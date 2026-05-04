/**
 * oauth-crypto.ts — AES-256-GCM encryption for OAuth tokens.
 *
 * Uses OAUTH_TOKEN_ENCRYPTION_KEY env var (32 hex chars = 16 bytes).
 * Falls back to a deterministic key derived from SUPABASE_SERVICE_ROLE_KEY
 * when the dedicated env var is not set.
 *
 * Format: "iv_hex:authTag_hex:ciphertext_hex"
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const explicit = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 32) {
    return Buffer.from(explicit.slice(0, 64), "hex").subarray(0, 32);
  }
  // Derive from service role key — not ideal but acceptable fallback
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "engram-dev-fallback-key-do-not-use";
  return createHash("sha256").update(seed).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

export function decryptToken(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return dec.toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.split(":").length === 3;
}
