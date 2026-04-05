const CHUNK_SIZE = 16384; // 16KB
const MAX_FILE_SIZE = 512 * 1024 * 1024; // 500MB

function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

// SHA-256 helper: uses crypto.subtle in secure contexts, pure JS fallback otherwise
async function sha256Hex(buffer) {
  if (crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const arr = new Uint8Array(hashBuffer);
    return "sha256-" + Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Pure JS SHA-256 fallback for non-secure contexts (HTTP LAN)
  return "sha256-" + jsSha256(new Uint8Array(buffer));
}

// Minimal pure JS SHA-256 implementation
function jsSha256(msg) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function ch(x, y, z) { return (x & y) ^ (~x & z); }
  function maj(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }
  function ep0(x) { return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22); }
  function ep1(x) { return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25); }
  function sig0(x) { return rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3); }
  function sig1(x) { return rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10); }

  // Padding
  const len = msg.length;
  const bitLen = len * 8;
  const padLen = ((56 - (len + 1) % 64) + 64) % 64;
  const total = len + 1 + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (bitLen / 0x100000000) | 0, false);
  dv.setUint32(total - 4, bitLen | 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) w[i] = (sig1(w[i - 2]) + w[i - 7] + sig0(w[i - 15]) + w[i - 16]) | 0;

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + ep1(e) + ch(e, f, g) + K[i] + w[i]) | 0;
      const t2 = (ep0(a) + maj(a, b, c)) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0, false); ov.setUint32(4, h1, false); ov.setUint32(8, h2, false); ov.setUint32(12, h3, false);
  ov.setUint32(16, h4, false); ov.setUint32(20, h5, false); ov.setUint32(24, h6, false); ov.setUint32(28, h7, false);
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}

