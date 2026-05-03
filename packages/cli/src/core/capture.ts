// src/core/capture.ts — updated to await async db calls

import Anthropic from '@anthropic-ai/sdk';
import { Session, getConversationPairs } from './session';
import { insertSnapshot, markSynced } from '../storage/db';
import { loadConfig } from '../storage/config';

export interface CaptureResult {
  id: string;
  title: string;
  summary: string;
  pairCount: number;
  synced: boolean;
}

export async function captureSession(session: Session): Promise<CaptureResult | null> {
  const pairs = getConversationPairs(session);
  if (pairs.length === 0) return null;

  const config = loadConfig();

  // ── Path 1: Push to web app ──────────────────────────────────────────
  if (config.engramApiUrl && (config.accessToken || config.extensionSecret)) {
    try {
      const body: Record<string, unknown> = {
        pairs,
        tool: session.tool,
        url: `cli://session/${Date.now()}`,
        mode: 'personal',
      };
      if (config.userId && !config.accessToken) {
        body.userId = config.userId;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.accessToken) {
        headers['Authorization'] = `Bearer ${config.accessToken}`;
      } else if (config.extensionSecret) {
        headers['x-engram-secret'] = config.extensionSecret;
      }

      const res = await fetch(`${config.engramApiUrl}/api/capture`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json() as { id: string; title: string; summary: string | null };

        const localId = await insertSnapshot({
          user_id: config.userId || null,
          title: data.title,
          summary: data.summary || null,
          decision: null,
          rationale: null,
          raw_pairs: JSON.stringify(pairs),
          tags: '[]',
          ai_tool: session.tool,
          source: 'cli',
          visibility: 'personal',
        });
        await markSynced(localId);

        return {
          id: localId,
          title: data.title,
          summary: data.summary || '',
          pairCount: pairs.length,
          synced: true,
        };
      }
    } catch {
      // Network unavailable — fall through to local path
    }
  }

  // ── Path 2: Local summarization ──────────────────────────────────────
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  let title: string;
  let summary: string;
  let decision: string;
  let tags: string[];
  let rationale: string;

  if (apiKey) {
    const result = await summarizeWithClaude(pairs, apiKey);
    title = result.title;
    summary = result.summary;
    decision = result.decision;
    tags = result.tags;
    rationale = result.rationale;
  } else {
    title = extractTitle(pairs);
    summary = extractBulletSummary(pairs);
    decision = '';
    tags = extractTechnologies(pairs);
    rationale = `# ${title}\n\n${summary}`;
  }

  const id = await insertSnapshot({
    user_id: config.userId || null,
    title,
    summary,
    decision,
    rationale,
    raw_pairs: JSON.stringify(pairs),
    tags: JSON.stringify(tags),
    ai_tool: session.tool,
    source: 'cli',
    visibility: 'personal',
  });

  return { id, title, summary, pairCount: pairs.length, synced: false };
}

async function summarizeWithClaude(
  pairs: Array<{ role: string; content: string }>,
  apiKey: string
): Promise<{ title: string; summary: string; decision: string; tags: string[]; rationale: string }> {
  const client = new Anthropic({ apiKey });

  const conversationText = pairs
    .map((p, i) => `${p.role.toUpperCase()} [${i + 1}]: ${p.content}`)
    .join('\n\n')
    .slice(0, 60000);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    tools: [
      {
        name: 'save_handoff_brief',
        description: 'Save the structured handoff brief for this conversation.',
        input_schema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string', description: 'Concise title, max 80 chars.' },
            summary: { type: 'string', description: '2-4 sentence summary.' },
            key_decisions: { type: 'string', description: 'Concrete decisions made and why.' },
            technologies: {
              type: 'array',
              items: { type: 'string' },
              description: 'Every tool, framework, library, service mentioned.',
            },
            context_md: { type: 'string', description: 'Full handoff brief in markdown.' },
          },
          required: ['title', 'summary', 'key_decisions', 'technologies', 'context_md'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_handoff_brief' },
    messages: [
      {
        role: 'user',
        content: `Analyze this conversation and produce a structured handoff brief.\n\n${conversationText}\n\nCall save_handoff_brief with the result.`,
      },
    ],
  });

  const toolUse = message.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { title: extractTitle(pairs), summary: '', decision: '', tags: [], rationale: '' };
  }

  const input = toolUse.input as {
    title: string; summary: string; key_decisions: string;
    technologies: string[]; context_md: string;
  };

  return {
    title: input.title || extractTitle(pairs),
    summary: input.summary || '',
    decision: input.key_decisions || '',
    tags: Array.isArray(input.technologies) ? input.technologies : [],
    rationale: input.context_md || '',
  };
}

function extractTitle(pairs: Array<{ role: string; content: string }>): string {
  const firstUser = pairs.find(p => p.role === 'user');
  const q = firstUser?.content || 'Untitled session';
  return q.slice(0, 60).trim() + (q.length > 60 ? '...' : '');
}

function extractBulletSummary(pairs: Array<{ role: string; content: string }>): string {
  return pairs.filter(p => p.role === 'user').slice(0, 5)
    .map(p => `• ${p.content.slice(0, 100)}`).join('\n');
}

function extractTechnologies(pairs: Array<{ role: string; content: string }>): string[] {
  const techPatterns = [
    'react', 'next.js', 'nextjs', 'typescript', 'javascript', 'python',
    'rust', 'go', 'java', 'postgres', 'supabase', 'redis', 'docker',
    'kubernetes', 'aws', 'gcp', 'azure', 'graphql', 'rest', 'jwt',
    'oauth', 'stripe', 'tailwind', 'prisma', 'node', 'express',
  ];
  const text = pairs.map(p => p.content).join(' ').toLowerCase();
  return techPatterns.filter(t => text.includes(t));
}
