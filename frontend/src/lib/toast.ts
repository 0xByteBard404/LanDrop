// 轻量 toast 通知：非阻塞，自动消失
type ToastType = "info" | "success" | "error";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
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
 * @param message 消息文本
 * @param type 类型
 * @param duration 持续毫秒
 */
export function toast(message: string, type: ToastType = "info", duration = 3500): void {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  ensureContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast-visible"));
  setTimeout(() => {
    el.classList.remove("toast-visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 300); // 兜底移除
  }, duration);
}