// SHA-256 self-test (silent unless failure)
(function() {
  const r = jsSha256(new Uint8Array([0x61, 0x62, 0x63]));
  if (r !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    console.error("SHA-256 self-test FAILED");
})();

export class FileTransfer {
  constructor(signaling) {
    this.signaling = signaling;
    this.activeTransfers = new Map(); // transferId -> TransferState
    this.onProgress = null;
    this.onTransferComplete = null;
    this.onTransferError = null;
    this.onIncomingFile = null;
    this.onSecureTextReceived = null;
    this.onSecureTextOffer = null;
    // Send queue: only 1 active P2P connection at a time to avoid SCTP congestion
    this._sendQueue = [];
    this._activeSends = 0;
  }

  // --- ICE candidate buffering ---

  _addIceCandidate(transferId, candidate) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer || !transfer.pc) return;

    if (transfer.remoteDescriptionSet) {
      transfer.pc.addIceCandidate(candidate).catch(() => {});
    } else {
      if (!transfer.pendingIceCandidates) transfer.pendingIceCandidates = [];
      transfer.pendingIceCandidates.push(candidate);
    }
  }

  _flushPendingCandidates(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer || !transfer.pendingIceCandidates) return;
    for (const c of transfer.pendingIceCandidates) {
      transfer.pc.addIceCandidate(c).catch(() => {});
    }
    transfer.pendingIceCandidates = null;
  }

  // --- Sender: initiate file transfer ---

  async sendFile(peerId, file) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`文件超过 500MB 限制`);
    }

    const transferId = uuid();
    this.signaling.sendOfferFile(peerId, transferId, file);

    // Store pending transfer
    this.activeTransfers.set(transferId, {
      role: "sender",
      peerId,
      file,
      transferId,
      state: "waiting",
      pendingIceCandidates: [],
      remoteDescriptionSet: false,
    });

    return transferId;
  }

  // --- Sender: initiate secure text transfer via WebRTC DataChannel ---

  async sendSecureText(peerId, text) {
    const transferId = uuid();
    const textPreview = text.length > 50 ? text.slice(0, 50) + "..." : text;
    this.signaling.sendOfferSecureText(peerId, transferId, textPreview);

    this.activeTransfers.set(transferId, {
      role: "secure-sender",
      peerId,
      transferId,
      text,
      state: "waiting",
      pendingIceCandidates: [],
      remoteDescriptionSet: false,
    });

    return transferId;
  }

  // --- Handle signaling messages ---

  handleSignalingMessage(msg) {
    const transfer = this.activeTransfers.get(msg.transferId);

    switch (msg.type) {
      case "accept-file":
        if (transfer && transfer.role === "sender") {
          this._sendQueue.push({ peerId: msg.from, transferId: msg.transferId });
          this._drainSendQueue();
        } else if (transfer && transfer.role === "secure-sender") {
          this._startSecureTextConnection(transfer.peerId, msg.transferId, transfer.text);
        }
        break;

      case "offer-secure-text":
        // Auto-accept secure text transfer
        this.signaling.sendAcceptFile(msg.from, msg.transferId);
        this.activeTransfers.set(msg.transferId, {
          role: "secure-receiver",
          peerId: msg.from,
          transferId: msg.transferId,
          state: "waiting",
          pendingIceCandidates: [],
          remoteDescriptionSet: false,
        });
        if (this.onSecureTextOffer) {
          this.onSecureTextOffer(msg.from, msg.transferId, msg.textPreview);
        }
        break;

      case "reject-file":
        if (transfer) {
          this.activeTransfers.delete(msg.transferId);
          if (this.onTransferError) {
            this.onTransferError(msg.transferId, msg.reason || msg.type);
          }
        }
        break;

      case "sdp-offer":
        this._handleSdpOffer(msg.from, msg.transferId, msg.sdp);
        break;

      case "sdp-answer":
        if (transfer && transfer.pc) {
          transfer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.sdp)))
            .then(() => {
              transfer.remoteDescriptionSet = true;
              this._flushPendingCandidates(msg.transferId);
            })
            .catch(() => {});
        }
        break;

      case "ice-candidate":
        this._addIceCandidate(msg.transferId, new RTCIceCandidate(msg.candidate));
        break;

      case "cancel-transfer":
        this._cleanup(msg.transferId);
        if (this.onTransferError) {
          this.onTransferError(msg.transferId, "cancelled");
        }
        break;

      case "transfer-error":
        this._cleanup(msg.transferId);
        if (this.onTransferError) {
          this.onTransferError(msg.transferId, msg.error);
        }
        break;

      case "error":
        if (msg.code === "file_too_large") {
          if (this.onTransferError) {
            const tid = msg.message?.match(/transfer/i) ? msg.transferId : null;
            if (tid) this.onTransferError(tid, "file_too_large");
          }
        }
        break;
    }
  }

  // --- Send queue: serialize P2P connections to avoid SCTP congestion ---

  _drainSendQueue() {
    while (this._sendQueue.length > 0 && this._activeSends < 1) {
      const { peerId, transferId } = this._sendQueue.shift();
      const transfer = this.activeTransfers.get(transferId);
      if (!transfer) continue; // cancelled while queued
      this._activeSends++;
      transfer._connectionStarted = true;
      this._startConnection(peerId, transferId, transfer.file);
    }
  }

  // --- Sender: create connection after accept ---

  async _startConnection(peerId, transferId, file) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    const pc = new RTCPeerConnection({ iceServers: [] });
    transfer.pc = pc;
    transfer.state = "connecting";

    // ICE timeout + data channel open timeout
    const timeout = setTimeout(() => {
      if (this.activeTransfers.has(transferId)) {
        this.signaling.sendTransferError(peerId, transferId, "ice_timeout");
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "ice_timeout");
      }
    }, 30000);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.sendIceCandidate(peerId, transferId, e.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "connected" || state === "completed") {
        clearTimeout(timeout);
      } else if (state === "failed" || state === "disconnected") {
        clearTimeout(timeout);
        if (this.activeTransfers.has(transferId)) {
          this.signaling.sendTransferError(peerId, transferId, "ice_" + state);
          this._cleanup(transferId);
          if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
        }
      }
    };

    // Create control channel
    const controlChannel = pc.createDataChannel("control", { ordered: true });
    transfer.controlChannel = controlChannel;

    // Create data channel
    const dataChannel = pc.createDataChannel("file-transfer", {
      ordered: true,
      maxRetransmits: null,
    });
    dataChannel.binaryType = "arraybuffer";
    dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB
    transfer.dataChannel = dataChannel;

    // Wait for data channel to open, then send file
    dataChannel.onopen = async () => {
      clearTimeout(timeout);
      console.log(`[发送] ${transferId.slice(0,8)} 数据通道已打开, 文件=${file.name} 大小=${file.size}`);
      await this._sendFileData(transferId);
    };

    dataChannel.onerror = (e) => {
      console.error(`[发送] ${transferId.slice(0,8)} 数据通道错误:`, e);
      clearTimeout(timeout);
      if (this.activeTransfers.has(transferId)) {
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
      }
    };

    dataChannel.onclose = () => {
      console.log(`[发送] ${transferId.slice(0,8)} 数据通道关闭, readyState=${dataChannel.readyState}`);
    };

    // Handle control messages from receiver
    controlChannel.onopen = () => {
      controlChannel.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        this._handleControlMessage(transferId, msg);
      };
    };

    controlChannel.onerror = () => {
      clearTimeout(timeout);
      if (this.activeTransfers.has(transferId)) {
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
      }
    };

    // Create and send SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendSdpOffer(peerId, transferId, JSON.stringify(pc.localDescription));
  }

  // --- Sender: secure text connection ---

  async _startSecureTextConnection(peerId, transferId, text) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    const pc = new RTCPeerConnection({ iceServers: [] });
    transfer.pc = pc;
    transfer.state = "connecting";

    const timeout = setTimeout(() => {
      if (this.activeTransfers.has(transferId)) {
        this.signaling.sendTransferError(peerId, transferId, "ice_timeout");
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "ice_timeout");
      }
    }, 15000);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.sendIceCandidate(peerId, transferId, e.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "connected" || state === "completed") {
        clearTimeout(timeout);
      } else if (state === "failed" || state === "disconnected") {
        clearTimeout(timeout);
        if (this.activeTransfers.has(transferId)) {
          this._cleanup(transferId);
          if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
        }
      }
    };

    const textChannel = pc.createDataChannel("secure-text", { ordered: true });
    transfer.dataChannel = textChannel;

    textChannel.onopen = () => {
      clearTimeout(timeout);
      textChannel.send(JSON.stringify({ type: "text", content: text }));
    };

    textChannel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "received") {
          this._cleanup(transferId);
        }
      } catch {}
    };

    textChannel.onerror = () => {
      clearTimeout(timeout);
      if (this.activeTransfers.has(transferId)) {
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendSdpOffer(peerId, transferId, JSON.stringify(pc.localDescription));
  }

  async _sendFileData(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    const { file, peerId, controlChannel, dataChannel } = transfer;
    const threshold = 1024 * 1024; // 1MB

    try {
      // Compute SHA-256
      const fileBuffer = await file.arrayBuffer();
      const fileHash = await sha256Hex(fileBuffer);
      transfer._fileBuffer = fileBuffer; // cache for potential retransmission

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      console.log(`[发送] ${transferId.slice(0,8)} 开始发送, 总块数=${totalChunks}, hash=${fileHash.slice(0,16)}`);

      // Send start message via control channel
      controlChannel.send(
        JSON.stringify({
          type: "start",
          transferId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          totalChunks,
          chunkSize: CHUNK_SIZE,
          fileHash,
        })
      );

      // Send chunks via data channel
      transfer.state = "sending";
      let lastProgressTime = 0;

      for (let i = 0; i < totalChunks; i++) {
        // Check if transfer was cancelled
        if (!this.activeTransfers.has(transferId)) return;

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkData = fileBuffer.slice(start, end);

        // Prefix with 4-byte chunk index (big-endian)
        const header = new ArrayBuffer(4);
        new DataView(header).setUint32(0, i, false);
        const payload = new Uint8Array(4 + chunkData.byteLength);
        payload.set(new Uint8Array(header), 0);
        payload.set(new Uint8Array(chunkData), 4);

        // Flow control with timeout
        if (dataChannel.bufferedAmount > threshold) {
          console.log(`[发送] ${transferId.slice(0,8)} 流控暂停 @块${i}, bufferedAmount=${dataChannel.bufferedAmount}`);
          await Promise.race([
            new Promise((resolve) => {
              dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
            }),
            new Promise((resolve) => setTimeout(resolve, 10000)),
          ]);
        }

        dataChannel.send(payload.buffer);

        // Throttled progress (max 4 updates/sec per transfer)
        const now = Date.now();
        if (this.onProgress && now - lastProgressTime > 250) {
          lastProgressTime = now;
          this.onProgress(transferId, i + 1, totalChunks);
        }
      }

      // Final progress
      if (this.onProgress) {
        this.onProgress(transferId, totalChunks, totalChunks);
      }

      // Wait for all data to be flushed from local buffer
      console.log(`[发送] ${transferId.slice(0,8)} 所有块已发送, 等待缓冲区清空, bufferedAmount=${dataChannel.bufferedAmount}`);
      while (dataChannel.bufferedAmount > 0) {
        if (!this.activeTransfers.has(transferId)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Safety net: send "complete" as fallback trigger.
      // The receiver auto-verifies when all chunks arrive (in _handleChunk),
      // so timing here is no longer critical.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send complete via control channel
      if (!this.activeTransfers.has(transferId)) return;
      console.log(`[发送] ${transferId.slice(0,8)} 发送 complete 消息`);
      controlChannel.send(
        JSON.stringify({
          type: "complete",
          transferId,
          totalChunks,
        })
      );

      transfer.state = "verifying";
    } catch (e) {
      // Transfer was cancelled or channel closed — silently ignore
      if (this.activeTransfers.has(transferId)) {
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
      }
    }
  }

  // --- Receiver: handle incoming SDP offer ---

  async _handleSdpOffer(fromId, transferId, sdpStr) {
    const pc = new RTCPeerConnection({ iceServers: [] });

    // Store for ICE candidate buffering before remote description is set
    const transfer = this.activeTransfers.get(transferId) || {};
    transfer.pc = pc;
    transfer.role = "receiver";
    transfer.peerId = fromId;
    transfer.state = "connecting";
    transfer.chunks = [];
    transfer.pendingIceCandidates = [];
    transfer.remoteDescriptionSet = false;
    this.activeTransfers.set(transferId, transfer);

    // ICE timeout
    const iceTimer = setTimeout(() => {
      this.signaling.sendTransferError(fromId, transferId, "ice_timeout");
      this._cleanup(transferId);
    }, 30000);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.sendIceCandidate(fromId, transferId, e.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "connected" || s === "completed") {
        clearTimeout(iceTimer);
      } else if (s === "failed" || s === "disconnected") {
        clearTimeout(iceTimer);
        if (this.activeTransfers.has(transferId)) {
          this.signaling.sendTransferError(fromId, transferId, "ice_" + s);
          this._cleanup(transferId);
          if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
        }
      }
    };

    // Receive DataChannels from sender
    pc.ondatachannel = (event) => {
      const channel = event.channel;

      if (channel.label === "control") {
        transfer.controlChannel = channel;
        channel.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          this._handleControlMessage(transferId, msg);
        };
        channel.onerror = () => {
          clearTimeout(iceTimer);
          if (this.activeTransfers.has(transferId)) {
            this._cleanup(transferId);
            if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
          }
        };
      } else if (channel.label === "file-transfer") {
        channel.binaryType = "arraybuffer";
        transfer.dataChannel = channel;
        channel.onmessage = (e) => {
          this._handleChunk(transferId, e.data);
        };
        channel.onerror = () => {
          clearTimeout(iceTimer);
          if (this.activeTransfers.has(transferId)) {
            this._cleanup(transferId);
            if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
          }
        };
        channel.onclose = () => {
          console.log(`[接收] ${transferId.slice(0,8)} 数据通道关闭, 已收=${transfer._receivedCount||'?'} 预期=${transfer.totalChunks||'?'}`);
        };
      } else if (channel.label === "secure-text") {
        channel.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "text") {
              clearTimeout(iceTimer);
              if (this.onSecureTextReceived) {
                this.onSecureTextReceived(transferId, data.content, fromId);
              }
              channel.send(JSON.stringify({ type: "received" }));
              setTimeout(() => this._cleanup(transferId), 500);
            }
          } catch (err) {
            console.error("Secure text receive error:", err);
          }
        };
        channel.onerror = () => {
          clearTimeout(iceTimer);
          if (this.activeTransfers.has(transferId)) {
            this._cleanup(transferId);
          }
        };
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdpStr)));
    // Now safe to process buffered ICE candidates
    transfer.remoteDescriptionSet = true;
    this._flushPendingCandidates(transferId);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.sendSdpAnswer(fromId, transferId, JSON.stringify(pc.localDescription));
  }

  _handleChunk(transferId, data) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    const view = new DataView(data);
    const chunkIndex = view.getUint32(0, false);
    // Copy data instead of creating a view — avoids potential buffer reuse issues
    const chunkData = new Uint8Array(data.slice(4));

    // Only count new chunks (guard against retransmission duplicates)
    if (!transfer.chunks[chunkIndex]) {
      transfer._receivedCount = (transfer._receivedCount || 0) + 1;
    }
    transfer.chunks[chunkIndex] = chunkData;

    const received = transfer._receivedCount;

    // Throttled progress (max 4 updates/sec per transfer)
    const now = Date.now();
    if (this.onProgress && (!transfer._lastProgressTime || now - transfer._lastProgressTime > 250)) {
      transfer._lastProgressTime = now;
      this.onProgress(transferId, received, transfer.totalChunks || 0);
    }

    // Auto-verify: when all chunks arrive, start verification immediately
    // This is more reliable than waiting for the "complete" control message,
    // since data and control channels are independent SCTP streams with no ordering guarantee.
    if (transfer.totalChunks && received === transfer.totalChunks && !transfer._verifying) {
      console.log(`[接收] ${transferId.slice(0,8)} 所有 ${received} 块已收到, 自动开始验证`);
      transfer._verifying = true;
      this._verifyAndFinish(transferId);
    }
  }

  _handleControlMessage(transferId, msg) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    switch (msg.type) {
      case "start":
        transfer.totalChunks = msg.totalChunks;
        transfer.chunkSize = msg.chunkSize;
        transfer.fileHash = msg.fileHash;
        transfer.fileName = msg.fileName;
        transfer.fileSize = msg.fileSize;
        transfer.mimeType = msg.mimeType;
        transfer.state = "receiving";
        break;

      case "complete": {
        // Fallback: if auto-verify from _handleChunk hasn't fired yet,
        // start verification from the control message
        if (!transfer._verifying) {
          console.log(`[接收] ${transferId.slice(0,8)} 收到 complete 回退触发, 已收块=${transfer._receivedCount||0}/${transfer.totalChunks||'?'}`);
          transfer._verifying = true;
          transfer.state = "verifying";
          this._verifyAndFinish(transferId);
        }
        break;
      }

      case "progress":
        if (this.onProgress && transfer.role === "sender") {
          this.onProgress(transferId, msg.receivedChunks, msg.totalChunks);
        }
        break;

      case "done":
        console.log(`[发送] ${transferId.slice(0,8)} 收到 done, hashMatch=${msg.hashMatch}`);
        if (msg.hashMatch) {
          if (this.onTransferComplete) this.onTransferComplete(transferId);
        } else {
          if (this.onTransferError) this.onTransferError(transferId, "hash_mismatch");
        }
        this._cleanup(transferId);
        break;

      case "missing":
        // Receiver requests retransmission of specific chunks
        if (transfer && transfer.role === "sender" && msg.indices?.length > 0) {
          console.log(`[发送] ${transferId.slice(0,8)} 收到重传请求, 缺失块=${msg.indices.length}个`);
          this._retransmitChunks(transferId, msg.indices);
        }
        break;
    }
  }

  async _verifyAndFinish(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    try {
      // If chunks are already complete (auto-verified), skip polling
      const _count = () => transfer._receivedCount || transfer.chunks.filter(Boolean).length;
      console.log(`[验证] ${transferId.slice(0,8)} 开始验证, 已有块=${_count()}/${transfer.totalChunks}`);

      const waitStart = Date.now();
      let lastRetryTime = 0;

      while (_count() < transfer.totalChunks) {
        const elapsed = Date.now() - waitStart;
        if (elapsed > 60000) {
          const received = _count();
          console.error(`分块超时: 收到 ${received}/${transfer.totalChunks}`);
          if (this.onTransferError) this.onTransferError(transferId, "chunk_timeout");
          this._cleanup(transferId);
          return;
        }

        // Periodically request retransmission of missing chunks
        if (Date.now() - lastRetryTime > 3000 && transfer.controlChannel) {
          lastRetryTime = Date.now();
          const missing = [];
          for (let i = 0; i < transfer.totalChunks; i++) {
            if (!transfer.chunks[i]) missing.push(i);
          }
          if (missing.length > 0) {
            console.log(`[接收] ${transferId.slice(0,8)} 请求重传 ${missing.length} 个块 (索引: ${missing.slice(0,5).join(',')}...)`);
            transfer.controlChannel.send(JSON.stringify({ type: "missing", transferId, indices: missing }));
          }
        }

        await new Promise((r) => setTimeout(r, 100));
      }

      // Merge chunks
      const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
      const buffer = await blob.arrayBuffer();

      // Compute SHA-256
      const computedHash = await sha256Hex(buffer);

      const hashMatch = computedHash === transfer.fileHash;
      console.log(`[验证] ${transferId.slice(0,8)} hash比对: ${hashMatch ? '匹配' : '不匹配'}, 计算=${computedHash.slice(0,16)}, 期望=${transfer.fileHash?.slice(0,16)}`);

      // Send done via control channel
      if (transfer.controlChannel) {
        const doneMsg = { type: "done", transferId, hashMatch };
        if (!hashMatch) doneMsg.error = "hash_mismatch";
        transfer.controlChannel.send(JSON.stringify(doneMsg));
      }

      if (hashMatch) {
        // Trigger download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = transfer.fileName;
        a.click();
        URL.revokeObjectURL(url);

        if (this.onTransferComplete) this.onTransferComplete(transferId);
      } else {
        if (this.onTransferError) this.onTransferError(transferId, "hash_mismatch");
      }
    } catch (e) {
      if (this.onTransferError) this.onTransferError(transferId, e.message);
    }

    this._cleanup(transferId);
  }

  // --- Sender: retransmit specific chunks requested by receiver ---

  async _retransmitChunks(transferId, indices) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer || !transfer._fileBuffer || !transfer.dataChannel) return;

    const fileBuffer = transfer._fileBuffer;
    const fileSize = transfer.file.size;

    for (const i of indices) {
      if (!this.activeTransfers.has(transferId)) return;

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkData = fileBuffer.slice(start, end);

      const header = new ArrayBuffer(4);
      new DataView(header).setUint32(0, i, false);
      const payload = new Uint8Array(4 + chunkData.byteLength);
      payload.set(new Uint8Array(header), 0);
      payload.set(new Uint8Array(chunkData), 4);

      // Simple flow control
      if (transfer.dataChannel.bufferedAmount > 1024 * 1024) {
        await new Promise(r => setTimeout(r, 100));
      }

      transfer.dataChannel.send(payload.buffer);
    }

    console.log(`[发送] ${transferId.slice(0,8)} 重传完成 ${indices.length} 个块`);
  }

  _cleanup(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      if (transfer.pc) transfer.pc.close();
      this.activeTransfers.delete(transferId);
      // If this was an active send, free the slot
      if (transfer._connectionStarted) {
        this._activeSends = Math.max(0, this._activeSends - 1);
        this._drainSendQueue();
      }
    }
  }

  cancelTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      this.signaling.sendCancelTransfer(transfer.peerId, transferId);
      this._cleanup(transferId);
      if (this.onTransferError) this.onTransferError(transferId, "cancelled");
    }
  }

  cancelAll(reason = "signaling_reconnect") {
    for (const [transferId] of this.activeTransfers) {
      this._cleanup(transferId);
      if (this.onTransferError) this.onTransferError(transferId, reason);
    }
  }
}
