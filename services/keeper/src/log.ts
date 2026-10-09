import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "tunnel-keeper" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
