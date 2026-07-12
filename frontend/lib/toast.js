// 轻量 toast 通知：非阻塞，自动消失
let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 显示 toast 通知
 * @param {string} message - 消息文本
 * @param {"info"|"success"|"error"} type - 类型
 * @param {number} duration - 持续毫秒
 */
export function toast(message, type = "info", duration = 3500) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  ensureContainer().appendChild(el);
  // 进入动画（下一帧触发 transition）
  requestAnimationFrame(() => el.classList.add("toast-visible"));
  // 自动消失
  setTimeout(() => {
    el.classList.remove("toast-visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 300); // 兜底移除
  }, duration);
}
