# Socket.IO Server

Express.js server chuyên dụng cho Socket.IO của hệ thống Q&A.

## Cài đặt

```bash
npm install
```

## Cấu hình

1. Copy `.env.example` thành `.env`
2. Điền các biến môi trường cần thiết:
   - `DATABASE_URL`: PostgreSQL connection string (dùng chung database với app chính)
   - `JWT_SECRET`: Secret key để verify JWT token (phải giống với app chính)
   - `ALLOWED_ORIGINS`: Các origin được phép kết nối (hoặc `*` để cho phép tất cả)
   - `FIREBASE_SERVICE_ACCOUNT_JSON` hoặc `FIREBASE_SERVICE_ACCOUNT_B64`: Firebase credentials cho FCM
   - `PORT`: Port để chạy server (mặc định: 3001)

## Chạy

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Database

Server này dùng chung database với app chính. Cần chạy Prisma generate trước:

```bash
npm run db:generate
```

## Socket.IO Events

### Client → Server

- `join-user`: Join user room
- `join-question`: Join question room
- `leave-question`: Leave question room
- `answer:send`: Gửi câu trả lời mới
- `answer:update`: Cập nhật câu trả lời
- `message:send`: Gửi tin nhắn

### Server → Client

- `notification:new`: Thông báo mới
- `answer:new`: Câu trả lời mới (optimistic)
- `answer:replace`: Thay thế câu trả lời tạm bằng câu trả lời thật
- `answer:updated`: Câu trả lời đã được cập nhật
- `answer:remove-temp`: Xóa câu trả lời tạm
- `message:new`: Tin nhắn mới
- `auth_error`: Lỗi xác thực

## Kết nối từ Client

Trong app Next.js, set biến môi trường:

```env
NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.com
```

Client sẽ tự động kết nối đến `/socket.io` path.
