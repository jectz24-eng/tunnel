import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

const globalForPrisma = globalThis as unknown as { __tunnelPrisma?: PrismaClient };

/** Shared Prisma client (one per process; reused across Next.js hot reloads). */
export function getDb(): PrismaClient {
  if (!globalForPrisma.__tunnelPrisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForPrisma.__tunnelPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return globalForPrisma.__tunnelPrisma;
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}
