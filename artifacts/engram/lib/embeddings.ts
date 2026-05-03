/**
 * OpenAI text embeddings — `text-embedding-3-small` (1536 dims).
 * Matches the `vector(1536)` column in `context_snapshots.embedding`.
 *
 * We use raw fetch instead of the OpenAI SDK to keep this dep-free and
 * avoid pulling in a heavy package for one HTTP call.
 *
 * Cost: ~$0.02 / 1M tokens. A typical capture (~500 tokens of summary +
 * decision) costs around $0.00001. Effectively free.
 */

const EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
const DIM = 1536;

export type EmbedResult = {
  vector: number[];
  model: string;
  inputChars: number;
};

export class EmbeddingError extends Error {
  status?: number;
  detail?: unknown;
  constructor(message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = "EmbeddingError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Embed a single piece of text. Returns null only when the API key is
 * unset (so callers can degrade gracefully). Throws on real API errors so
 * the caller can decide whether to fail the whole request or just skip
 * the embedding step.
 */
export async function embedText(rawText: string): Promise<EmbedResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // OpenAI hard limit is 8191 tokens (~32K chars). We aggressively trim
  // to keep latency low — embeddings benefit from focused signal anyway.
  const text = (rawText ?? "").toString().trim().slice(0, 8000);
  if (!text) {
    // Empty input would be rejected by the API; return a zero vector so
    // callers don't have to special-case this.
    return { vector: new Array(DIM).fill(0), model: MODEL, inputChars: 0 };
  }

  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, input: text }),
  });

  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => null);
    }
    throw new EmbeddingError(
      `OpenAI embeddings failed: ${res.status} ${res.statusText}`,
      res.status,
      detail
    );
  }

  const json = (await res.json()) as {
    data?: { embedding: number[] }[];
  };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== DIM) {
    throw new EmbeddingError(
      `OpenAI returned a bad embedding (len=${vec?.length ?? "n/a"})`
    );
  }

  return { vector: vec, model: MODEL, inputChars: text.length };
}

/**
 * Build the text we embed for a capture. We blend the most semantically
 * dense fields (title + summary + decision + tags) so the embedding
 * captures "what this conversation is ABOUT" rather than its surface
 * wording. Truncated per-section so one bloated rationale can't drown
 * out the others.
 */
export function buildSnapshotEmbeddingInput(s: {
  title?: string | null;
  summary?: string | null;
  decision?: string | null;
  tags?: string[] | null;
  rationale?: string | null;
}): string {
  const tagsLine =
    Array.isArray(s.tags) && s.tags.length > 0
      ? `Topics: ${s.tags.slice(0, 30).join(", ")}`
      : "";
  return [
    s.title?.toString().slice(0, 200),
    s.summary?.toString().slice(0, 1500),
    s.decision?.toString().slice(0, 1500),
    tagsLine,
    s.rationale?.toString().slice(0, 2500),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
