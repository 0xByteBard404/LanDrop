// 统一日志工具：按 localStorage 控制级别，生产环境默认 info
// 用法：localStorage.setItem("landrop_log", "debug") 开启调试
const LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, none: 5 };

function currentLevel() {
  try {
    return LEVELS[localStorage.getItem("landrop_log")] ?? LEVELS.info;
  } catch {
    return LEVELS.info;
  }
}

function emit(level, args) {
  if (LEVELS[level] >= currentLevel()) {
    // trace/debug 统一走 console.log，其余用对应方法
    const fn = level === "trace" || level === "debug" ? "log" : level;
    console[fn](...args);
  }
}

export const log = {
  trace: (...a) => emit("trace", a),
  debug: (...a) => emit("debug", a),
  info: (...a) => emit("info", a),
  warn: (...a) => emit("warn", a),
  error: (...a) => emit("error", a),
};
