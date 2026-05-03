import { createHash } from "crypto";

/**
 * Strip volatile UI chrome that DOM scrapers pick up via `innerText`.
 *
 * Different AI tools have different UIs, but they all leak the same kinds of
 * noise into innerText: action buttons ("Copy", "Edit"), reaction buttons
 * ("thumb_up", "thumb_down"), TTS buttons ("volume_up"), Material icon ligature
 * names, draft selectors ("Show drafts"), etc. None of these are part of the
 * actual conversation, but they vary slightly between renders/captures and
 * break content-based dedup.
 *
 * This normalizer is run server-side on every (role, content) pair before
 * hashing, so dedup is resilient to UI noise from ANY tool — even tools we
 * haven't explicitly handled in the extension yet, and even older versions of
 * the extension that send raw innerText.
 */
const UI_NOISE_LINES = new Set([
  // Generic / Material icon ligatures (Gemini uses these heavily)
  "copy",
  "copy_all",
  "edit",
  "more_vert",
  "more_horiz",
  "share",
  "thumb_up",
  "thumb_down",
  "thumbs up",
  "thumbs down",
  "volume_up",
  "volume_off",
  "stop_circle",
  "play_arrow",
  "refresh",
  "rotate_left",
  "rotate_right",
  "expand_more",
  "expand_less",
  "chevron_left",
  "chevron_right",
  "close",
  "check",
  "send",
  "mic",
  "image",
  "attach_file",
  "download",
  "open_in_new",
  // Gemini-specific labels
  "show drafts",
  "hide drafts",
  "good response",
  "bad response",
  "regenerate",
  "regenerate response",
  "report legal issue",
  "modify response",
  "shorter",
  "longer",
  "simpler",
  "more casual",
  "more professional",
  // ChatGPT
  "regenerate response",
  "stop generating",
  "continue generating",
  "you said:",
  "chatgpt said:",
  // Claude
  "retry",
  "retry from here",
  "edit message",
  "good response",
  "poor response",
  "i'm sorry, but i can't help with that.",
]);

const UI_NOISE_PREFIXES = [
  // "Edited 2m ago", "1 of 2", "Draft 1", etc.
  /^edited\s/i,
  /^draft\s+\d+/i,
  /^\d+\s+of\s+\d+$/i,
];

function normalizeContent(raw: string): string {
  if (!raw) return "";
  // Split on newlines, strip per-line UI noise, then re-join.
  const cleaned = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const lower = line.toLowerCase();
      if (UI_NOISE_LINES.has(lower)) return false;
      if (UI_NOISE_PREFIXES.some((rx) => rx.test(line))) return false;
      return true;
    })
    .join("\n");
  // Collapse runs of whitespace inside each line to a single space.
  return cleaned.replace(/[ \t]+/g, " ").trim();
}

/**
 * Canonical SHA-256 hash of a conversation's pairs.
 * Strips UI noise + collapses whitespace so the hash is identical across
 * re-renders, browsers, and tools.
 */
export function hashConversation(
  pairs: { role: string; content: string }[]
): string {
  const canonical = pairs
    .map(
      (p) =>
        `${(p.role || "").toLowerCase()}\u241F${normalizeContent(p.content || "")}`
    )
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
    content: normalizeContent(p.content || "").slice(0, 500),
  }));
  const canonical = seedPairs
    .map((p) => `${p.role}\u241F${p.content}`)
    .join("\u241E");
  return createHash("sha256").update(canonical).digest("hex");
}

// Exported for tests
export const _internal = { normalizeContent };
