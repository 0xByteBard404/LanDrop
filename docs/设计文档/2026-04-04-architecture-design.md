# LanDrop - 局域网文件传输工具 架构设计

> 日期: 2026-04-04
> 版本: v5（第四轮评审修复）
> 状态: 待评审

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 整体架构](#2-整体架构)
- [3. 信令协议规范](#3-信令协议规范)
- [4. 控制通道协议规范](#4-控制通道协议规范)
- [5. WebRTC 文件传输](#5-webrtc-文件传输)
- [6. 连接生命周期管理](#6-连接生命周期管理)
- [7. 文件传输状态机](#7-文件传输状态机)
- [8. 安全设计](#8-安全设计)
- [9. 技术栈](#9-技术栈)
- [10. 项目结构](#10-项目结构)
- [11. 服务器设计](#11-服务器设计)
- [12. 风险与应对](#12-风险与应对)
- [13. 可行性结论](#13-可行性结论)

---

## 1. 项目概述

一个 AirDrop 风格的局域网文件传输工具。用户在浏览器中打开服务地址，自动获得节点身份，即可与其他在线节点互传文件。文件传输走 WebRTC P2P 直连，不经过服务器中转。

### 核心特性

- 零安装：浏览器即客户端，无需安装 App
- 零外网依赖：纯局域网运行，无需 STUN/TURN 服务器
- 单文件部署：一个 Rust 二进制，无运行时依赖
- 端到端加密：WebRTC 内置 DTLS 加密
- 传输校验：SHA-256 哈希校验，确保文件完整性

### 版本约束

| 约束项 | v1 限制 | 未来扩展 |
|--------|---------|----------|
| 单文件大小上限 | 500 MB | File System Access API 流式写入 |
| 文件夹传输 | 不支持 | 打包为 zip 或扩展协议 |
| 并发传输 | 每对端同时 1 个传输任务 | 支持多任务队列 |
| HTTPS | 仅 localhost 安全上下文 | 嵌入自签名证书 |

> **500 MB 上限理由：** 接收方需将所有分片缓存在内存中再合并 Blob，加上浏览器自身开销，2GB 文件可能需要 ~4GB 内存。发送方也需要将整个文件读入内存用于 SHA-256 计算（Web Crypto API `digest()` 不支持流式）。超过 500 MB 的文件前端提示"文件过大，v2 将支持"。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    局域网 (LAN)                      │
│                                                     │
│  ┌──────┐  WebSocket(信令)  ┌──────────────┐        │
│  │设备 A │◄──────────────►  │              │        │
│  │浏览器 │                   │ Rust 信令服务器│        │
│  └──┬───┘  WebSocket(信令)  │ (axum+tokio)  │        │
│     │    ◄──────────────►  │              │        │
│  ┌──┴───┐                   └──────┬───────┘        │
│  │设备 B │                          │                │
│  │浏览器 │    同时提供静态前端页面      │                │
│  └──────┘                           │                │
│                                     │                │
│  设备 A ◄── WebRTC DataChannel ──► 设备 B            │
│           (P2P 直连, DTLS 加密)                       │
└─────────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 职责 |
|------|------|
| Rust 服务器 | (1) 托管前端静态文件 (2) WebSocket 信令中继 (3) 节点身份管理与验证 |
| 浏览器前端 | UI 交互 + WebRTC 连接建立 + 文件分片传输 |
| WebRTC DataChannel | P2P 二进制数据传输，DTLS 加密 |

### 数据流时序图

```
设备A(发送方)          信令服务器          设备B(接收方)
     │                    │                    │
     │── WS 连接 ────────►│                    │
     │── join ───────────►│                    │
     │◄── joined ─────────│                    │
     │                    │◄──── WS 连接 ──────│
     │                    │◄──── join ─────────│
     │                    │───── joined ──────►│
     │                    │                    │
     │── offer-file ─────►│── offer-file ─────►│
     │                    │◄── accept-file ────│
     │◄── accept-file ───│                    │
     │                    │                    │
     │── sdp-offer ──────►│── sdp-offer ──────►│
     │                    │◄── sdp-answer ─────│
     │◄── sdp-answer ────│                    │
     │◄── ice-candidate ─│◄── ice-candidate ──│
     │── ice-candidate ─►│── ice-candidate ──►│
     │                    │                    │
     │◄═══ WebRTC DataChannel (P2P 直连) ═════►│
     │─────── 文件分片传输 ────────────────────►│
     │                    │                    │
```

---

## 3. 信令协议规范

### 3.1 协议版本

所有信令消息基于 JSON 格式。协议版本通过 `join` 消息声明：

```json
{ "type": "join", "name": "橘色狐狸 #7", "protocolVersion": 1 }
```

服务器检查版本号，不匹配时拒绝连接并返回错误。`nodeId` 由服务器在 `joined` 响应中分配，客户端不应发送该字段。

### 3.2 身份验证机制

**服务器强制替换 `from` 字段。** 客户端发送的消息中 `from` 字段会被忽略，服务器使用该 WebSocket 连接注册时的 `nodeId` 作为来源标识。这防止了消息伪造攻击。

```rust
// 服务端伪代码：处理每条转发消息时
fn route_message(msg: &mut SignalingMessage, sender_id: &NodeId) {
    msg.from = sender_id.clone(); // 强制替换，忽略客户端传的值
    let target = &msg.to;
    route_to(target, msg);
}
```

### 3.3 完整消息格式

#### 节点管理

```json
// 节点上线（客户端 → 服务器，不含 nodeId）
{ "type": "join", "name": "橘色狐狸 #7", "protocolVersion": 1 }

// 服务器确认加入（服务器 → 客户端）
{ "type": "joined", "nodeId": "srv-generated-abc123", "name": "橘色狐狸 #7",
  "peers": [
    {"id":"def456","name":"蓝色海豚"}
  ]
}

// 注意：joined 的 "peers" 字段与广播消息 "peers" 的 "list" 字段结构一致
// 统一为 peers 消息的 list 格式，joined 中的列表同理
// peers[i] = { "id": string, "name": string }

// 版本不匹配拒绝（服务器 → 客户端）
{ "type": "error", "code": "protocol_version_mismatch",
  "message": "Unsupported protocol version" }

// 在线列表同步（服务器广播）
{ "type": "peers", "list": [
    {"id":"abc123","name":"橘色狐狸"},
    {"id":"def456","name":"蓝色海豚"}
  ]
}

// peers 广播时机：
// 1. 节点加入后 → 广播给除新节点外的所有节点（新节点通过 joined 消息获取）
// 2. 节点离线后 → 广播给所有剩余在线节点
// 3. 列表中不包含接收者自身（每节点收到的列表 = 其他所有在线节点）

// 节点离线（服务器广播）
{ "type": "leave", "nodeId": "abc123" }
```

#### 文件传输协商

每个传输任务通过 `transferId` (UUID) 唯一标识，用于关联后续的所有消息。

> **`offer-file` 与 `start` 的职责区分：** `offer-file` 是信令阶段的元数据，用于接收方 UI 展示和用户决策（文件名、大小等）；`start` 是 DataChannel 建立后的传输参数，用于接收方校验和重组。两者的元数据字段必须一致，如有冲突以 `start` 为准（因为此时传输参数已最终确定）。

```json
// 发送文件请求（信令阶段，供用户预览和决策）
{ "type": "offer-file", "from": "abc123", "to": "def456",
  "transferId": "xfr-uuid-001",
  "fileName": "photo.jpg",
  "fileSize": 2048576,
  "mimeType": "image/jpeg" }

// 接收方接受
{ "type": "accept-file", "from": "def456", "to": "abc123",
  "transferId": "xfr-uuid-001" }

// 接收方拒绝
{ "type": "reject-file", "from": "def456", "to": "abc123",
  "transferId": "xfr-uuid-001", "reason": "user_rejected" }

// 接收方拒绝（文件过大）
{ "type": "reject-file", "from": "def456", "to": "abc123",
  "transferId": "xfr-uuid-001", "reason": "file_too_large",
  "maxSize": 524288000 }

// 接收方正忙（已有传输进行中，服务端或接收方返回）
{ "type": "busy", "from": "def456", "to": "abc123",
  "transferId": "xfr-uuid-001", "reason": "transfer_in_progress" }
```

#### 传输取消与错误

```json
// 任意方取消传输
{ "type": "cancel-transfer", "from": "abc123", "to": "def456",
  "transferId": "xfr-uuid-001", "reason": "user_cancelled" }

// 传输错误通知
{ "type": "transfer-error", "from": "abc123", "to": "def456",
  "transferId": "xfr-uuid-001", "error": "channel_closed" }

// 取消/错误原因枚举
// "user_cancelled" — 用户主动取消（reject-file / cancel-transfer）
// "file_too_large" — 文件超过接收方限制（reject-file，附 maxSize 字段）
// "timeout" — 等待响应超时（cancel-transfer）
// "ice_timeout" — ICE 连接超时（30s）（transfer-error）
// "channel_closed" — DataChannel 异常断开（transfer-error）
// "hash_mismatch" — 传输完成但哈希校验失败（transfer-error）
// "transfer_in_progress" — 对方正忙，已有传输进行中（busy 消息专用）
```

#### 文件请求超时

`offer-file` 发出后，发送方启动 **60 秒**倒计时。超时未收到 `accept-file` 或 `reject-file`，发送方自动清理等待状态，UI 提示"请求已超时"。

#### WebRTC 信令

```json
{ "type": "sdp-offer",    "from": "abc123", "to": "def456",
  "transferId": "xfr-uuid-001", "sdp": "..." }
{ "type": "sdp-answer",   "from": "def456", "to": "abc123",
  "transferId": "xfr-uuid-001", "sdp": "..." }
{ "type": "ice-candidate", "from": "abc123", "to": "def456",
  "transferId": "xfr-uuid-001", "candidate": {...} }
```

#### 心跳

使用 **WebSocket 原生 ping/pong frame**，不占用应用层消息通道。

- 服务端每 30 秒向客户端发送 WebSocket ping frame
- 客户端 60 秒内未回复 pong，服务端判定离线，清理节点并广播 `leave`
- 浏览器 WebSocket 自动回复 pong，无需前端代码处理

### 3.4 服务端节点管理

```rust
// 概念示意（非完整实现）
struct AppState {
    /// nodeId -> WebSocket 发送端
    nodes: DashMap<NodeId, SplitSink<WebSocket, Message>>,
    /// nodeId -> 节点信息
    node_info: DashMap<NodeId, NodeInfo>,
}

struct NodeInfo {
    id: NodeId,
    name: String,
    protocol_version: u32,
    connected_at: Instant,
}
```

---

## 4. 控制通道协议规范

WebRTC 建立后，每对节点间打开两条 DataChannel。控制通道承载文本 JSON 消息，用于文件传输的元数据交换和状态同步。

### 4.1 控制通道消息格式

```json
// 文件传输开始（发送方 → 接收方，DataChannel open 后发送）
// 包含完整传输参数，是传输的权威参数源（与 offer-file 重复字段必须一致）
{ "type": "start", "transferId": "xfr-uuid-001",
  "fileName": "photo.jpg", "fileSize": 2048576,
  "mimeType": "image/jpeg", "totalChunks": 125,
  "chunkSize": 16384, "fileHash": "sha256-abc..." }

// 分片确认（接收方 → 发送方，每接收 N 个分片回报一次）
{ "type": "progress", "transferId": "xfr-uuid-001",
  "receivedChunks": 50, "totalChunks": 125 }

// 传输完成（发送方 → 接收方，所有分片已发送且缓冲区已排空）
// ⚠️ 发送方必须等待 dataChannel.bufferedAmount === 0 后再发送此消息
//    因为控制通道和数据通道是独立的，缓冲区中的数据可能尚未到达接收方
{ "type": "complete", "transferId": "xfr-uuid-001",
  "totalChunks": 125 }

// 传输完成确认（接收方 → 发送方，校验通过后发送）
{ "type": "done", "transferId": "xfr-uuid-001",
  "hashMatch": true }

// 哈希校验失败
{ "type": "done", "transferId": "xfr-uuid-001",
  "hashMatch": false, "error": "hash_mismatch" }
```

**重试策略：** v1 `hashMatch=false` 后直接判定传输失败，回到 IDLE，不自动重试。用户可手动重新发起传输。原因：哈希校验失败通常意味着数据严重损坏，重传整个文件比选择性重传更简单可靠。v2 可考虑基于分片 ACK 的选择性重传。

### 4.2 数据通道分片格式

数据通道只传输二进制 `ArrayBuffer`。每个分片的前 4 字节为分片序号（big-endian `Uint32`），后续为实际文件数据：

```
┌──────────────┬──────────────────────────────┐
│ 序号 (4 bytes) │      文件数据 (16KB)          │
│  0x00000000   │      ...                    │
└──────────────┴──────────────────────────────┘
```

接收方通过序号判断：
- 是否有分片丢失（序号不连续）
- 传输是否完整（收到序号 == totalChunks - 1）
- 乱序到达时正确重组（使用序号排序）

**最后分片处理：** 最后一个分片的数据部分可能小于 16KB。接收方通过 `totalChunks` 和 `fileSize` 可精确计算最后一块的大小：`lastChunkSize = fileSize - (totalChunks - 1) * chunkSize`。接收方必须按实际大小截取，而非假设固定 16KB。

### 4.3 校验流程

> **SHA-256 计算说明：** Web Crypto API 的 `crypto.subtle.digest('SHA-256', buffer)` 需要整个文件数据作为 `ArrayBuffer` 传入，不支持流式分块计算。v1 限制文件 500MB 以控制内存峰值。v2 将使用 `SubtleCrypto.digest` 的流式替代方案（如第三方库 `jsSHA` 或 Wasm 实现）。

```
发送方                              接收方
  │                                   │
  │── start (含 fileHash) ──────────► │ 记录期望的 hash
  │── 分片数据 ──────────────────────► │ 按序号缓冲
  │── complete ──────────────────────► │ 合并所有分片
  │                                   │ 计算 SHA-256
  │                                   │ 对比 fileHash
  │◄── done (hashMatch=true/false) ── │
  │                                   │
  │ hashMatch=true → 触发浏览器下载     │
  │ hashMatch=false → 通知传输失败      │
```

### 4.4 DataChannel 事件处理

DataChannel 的 `close` 和 `error` 事件是传输中断检测的核心机制，必须在建立时注册：

```javascript
channel.onclose = () => {
  // 传输中断：清理状态，UI 提示"连接已断开"
  // 如果有进行中的传输，通过信令通知对方
};

channel.onerror = (e) => {
  // 记录错误日志，触发与 onclose 相同的清理逻辑
};
```

### 4.5 接收方文件下载

校验通过后，接收方通过浏览器 API 触发文件保存：

```javascript
// 合并所有分片为 Blob
const blob = new Blob(chunks, { type: mimeType });
// 创建下载链接
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = fileName;
a.click();
// 释放内存
URL.revokeObjectURL(url);
```

> **注意：** `URL.createObjectURL` 在大文件时不会额外复制内存，浏览器内部使用引用。但合并前的分片数组仍然占用完整内存，传输完成后应清空。

---

## 5. WebRTC 文件传输

### 5.1 传输流程

```
发送方                                    接收方
  │                                         │
  ├─ 读取文件 File API                       │
  ├─ 计算 SHA-256 哈希                       │
  ├─ 切片 16KB/块，每块前缀 4 字节序号         │
  │                                         │
  ├── 控制通道 ── start ───────────────────► │ 记录元数据
  │                                         │
  ├──── 数据通道 ──── chunk #0 ────────────► │ 按序号缓冲
  ├──── 数据通道 ──── chunk #1 ────────────► │
  ├─ 检查 bufferedAmount                     │
  │  (>阈值时暂停, 等 bufferedamountlow 事件)   │
  ├──── 数据通道 ──── chunk #2 ────────────► │
  │  ...                                     │
  ├──── 数据通道 ──── chunk #N ────────────► │
  │                                         │
  ├── 控制通道 ── complete ────────────────► │ 合并 Blob，校验哈希
  │◄── 控制通道 ── done (hashMatch) ──────── │
  │                                         │
  │  hashMatch=true → 双方显示"传输完成"       │
  │  hashMatch=false → 双方显示"传输失败"      │
```

### 5.2 技术参数

| 项目 | 值 | 说明 |
|------|-----|------|
| 分片大小 | 16 KB (数据部分) | 跨浏览器安全上限（Firefox↔Chrome） |
| 分片序号 | 4 bytes big-endian | 前缀于每个 ArrayBuffer |
| 实际发送大小 | 16 KB + 4 B（最后一块可能更小） | 含序号前缀 |
| 最后分片 | 1 - 16 KB | `lastChunkSize = fileSize - (totalChunks - 1) * chunkSize` |
| 流控阈值 | `bufferedAmountLowThreshold = 4MB` | 局域网高带宽，4MB 更合理 |
| DataChannel 配置 | `ordered: true, maxRetransmits: null` | 可靠有序传输 |
| 预估局域网速度 | 50-200 MB/s | 取决于设备网卡 |
| 文件大小上限 | 500 MB (v1) | 超过时前端提示，拒绝发送 |
| 进度回报间隔 | 每 10% 回报一次 | 控制通道 progress 消息 |

### 5.3 流控机制

```javascript
async function sendChunks(dataChannel, chunks) {
  const THRESHOLD = 4 * 1024 * 1024; // 4MB

  for (const chunk of chunks) {
    // 如果缓冲区超过阈值，等待 drain 事件
    if (dataChannel.bufferedAmount > THRESHOLD) {
      await new Promise(resolve => {
        // 使用 once 避免覆盖其他监听器
        dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
      });
    }
    dataChannel.send(chunk);
  }
}
```

Safari 环境下调小阈值为 **1MB**，通过前端 User-Agent 检测自动适配。

### 5.4 DataChannel 创建配置

```javascript
// 控制通道（文本，可靠有序）
const controlChannel = pc.createDataChannel("control", {
  ordered: true
});

// 数据通道（二进制，可靠有序）
const dataChannel = pc.createDataChannel("file-transfer", {
  ordered: true,
  maxRetransmits: null  // 可靠模式
});
dataChannel.binaryType = "arraybuffer";
dataChannel.bufferedAmountLowThreshold = 4 * 1024 * 1024; // 4MB (Safari: 1MB)
```

### 5.5 RTCPeerConnection 生命周期

| 阶段 | 触发条件 | 动作 |
|------|----------|------|
| 创建 | `accept-file` 后、发送 SDP offer 前 | 发送方创建 `RTCPeerConnection` |
| 建立 | SDP/ICE 交换完成 | 双方 DataChannel 可用 |
| 关闭 | 传输完成(done) / 传输失败 / 取消 / ICE 超时 | 调用 `pc.close()` 释放资源 |
| 复用 | 同一对节点已有连接且有新传输 | 复用现有连接，新建 DataChannel（v1 暂不支持，每个传输独立连接） |

**关键规则：**
- **发送方**负责创建 `RTCPeerConnection` 和 DataChannel（因为发送方是 SDP offer 的发起者）
- DataChannel 创建后**必须等待 `open` 事件**才能调用 `send()`，这是常见陷阱
- 传输结束后（无论成功或失败）必须关闭 `RTCPeerConnection`，避免资源泄漏

```javascript
// 正确的 DataChannel 使用模式
const dataChannel = pc.createDataChannel("file-transfer", { ordered: true });

dataChannel.onopen = () => {
  // ✅ 只有 open 之后才能发送数据
  sendChunks(dataChannel, chunks);
};

dataChannel.onerror = (e) => {
  // 处理通道错误
};

// ❌ 错误：创建后立即发送，可能还未 open
// dataChannel.send(chunk); // 可能抛出 InvalidStateError
```

### 5.5.1 接收方 DataChannel 获取

**接收方不调用 `createDataChannel`**，而是通过 `RTCPeerConnection.ondatachannel` 事件获取发送方创建的通道。这是 WebRTC 的核心机制，遗漏将导致接收方完全无法通信。

```javascript
// 接收方关键代码
pc.ondatachannel = (event) => {
  const channel = event.channel;

  if (channel.label === "control") {
    channel.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleControlMessage(msg);
    };
  } else if (channel.label === "file-transfer") {
    // ⚠️ 接收方也必须设置 binaryType，默认可能是 Blob
    channel.binaryType = "arraybuffer";
    channel.onmessage = (e) => {
      handleChunk(e.data); // ArrayBuffer
    };
  }
};
```

### 5.6 并发传输设计

- 每对节点 (A, B) 之间建立一个 `RTCPeerConnection`
- 该连接上可创建多对 DataChannel（每对对应一个 `transferId`）
- v1 限制：**每对节点方向**同时只允许 **1 个**活跃传输任务（如 A→B 传输中，A 不能再向 B 发起传输）
- 跨对节点互不影响：A→B 传输中，A 可同时接收 C 的文件，B 可同时向 D 发送文件
- 新的 `offer-file` 在当前传输完成前会被**接收方**通过信令拒绝，返回 `busy` 消息
- 接收方收到 `offer-file` 时检查是否有来自同一节点的进行中传输，如有则回复 `busy`

---

## 6. 连接生命周期管理

### 6.1 WebSocket 重连策略

```
客户端检测到 WebSocket 断开
        │
        ├─ 等待 1s（首次）
        ├─ 重新建立 WebSocket 连接
        │    │
        │    ├─ 成功 → 服务器分配新 nodeId，广播新在线列表
        │    └─ 失败 → 指数退避（1s, 2s, 4s, 8s, 最大 30s）
        │
        └─ 重连成功后：
             ├─ UI 更新：显示为新节点（原节点身份丢失）
             ├─ 在线列表重新同步
             └─ 进行中的 WebRTC 传输不受影响（P2P 直连独立于信令通道）
```

**关键点：** WebRTC 连接独立于 WebSocket 信令通道。WebSocket 断开时，已建立的 WebRTC DataChannel 仍然可用，文件传输继续进行。只有新的连接建立才需要信令服务。

**WS 断开期间的行为约束：**
- 已进行的传输：继续完成，不受影响
- 新的传输请求：**前端应禁用发送按钮**，提示"正在重连信令服务器…"，阻止用户新建传输
- 取消传输：通过 DataChannel 控制通道发送 `cancel-transfer`（如果 DataChannel 仍然可用）；如果 DataChannel 也断开，等待重连后通过信令通知
- 重连成功后：恢复 UI 交互能力，同步最新在线列表

### 6.2 WebRTC 连接超时

ICE 候选收集阶段设置 **30 秒**超时：
- WebRTC API 没有直接的 ICE 超时配置，需手动实现：在 `pc.setLocalDescription()` 后启动 30s 定时器，监听 `pc.oniceconnectionstatechange` 事件
- 如果 `iceConnectionState` 变为 `"connected"` 或 `"completed"`，清除定时器
- 如果 30s 内未连接成功，调用 `pc.close()`，通过信令发送 `transfer-error`
- 收到方也通过信令回复确认，双方清理传输状态后回到 IDLE
- 前端展示错误提示和排查建议（检查防火墙、确认同一局域网等）

```json
// ICE 超时通知（通过信令服务器，非 DataChannel）
{ "type": "transfer-error", "from": "abc123", "to": "def456",
  "transferId": "xfr-uuid-001", "error": "ice_timeout" }
```

> `ice_timeout` — ICE 连接超时，30s 内未建立 P2P 连接

### 6.3 页面关闭/刷新处理

当用户关闭或刷新浏览器 Tab 时，WebSocket 断开触发服务器广播 `leave`，但对端不会立即知道传输中断。依赖以下机制检测：

| 检测方式 | 触发条件 | 延迟 |
|---------|----------|------|
| DataChannel `close` 事件 | 对端 TCP 连接断开 | 通常 1-10 秒 |
| WebSocket 心跳超时 | 服务端 60s 未收到 pong | 最长 60 秒 |

**处理流程：**
1. 前端注册 `window.onbeforeunload`，尝试通过控制通道发送 `cancel-transfer`
2. 对端收到 DataChannel `close` 事件后，清理传输状态，UI 提示"对端已断开连接"
3. 服务器检测心跳超时后广播 `leave`，对端从在线列表移除该节点
4. v1 不支持传输断点续传，传输中断后需要重新发起

---

## 7. 文件传输状态机

### 7.1 发送方状态机

```
                          ┌──────────┐
                          │   IDLE   │ ← 初始状态 / 传输结束
                          └────┬─────┘
                               │ 用户选择文件并发送 offer-file
                               ▼
                          ┌──────────┐
                     ┌────│ WAITING  │ ← 等待接收方响应
                     │    └──────────┘
                  reject/busy/       │ accept-file
                  timeout(60s)       │
                     │               ▼
                     ▼          ┌──────────┐
                  回到 IDLE     │CONNECTING│ ← 创建 PC, SDP/ICE 交换
                                └──┬───┬───┘
                        ICE 超时  │   │ DataChannel open
                        (30s)     │   │
                            ┌─────┘   ▼
                            │    ┌──────────┐
                            │    │ SENDING  │ ← 发送分片数据
                            │    └────┬──────┘
                            │         │ bufferedAmount=0 后发 complete
                            │         ▼
                            │    ┌──────────┐
                            │    │VERIFYING │ ← 等待 done 响应
                            │    └──┬───┬───┘
                            │   hashMatch  hashMatch
                            │   =true     =false
                            │       │         │
                            ▼       ▼         ▼
                         回到 IDLE  回到 IDLE 回到 IDLE
```

### 7.2 接收方状态机

```
                          ┌──────────┐
                          │   IDLE   │ ← 初始状态 / 传输结束
                          └────┬─────┘
                               │ 收到 offer-file
                               ▼
                          ┌──────────┐
                     ┌────│DECIDING  │ ← 用户确认（UI 弹窗）
                     │    └──────────┘
                  reject/             │ accept-file
                  busy                │
                     │                ▼
                     ▼           ┌──────────┐
                  回到 IDLE      │CONNECTING│ ← 收到 sdp-offer, 建立 PC
                                └──┬───┬───┘
                        ICE 超时  │   │ ondatachannel → start 消息
                        (30s)     │   │
                            ┌─────┘   ▼
                            │    ┌──────────┐
                            │    │RECEIVING │ ← 按序号缓冲分片
                            │    └────┬──────┘
                            │         │ 收到 complete → 合并+校验
                            │         ▼
                            │    ┌──────────┐
                            │    │ VERIFYING│ ← 计算 SHA-256
                            │    └──┬───┬───┘
                            │   hashMatch  hashMatch
                            │   =true     =false
                            │       │         │
                            ▼       ▼         ▼
                         回到 IDLE  回到 IDLE 回到 IDLE
                                    (触发下载) (提示失败)
```

**通用规则：**
- 任何状态均可通过 `cancel-transfer`（信令或控制通道）回到 IDLE
- DataChannel `close`/`error` 事件在任何状态均触发回到 IDLE，通过信令通知对方
- ICE 超时通过信令 `transfer-error` 通知对方回到 IDLE

---

## 8. 安全设计

### 8.1 信令安全

| 措施 | 说明 |
|------|------|
| 服务器强制替换 `from` | 防止节点伪造身份发送消息 |
| `to` 字段校验 | 目标 nodeId 不存在时返回 `error` 消息（`code: "target_not_found"`），不静默丢弃 |
| 协议版本校验 | 拒绝不兼容的客户端连接 |
| 消息格式校验 | 服务端验证所有字段类型和必填项，畸形消息断开连接 |

### 8.2 传输安全

| 措施 | 说明 |
|------|------|
| DTLS 加密 | WebRTC 内置，所有 P2P 数据传输加密 |
| SHA-256 校验 | 传输完成后验证文件完整性 |
| 文件大小限制 | v1 上限 500MB，兼顾浏览器内存安全 |

### 8.3 网络安全

| 场景 | 处理方式 |
|------|----------|
| 安全上下文 (HTTPS) | localhost 视为安全上下文；LAN IP 访问时 v1 使用 HTTP，前端提示浏览器可能限制部分功能 |
| CORS | 服务端 CORS 策略仅允许同源访问 |
| 多 Tab 打开 | 同一浏览器多 Tab 各自建立独立 WebSocket，服务端视为不同节点 |

---

## 9. 技术栈

### 9.1 Rust 后端

```toml
[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tower-http = { version = "0.6", features = ["fs", "cors"] }
uuid = { version = "1", features = ["v4"] }
rand = "0.8"
tracing = "0.1"
tracing-subscriber = "0.3"
dashmap = "6"
sha2 = "0.10"           # 哈希校验（服务端辅助，主要在浏览器端）
clap = { version = "4", features = ["derive"] }  # 命令行参数
```

### 9.2 前端

纯 HTML/JS/CSS，无框架依赖：

- 原生 WebRTC API (`RTCPeerConnection`, `RTCDataChannel`)
- 原生 WebSocket API
- 原生 Drag & Drop API
- 原生 File API (`File`, `Blob`, `FileReader`)
- Web Crypto API (`crypto.subtle.digest` — SHA-256 计算)
- 响应式设计：适配桌面和移动端屏幕

### 9.3 选择理由

- **axum**: Rust Web 框架首选，内置 WebSocket 支持，社区活跃
- **无前端框架**: 降低构建复杂度，单 HTML 文件，Rust 直接托管
- **无 STUN/TURN**: 局域网内 WebRTC 使用本地 ICE 候选直连
- **clap**: 命令行参数解析，支持端口、日志级别等配置

---

## 10. 项目结构

```
lan-drop/
├── Cargo.toml
├── src/
│   ├── main.rs            # 入口，CLI 参数解析，启动 axum 服务器
│   ├── signaling.rs       # WebSocket 信令处理（消息路由、身份验证）
│   ├── node.rs            # 节点管理（注册、发现、心跳、离线）
│   ├── name_gen.rs        # 随机名称生成器（形容词+动物）
│   └── config.rs          # 配置管理（端口、限制等）
├── frontend/
│   ├── index.html          # 主页面
│   ├── style.css           # 样式（含响应式设计）
│   ├── app.js              # UI 交互逻辑（拖拽、节点列表、进度条、状态提示）
│   ├── webrtc.js           # WebRTC 连接建立、文件分片传输、哈希校验
│   └── signaling.js        # WebSocket 信令客户端（含重连逻辑）
├── docs/
│   └── 设计文档/
│       └── 2026-04-04-architecture-design.md
└── README.md
```

---

## 11. 服务器设计

### 11.1 启动流程

```
解析 CLI 参数 (端口、日志级别、静态文件路径)
        │
        ├─ 构建 AppState (DashMap 节点表)
        ├─ 注册路由:
        │    ├─ GET /     → 静态文件 (tower-http ServeDir)
        │    ├─ GET /ws   → WebSocket 信令端点
        │    └─ GET /health → 健康检查
        │
        ├─ 绑定 0.0.0.0:<port>
        ├─ 检测并打印局域网 IP
        │
        └─ 注册优雅关机 (Ctrl+C):
             ├─ 通知所有在线节点 (leave 消息)
             ├─ 等待 5s 让 WebSocket 连接关闭
             └─ 退出进程
```

启动输出：
```
LanDrop v0.1.0 已启动！
本机访问:    http://localhost:3000
局域网访问:  http://192.168.1.100:3000
日志级别:    info
文件大小上限: 512 MB
按 Ctrl+C 优雅退出
```

### 11.2 CLI 参数

```
Usage: lan-drop [OPTIONS]

Options:
  -p, --port <PORT>          监听端口 [default: 3000]
  -d, --static-dir <DIR>     前端静态文件目录 [default: ./frontend]
  -l, --log-level <LEVEL>    日志级别 [default: info]
  -m, --max-file-size <MB>   单文件大小上限 MB [default: 512]
  -h, --help                 显示帮助
  -V, --version              显示版本
```

### 11.3 日志设计

使用 `tracing` 结构化日志，关键事件清单：

| 事件 | 级别 | 字段 |
|------|------|------|
| 节点上线 | INFO | nodeId, name, remote_addr |
| 节点离线 | INFO | nodeId, name, reason(timeout/manual) |
| 文件传输请求 | INFO | transferId, from, to, fileName, fileSize |
| 文件传输完成 | INFO | transferId, duration, fileSize |
| 文件传输失败 | WARN | transferId, error |
| 消息路由失败 | WARN | target not found, from |
| 畸形消息 | ERROR | raw message, from |
| WebSocket 错误 | ERROR | nodeId, error |

### 11.4 健康检查

`GET /health` 返回：
```json
{ "status": "ok", "uptime_seconds": 3600, "connected_nodes": 3 }
```

---

## 12. 风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|----------|
| Chrome mDNS 地址混淆 | 局域网 ICE 候选可能显示为 `.local` 地址 | v1 测试验证；若受影响，前端提示用户配置 `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` 为 Disabled |
| HTTP 下 WebRTC 限制 | 非安全上下文可能限制 WebRTC API | localhost 视为安全上下文；LAN IP 访问时 v1 用 HTTP，文档说明限制；v2 考虑嵌入自签名证书 |
| Safari 兼容性 | 缓冲区限制更严格 | 前端 UA 检测，Safari 自动将流控阈值降至 1MB |
| 超大文件（>500MB） | 浏览器内存不足（接收方缓冲 + 合并，发送方 SHA-256 需全文件在内存） | v1 前端拒绝超过 500MB 的文件；v2 引入 File System Access API 流式写入 + 流式 SHA-256 |
| 防火墙阻止 UDP | WebRTC 连接建立失败 | ICE 30s 超时检测，前端展示排查建议 |
| 多 Tab 连接风暴 | 同一浏览器多 Tab 各自注册节点 | v1 允许此行为（各 Tab 独立节点）；若成为问题，v2 用 `BroadcastChannel` API 去重 |
| 浏览器兼容性 | 不同浏览器 WebRTC 行为差异 | v1 目标 Chrome 90+、Firefox 90+、Safari 15+；文档说明支持范围 |
| 移动端体验 | 小屏幕显示、文件选择体验 | 响应式 CSS 适配；`<input type="file">` 移动端会调起系统文件选择器 |

---

## 13. 可行性结论

**完全可行。** 理由：

1. 已有成熟的先例项目（Snapdrop / PairDrop 为 Node.js 实现，证明了该架构）
2. Rust 生态中 axum + tokio 组合成熟稳定，WebSocket 支持完善
3. WebRTC DataChannel 在局域网内无需 NAT 穿透，直连性能优异
4. 服务器逻辑极简（仅信令中继），核心代码约 300-500 行 Rust
5. 前端代码约 800-1500 行 JS，无框架依赖
6. 市面上尚无成熟的 Rust + WebRTC 局域网传文件方案，有一定差异化价值
7. 信令协议完整，覆盖身份验证、传输校验、取消/错误、重连等关键场景
