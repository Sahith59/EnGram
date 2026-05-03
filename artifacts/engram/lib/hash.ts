import { createHash } from "crypto";

/**
 * Canonical SHA-256 hash of a conversation's pairs.
 * Trims content + lowercases role for consistency. The hash is identical
 * regardless of insignificant whitespace differences.
 */
export function hashConversation(
  pairs: { role: string; content: string }[]
): string {
  const canonical = pairs
    .map((p) => `${(p.role || "").toLowerCase()}\u241F${(p.content || "").trim()}`)
    .join("\u241E");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Conversation IDENTITY hash — based on the first N pairs only.
 * Stays stable as the conversation grows, enabling "this is the same chat,
 * just longer now" dedup. Used to UPDATE existing snapshots in place
 * instead of creating duplicates.
 *
 * For the very first message, we use the user's first prompt alone (which
 * is a strong identity signal). Once we have at least 2 pairs (a full
 * exchange), we use the first 2 pairs.
 */
export function hashConversationIdentity(
  pairs: { role: string; content: string }[]
): string {
  if (!pairs.length) return "";
  // Take first user message (always present at index 0 in real chats),
  // plus first assistant reply if present. Truncate each to first 500 chars
  // so minor streaming-edit differences don't break identity.
  const seedPairs = pairs.slice(0, 2).map((p) => ({
    role: (p.role || "").toLowerCase(),
    content: (p.content || "").trim().slice(0, 500),
  }));
  const canonical = seedPairs
    .map((p) => `${p.role}\u241F${p.content}`)
    .join("\u241E");
  return createHash("sha256").update(canonical).digest("hex");
}
