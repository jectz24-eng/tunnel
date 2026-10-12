import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info"),
  base: { service: "tunnel-engine" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
