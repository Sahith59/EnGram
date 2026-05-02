export type AITool = "chatgpt" | "claude" | "gemini" | "other";

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  team_id: string | null;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
  created_at: string;
  updated_at: string;
}

export interface ContextSnapshot {
  id: string;
  team_id: string;
  created_by: string;
  title: string;
  summary: string | null;
  ai_tool: AITool;
  raw_conversation: ConversationMessage[];
  tags: string[];
  project: string | null;
  decision: string | null;
  rationale: string | null;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface KTQuery {
  id: string;
  team_id: string;
  asked_by: string;
  question: string;
  answer: string | null;
  source_snapshot_ids: string[];
  confidence: number | null;
  created_at: string;
}

export interface Integration {
  id: string;
  team_id: string;
  type: "slack" | "github" | "jira" | "linear" | "other";
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtensionEvent {
  id: string;
  team_id: string;
  user_id: string;
  ai_tool: AITool;
  raw_payload: Record<string, unknown>;
  processed: boolean;
  snapshot_id: string | null;
  created_at: string;
}
