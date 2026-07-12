import { log } from "./log.js";

// 传输完成提示音（Web Audio API 合成，无需音频文件）
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/**
 * 播放柔和的两音上行提示（C5 → E5）。
 * 受 localStorage "landrop_sound" 开关控制（设为 "0" 关闭，默认开）。
 */
export function playChime(): void {
  if (localStorage.getItem("landrop_sound") === "0") return;
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    const now = ac.currentTime;
    (
      [
        [523.25, now],
        [659.25, now + 0.12],
      ] as const
    ).forEach(([freq, t]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch (e) {
    log.warn("提示音播放失败:", e);
  }
}
