// src/core/session.ts
// Manages the state of an active conversation.
// A "session" is one continuous back-and-forth with an AI tool.
// When it ends (Ctrl+C or 'exit'), we summarize and capture it.

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Session {
  tool: 'claude' | 'chatgpt' | 'gemini';
  messages: Message[];
  startedAt: Date;
  injectedContext: string | null;
}

export function createSession(tool: Session['tool'], systemPrompt?: string): Session {
  const session: Session = {
    tool,
    messages: [],
    startedAt: new Date(),
    injectedContext: systemPrompt || null,
  };
  if (systemPrompt) {
    session.messages.push({ role: 'system', content: systemPrompt });
  }
  return session;
}

export function addUserMessage(session: Session, content: string): void {
  session.messages.push({ role: 'user', content });
}

export function addAssistantMessage(session: Session, content: string): void {
  session.messages.push({ role: 'assistant', content });
}

// Returns conversation as flat [{role, content}] array (matching the web app capture format)
export function getConversationPairs(session: Session): Array<{ role: string; content: string }> {
  return session.messages.filter(m => m.role !== 'system');
}

export function sessionHasContent(session: Session): boolean {
  return session.messages.filter(m => m.role === 'user').length > 0;
}
