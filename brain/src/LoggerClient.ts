import pino from "pino";

export function LoggerClient() {
  return pino({
    transport: {
      target: "pino-pretty",
      options: { translateTime: "dd-mm-yyyy HH:MM:ss Z" }, // Custom format
    },
  });
}
