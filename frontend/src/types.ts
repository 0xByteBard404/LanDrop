// LanDrop 核心类型定义

export type TransferRole = "sender" | "receiver" | "secure-sender" | "secure-receiver";

export interface NodeInfo {
  id: string;
  name: string;
}

export interface AppConfig {
  maxFileSize: number;
  maxTextSize: number;
  protocolVersion: number;
  maxNameLength: number;
  iceServers: RTCIceServer[];
}

/** 传输状态（activeTransfers 的 value），不同 role 用不同字段，故多数 optional */
export interface TransferState {
  role: TransferRole;
  peerId: string;
  transferId: string;
  state: string;
  pendingIceCandidates: RTCIceCandidateInit[] | null;
  remoteDescriptionSet: boolean;
  pc?: RTCPeerConnection | null;
  controlChannel?: RTCDataChannel | null;
  dataChannel?: RTCDataChannel | null;
  file?: File;
  text?: string;
  chunks?: Uint8Array[];
  _receivedCount?: number;
  totalChunks?: number;
  chunkSize?: number;
  fileHash?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  _verifying?: boolean;
  _lastProgressTime?: number;
  _blobUrl?: string;
  _connectionStarted?: boolean;
}

export interface TransferRecord {
  id?: number;
  fileName: string;
  fileSize: number;
  role: TransferRole;
  peerName: string;
  status: "success" | "error";
  error?: string;
  timestamp: number;
}

/** 信令消息（服务端→客户端，或经服务端路由的 P2P 消息） */
export type ServerMessage =
  | { type: "joined"; nodeId: string; name: string; peers: NodeInfo[]; maxFileSize: number; maxTextSize: number; protocolVersion: number; maxNameLength: number }
  | { type: "peers"; list: NodeInfo[] }
  | { type: "leave"; nodeId: string }
  | { type: "offer-file"; from: string; transferId: string; fileName: string; fileSize: number; mimeType: string }
  | { type: "offer-secure-text"; from: string; transferId: string; textPreview: string }
  | { type: "send-text"; from: string; textId: string; content: string }
  | { type: "chat"; from: string; name: string; content: string }
  | { type: "sdp-offer"; from: string; transferId: string; sdp: string }
  | { type: "sdp-answer"; from: string; transferId: string; sdp: string }
  | { type: "ice-candidate"; from: string; transferId: string; candidate: RTCIceCandidateInit }
  | { type: "accept-file"; from: string; transferId: string }
  | { type: "reject-file"; from: string; transferId: string; reason?: string }
  | { type: "cancel-transfer"; from: string; transferId: string; reason?: string }
  | { type: "transfer-error"; from: string; transferId: string; error: string }
  | { type: "error"; code: string; message: string; transferId?: string }
  | { type: "pong" };

/** 控制通道消息（P2P DataChannel "control"） */
export type ControlMessage =
  | { type: "start"; transferId: string; fileName: string; fileSize: number; mimeType: string; totalChunks: number; chunkSize: number; fileHash: string }
  | { type: "complete"; transferId: string; totalChunks: number }
  | { type: "done"; transferId: string; hashMatch: boolean; error?: string }
  | { type: "missing"; transferId: string; indices: number[] }
  | { type: "progress"; receivedChunks: number; totalChunks: number };
