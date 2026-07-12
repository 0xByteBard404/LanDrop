// qrcode.min.js 全局类型声明（第三方 IIFE，普通 script 加载，暴露全局 QRCode）

interface QRCodeOptions {
  text?: string;
  width?: number;
  height?: number;
  colorDark?: string;
  colorLight?: string;
  correctLevel?: number;
}

declare class QRCode {
  constructor(element: HTMLElement | string, options?: QRCodeOptions | string);
  makeCode(text: string): void;
  makeImage(): void;
  clear(): void;
  static readonly CorrectLevel: {
    readonly L: 1;
    readonly M: 0;
    readonly Q: 3;
    readonly H: 2;
  };
}
