// 统一日志工具：按 localStorage 控制级别，生产环境默认 info
// 用法：localStorage.setItem("landrop_log", "debug") 开启调试
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "none";

const LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  none: 5,
};

function currentLevel(): number {
  try {
    const key = localStorage.getItem("landrop_log") as LogLevel | null;
    return key ? (LEVELS[key] ?? LEVELS.info) : LEVELS.info;
  } catch {
    return LEVELS.info;
  }
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVELS[level] >= currentLevel()) {
    // trace/debug 统一走 console.log，其余用对应方法
    const fn = level === "trace" || level === "debug" ? "log" : level;
    console[fn as "log" | "info" | "warn" | "error"](...args);
  }
}

export const log = {
  trace: (...a: unknown[]) => emit("trace", a),
  debug: (...a: unknown[]) => emit("debug", a),
  info: (...a: unknown[]) => emit("info", a),
  warn: (...a: unknown[]) => emit("warn", a),
  error: (...a: unknown[]) => emit("error", a),
};
