import { Server as IOServer } from "socket.io";
import { prisma } from "../config/database";
import { getTokenFromCookies, verifyToken } from "../config/auth";
import { sendFcmMessage } from "../config/firebase";

// Track emitted notifications to prevent duplicates
const emittedNotifications = new Set<string>();

function emitNotification(io: IOServer, userId: string, notif: any) {
  const notificationKey = `${userId}:${notif.id}`;

  if (emittedNotifications.has(notificationKey)) {
    console.log(
      `[Socket] ⚠️ Notification ${notif.id} already emitted to user ${userId}, skipping`
    );
    return;
  }

  emittedNotifications.add(notificationKey);

  if (emittedNotifications.size > 1000) {
    const entries = Array.from(emittedNotifications);
    entries.slice(0, 100).forEach((key) => emittedNotifications.delete(key));
  }

  const payload = {
    id: notif.id,
    title: notif.title,
    content: notif.content,
    link: notif.link,
    createdAt:
      notif.createdAt instanceof Date
        ? notif.createdAt.toISOString()
        : notif.createdAt || new Date().toISOString(),
  };
  console.log(`[Socket] Emitting notification to user:${userId}`, payload);
  io.to(`user:${userId}`).emit("notification:new", payload);
  console.log(`[Socket] ✓ Notification emitted to room user:${userId}`);
}

