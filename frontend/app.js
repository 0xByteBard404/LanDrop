import { SignalingClient } from "./signaling.js";
import { FileTransfer } from "./webrtc.js";

const signaling = new SignalingClient();
const transfer = new FileTransfer(signaling);

// --- DOM refs ---

const selfInfoEl = document.getElementById("self-info");
const peersListEl = document.getElementById("peers-list");
const noPeersEl = document.getElementById("no-peers");
const chatMessagesEl = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send");
const transfersListEl = document.getElementById("transfers-list");
const noTransfersEl = document.getElementById("no-transfers");
const offerDialog = document.getElementById("offer-dialog");
const offerTitle = document.getElementById("offer-title");
const offerFileInfo = document.getElementById("offer-file-info");
const offerAcceptBtn = document.getElementById("offer-accept");
const offerRejectBtn = document.getElementById("offer-reject");
const messagesListEl = document.getElementById("messages-list");
const noMessagesEl = document.getElementById("no-messages");
const textComposeDialog = document.getElementById("text-compose-dialog");
const textComposeTitle = document.getElementById("text-compose-title");
const textComposeInput = document.getElementById("text-compose-input");
const textComposeSendBtn = document.getElementById("text-compose-send");
const textComposeCancelBtn = document.getElementById("text-compose-cancel");
const textComposeSecure = document.getElementById("text-compose-secure");
const secureHint = document.getElementById("secure-hint");
const textReceiveDialog = document.getElementById("text-receive-dialog");
const textReceiveTitle = document.getElementById("text-receive-title");
const textReceiveContent = document.getElementById("text-receive-content");
const textReceiveCopyBtn = document.getElementById("text-receive-copy");
const textReceiveCloseBtn = document.getElementById("text-receive-close");
const qrBtn = document.getElementById("qr-btn");
const qrDialog = document.getElementById("qr-dialog");
const qrContainer = document.getElementById("qr-container");
const qrUrlEl = document.getElementById("qr-url");
const qrCopyBtn = document.getElementById("qr-copy");
const qrCloseBtn = document.getElementById("qr-close");
const speedLimitSelect = document.getElementById("speed-limit");
const previewDialog = document.getElementById("preview-dialog");
const previewMediaContainer = document.getElementById("preview-media-container");
const previewDownloadBtn = document.getElementById("preview-download");
const previewCloseBtn = document.getElementById("preview-close");speedLimitSelect.onchange = () => {
  transfer._speedLimit = parseInt(speedLimitSelect.value);
};

// --- Media preview ---

transfer.onMediaPreview = (transferId, fileName, mimeType, fileSize) => {
  const t = transfer.activeTransfers.get(transferId);
  if (!t || !t._blobUrl) return;
  showMediaPreview(t._blobUrl, fileName, mimeType);
};

function showMediaPreview(blobUrl, fileName, mimeType) {
  previewMediaContainer.innerHTML = "";
  if (mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = blobUrl;
    img.className = "preview-img";
    previewMediaContainer.appendChild(img);
  } else if (mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = blobUrl;
    video.controls = true;
    video.className = "preview-video";
    previewMediaContainer.appendChild(video);
  }
  previewDownloadBtn.onclick = () => {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.click();
  };
  previewDialog.classList.remove("hidden");
}

previewCloseBtn.onclick = () => {
  previewDialog.classList.add("hidden");
};

// --- Browser notifications ---

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico" });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

requestNotificationPermission();

// --- Signaling events ---

signaling.onPeersUpdate = (peers) => {
  renderPeers(peers);
  updateSelfInfo();
};

function updateSelfInfo() {
  const name = signaling.nodeInfo?.name || "连接中...";
  const id = signaling.nodeId?.slice(0, 8) || "...";
  selfInfoEl.innerHTML = `${escapeHtml(name)} <span class="self-id">${id}</span>`;
}

// --- Self-info rename ---
selfInfoEl.addEventListener("click", () => {
  if (!signaling.nodeInfo) return;
  const currentName = signaling.nodeInfo.name;
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "rename-input";
  input.maxLength = signaling.config?.maxNameLength || 32;
  input.placeholder = "输入新名称";

  const span = selfInfoEl;
  const originalHTML = span.innerHTML;
  span.innerHTML = "";
  span.appendChild(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const finish = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName && newName.length <= (signaling.config?.maxNameLength || 32)) {
      signaling.nodeInfo.name = newName;
      signaling.sendRename(newName);
      // Update session storage
      try {
        sessionStorage.setItem("landrop_identity", JSON.stringify({
          nodeId: signaling.nodeId,
          name: newName,
        }));
      } catch {}
    }
    updateSelfInfo();
  };

  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = currentName; input.blur(); }
  });
});

signaling.onDisconnect = () => {
  selfInfoEl.textContent = "正在重连...";
  transfer.cancelAll("signaling_reconnect");
};

