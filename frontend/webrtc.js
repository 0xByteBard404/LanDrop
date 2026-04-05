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
    this.pc = null;
    this.controlChannel = null;
    this.dataChannel = null;
    this.activeTransfers = new Map(); // transferId -> TransferState
    this.onProgress = null;
    this.onTransferComplete = null;
    this.onTransferError = null;
    this.onIncomingFile = null;
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
    });

    return transferId;
  }

  // --- Handle signaling messages ---

  handleSignalingMessage(msg) {
    const transfer = this.activeTransfers.get(msg.transferId);

    switch (msg.type) {
      case "accept-file":
        if (transfer && transfer.role === "sender") {
          this._startConnection(msg.from, msg.transferId, transfer.file);
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
          transfer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.sdp)));
        }
        break;

      case "ice-candidate":
        if (transfer && transfer.pc) {
          transfer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } else if (this.pc) {
          this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
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

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    dataChannel.bufferedAmountLowThreshold = isSafari ? 1024 * 1024 : 4 * 1024 * 1024;
    transfer.dataChannel = dataChannel;

    // Wait for data channel to open, then send file
    dataChannel.onopen = async () => {
      clearTimeout(timeout);
      await this._sendFileData(transferId);
    };

    dataChannel.onerror = () => {
      clearTimeout(timeout);
      if (this.activeTransfers.has(transferId)) {
        this._cleanup(transferId);
        if (this.onTransferError) this.onTransferError(transferId, "channel_closed");
      }
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

  async _sendFileData(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    const { file, peerId, controlChannel, dataChannel } = transfer;

    try {
      // Compute SHA-256
      const fileBuffer = await file.arrayBuffer();
      const fileHash = await sha256Hex(fileBuffer);

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

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
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const threshold = isSafari ? 1024 * 1024 : 4 * 1024 * 1024;

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

        // Flow control
        if (dataChannel.bufferedAmount > threshold) {
          await new Promise((resolve) => {
            dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
          });
        }

        dataChannel.send(payload.buffer);

        // Progress
        if (this.onProgress) {
          this.onProgress(transferId, i + 1, totalChunks);
        }
      }

      // Wait for all data to be sent
      while (dataChannel.bufferedAmount > 0) {
        if (!this.activeTransfers.has(transferId)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Send complete via control channel
      if (!this.activeTransfers.has(transferId)) return;
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
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdpStr)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.sendSdpAnswer(fromId, transferId, JSON.stringify(pc.localDescription));
  }

  _handleChunk(transferId, data) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    const view = new DataView(data);
    const chunkIndex = view.getUint32(0, false);
    const chunkData = new Uint8Array(data, 4);

    transfer.chunks[chunkIndex] = chunkData;

    if (this.onProgress) {
      const received = transfer.chunks.filter(Boolean).length;
      this.onProgress(transferId, received, transfer.totalChunks || 0);
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
        transfer.state = "verifying";
        this._verifyAndFinish(transferId);
        break;
      }

      case "progress":
        if (this.onProgress && transfer.role === "sender") {
          this.onProgress(transferId, msg.receivedChunks, msg.totalChunks);
        }
        break;

      case "done":
        if (msg.hashMatch) {
          if (this.onTransferComplete) this.onTransferComplete(transferId);
        } else {
          if (this.onTransferError) this.onTransferError(transferId, "hash_mismatch");
        }
        this._cleanup(transferId);
        break;
    }
  }

  async _verifyAndFinish(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return;

    try {
      // Wait for all chunks to arrive (data/control channels are independent SCTP streams)
      const waitStart = Date.now();
      while (transfer.chunks.filter(Boolean).length < transfer.totalChunks) {
        if (Date.now() - waitStart > 5000) {
          const received = transfer.chunks.filter(Boolean).length;
          console.error(`分块超时: 收到 ${received}/${transfer.totalChunks}`);
          if (this.onTransferError) this.onTransferError(transferId, "chunk_timeout");
          this._cleanup(transferId);
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      // Merge chunks
      const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
      const buffer = await blob.arrayBuffer();

      // Compute SHA-256
      const computedHash = await sha256Hex(buffer);

      const hashMatch = computedHash === transfer.fileHash;

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

  _cleanup(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      if (transfer.pc) transfer.pc.close();
      this.activeTransfers.delete(transferId);
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