export function setupSocketHandlers(io: IOServer) {
  console.log("[Socket] Setting up socket handlers...");

  io.on("connection", (socket: any) => {
    console.log("[Socket] New connection attempt, socket ID:", socket.id);
    console.log("[Socket] Cookies present:", !!socket.handshake.headers.cookie);

    // Auth via cookie token (fallback to auth/query/header)
    try {
      const cookie = socket.handshake.headers.cookie || "";
      const tokenFromCookie = getTokenFromCookies(cookie);
      const tokenFromAuth = (socket.handshake.auth && socket.handshake.auth.token) || undefined;
      const tokenFromQuery = socket.handshake.query?.token;
      const authHeader = socket.handshake.headers.authorization;
      const tokenFromHeader = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      const token = tokenFromCookie || tokenFromAuth || tokenFromQuery || tokenFromHeader;
      if (!token) {
        console.error("[Socket] No token found (cookie/auth/query/header)");
        throw new Error("NO_TOKEN");
      }
      const payload = verifyToken(token);
      if (!payload?.userId || !payload.role) {
        console.error("[Socket] Invalid token payload:", payload);
        throw new Error("INVALID_TOKEN");
      }
      socket.data.user = {
        userId: payload.userId as string,
        fullName: (payload as any).fullName,
        role: payload.role as string,
        email: (payload as any).email,
      };
      socket.join(`user:${payload.userId}`);
      console.log(
        `[Socket] ✓ User ${payload.userId} authenticated and joined room`
      );
    } catch (err: any) {
      console.error("[Socket] ✗ Authentication failed:", err.message);
      socket.emit("auth_error", {
        message: "Authentication failed",
        details: err.message || "Unknown error",
      });
      setTimeout(() => {
        socket.disconnect(true);
      }, 100);
      return;
    }

    socket.on("join-user", (userId: string) => {
      if (userId) socket.join(`user:${userId}`);
    });
    socket.on("join-question", (qid: string) => {
      if (qid) socket.join(`question:${qid}`);
    });
    socket.on("leave-question", (qid: string) => {
      if (qid) socket.leave(`question:${qid}`);
    });

    // Handle answer creation via socket (emit first, persist later)
    socket.on(
      "answer:send",
      async (
        payload: { questionId?: string; content?: any; tempId?: string },
        cb?: (resp: { ok?: boolean; error?: string }) => void
      ) => {
        try {
          const user = socket.data.user;
          if (!user?.userId) throw new Error("UNAUTHENTICATED");
          const questionId = payload?.questionId;
          const content = payload?.content;
          if (!questionId) throw new Error("Thiếu questionId");
          if (!content || (content.blocks && content.blocks.length === 0)) {
            throw new Error("Nội dung trả lời không được để trống");
          }

          const question = await prisma.question.findUnique({
            where: { id: questionId },
            select: {
              id: true,
              title: true,
              authorId: true,
              approvalStatus: true,
            },
          });
          if (!question) throw new Error("Không tìm thấy câu hỏi");
          if (question.approvalStatus !== "APPROVED") {
            throw new Error("Câu hỏi chưa được duyệt nên không thể trả lời");
          }

          const contentToSave =
            typeof content === "string" ? content : JSON.stringify(content);

          const tempId = payload?.tempId || `temp-${Date.now()}`;
          const optimisticAnswer = {
            id: tempId,
            content: contentToSave,
            isPinned: false,
            author: {
              id: user.userId,
              fullName: user.fullName,
              role: user.role,
            },
            createdAt: new Date().toISOString(),
            questionId,
            votesCount: 0,
          };
          io.to(`question:${questionId}`).emit("answer:new", optimisticAnswer);
          if (question.authorId) {
            io.to(`user:${question.authorId}`).emit(
              "answer:new",
              optimisticAnswer
            );
          }
          cb?.({ ok: true });

          try {
            const answer = await prisma.answer.create({
              data: {
                content: contentToSave,
                questionId,
                authorId: user.userId,
              },
              include: {
                author: {
                  select: { id: true, fullName: true, role: true },
                },
              },
            });

            const persistedPayload = {
              id: answer.id,
              content: answer.content,
              isPinned: answer.isPinned,
              author: answer.author,
              createdAt: answer.createdAt,
              questionId,
              votesCount: 0,
            };

            io.to(`question:${questionId}`).emit("answer:replace", {
              tempId,
              answer: persistedPayload,
            });
            if (question.authorId) {
              io.to(`user:${question.authorId}`).emit("answer:replace", {
                tempId,
                answer: persistedPayload,
              });
            }

            const recipients = new Set<string>();
            if (question.authorId && question.authorId !== user.userId) {
              recipients.add(question.authorId);
            }

            const watchers = await prisma.questionWatcher.findMany({
              where: {
                questionId,
                userId: { not: user.userId },
              },
              select: { userId: true },
            });

            watchers.forEach((w) => {
              if (w.userId && w.userId !== question.authorId) {
                recipients.add(w.userId);
              }
            });

            const link = `/questions/${questionId}#answer-${answer.id}`;

            await Promise.allSettled(
              Array.from(recipients).map(async (recipientId) => {
                try {
                  const existingNotif = await prisma.notification.findFirst({
                    where: {
                      userId: recipientId,
                      type: "ANSWER_CREATED",
                      questionId,
                      answerId: answer.id,
                    },
                  });

                  let notif;
                  if (existingNotif) {
                    notif = existingNotif;
                  } else {
                    notif = await prisma.notification.create({
                      data: {
                        userId: recipientId,
                        type: "ANSWER_CREATED",
                        title: "Có câu trả lời mới",
                        content: `Câu hỏi "${question.title}" vừa có câu trả lời mới.`,
                        link,
                        meta: {
                          questionId,
                          answerId: answer.id,
                        },
                        questionId,
                        answerId: answer.id,
                      },
                    });
                  }

                  emitNotification(io, recipientId, notif);

                  try {
                    const tokens = await prisma.notificationToken.findMany({
                      where: { userId: recipientId, revokedAt: null },
                      select: { fcmToken: true },
                    });
                    if (tokens.length > 0) {
                      await Promise.allSettled(
                        tokens.map((t) =>
                          sendFcmMessage({
                            token: t.fcmToken,
                            notification: {
                              title: "Có câu trả lời mới",
                              body: question.title,
                            },
                            data: { link, questionId, answerId: answer.id },
                            link,
                          }).catch((err) =>
                            console.error(`[Socket] ✗ FCM send failed:`, err)
                          )
                        )
                      );
                    }
                  } catch (fcmErr) {
                    console.error(
                      `[Socket] ✗ FCM token lookup failed:`,
                      fcmErr
                    );
                  }
                } catch (err: any) {
                  console.error(
                    `[Socket] ✗ Failed to create/send notification:`,
                    err?.message || err
                  );
                }
              })
            );
          } catch (err) {
            io.to(`question:${questionId}`).emit("answer:remove-temp", {
              tempId,
            });
            if (question.authorId) {
              io.to(`user:${question.authorId}`).emit("answer:remove-temp", {
                tempId,
              });
            }
          }
        } catch (err: any) {
          cb?.({ ok: false, error: err?.message || "Lỗi gửi trả lời" });
        }
      }
    );

    // Handle answer update via socket
    socket.on(
      "answer:update",
      async (
        payload: {
          questionId?: string;
          answerId?: string;
          content?: any;
          editCount?: number;
          editedAt?: string;
          originalContent?: string;
        },
        cb?: (resp: { ok?: boolean; error?: string }) => void
      ) => {
        try {
          const user = socket.data.user;
          if (!user?.userId) {
            cb?.({ ok: false, error: "UNAUTHENTICATED" });
            return;
          }
          const questionId = payload?.questionId;
          const answerId = payload?.answerId;
          const content = payload?.content;
          if (!questionId || !answerId) {
            cb?.({ ok: false, error: "Thiếu questionId hoặc answerId" });
            return;
          }
          if (!content) {
            cb?.({ ok: false, error: "Nội dung không được để trống" });
            return;
          }

          const answer = await prisma.answer.findUnique({
            where: { id: answerId },
            include: {
              author: {
                select: { id: true, fullName: true, role: true },
              },
              question: {
                select: { id: true, approvalStatus: true },
              },
            },
          });

          if (!answer) {
            cb?.({ ok: false, error: "Không tìm thấy câu trả lời" });
            return;
          }

          if (answer.authorId !== user.userId) {
            cb?.({
              ok: false,
              error: "Bạn chỉ có thể chỉnh sửa câu trả lời của mình",
            });
            return;
          }

          const editCount = (answer as any).editCount || 0;
          if (editCount >= 1) {
            cb?.({
              ok: false,
              error: "Câu trả lời chỉ có thể chỉnh sửa một lần",
            });
            return;
          }

          if (answer.question.approvalStatus !== "APPROVED") {
            cb?.({
              ok: false,
              error:
                "Không thể chỉnh sửa câu trả lời cho câu hỏi chưa được duyệt",
            });
            return;
          }

          let contentToSave: string;
          if (typeof content === "string") {
            if (!content.trim()) {
              cb?.({ ok: false, error: "Nội dung không được để trống" });
              return;
            }
            contentToSave = content.trim();
          } else if (content && typeof content === "object") {
            if (
              Array.isArray((content as any).blocks) &&
              (content as any).blocks.length === 0
            ) {
              cb?.({ ok: false, error: "Nội dung không được để trống" });
              return;
            }
            contentToSave = JSON.stringify(content);
          } else {
            cb?.({ ok: false, error: "Định dạng nội dung không hợp lệ" });
            return;
          }

          const optimisticPayload = {
            id: answerId,
            content: contentToSave,
            author: answer.author,
            editCount: payload.editCount ?? 1,
            editedAt: payload.editedAt || new Date().toISOString(),
            originalContent: payload.originalContent || answer.content,
            questionId,
          };
          io.to(`question:${questionId}`).emit(
            "answer:updated",
            optimisticPayload
          );
          cb?.({ ok: true });

          try {
            const updateData: any = {
              content: contentToSave,
              editCount: 1,
              editedAt: new Date(),
            };

            if (editCount === 0 || !(answer as any).originalContent) {
              updateData.originalContent = answer.content;
            } else {
              updateData.originalContent = (answer as any).originalContent;
            }

            const updatedAnswer = await prisma.answer.update({
              where: { id: answerId },
              data: updateData,
              include: {
                author: {
                  select: { id: true, fullName: true, role: true },
                },
              },
            });

            const answerData = updatedAnswer as any;
            const persistedPayload = {
              id: updatedAnswer.id,
              content: updatedAnswer.content,
              author: updatedAnswer.author,
              editCount: answerData.editCount ?? 1,
              editedAt:
                answerData.editedAt?.toISOString() || new Date().toISOString(),
              originalContent: answerData.originalContent ?? null,
              questionId,
            };
            io.to(`question:${questionId}`).emit(
              "answer:updated",
              persistedPayload
            );
          } catch (dbError: any) {
            console.error(
              "[Socket] ✗ Error persisting answer update:",
              dbError
            );
            io.to(`question:${questionId}`).emit("answer:update-failed", {
              id: answerId,
              questionId,
              error: dbError.message || "Lỗi cập nhật câu trả lời",
            });
          }
        } catch (err: any) {
          console.error("[Socket] Error handling answer:update:", err);
          cb?.({
            ok: false,
            error: err?.message || "Lỗi cập nhật câu trả lời",
          });
        }
      }
    );

    // Handle chat message via socket
    socket.on(
      "message:send",
      async (
        payload: { questionId?: string; content?: any },
        cb?: (resp: { ok?: boolean; error?: string; message?: any }) => void
      ) => {
        try {
          const user = socket.data.user;
          if (!user?.userId) throw new Error("UNAUTHENTICATED");
          const questionId = payload?.questionId;
          const content = payload?.content;
          if (!questionId) throw new Error("Thiếu questionId");
          if (!content || (content.blocks && content.blocks.length === 0)) {
            throw new Error("Nội dung tin nhắn không được để trống");
          }

          const question = await prisma.question.findUnique({
            where: { id: questionId },
            select: {
              id: true,
              title: true,
              authorId: true,
            },
          });
          if (!question) throw new Error("Không tìm thấy câu hỏi");

          const contentToSave =
            typeof content === "string" ? content : JSON.stringify(content);

          const message = await prisma.questionMessage.create({
            data: {
              questionId,
              senderId: user.userId,
              content: contentToSave,
            },
            include: {
              sender: { select: { id: true, fullName: true, role: true } },
            },
          });

          const recipients = new Set<string>();
          if (question.authorId && question.authorId !== user.userId) {
            recipients.add(question.authorId);
          }

          const watchers = await prisma.questionWatcher.findMany({
            where: {
              questionId,
              userId: { not: user.userId },
            },
            select: { userId: true },
          });

          watchers.forEach((w) => {
            if (w.userId && w.userId !== question.authorId) {
              recipients.add(w.userId);
            }
          });

          const payloadMsg = {
            id: message.id,
            content: message.content,
            sender: message.sender,
            createdAt: message.createdAt,
            questionId,
          };

          io.to(`question:${questionId}`).emit("message:new", payloadMsg);
          recipients.forEach((uid) => {
            io.to(`user:${uid}`).emit("message:new", payloadMsg);
          });

          cb?.({ ok: true, message: payloadMsg });

          const link = `/questions/${questionId}#message-${message.id}`;
          await Promise.allSettled(
            Array.from(recipients).map(async (uid) => {
              try {
                const existingNotif = await prisma.notification.findFirst({
                  where: {
                    userId: uid,
                    type: "MESSAGE_CREATED",
                    questionId,
                    answerId: message.id,
                  },
                });

                let notif;
                if (existingNotif) {
                  notif = existingNotif;
                } else {
                  notif = await prisma.notification.create({
                    data: {
                      userId: uid,
                      type: "MESSAGE_CREATED",
                      title: "Tin nhắn mới",
                      content: `Câu hỏi "${question.title}" có tin nhắn mới`,
                      link,
                      meta: { questionId, messageId: message.id },
                      questionId,
                      answerId: message.id,
                    },
                  });
                }

                emitNotification(io, uid, notif);

                const tokens = await prisma.notificationToken.findMany({
                  where: { userId: uid, revokedAt: null },
                  select: { fcmToken: true },
                });
                await Promise.allSettled(
                  tokens.map((t) =>
                    sendFcmMessage({
                      token: t.fcmToken,
                      notification: {
                        title: "Tin nhắn mới",
                        body: question.title,
                      },
                      data: { link, questionId, messageId: message.id },
                      link,
                    }).catch((err) => console.error("FCM send failed", err))
                  )
                );
              } catch (err: any) {
                console.error(
                  `[Socket] ✗ Failed to create/send notification:`,
                  err?.message || err
                );
              }
            })
          );
        } catch (err: any) {
          cb?.({ ok: false, error: err?.message || "Lỗi gửi tin nhắn" });
        }
      }
    );
  });

  console.log("[Socket] ✓ Socket handlers setup complete");
}
