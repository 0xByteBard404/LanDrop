const STORAGE_KEY = "landrop_crypto";

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function exportPublicKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

async function importPublicKey(b64) {
  const raw = base64ToArrayBuffer(b64);
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function deriveAESKey(peerPublicKey, myPrivateKey) {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    myPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function initCrypto() {
  // crypto.subtle requires secure context (HTTPS or localhost)
  if (!crypto || !crypto.subtle) {
    return { publicKeyBase64: null, privateKey: null };
  }

  // Try load from sessionStorage (survives reconnect)
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { privateKeyJwk, publicKeyB64 } = JSON.parse(saved);
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        privateKeyJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveKey"]
      );
      return { publicKeyBase64: publicKeyB64, privateKey };
    }
  } catch {}

  // Generate new key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  // Save to sessionStorage
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ privateKeyJwk, publicKeyB64: publicKeyBase64 }));
  } catch {}

  return { publicKeyBase64, privateKey: keyPair.privateKey };
}

export async function encryptText(plainText, peerPublicKeyBase64, myPrivateKey) {
  const peerPubKey = await importPublicKey(peerPublicKeyBase64);
  const aesKey = await deriveAESKey(peerPubKey, myPrivateKey);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);

  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded);

  return {
    content: arrayBufferToBase64(cipherBuf),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

export async function decryptText(cipherBase64, ivBase64, peerPublicKeyBase64, myPrivateKey) {
  const peerPubKey = await importPublicKey(peerPublicKeyBase64);
  const aesKey = await deriveAESKey(peerPubKey, myPrivateKey);

  const cipherBuf = base64ToArrayBuffer(cipherBase64);
  const ivBuf = base64ToArrayBuffer(ivBase64);

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(ivBuf) },
    aesKey,
    cipherBuf
  );

  return new TextDecoder().decode(plainBuf);
}
