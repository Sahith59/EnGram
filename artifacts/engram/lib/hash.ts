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
