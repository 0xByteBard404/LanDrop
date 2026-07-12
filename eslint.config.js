import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["frontend/lib/qrcode.min.js", "node_modules/", "dist/"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        QRCode: "readonly", // qrcode.min.js 以普通 script 提供
      },
    },
    rules: {
      // 未使用变量告警（_ 前缀的参数/变量豁免）
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // 已用 log 工具封装，log.js 内部仍需 console，故不禁止
      "no-console": "off",
      // 允许空 catch（用于忽略预期错误）
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
    },
  },
];
