import { initCrypto } from "./crypto.js";

const STORAGE_KEY = "landrop_identity";

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
    this.onPeersUpdate = null;
    this.onOfferFile = null;
    this.onTextReceived = null;
    this.onMessage = null;
    this.onDisconnect = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.publicKeyBase64 = null;
    this.privateKey = null;
  }

  async initCryptoKeys() {
    if (this.privateKey) return;
    try {
      const { publicKeyBase64, privateKey } = await initCrypto();
      this.publicKeyBase64 = publicKeyBase64;
      this.privateKey = privateKey;
    } catch (e) {
      console.warn("E2E 加密不可用:", e.message);
      this.publicKeyBase64 = null;
      this.privateKey = null;
    }
  }

  connect(url = `ws://${location.host}/ws`) {
    this.wsUrl = url;
    this._doConnect();
  }

  _doConnect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = async () => {
      this.reconnectDelay = 1000;
      await this.initCryptoKeys();
      const identity = loadIdentity();
      const joinMsg = { type: "join", protocolVersion: 1, pubKey: this.publicKeyBase64 };
      if (identity) {
        joinMsg.nodeId = identity.nodeId;
        joinMsg.name = identity.name;
      } else {
        joinMsg.name = this._generateName();
      }
      this._send(joinMsg);
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
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
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }, this.reconnectDelay);
  }

  _generateName() {
    const adjectives = ["橘色", "蓝色", "红色", "绿色", "紫色", "金色", "银色", "粉色"];
    const animals = ["狐狸", "海豚", "熊猫", "兔子", "猫咪", "企鹅", "鹿", "松鼠"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const num = Math.floor(Math.random() * 99) + 1;
    return `${adj}${animal} #${num}`;
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "joined":
        this.nodeId = msg.nodeId;
        this.nodeInfo = { id: msg.nodeId, name: msg.name };
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

  sendText(to, textId, content, encrypted = false, iv = null) {
    const msg = { type: "send-text", to, textId, content };
    if (encrypted) {
      msg.encrypted = true;
      msg.iv = iv;
    }
    this.send(msg);
  }
}
