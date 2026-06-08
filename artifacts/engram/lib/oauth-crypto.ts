/**
 * oauth-crypto.ts — AES-256-GCM encryption for OAuth tokens.
 *
 * Uses OAUTH_TOKEN_ENCRYPTION_KEY env var (32 hex chars = 16 bytes, or 64 = 32 bytes).
 * Falls back to HKDF key derivation from SUPABASE_SERVICE_ROLE_KEY when the dedicated
 * env var is not set. Never uses a static/hardcoded dev fallback in production.
 *
 * Format: "iv_hex:authTag_hex:ciphertext_hex"
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "crypto";

const ALGO = "aes-256-gcm";

// HKDF info string — change this to invalidate all derived keys (rotate tokens)
const HKDF_INFO = "engram-oauth-token-encryption-v1";
const HKDF_SALT = Buffer.from("engram-oauth-salt-v1", "utf8");

function getKey(): Buffer {
  const explicit = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 64) {
    // Explicit 32-byte hex key (preferred)
    return Buffer.from(explicit.slice(0, 64), "hex");
  }
  if (explicit && explicit.length >= 32) {
    // 16-byte hex key — expand via HKDF to 32 bytes
    const raw = Buffer.from(explicit.slice(0, 32), "hex");
    return Buffer.from(hkdfSync("sha256", raw, HKDF_SALT, HKDF_INFO, 32));
  }

  // Derive key from SUPABASE_SERVICE_ROLE_KEY via HKDF (RFC 5869).
  // SHA-256 HKDF provides proper key separation and is significantly
  // stronger than a raw SHA-256 hash of the seed material.
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!seed) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "OAUTH_TOKEN_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY must be set in production"
      );
    }
    // Development only — use a deterministic but labeled dev key
    const devSeed = Buffer.from("engram-dev-only-do-not-use-in-production", "utf8");
    return Buffer.from(hkdfSync("sha256", devSeed, HKDF_SALT, HKDF_INFO, 32));
  }

  return Buffer.from(hkdfSync("sha256", seed, HKDF_SALT, HKDF_INFO, 32));
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM (recommended)
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
  const parts = value.split(":");
  // All three parts must be valid hex strings
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

/**
 * Normalise a GitHub App RSA private key from whatever format the env var
 * holds it in:
 *   - Proper PEM with real newlines (ideal)
 *   - Escaped "\n" literals (common when set via shell)
 *   - Single line with spaces separating the base-64 body (common when
 *     pasted directly into a Replit secret without newlines)
 *
 * Returns a properly-formatted PEM string ready for Node's `createSign`.
 */
export function parseGitHubPrivateKey(raw: string): string {
  // Already has real newlines — return as-is
  if (raw.includes("\n")) return raw;

  // Has escaped \n literals — replace them
  if (raw.includes("\\n")) return raw.replace(/\\n/g, "\n");

  // Single-line with spaces: reconstruct PEM with 64-char base64 lines
  const m = raw.match(/-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/);
  if (m) {
    const label = m[1];
    const b64 = m[2].trim().replace(/\s+/g, "");
    const lines = b64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
  }

  // Unknown format — return raw and let the caller fail with a clear error
  return raw;
}
