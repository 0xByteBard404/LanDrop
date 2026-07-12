import { toast } from "./lib/toast.js";
import { playChime } from "./lib/sound.js";
import { addHistory, getHistory } from "./lib/db.js";
import { SignalingClient } from "./signaling.js";
import { FileTransfer } from "./webrtc.js";
import type { AppConfig, NodeInfo, ServerMessage, TransferRecord, TransferRole, TransferState } from "./types.js";

const signaling = new SignalingClient();
const transfer = new FileTransfer(signaling) as unknown as FileTransfer & {
  activeTransfers: Map<string, TransferState>;
  _speedLimit: number;
  onProgress: ((transferId: string, current: number, total: number) => void) | null;
  onTransferComplete: ((transferId: string) => void) | null;
  onTransferError: ((transferId: string, error: string) => void) | null;
  onSecureTextReceived: ((transferId: string, text: string, fromId: string) => void) | null;
  onSecureTextOffer: ((fromId: string, transferId: string, textPreview: string) => void) | null;
  onMediaPreview: ((transferId: string, fileName: string, mimeType: string, fileSize: number) => void) | null;
};
const transferMeta = new Map<string, { fileName: string; fileSize: number; role: TransferRole; peerName: string }>();

type OfferFileMsg = Extract<ServerMessage, { type: "offer-file" }>;
type OfferMsg = OfferFileMsg | Extract<ServerMessage, { type: "offer-secure-text" }>;

// --- DOM refs ---

const selfInfoEl = document.getElementById("self-info") as HTMLElement;
const peersListEl = document.getElementById("peers-list") as HTMLElement;
const noPeersEl = document.getElementById("no-peers") as HTMLElement;
const chatMessagesEl = document.getElementById("chat-messages") as HTMLElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const chatSendBtn = document.getElementById("chat-send") as HTMLElement;
const transfersListEl = document.getElementById("transfers-list") as HTMLElement;
const noTransfersEl = document.getElementById("no-transfers") as HTMLElement;
const offerDialog = document.getElementById("offer-dialog") as HTMLDialogElement;
const offerTitle = document.getElementById("offer-title") as HTMLElement;
const offerFileInfo = document.getElementById("offer-file-info") as HTMLElement;
const offerAcceptBtn = document.getElementById("offer-accept") as HTMLElement;
const offerRejectBtn = document.getElementById("offer-reject") as HTMLElement;
const messagesListEl = document.getElementById("messages-list") as HTMLElement;
const noMessagesEl = document.getElementById("no-messages") as HTMLElement;
const textComposeDialog = document.getElementById("text-compose-dialog") as HTMLDialogElement;
const textComposeTitle = document.getElementById("text-compose-title") as HTMLElement;
const textComposeInput = document.getElementById("text-compose-input") as HTMLTextAreaElement;
const textComposeSendBtn = document.getElementById("text-compose-send") as HTMLElement;
const textComposeCancelBtn = document.getElementById("text-compose-cancel") as HTMLElement;
const textComposeSecure = document.getElementById("text-compose-secure") as HTMLInputElement;
const secureHint = document.getElementById("secure-hint") as HTMLElement;
const textReceiveDialog = document.getElementById("text-receive-dialog") as HTMLDialogElement;
const textReceiveTitle = document.getElementById("text-receive-title") as HTMLElement;
const textReceiveContent = document.getElementById("text-receive-content") as HTMLElement;
const textReceiveCopyBtn = document.getElementById("text-receive-copy") as HTMLElement;
const textReceiveCloseBtn = document.getElementById("text-receive-close") as HTMLElement;
const qrBtn = document.getElementById("qr-btn") as HTMLElement;
const qrDialog = document.getElementById("qr-dialog") as HTMLDialogElement;
const qrContainer = document.getElementById("qr-container") as HTMLElement;
const qrUrlEl = document.getElementById("qr-url") as HTMLElement;
const qrCopyBtn = document.getElementById("qr-copy") as HTMLElement;
const qrCloseBtn = document.getElementById("qr-close") as HTMLElement;
const speedLimitSelect = document.getElementById("speed-limit") as HTMLSelectElement;
const previewDialog = document.getElementById("preview-dialog") as HTMLDialogElement;
const previewMediaContainer = document.getElementById("preview-media-container") as HTMLElement;
const previewDownloadBtn = document.getElementById("preview-download") as HTMLElement;
const previewCloseBtn = document.getElementById("preview-close") as HTMLElement;

speedLimitSelect.onchange = () => {
  transfer._speedLimit = parseInt(speedLimitSelect.value);
};

// --- Media preview ---

