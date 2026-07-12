import { log } from "./lib/log.js";

const STORAGE_KEY = "landrop_identity";
const WS_PATH = "/ws";
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000; // 心跳发送间隔 (ms)
const HEARTBEAT_TIMEOUT = 60000;  // 未收到 pong 的断连阈值 (ms)

function loadIdentity() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveIdentity(nodeId, name) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ nodeId, name }));
  } catch {}
}

export class SignalingClient {
  constructor() {
    this.ws = null;
    this.nodeId = null;
    this.nodeInfo = null;
    this.peers = new Map(); // id -> {id, name}
    this.config = null; // set by app.js before connect()
    this.onPeersUpdate = null;
    this.onOfferFile = null;
    this.onTextReceived = null;
    this.onMessage = null;
    this.onDisconnect = null;
    this.onChatMessage = null;
    this.reconnectTimer = null;
    this.reconnectDelay = RECONNECT_BASE_DELAY;
    this._heartbeatTimer = null;
    this._lastPongAt = 0;
  }

  connect(url = `ws://${location.host}${WS_PATH}`) {
    this.wsUrl = url;
    this._doConnect();
  }

  _doConnect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_DELAY;
      this._lastPongAt = Date.now();
      this._startHeartbeat();
      const identity = loadIdentity();
      const joinMsg = { type: "join", protocolVersion: this.config?.protocolVersion ?? 1 };
      if (identity) {
        joinMsg.nodeId = identity.nodeId;
        joinMsg.name = identity.name;
      }
      this._send(joinMsg);
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
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

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._doConnect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY);
    }, this.reconnectDelay);
  }

  // 应用层心跳：浏览器 WS API 无法主动发 Ping 帧，改用 ping/pong 消息
  _startHeartbeat() {
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

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "joined":
        this.nodeId = msg.nodeId;
        this.nodeInfo = { id: msg.nodeId, name: msg.name };
        // Update config from server
        if (msg.maxFileSize != null) {
          this.config = {
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

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  sendOfferFile(to, transferId, file) {
    this.send({
      type: "offer-file",
      to,
      transferId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    });
  }

  sendOfferSecureText(to, transferId, textPreview) {
    this.send({ type: "offer-secure-text", to, transferId, textPreview });
  }

  sendAcceptFile(to, transferId) {
    this.send({ type: "accept-file", to, transferId });
  }

  sendRejectFile(to, transferId, reason = "user_rejected") {
    this.send({ type: "reject-file", to, transferId, reason });
  }

  sendCancelTransfer(to, transferId, reason = "user_cancelled") {
    this.send({ type: "cancel-transfer", to, transferId, reason });
  }

  sendTransferError(to, transferId, error) {
    this.send({ type: "transfer-error", to, transferId, error });
  }

  sendSdpOffer(to, transferId, sdp) {
    this.send({ type: "sdp-offer", to, transferId, sdp });
  }

  sendSdpAnswer(to, transferId, sdp) {
    this.send({ type: "sdp-answer", to, transferId, sdp });
  }

  sendIceCandidate(to, transferId, candidate) {
    this.send({ type: "ice-candidate", to, transferId, candidate });
  }

  sendText(to, textId, content) {
    this.send({ type: "send-text", to, textId, content });
  }

  sendRename(name) {
    this._send({ type: "rename", name });
  }

  sendChat(content) {
    this._send({ type: "chat", content });
  }
}
