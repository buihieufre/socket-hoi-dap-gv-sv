import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma Client Singleton
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create pg Pool
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

let prismaInstance: PrismaClient;

if (process.env.NODE_ENV !== "production") {
  prismaInstance =
    globalForPrisma.prisma ??
    new PrismaClient({
      adapter,
      log: ["query", "error", "warn"],
    });
  globalForPrisma.prisma = prismaInstance;
} else {
  prismaInstance =
    globalForPrisma.prisma ??
    new PrismaClient({
      adapter,
      log: ["error"],
    });
}

export const prisma = prismaInstance;
export default prisma;
