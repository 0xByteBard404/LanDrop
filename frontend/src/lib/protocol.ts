// 文件分块传输协议：4 字节大端 chunk index + 数据
export const CHUNK_HEADER_SIZE = 4;

/** 编码一个 chunk：4 字节大端索引 + 数据，返回 ArrayBuffer */
export function encodeChunk(index: number, chunkData: ArrayBuffer | Uint8Array): ArrayBuffer {
  const data = chunkData instanceof Uint8Array ? chunkData : new Uint8Array(chunkData);
  const payload = new Uint8Array(CHUNK_HEADER_SIZE + data.byteLength);
  new DataView(payload.buffer).setUint32(0, index, false);
  payload.set(data, CHUNK_HEADER_SIZE);
  return payload.buffer;
}

/** 解码一个 chunk：返回 { index, data } */
export function decodeChunk(buffer: ArrayBuffer): { index: number; data: Uint8Array } {
  const view = new DataView(buffer);
  const index = view.getUint32(0, false);
  const data = new Uint8Array(buffer.slice(CHUNK_HEADER_SIZE));
  return { index, data };
}

/** 找出缺失的 chunk 索引（chunks 为稀疏数组，已收位置为真值） */
export function findMissingIndices(chunks: ArrayLike<unknown>, totalChunks: number): number[] {
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!chunks[i]) missing.push(i);
  }
  return missing;
}
