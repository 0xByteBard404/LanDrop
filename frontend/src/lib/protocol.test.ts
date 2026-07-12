import { describe, it, expect } from "vitest";
import {
  encodeChunk,
  decodeChunk,
  findMissingIndices,
  CHUNK_HEADER_SIZE,
} from "./protocol.js";

describe("encodeChunk / decodeChunk", () => {
  it("往返：编码后解码恢复原 index 和 data", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = encodeChunk(42, data);
    const { index, data: decoded } = decodeChunk(buf);
    expect(index).toBe(42);
    expect(Array.from(decoded)).toEqual([1, 2, 3, 4, 5]);
  });

  it("index 用大端 4 字节编码", () => {
    const buf = encodeChunk(0x11223344, new Uint8Array(0));
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x11);
    expect(bytes[1]).toBe(0x22);
    expect(bytes[2]).toBe(0x33);
    expect(bytes[3]).toBe(0x44);
    expect(buf.byteLength).toBe(CHUNK_HEADER_SIZE);
  });

  it("大 index（超过 65535）正确编码/解码", () => {
    const buf = encodeChunk(70000, new Uint8Array([9]));
    const { index, data } = decodeChunk(buf);
    expect(index).toBe(70000);
    expect(Array.from(data)).toEqual([9]);
  });

  it("空数据 chunk 仍正确", () => {
    const buf = encodeChunk(0, new Uint8Array(0));
    const { index, data } = decodeChunk(buf);
    expect(index).toBe(0);
    expect(data.byteLength).toBe(0);
  });
});

describe("findMissingIndices", () => {
  it("返回未填充的索引", () => {
    const chunks: (Uint8Array | undefined)[] = [];
    chunks[0] = new Uint8Array([1]);
    chunks[2] = new Uint8Array([3]);
    expect(findMissingIndices(chunks, 3)).toEqual([1]);
  });

  it("全部缺失", () => {
    expect(findMissingIndices([], 4)).toEqual([0, 1, 2, 3]);
  });

  it("全部已收返回空数组", () => {
    const chunks = [1, 1, 1];
    expect(findMissingIndices(chunks, 3)).toEqual([]);
  });

  it("totalChunks 为 0 返回空", () => {
    expect(findMissingIndices([], 0)).toEqual([]);
  });
});
