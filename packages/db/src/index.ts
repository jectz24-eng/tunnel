import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

const globalForPrisma = globalThis as unknown as { __tunnelPrisma?: PrismaClient };

/** Shared Prisma client (one per process; reused across Next.js hot reloads). */
export function getDb(): PrismaClient {
  if (!globalForPrisma.__tunnelPrisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForPrisma.__tunnelPrisma = new PrismaClient({
      // DATABASE_POOL_MAX=1 for the local PGlite emulator, which cannot interleave queries from parallel connections.
      adapter: new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) }),
    });
  }
  return globalForPrisma.__tunnelPrisma;
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}
