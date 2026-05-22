import { EngramConfig } from "./config";

export interface Snapshot {
  id: string;
  title: string;
  summary: string | null;
  ai_tool: string;
  tags: string[];
  decision: string | null;
  created_at: string;
  updated_at: string | null;
  visibility: string;
  author_handle: string | null;
  project?: string | null;
  rationale?: string | null;
  raw_conversation?: Array<{ role: string; content: string }>;
}

export interface AskResult {
  answer: string;
  sources: Array<{ id: string; title: string; similarity?: number }>;
}

export class EngramAPI {
  private baseUrl: string;
  private token: string;

  constructor(cfg: EngramConfig) {
    this.baseUrl = cfg.api_url.replace(/\/$/, "");
    this.token = cfg.access_token;
  }

  private async req<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }

    return res.json() as Promise<T>;
  }

  async me(): Promise<{
    connected: boolean;
    user: { id: string; email: string; full_name: string | null };
    team_id: string;
  }> {
    return this.req("GET", "/api/me");
  }

  async listContexts(opts: {
    limit?: number;
    scope?: "personal" | "team";
    tool?: string;
    search?: string;
    page?: number;
  } = {}): Promise<{ data: Snapshot[]; total: number }> {
    const p = new URLSearchParams();
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.scope) p.set("scope", opts.scope);
    if (opts.tool) p.set("tool", opts.tool);
    if (opts.search) p.set("search", opts.search);
    if (opts.page) p.set("page", String(opts.page));
    const qs = p.toString() ? `?${p}` : "";
    const res = await this.req<{
      data: Snapshot[];
      pagination: { total: number };
    }>("GET", `/api/contexts${qs}`);
    return { data: res.data ?? [], total: res.pagination?.total ?? 0 };
  }

  async getContext(id: string): Promise<Snapshot> {
    const res = await this.req<{ data: Snapshot }>("GET", `/api/contexts/${id}`);
    return res.data;
  }

  async exportContext(
    id: string,
    mode: "brief" | "full" = "brief"
  ): Promise<{ content: string; title: string }> {
    return this.req("GET", `/api/contexts/${id}/export?mode=${mode}`);
  }

  async ask(
    question: string,
    scope: "personal" | "team" | "all" = "personal"
  ): Promise<AskResult> {
    return this.req("POST", "/api/ask", { question, scope });
  }

  async capture(payload: {
    pairs: Array<{ role: string; content: string }>;
    tool: string;
    url?: string;
    mode?: "personal" | "team";
  }): Promise<{
    success: boolean;
    id: string;
    title: string;
    duplicate?: boolean;
    updated?: boolean;
  }> {
    return this.req("POST", "/api/capture", payload);
  }
}
