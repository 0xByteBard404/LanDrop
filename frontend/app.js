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
};

signaling.onOfferFile = (msg) => {
  if (transfer.isBusy()) {
    signaling.sendBusy(msg.from, msg.transferId);
    return;
  }
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
    transfer_in_progress: "对方正忙",
    user_cancelled: "传输已取消",
    ice_timeout: "连接超时",
    channel_closed: "连接断开",
    hash_mismatch: "文件校验失败",
    cancelled: "传输已取消",
  };
  updateTransferStatus(transferId, messages[error] || `传输失败: ${error}`, "error");
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
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      const transferId = await transfer.sendFile(peerId, file);
      addTransferCard(transferId, file.name, file.size, "sender");
    } catch (e) {
      alert(e.message);
    }
  };
  input.click();
}

// --- Offer dialog ---

let pendingOffer = null;

function showOfferDialog(msg) {
  pendingOffer = msg;
  offerTitle.textContent = `${signaling.peers.get(msg.from)?.name || "未知设备"} 想发送文件`;
  offerFileInfo.textContent = `${msg.fileName} (${formatSize(msg.fileSize)})`;
  offerDialog.classList.remove("hidden");
}

offerAcceptBtn.onclick = () => {
  if (pendingOffer) {
    signaling.sendAcceptFile(pendingOffer.from, pendingOffer.transferId);
    addTransferCard(pendingOffer.transferId, pendingOffer.fileName, pendingOffer.fileSize, "receiver");
    pendingOffer = null;
  }
  offerDialog.classList.add("hidden");
};

offerRejectBtn.onclick = () => {
  if (pendingOffer) {
    signaling.sendRejectFile(pendingOffer.from, pendingOffer.transferId);
    pendingOffer = null;
  }
  offerDialog.classList.add("hidden");
};

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
