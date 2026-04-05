# LanDrop

局域网 P2P 文件与文本传输工具。基于 WebRTC DataChannel 实现浏览器端到端直传，无需安装客户端，打开即用。

## 功能

- **文件传输** — 支持多文件并行传输，单文件上限 512MB，SHA-256 校验保证完整性
- **文本传输** — 支持发送链接、笔记等文本内容，上限 1MB；可选 WebRTC 安全传输 (E2E 加密)
- **P2P 直传** — WebRTC DataChannel 端到端传输，数据不经过服务器；安全文本通过 DTLS 加密
- **SCTP 重传** — 自动检测并重传丢失的 SCTP 分块，确保传输可靠完成
- **即时发现** — 自动发现局域网内其他设备，无需手动配对
- **拖拽发送** — 拖拽文件到设备卡片即可发起传输
- **QR 码访问** — 点击二维码按钮，手机扫码直接访问
- **浏览器通知** — 收到文件/文本/群聊消息时弹出系统通知
- **自定义设备名** — 点击顶部名称即可修改，其他设备实时同步
- **发送限速** — 可选不限 / 1 / 5 / 10 MB/s，避免占满局域网带宽
- **图片/视频预览** — 传输完成后可直接预览图片和视频，支持下载
- **局域网群聊** — 在线设备之间的实时群聊
- **暗色主题** — 玻璃拟态 UI，响应式布局，手机/平板友好

## 架构

```
浏览器 A ←── WebSocket ──→ 信令服务器(Rust/axum) ←── WebSocket ──→ 浏览器 B
                │                                                       │
                └──────── WebRTC DataChannel (P2P 直连) ────────────────┘
```

- **信令服务器**：Rust + axum，负责节点注册、设备发现、SDP/ICE 交换、明文文本中转
- **前端**：原生 JS，WebRTC API 建立 P2P 连接，独立 RTCPeerConnection 管理每个传输任务
- **安全文本**：勾选「安全传输」时通过 WebRTC DataChannel 传输，DTLS 自动提供端到端加密，在 HTTP 局域网下也可用

## 快速开始

### 前置条件

- Rust 1.70+
- 局域网环境

### 运行

```bash
cargo run
```

启动后终端会显示访问地址：

```
LanDrop v0.1.0 已启动！
本机访问:    http://localhost:3000
局域网访问:  http://192.168.x.x:3000
文件大小上限: 512 MB
```

在局域网内的其他设备浏览器打开对应地址即可使用。

### 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-p, --port` | `3000` | 监听端口 |
| `-s, --static-dir` | `./frontend` | 前端静态文件目录 |
| `-l, --log-level` | `info` | 日志级别 (trace/debug/info/warn/error) |
| `-m, --max-file-size-mb` | `512` | 单文件大小上限 (MB) |

## 项目结构

```
src/
  main.rs          # 入口，HTTP 服务器，静态文件托管
  config.rs        # CLI 参数解析
  signaling.rs     # WebSocket 信令处理，消息路由
  node.rs          # 节点注册表，状态管理
  name_gen.rs      # 随机设备名生成

frontend/
  index.html       # 页面结构
  style.css        # 样式（暗色主题）
  app.js           # UI 交互逻辑
  signaling.js     # WebSocket 信令客户端
  webrtc.js        # WebRTC 连接与文件传输引擎
```

## 技术栈

- **后端**：Rust, axum 0.8, tokio, tower-http, dashmap
- **前端**：原生 JavaScript, WebRTC API, CSS Variables
- **传输**：WebRTC DataChannel (SCTP), SHA-256 文件校验

## 许可

MIT