signaling.onOfferFile = (msg) => {
  showOfferDialog(msg);
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  showNotification("收到文件", `${peerName}: ${msg.fileName} (${formatSize(msg.fileSize)})`);
};

signaling.onMessage = (msg) => {
  if (msg.type === "error" && msg.code === "text_too_long") {
    alert(`文本超过 ${formatSize(signaling.config?.maxTextSize ?? 0)} 限制`);
    return;
  }
  transfer.handleSignalingMessage(msg);
};

signaling.onTextReceived = (msg) => {
  showReceivedText(msg);
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  showNotification("收到文本", `来自 ${peerName}`);
};

// --- Transfer events ---

transfer.onProgress = (transferId, current, total) => {
  updateTransferProgress(transferId, current, total);
};

transfer.onTransferComplete = (transferId) => {
  updateTransferStatus(transferId, "传输完成", "success");
  showNotification("传输完成", "文件已成功传输");
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

transfer.onSecureTextReceived = (transferId, text, fromId) => {
  const peerName = signaling.peers.get(fromId)?.name || "未知设备";
  addMessageCard(transferId, text, "receiver", peerName, true);
  textReceiveTitle.textContent = `来自 ${peerName} 的文本 (安全)`;
  textReceiveContent.textContent = text;
  textReceiveDialog.classList.remove("hidden");
  showNotification("收到安全文本", `来自 ${peerName}`);
};

transfer.onSecureTextOffer = (fromId, transferId, textPreview) => {
  console.log(`安全文本传输请求来自 ${fromId}, 已自动接受`);
};

// --- Chat ---

signaling.onChatMessage = (msg) => {
  const isSelf = msg.from === signaling.nodeId;
  const name = isSelf ? signaling.nodeInfo?.name : (msg.name || signaling.peers.get(msg.from)?.name || "未知设备");
  addChatMessage(name, msg.content, isSelf);
  if (!isSelf) {
    showNotification("群聊消息", `${name}: ${msg.content.slice(0, 60)}`);
  }
};

function addChatMessage(name, content, isSelf) {
  const el = document.createElement("div");
  el.className = `chat-msg ${isSelf ? "self" : "other"}`;
  const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  el.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-name">${escapeHtml(name)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-text">${escapeHtml(content)}</div>
  `;
  chatMessagesEl.appendChild(el);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function sendChatMessage() {
  const content = chatInput.value.trim();
  if (!content) return;
  signaling.sendChat(content);
  chatInput.value = "";
}

chatSendBtn.onclick = sendChatMessage;
chatInput.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
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

    const textBtn = document.createElement("button");
    textBtn.className = "btn-text-link";
    textBtn.textContent = "发送文本";
    textBtn.onclick = () => openTextCompose(id, peer.name);

    const btnGroup = document.createElement("div");
    btnGroup.className = "peer-actions";
    btnGroup.appendChild(textBtn);
    btnGroup.appendChild(sendBtn);

    card.appendChild(nameSpan);
    card.appendChild(btnGroup);

    // Drag-and-drop
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      card.classList.add("drag-over");
    });
    card.addEventListener("dragenter", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        sendFilesToPeer(id, files);
      }
    });

    peersListEl.appendChild(card);
  }
}

// --- File selection ---

async function sendFilesToPeer(peerId, files) {
  const fileArr = Array.from(files);
  const totalSize = fileArr.reduce((sum, f) => sum + f.size, 0);
  const maxFileSize = signaling.config?.maxFileSize ?? Infinity;
  if (totalSize > maxFileSize) {
    alert(`所选文件总大小 ${formatSize(totalSize)} 超过 ${formatSize(maxFileSize)} 限制`);
    return;
  }

  for (const file of fileArr) {
    try {
      const transferId = await transfer.sendFile(peerId, file);
      addTransferCard(transferId, file.name, file.size, "sender");
    } catch (e) {
      alert(`${file.name}: ${e.message}`);
    }
  }
}

async function selectAndSend(peerId) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    const files = input.files;
    if (!files || files.length === 0) return;
    await sendFilesToPeer(peerId, files);
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

  const fill = card.querySelector(".transfer-progress-fill");
  if (fill) fill.style.width = className === "success" ? "100%" : fill.style.width;

  const cancelBtn = card.querySelector(".transfer-cancel");
  if (cancelBtn) cancelBtn.remove();
}

// --- Text messaging ---

let textComposeTargetId = null;

function openTextCompose(peerId, peerName) {
  textComposeTargetId = peerId;
  textComposeTitle.textContent = `发送文本给 ${peerName}`;
  textComposeInput.value = "";
  textComposeSecure.checked = false;
  textComposeSecure.disabled = false;
  secureHint.textContent = "";
  textComposeDialog.classList.remove("hidden");
  setTimeout(() => textComposeInput.focus(), 50);
}

textComposeCancelBtn.onclick = () => {
  textComposeDialog.classList.add("hidden");
  textComposeTargetId = null;
};

textComposeInput.onkeydown = (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    textComposeSendBtn.click();
  }
};

textComposeSendBtn.onclick = async () => {
  const content = textComposeInput.value.trim();
  if (!content) return;
  const maxTextSize = signaling.config?.maxTextSize ?? Infinity;
  if (content.length > maxTextSize) {
    alert(`文本超过 ${formatSize(maxTextSize)} 限制`);
    return;
  }

  const textId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const peerName = signaling.peers.get(textComposeTargetId)?.name || "未知设备";
  const secure = textComposeSecure.checked && !textComposeSecure.disabled;

  if (secure) {
    try {
      await transfer.sendSecureText(textComposeTargetId, content);
      addMessageCard(textId, content, "sender", peerName, true);
    } catch (e) {
      alert("安全传输失败: " + e.message);
      return;
    }
  } else {
    signaling.sendText(textComposeTargetId, textId, content);
    addMessageCard(textId, content, "sender", peerName, false);
  }

  textComposeDialog.classList.add("hidden");
  textComposeTargetId = null;
};

async function showReceivedText(msg) {
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  addMessageCard(msg.textId, msg.content, "receiver", peerName, false);

  textReceiveTitle.textContent = `来自 ${peerName} 的文本`;
  textReceiveContent.textContent = msg.content;
  textReceiveDialog.classList.remove("hidden");
}

textReceiveCopyBtn.onclick = async () => {
  const text = textReceiveContent.textContent;
  try {
    await navigator.clipboard.writeText(text);
    textReceiveCopyBtn.textContent = "已复制";
    setTimeout(() => { textReceiveCopyBtn.textContent = "复制"; }, 1500);
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    textReceiveCopyBtn.textContent = "已复制";
    setTimeout(() => { textReceiveCopyBtn.textContent = "复制"; }, 1500);
  }
};

textReceiveCloseBtn.onclick = () => {
  textReceiveDialog.classList.add("hidden");
};

function addMessageCard(textId, content, role, peerName, encrypted = false) {
  noMessagesEl.style.display = "none";

  const card = document.createElement("div");
  card.className = `message-card message-${role}` + (encrypted ? " message-encrypted" : "");
  card.id = `message-${textId}`;

  const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
  const arrow = role === "sender" ? "\u2191" : "\u2193";
  const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const lock = encrypted ? ' <span class="lock-icon">\uD83D\uDD12</span>' : "";

  card.innerHTML = `
    <div class="message-header">
      <span class="message-direction"><span class="message-arrow">${arrow}</span> ${escapeHtml(peerName)}${lock}</span>
      <span class="message-time">${time}</span>
    </div>
    <div class="message-preview">${escapeHtml(preview)}</div>
  `;

  card.onclick = () => {
    textReceiveContent.textContent = content;
    textReceiveTitle.textContent = (role === "sender" ? "发给 " : "来自 ") + peerName + (encrypted ? " (安全)" : "");
    textReceiveCopyBtn.textContent = "复制";
    textReceiveDialog.classList.remove("hidden");
  };

  messagesListEl.prepend(card);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Utility ---

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// --- QR code dialog ---

let cachedLanUrl = null;

qrBtn.onclick = async () => {
  qrContainer.innerHTML = "";
  try {
    if (!cachedLanUrl) {
      const res = await fetch("/api/info");
      const data = await res.json();
      cachedLanUrl = data.url || location.href;
    }
    qrUrlEl.textContent = cachedLanUrl;
    new QRCode(qrContainer, {
      text: cachedLanUrl,
      width: 200,
      height: 200,
      colorDark: "#e8e4df",
      colorLight: "#1a1a1e",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch {
    qrUrlEl.textContent = location.href;
  }
  qrDialog.classList.remove("hidden");
};

qrCloseBtn.onclick = () => {
  qrDialog.classList.add("hidden");
};

qrCopyBtn.onclick = async () => {
  const url = cachedLanUrl || location.href;
  try {
    await navigator.clipboard.writeText(url);
    qrCopyBtn.textContent = "已复制";
    setTimeout(() => { qrCopyBtn.textContent = "复制链接"; }, 1500);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    qrCopyBtn.textContent = "已复制";
    setTimeout(() => { qrCopyBtn.textContent = "复制链接"; }, 1500);
  }
};

// --- Connect ---

async function init() {
  try {
    const res = await fetch("/api/info");
    const data = await res.json();
    signaling.config = {
      maxFileSize: data.maxFileSize,
      maxTextSize: data.maxTextSize,
      protocolVersion: data.protocolVersion,
      maxNameLength: data.maxNameLength,
    };
  } catch {
    // Fallback defaults
    signaling.config = {
      maxFileSize: 512 * 1024 * 1024,
      maxTextSize: 1024 * 1024,
      protocolVersion: 1,
      maxNameLength: 32,
    };
  }
  signaling.connect();
}
init();
