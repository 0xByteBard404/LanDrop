import { log } from "./lib/log.js";
import type { AppConfig, NodeInfo, ServerMessage } from "./types.js";

const STORAGE_KEY = "landrop_identity";
const WS_PATH = "/ws";
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000; // 心跳发送间隔 (ms)
const HEARTBEAT_TIMEOUT = 60000; // 未收到 pong 的断连阈值 (ms)

type Identity = { nodeId: string; name: string } | null;

function loadIdentity(): Identity {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {}
  return null;
}

function saveIdentity(nodeId: string, name: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ nodeId, name }));
  } catch {}
}

type OfferFileMsg = Extract<ServerMessage, { type: "offer-file" }>;
type SendTextMsg = Extract<ServerMessage, { type: "send-text" }>;
type ChatMsg = Extract<ServerMessage, { type: "chat" }>;

export class SignalingClient {
  ws: WebSocket | null = null;
  wsUrl = "";
  nodeId: string | null = null;
  nodeInfo: NodeInfo | null = null;
  peers = new Map<string, NodeInfo>();
  config: AppConfig | null = null; // set by app.ts before connect()
  onPeersUpdate: ((peers: Map<string, NodeInfo>) => void) | null = null;
  onOfferFile: ((msg: OfferFileMsg) => void) | null = null;
  onTextReceived: ((msg: SendTextMsg) => void) | null = null;
  onMessage: ((msg: ServerMessage) => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onChatMessage: ((msg: ChatMsg) => void) | null = null;
  reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  reconnectDelay = RECONNECT_BASE_DELAY;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _lastPongAt = 0;

  connect(url = `ws://${location.host}${WS_PATH}`): void {
    this.wsUrl = url;
    this._doConnect();
  }

  private _doConnect(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_DELAY;
      this._lastPongAt = Date.now();
      this._startHeartbeat();
      const identity = loadIdentity();
      const joinMsg: { type: "join"; protocolVersion: number; nodeId?: string; name?: string } = {
        type: "join",
        protocolVersion: this.config?.protocolVersion ?? 1,
      };
      if (identity) {
        joinMsg.nodeId = identity.nodeId;
        joinMsg.name = identity.name;
      }
      this._send(joinMsg);
    };

    this.ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch (e) {
        log.warn("收到畸形信令消息，已忽略:", e);
        return;
      }
      // 心跳响应：更新心跳时间戳，不进入业务处理
      if (msg.type === "pong") {
        this._lastPongAt = Date.now();
        return;
      }
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      this._stopHeartbeat();
      this._scheduleReconnect();
      if (this.onDisconnect) this.onDisconnect();
    };

    this.ws.onerror = () => {};
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._doConnect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY);
    }, this.reconnectDelay);
  }

  // 应用层心跳：浏览器 WS API 无法主动发 Ping 帧，改用 ping/pong 消息
  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this._send({ type: "ping" });
      // 长时间未收到 pong，视为连接已死，主动断连以触发重连
      if (Date.now() - this._lastPongAt > HEARTBEAT_TIMEOUT) {
        log.warn("信令心跳超时，主动断连以触发重连");
        this.ws.close();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private _handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "joined":
        this.nodeId = msg.nodeId;
        this.nodeInfo = { id: msg.nodeId, name: msg.name };
        // Update config from server
        if (msg.maxFileSize != null) {
          this.config = {
            iceServers: this.config?.iceServers ?? [],
            maxFileSize: msg.maxFileSize,
            maxTextSize: msg.maxTextSize,
            protocolVersion: msg.protocolVersion,
            maxNameLength: msg.maxNameLength,
          };
        }
        saveIdentity(msg.nodeId, msg.name);
        this.peers.clear();
        if (msg.peers) {
          for (const p of msg.peers) this.peers.set(p.id, p);
        }
        if (this.onPeersUpdate) this.onPeersUpdate(this.peers);
        break;

      case "peers":
        this.peers.clear();
        for (const p of msg.list) this.peers.set(p.id, p);
        if (this.onPeersUpdate) this.onPeersUpdate(this.peers);
        break;

      case "leave":
        this.peers.delete(msg.nodeId);
        if (this.onPeersUpdate) this.onPeersUpdate(this.peers);
        break;

      case "offer-file":
        if (this.onOfferFile) this.onOfferFile(msg);
        break;

      case "send-text":
        if (this.onTextReceived) this.onTextReceived(msg);
        break;

      case "chat":
        if (this.onChatMessage) this.onChatMessage(msg);
        break;

      default:
        if (this.onMessage) this.onMessage(msg);
        break;
    }
  }

  send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _send(msg: object): void {
    this.ws!.send(JSON.stringify(msg));
  }

  sendOfferFile(to: string, transferId: string, file: File): void {
    this.send({
      type: "offer-file",
      to,
      transferId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    });
  }

  sendOfferSecureText(to: string, transferId: string, textPreview: string): void {
    this.send({ type: "offer-secure-text", to, transferId, textPreview });
  }

  sendAcceptFile(to: string, transferId: string): void {
    this.send({ type: "accept-file", to, transferId });
  }

  sendRejectFile(to: string, transferId: string, reason = "user_rejected"): void {
    this.send({ type: "reject-file", to, transferId, reason });
  }

  sendCancelTransfer(to: string, transferId: string, reason = "user_cancelled"): void {
    this.send({ type: "cancel-transfer", to, transferId, reason });
  }

  sendTransferError(to: string, transferId: string, error: string): void {
    this.send({ type: "transfer-error", to, transferId, error });
  }

  sendSdpOffer(to: string, transferId: string, sdp: string): void {
    this.send({ type: "sdp-offer", to, transferId, sdp });
  }

  sendSdpAnswer(to: string, transferId: string, sdp: string): void {
    this.send({ type: "sdp-answer", to, transferId, sdp });
  }

  sendIceCandidate(to: string, transferId: string, candidate: RTCIceCandidateInit): void {
    this.send({ type: "ice-candidate", to, transferId, candidate });
  }

  sendText(to: string, textId: string, content: string): void {
    this.send({ type: "send-text", to, textId, content });
  }

  sendRename(name: string): void {
    this._send({ type: "rename", name });
  }

  sendChat(content: string): void {
    this._send({ type: "chat", content });
  }
}
