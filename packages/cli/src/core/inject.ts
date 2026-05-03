// src/core/inject.ts
// Loads the most relevant context snapshot and builds a system prompt
// that gets injected at the start of a new CLI session.

import { getMostRecent, searchSnapshots, ContextSnapshot } from '../storage/db';
import { loadConfig } from '../storage/config';

export interface InjectedContext {
  systemPrompt: string;
  sourceSnapshot: ContextSnapshot;
  matchType: 'search' | 'most_recent' | 'remote';
}

export async function buildContextForPrompt(
  prompt: string,
  tool?: string
): Promise<InjectedContext | null> {
  const config = loadConfig();
  if (!config.autoInject) return null;

  const keywords = extractKeywords(prompt);
  if (keywords.length > 0) {
    const results = await searchSnapshots(keywords.join(' '), 3);
    if (results.length > 0) {
      return {
        systemPrompt: buildSystemPrompt(results[0], config.maxContextPairs),
        sourceSnapshot: results[0],
        matchType: 'search',
      };
    }
  }

  const recent = await getMostRecent(tool);
  if (recent) {
    return {
      systemPrompt: buildSystemPrompt(recent, config.maxContextPairs),
      sourceSnapshot: recent,
      matchType: 'most_recent',
    };
  }

  return null;
}

export async function buildContextForResume(tool?: string): Promise<InjectedContext | null> {
  const snapshot = await getMostRecent(tool);
  if (!snapshot) return null;

  const config = loadConfig();
  return {
    systemPrompt: buildSystemPrompt(snapshot, config.maxContextPairs),
    sourceSnapshot: snapshot,
    matchType: 'most_recent',
  };
}

function buildSystemPrompt(snapshot: ContextSnapshot, maxPairs: number): string {
  const pairs = JSON.parse(snapshot.raw_pairs || '[]') as Array<{ role: string; content: string }>;
  const recentPairs = pairs.slice(-maxPairs * 2);
  const tags = JSON.parse(snapshot.tags || '[]') as string[];

  const lines: string[] = [
    `## ENGRAM Context — Continuing from "${snapshot.title}"`,
    `Captured: ${snapshot.captured_at} via ${snapshot.ai_tool} (${snapshot.source})`,
    '',
    `### Summary`,
    snapshot.summary || 'No summary available.',
    '',
  ];

  if (snapshot.decision) {
    lines.push('### Key Decisions Made');
    lines.push(snapshot.decision);
    lines.push('');
  }

  if (tags.length > 0) {
    lines.push(`### Technologies in play: ${tags.join(', ')}`);
    lines.push('');
  }

  if (recentPairs.length > 0) {
    lines.push(`### Last ${Math.floor(recentPairs.length / 2) || recentPairs.length} exchanges from that session:`);
    recentPairs.forEach((p, i) => {
      lines.push(`\n[${i + 1}] ${p.role.toUpperCase()}: ${p.content.slice(0, 400)}${p.content.length > 400 ? '...' : ''}`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('You are continuing a conversation with full context of what was discussed above.');
  lines.push('Pick up naturally. Do not re-introduce yourself or summarize unless asked.');

  return lines.join('\n');
}

function extractKeywords(prompt: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'i', 'we', 'you', 'it', 'is', 'was', 'are',
    'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
    'okay', 'continue', 'continuing', 'back', 'earlier', 'discussion',
    'conversation', 'about', 'that', 'this', 'my', 'our', 'their',
  ]);

  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 6);
}
