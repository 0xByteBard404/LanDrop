import { SignalingClient } from "./signaling.js";
import { FileTransfer } from "./webrtc.js";

const signaling = new SignalingClient();
const transfer = new FileTransfer(signaling);

// --- DOM refs ---

const selfInfoEl = document.getElementById("self-info");
const peersListEl = document.getElementById("peers-list");
const noPeersEl = document.getElementById("no-peers");
const transfersListEl = document.getElementById("transfers-list");
const noTransfersEl = document.getElementById("no-transfers");
const offerDialog = document.getElementById("offer-dialog");
const offerTitle = document.getElementById("offer-title");
const offerFileInfo = document.getElementById("offer-file-info");
const offerAcceptBtn = document.getElementById("offer-accept");
const offerRejectBtn = document.getElementById("offer-reject");

// --- Signaling events ---

signaling.onPeersUpdate = (peers) => {
  renderPeers(peers);
  selfInfoEl.textContent = `${signaling.nodeInfo?.name || "连接中..."} (${signaling.nodeId?.slice(0, 8) || "..."})`;
};

signaling.onDisconnect = () => {
  selfInfoEl.textContent = "正在重连...";
  transfer.cancelAll("signaling_reconnect");
};

signaling.onOfferFile = (msg) => {
  showOfferDialog(msg);
};

signaling.onMessage = (msg) => {
  transfer.handleSignalingMessage(msg);
};

// --- Transfer events ---

transfer.onProgress = (transferId, current, total) => {
  updateTransferProgress(transferId, current, total);
};

transfer.onTransferComplete = (transferId) => {
  updateTransferStatus(transferId, "传输完成", "success");
};

transfer.onTransferError = (transferId, error) => {
  const messages = {
    user_rejected: "对方拒绝了文件",
    user_cancelled: "传输已取消",
    ice_timeout: "连接超时",
    ice_failed: "连接失败",
    ice_disconnected: "连接断开",
    channel_closed: "数据通道断开",
    hash_mismatch: "文件校验失败",
    cancelled: "传输已取消",
    file_too_large: "文件超过大小限制",
    chunk_timeout: "数据接收超时",
    signaling_reconnect: "信令重连，传输中断",
  };
  updateTransferStatus(transferId, messages[error] || `传输失败: ${error}`, "error");
  dismissOffer(transferId);
};

// --- Render peers ---

function renderPeers(peers) {
  if (peers.size === 0) {
    peersListEl.innerHTML = "";
    noPeersEl.style.display = "block";
    return;
  }

  noPeersEl.style.display = "none";
  peersListEl.innerHTML = "";

  for (const [id, peer] of peers) {
    const card = document.createElement("div");
    card.className = "peer-card";

    const nameSpan = document.createElement("span");
    nameSpan.className = "peer-name";
    nameSpan.textContent = peer.name;

    const sendBtn = document.createElement("button");
    sendBtn.className = "btn btn-send";
    sendBtn.textContent = "发送文件";
    sendBtn.onclick = () => selectAndSend(id);

    card.appendChild(nameSpan);
    card.appendChild(sendBtn);
    peersListEl.appendChild(card);
  }
}

// --- File selection ---

async function selectAndSend(peerId) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    const files = input.files;
    if (!files || files.length === 0) return;

    // 校验总大小
    const totalSize = Array.from(files).reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 512 * 1024 * 1024) {
      alert(`所选文件总大小 ${formatSize(totalSize)} 超过 512 MB 限制`);
      return;
    }

    for (const file of files) {
      try {
        const transferId = await transfer.sendFile(peerId, file);
        addTransferCard(transferId, file.name, file.size, "sender");
      } catch (e) {
        alert(`${file.name}: ${e.message}`);
      }
    }
  };
  input.click();
}

// --- Offer dialog ---

const offerQueue = [];
let showingOffer = false;
let currentOfferTransferId = null;

function showOfferDialog(msg) {
  offerQueue.push(msg);
  if (!showingOffer) _showNextOffer();
}

function _showNextOffer() {
  if (offerQueue.length === 0) {
    showingOffer = false;
    currentOfferTransferId = null;
    offerDialog.classList.add("hidden");
    return;
  }
  showingOffer = true;
  const msg = offerQueue.shift();
  currentOfferTransferId = msg.transferId;
  offerTitle.textContent = `${signaling.peers.get(msg.from)?.name || "未知设备"} 想发送文件`;
  offerFileInfo.textContent = `${msg.fileName} (${formatSize(msg.fileSize)})`;
  offerDialog.classList.remove("hidden");

  offerAcceptBtn.onclick = () => {
    signaling.sendAcceptFile(msg.from, msg.transferId);
    addTransferCard(msg.transferId, msg.fileName, msg.fileSize, "receiver");
    _showNextOffer();
  };

  offerRejectBtn.onclick = () => {
    signaling.sendRejectFile(msg.from, msg.transferId);
    _showNextOffer();
  };
}

function dismissOffer(transferId) {
  // Remove from queue
  const idx = offerQueue.findIndex(m => m.transferId === transferId);
  if (idx !== -1) offerQueue.splice(idx, 1);
  // If currently showing this offer, dismiss and show next
  if (currentOfferTransferId === transferId) {
    _showNextOffer();
  }
}

// --- Transfer cards ---

function addTransferCard(transferId, fileName, fileSize, role) {
  noTransfersEl.style.display = "none";

  const card = document.createElement("div");
  card.className = "transfer-card";
  card.id = `transfer-${transferId}`;

  card.innerHTML = `
    <div class="transfer-header">
      <span class="transfer-filename">${fileName}</span>
      <span class="transfer-size">${formatSize(fileSize)}</span>
    </div>
    <div class="transfer-progress-bar">
      <div class="transfer-progress-fill" style="width: 0%"></div>
    </div>
    <div class="transfer-footer">
      <span class="transfer-status">${role === "sender" ? "发送中" : "接收中"}...</span>
      <button class="btn btn-secondary transfer-cancel" style="font-size:12px;padding:4px 8px;">取消</button>
    </div>
  `;

  card.querySelector(".transfer-cancel").onclick = () => {
    transfer.cancelTransfer(transferId);
  };

  transfersListEl.appendChild(card);
}

function updateTransferProgress(transferId, current, total) {
  const card = document.getElementById(`transfer-${transferId}`);
  if (!card) return;

  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const fill = card.querySelector(".transfer-progress-fill");
  if (fill) fill.style.width = `${percent}%`;

  const status = card.querySelector(".transfer-status");
  if (status && !status.classList.contains("error") && !status.classList.contains("success")) {
    status.textContent = `${percent}%`;
  }
}

function updateTransferStatus(transferId, text, className) {
  const card = document.getElementById(`transfer-${transferId}`);
  if (!card) return;

  const status = card.querySelector(".transfer-status");
  if (status) {
    status.textContent = text;
    status.className = `transfer-status ${className}`;
  }

  const cancelBtn = card.querySelector(".transfer-cancel");
  if (cancelBtn) cancelBtn.remove();
}

// --- Utility ---

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// --- Connect ---

signaling.connect();
