// Structured logger — emits JSON lines to stdout/stderr.
// Intentionally thin: no external dependency, easy to swap for pino/winston later.

type LogLevel = "info" | "warn" | "error" | "debug";

type LogEntry = {
  ts: string;
  level: LogLevel;
  service: string;
  message: string;
  [key: string]: unknown;
};

function write(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    service,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export function createLogger(service: string) {
  return {
    info:  (msg: string, meta?: Record<string, unknown>) => write("info",  service, msg, meta),
    warn:  (msg: string, meta?: Record<string, unknown>) => write("warn",  service, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => write("error", service, msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => write("debug", service, msg, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