transfer.onMediaPreview = (transferId: string, fileName: string, mimeType: string, _fileSize: number) => {
  const t = transfer.activeTransfers.get(transferId);
  if (!t || !t._blobUrl) return;
  showMediaPreview(t._blobUrl, fileName, mimeType);
};

function showMediaPreview(blobUrl: string, fileName: string, mimeType: string) {
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
  previewDialog.showModal();
}

previewCloseBtn.onclick = () => {
  previewDialog.close();
};

// --- Browser notifications ---

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico" });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

requestNotificationPermission();

// --- Signaling events ---

signaling.onPeersUpdate = (peers: Map<string, NodeInfo>) => {
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
  span.replaceChildren();
  span.appendChild(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const finish = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName && newName.length <= (signaling.config?.maxNameLength || 32)) {
      signaling.nodeInfo!.name = newName;
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

signaling.onOfferFile = (msg: OfferFileMsg) => {
  showOfferDialog(msg);
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  showNotification("收到文件", `${peerName}: ${msg.fileName} (${formatSize(msg.fileSize)})`);
};

signaling.onMessage = (msg: ServerMessage) => {
  if (msg.type === "error" && msg.code === "text_too_long") {
    toast(`文本超过 ${formatSize(signaling.config?.maxTextSize ?? 0)} 限制`, "error");
    return;
  }
  transfer.handleSignalingMessage(msg);
};

signaling.onTextReceived = (msg: Extract<ServerMessage, { type: "send-text" }>) => {
  showReceivedText(msg);
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  showNotification("收到文本", `来自 ${peerName}`);
};

// --- Transfer events ---

transfer.onProgress = (transferId: string, current: number, total: number) => {
  updateTransferProgress(transferId, current, total);
};

transfer.onTransferComplete = (transferId: string) => {
  updateTransferStatus(transferId, "传输完成", "success");
  showNotification("传输完成", "文件已成功传输");
  playChime();
  const meta = transferMeta.get(transferId);
  if (meta) {
    addHistory({ ...meta, status: "success" });
    renderHistoryList();
  }
};

transfer.onTransferError = (transferId: string, error: string) => {
  const messages: Record<string, string> = {
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
  const meta = transferMeta.get(transferId);
  if (meta) {
    addHistory({ ...meta, status: "error", error });
    renderHistoryList();
  }
};

transfer.onSecureTextReceived = (transferId: string, text: string, fromId: string) => {
  const peerName = signaling.peers.get(fromId)?.name || "未知设备";
  addMessageCard(transferId, text, "receiver", peerName, true);
  textReceiveTitle.textContent = `来自 ${peerName} 的文本 (安全)`;
  textReceiveContent.textContent = text;
  textReceiveDialog.showModal();
  showNotification("收到安全文本", `来自 ${peerName}`);
};

transfer.onSecureTextOffer = (fromId: string, transferId: string, textPreview: string) => {
  showOfferDialog({ type: "offer-secure-text", from: fromId, transferId, textPreview });
};

// --- Chat ---

signaling.onChatMessage = (msg: Extract<ServerMessage, { type: "chat" }>) => {
  const isSelf = msg.from === signaling.nodeId;
  const name = isSelf ? signaling.nodeInfo?.name : (msg.name || signaling.peers.get(msg.from)?.name || "未知设备");
  addChatMessage(name as string, msg.content, isSelf);
  if (!isSelf) {
    showNotification("群聊消息", `${name}: ${msg.content.slice(0, 60)}`);
  }
};

function addChatMessage(name: string, content: string, isSelf: boolean) {
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

function renderPeers(peers: Map<string, NodeInfo>) {
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

    const folderBtn = document.createElement("button");
    folderBtn.className = "btn-text-link";
    folderBtn.textContent = "发送文件夹";
    folderBtn.onclick = () => selectAndSend(id, true);

    const btnGroup = document.createElement("div");
    btnGroup.className = "peer-actions";
    btnGroup.appendChild(textBtn);
    btnGroup.appendChild(folderBtn);
    btnGroup.appendChild(sendBtn);

    card.appendChild(nameSpan);
    card.appendChild(btnGroup);

    // Drag-and-drop
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
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
      const files = e.dataTransfer!.files;
      if (files && files.length > 0) {
        sendFilesToPeer(id, files);
      }
    });

    peersListEl.appendChild(card);
  }
}

// --- File selection ---

async function sendFilesToPeer(peerId: string, files: FileList | File[]) {
  const fileArr = Array.from(files);
  const maxFileSize = signaling.config?.maxFileSize ?? Infinity;

  // The limit is per-file, not per-batch: skip oversized files individually
  // but still send the rest.
  const tooLarge = fileArr.filter((f) => f.size > maxFileSize);
  if (tooLarge.length > 0) {
    const names = tooLarge.map((f) => f.name).join("\n");
    toast(`以下文件超过 ${formatSize(maxFileSize)} 单文件限制，已跳过：\n${names}`, "error");
  }

  for (const file of fileArr) {
    if (file.size > maxFileSize) continue;
    try {
      const transferId = await transfer.sendFile(peerId, file);
      addTransferCard(transferId, file.name, file.size, "sender", signaling.peers.get(peerId)?.name || "未知设备");
    } catch (e) {
      toast(`${file.name}: ${(e as Error).message}`, "error");
    }
  }
}

async function selectAndSend(peerId: string, directory = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (directory) {
    input.setAttribute("webkitdirectory", "");
  }
  input.onchange = async () => {
    const files = input.files;
    if (!files || files.length === 0) return;
    await sendFilesToPeer(peerId, files);
  };
  input.click();
}


// --- Offer dialog ---

const offerQueue: OfferMsg[] = [];
let showingOffer = false;
let currentOfferTransferId: string | null = null;

function showOfferDialog(msg: OfferMsg) {
  offerQueue.push(msg);
  if (!showingOffer) _showNextOffer();
}

function _showNextOffer() {
  if (offerQueue.length === 0) {
    showingOffer = false;
    currentOfferTransferId = null;
    offerDialog.close();
    return;
  }
  showingOffer = true;
  const msg = offerQueue.shift()!;
  currentOfferTransferId = msg.transferId;
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  offerTitle.textContent = msg.type === "offer-secure-text"
    ? `${peerName} 想发送安全文本`
    : `${peerName} 想发送文件`;
  offerFileInfo.textContent = msg.type === "offer-secure-text"
    ? msg.textPreview || "(无预览)"
    : `${msg.fileName} (${formatSize(msg.fileSize)})`;
  offerDialog.showModal();

  offerAcceptBtn.onclick = () => {
    signaling.sendAcceptFile(msg.from, msg.transferId);
    if (msg.type === "offer-secure-text") {
      transfer.acceptSecureText(msg.from, msg.transferId);
    } else {
      addTransferCard(msg.transferId, msg.fileName, msg.fileSize, "receiver", peerName);
    }
    _showNextOffer();
  };

  offerRejectBtn.onclick = () => {
    signaling.sendRejectFile(msg.from, msg.transferId);
    _showNextOffer();
  };
}

function dismissOffer(transferId: string) {
  // Remove from queue
  const idx = offerQueue.findIndex(m => m.transferId === transferId);
  if (idx !== -1) offerQueue.splice(idx, 1);
  // If currently showing this offer, dismiss and show next
  if (currentOfferTransferId === transferId) {
    _showNextOffer();
  }
}

// --- Transfer cards ---

function addTransferCard(transferId: string, fileName: string, fileSize: number, role: TransferRole, peerName = "未知设备") {
  transferMeta.set(transferId, { fileName, fileSize, role, peerName });
  noTransfersEl.style.display = "none";

  const card = document.createElement("div");
  card.className = "transfer-card";
  card.id = `transfer-${transferId}`;

  card.innerHTML = `
    <div class="transfer-header">
      <span class="transfer-filename">${escapeHtml(fileName)}</span>
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

  (card.querySelector(".transfer-cancel") as HTMLElement).onclick = () => {
    transfer.cancelTransfer(transferId);
  };

  transfersListEl.appendChild(card);
}

async function renderHistoryList() {
  const el = document.getElementById("history-list");
  if (!el) return;
  const history: TransferRecord[] = await getHistory();
  if (history.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = history
    .slice(0, 20)
    .map((r) => {
      const time = new Date(r.timestamp).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const ok = r.status === "success";
      return `<div class="history-item ${ok ? "history-success" : "history-error"}">
        <span class="history-status">${ok ? "✓" : "✗"}</span>
        <span class="history-name">${escapeHtml(r.fileName || "")}</span>
        <span class="history-peer">${escapeHtml(r.peerName || "")}</span>
        <span class="history-size">${formatSize(r.fileSize || 0)}</span>
        <span class="history-time">${time}</span>
      </div>`;
    })
    .join("");
}

function updateTransferProgress(transferId: string, current: number, total: number) {
  const card = document.getElementById(`transfer-${transferId}`);
  if (!card) return;

  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const fill = card.querySelector(".transfer-progress-fill") as HTMLElement | null;
  if (fill) fill.style.width = `${percent}%`;

  const status = card.querySelector(".transfer-status");
  if (status && !status.classList.contains("error") && !status.classList.contains("success")) {
    status.textContent = `${percent}%`;
  }
}

function updateTransferStatus(transferId: string, text: string, className: string) {
  const card = document.getElementById(`transfer-${transferId}`);
  if (!card) return;

  const status = card.querySelector(".transfer-status");
  if (status) {
    status.textContent = text;
    status.className = `transfer-status ${className}`;
  }

  const fill = card.querySelector(".transfer-progress-fill") as HTMLElement | null;
  if (fill) fill.style.width = className === "success" ? "100%" : fill.style.width;

  const cancelBtn = card.querySelector(".transfer-cancel");
  if (cancelBtn) cancelBtn.remove();
}

// --- Text messaging ---

let textComposeTargetId: string | null = null;

function openTextCompose(peerId: string, peerName: string) {
  textComposeTargetId = peerId;
  textComposeTitle.textContent = `发送文本给 ${peerName}`;
  textComposeInput.value = "";
  textComposeSecure.checked = false;
  textComposeSecure.disabled = false;
  secureHint.textContent = "";
  textComposeDialog.showModal();
  setTimeout(() => textComposeInput.focus(), 50);
}

textComposeCancelBtn.onclick = () => {
  textComposeDialog.close();
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
  // Size-check in bytes to match the server's UTF-8 byte limit, not JS char count.
  const contentBytes = new Blob([content]).size;
  if (contentBytes > maxTextSize) {
    toast(`文本超过 ${formatSize(maxTextSize)} 限制`, "error");
    return;
  }

  const textId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const peerName = signaling.peers.get(textComposeTargetId!)?.name || "未知设备";
  const secure = textComposeSecure.checked && !textComposeSecure.disabled;

  if (secure) {
    try {
      await transfer.sendSecureText(textComposeTargetId!, content);
      addMessageCard(textId, content, "sender", peerName, true);
    } catch (e) {
      toast("安全传输失败: " + (e as Error).message, "error");
      return;
    }
  } else {
    signaling.sendText(textComposeTargetId!, textId, content);
    addMessageCard(textId, content, "sender", peerName, false);
  }

  textComposeDialog.close();
  textComposeTargetId = null;
};

async function showReceivedText(msg: Extract<ServerMessage, { type: "send-text" }>) {
  const peerName = signaling.peers.get(msg.from)?.name || "未知设备";
  addMessageCard(msg.textId, msg.content, "receiver", peerName, false);

  textReceiveTitle.textContent = `来自 ${peerName} 的文本`;
  textReceiveContent.textContent = msg.content;
  textReceiveDialog.showModal();
}

textReceiveCopyBtn.onclick = async () => {
  const text = textReceiveContent.textContent;
  try {
    await navigator.clipboard.writeText(text ?? "");
    textReceiveCopyBtn.textContent = "已复制";
    setTimeout(() => { textReceiveCopyBtn.textContent = "复制"; }, 1500);
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text ?? "";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    textReceiveCopyBtn.textContent = "已复制";
    setTimeout(() => { textReceiveCopyBtn.textContent = "复制"; }, 1500);
  }
};

textReceiveCloseBtn.onclick = () => {
  textReceiveDialog.close();
};

function addMessageCard(textId: string, content: string, role: string, peerName: string, encrypted = false) {
  noMessagesEl.style.display = "none";

  const card = document.createElement("div");
  card.className = `message-card message-${role}` + (encrypted ? " message-encrypted" : "");
  card.id = `message-${textId}`;

  const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
  const arrow = role === "sender" ? "↑" : "↓";
  const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const lock = encrypted ? ' <span class="lock-icon">🔒</span>' : "";

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
    textReceiveDialog.showModal();
  };

  messagesListEl.prepend(card);
}

function escapeHtml(str: string) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Utility ---

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// --- QR code dialog ---

let cachedLanUrl: string | null = null;

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
      text: cachedLanUrl!,
      width: 200,
      height: 200,
      colorDark: "#e8e4df",
      colorLight: "#1a1a1e",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch {
    qrUrlEl.textContent = location.href;
  }
  qrDialog.showModal();
};

qrCloseBtn.onclick = () => {
  qrDialog.close();
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
      iceServers: data.iceServers ? JSON.parse(data.iceServers) : [],
    } as AppConfig;
  } catch {
    // Fallback defaults
    signaling.config = {
      maxFileSize: 512 * 1024 * 1024,
      maxTextSize: 1024 * 1024,
      protocolVersion: 1,
      maxNameLength: 32,
      iceServers: [],
    } as AppConfig;
  }
  signaling.connect();
  renderHistoryList();
}
init();
