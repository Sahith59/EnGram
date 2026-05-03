// src/commands/ask.ts
// `engram ask "why did we choose JWT over sessions?"`
//
// Two paths:
// 1. If logged in + web app URL configured → calls POST /api/ask (same endpoint
//    the web dashboard uses, gets Claude Sonnet synthesis with team context).
// 2. Fallback → searches local SQLite + synthesizes with user's Anthropic key.
//
// The web app's /api/ask expects: { question: string, scope: 'personal'|'team'|'all' }

import Anthropic from '@anthropic-ai/sdk';
import { searchSnapshots } from '../storage/db';
import { loadConfig } from '../storage/config';
import {
  printBanner, printError, subtle, brand, toolColors,
} from '../ui/print';
import ora from 'ora';
import chalk from 'chalk';

export async function askCommand(query: string, scope: 'personal' | 'team' | 'all' = 'personal'): Promise<void> {
  const config = loadConfig();
  printBanner();

  // ── Path 1: Route through web app /api/ask (preferred) ──
  if (config.engramApiUrl && config.accessToken) {
    const spinner = ora({
      text: subtle(`  Searching ENGRAM for: "${query}"`),
      spinner: 'dots',
    }).start();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.accessToken}`,
      };

      const res = await fetch(`${config.engramApiUrl}/api/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: query, scope }),
      });

      spinner.stop();

      if (res.ok) {
        const data = await res.json() as {
          answer: string;
          confidence?: number | null;
          sources?: Array<{ ref: number; id: string; title: string; ai_tool: string; created_at: string; author_handle?: string | null }>;
          related?: Array<{ id: string; title: string; ai_tool: string }>;
          queryId?: string | null;
        };

        console.log(brand.bold('\n  ENGRAM:\n'));
        console.log(data.answer.split('\n').map(l => '  ' + l).join('\n'));
        console.log();

        if (data.sources && data.sources.length > 0) {
          console.log(subtle('  Sources:'));
          data.sources.forEach(s => {
            const toolColor = toolColors[s.ai_tool] || chalk.white;
            const author = s.author_handle ? ` · by ${s.author_handle}` : '';
            console.log(
              subtle(`    [${s.ref}] `) +
              chalk.white(s.title) +
              subtle(` · ${toolColor(s.ai_tool)} · ${new Date(s.created_at).toLocaleDateString()}${author}`)
            );
          });
          console.log();
        }

        if (data.confidence !== null && data.confidence !== undefined) {
          const conf = Math.round(data.confidence * 100);
          const confColor = conf >= 70 ? chalk.green : conf >= 40 ? chalk.yellow : chalk.red;
          console.log(subtle(`  Confidence: ${confColor(`${conf}%`)}\n`));
        }
        return;
      }
    } catch {
      spinner.stop();
      // Network error — fall through to local path
    }
  }

  // ── Path 2: Local SQLite search + optional Claude synthesis ──
  const spinner = ora({
    text: subtle(`  Searching local captures for: "${query}"`),
    spinner: 'dots',
  }).start();
  const results = await searchSnapshots(query, 8);
  spinner.stop();

  if (results.length === 0) {
    console.log(subtle('  No relevant sessions found.\n'));
    console.log(subtle('  Capture more AI sessions with: engram claude "your question"\n'));
    return;
  }

  console.log(subtle(`  Found ${results.length} relevant session${results.length > 1 ? 's' : ''}.\n`));

  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const synSpinner = ora({ text: subtle('  Synthesizing answer...'), spinner: 'dots' }).start();

    const client = new Anthropic({ apiKey });

    const contextBlocks = results.map((r, i) => `
[Session ${i + 1}] — ${r.ai_tool} · ${r.captured_at}
Title: ${r.title}
Summary: ${r.summary || 'N/A'}
Key Decisions: ${r.decision || 'N/A'}
`).join('\n---\n');

    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are ENGRAM. Answer this question based on the developer's captured AI sessions.

Question: "${query}"

Captured sessions:
${contextBlocks}

Give a direct, specific answer. Cite which sessions your answer draws from. Name decisions and reasoning, not just outcomes. If the answer isn't fully captured, say what IS known and flag what's missing.`,
      }],
    });

    synSpinner.stop();

    const answer = res.content[0].type === 'text' ? res.content[0].text : '';
    console.log(brand.bold('  ENGRAM:\n'));
    console.log(answer.split('\n').map(l => '  ' + l).join('\n'));
    console.log();
  } else {
    // No API key — show raw results
    console.log(brand.bold('  Relevant sessions:\n'));
    results.slice(0, 3).forEach((r, i) => {
      const toolColor = toolColors[r.ai_tool] || chalk.white;
      console.log(
        chalk.white(`  ${i + 1}. "${r.title}"`) +
        subtle(` · ${toolColor(r.ai_tool)} · ${r.captured_at}`)
      );
      console.log(subtle(`     ${(r.summary || '').slice(0, 120)}...\n`));
    });
    console.log(subtle('  Tip: Set an API key for synthesized answers: engram config --anthropic-key sk-ant-...\n'));
  }
}
