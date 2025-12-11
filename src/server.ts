import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { setupSocketHandlers } from "./socket/socket-handler";

const app = express();
const httpServer = createServer(app);

// CORS configuration
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || "*";
const allowedOrigins =
  allowedOriginsEnv === "*"
    ? "*"
    : allowedOriginsEnv.split(",").map((origin) => origin.trim());

console.log(
  `[Server] CORS allowed origins: ${
    allowedOrigins === "*" ? "* (all)" : allowedOrigins.join(", ")
  }`
);

// Express CORS middleware
app.use(
  cors({
    origin:
      allowedOrigins === "*"
        ? true
        : (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error("Not allowed by CORS"));
            }
          },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Socket.IO CORS configuration
const corsConfig: any = {
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};

if (allowedOrigins === "*") {
  corsConfig.origin = true;
  console.log(
    "[Socket Server] Using wildcard origin (auto-detect from request)"
  );
} else {
  corsConfig.origin = (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin) {
      console.log("[Socket Server] Allowing request with no origin");
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      console.log(`[Socket Server] ✓ Allowing origin: ${origin}`);
      callback(null, true);
    } else {
      console.warn(`[Socket Server] ✗ CORS blocked origin: ${origin}`);
      console.warn(
        `[Socket Server] Allowed origins: ${allowedOrigins.join(", ")}`
      );
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  };
}

// Initialize Socket.IO server
const io = new SocketIOServer(httpServer, {
  path: "/socket.io",
  cors: corsConfig,
  transports: ["websocket", "polling"],
});

// Setup socket handlers
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

httpServer.listen(Number(PORT), HOST as string, () => {
  console.log(`> Socket.IO server ready on http://${HOST}:${PORT}`);
  console.log(`> Socket.IO path: /socket.io`);
  console.log(
    `> CORS allowed origins: ${
      allowedOrigins === "*" ? "* (all)" : allowedOrigins.join(", ")
    }`
  );
});
