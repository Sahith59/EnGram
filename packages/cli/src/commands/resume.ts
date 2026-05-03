// src/commands/resume.ts
// `engram resume [--tool claude|chatgpt|gemini]`
//
// 1. Syncs with the web app to pull in any recent browser captures
// 2. Loads the most recent snapshot from local SQLite
// 3. Opens an interactive session with full context pre-loaded

import { buildContextForResume } from '../core/inject';
import { syncAll } from '../core/sync';
import { claudeCommand } from './claude';
import { chatgptCommand } from './chatgpt';
import { geminiCommand } from './gemini';
import { loadConfig } from '../storage/config';
import { printBanner, printError, subtle, brand, toolColors } from '../ui/print';
import ora from 'ora';
import chalk from 'chalk';

export async function resumeCommand(options: { tool?: string }): Promise<void> {
  const config = loadConfig();
  const tool = (options.tool || config.defaultTool) as 'claude' | 'chatgpt' | 'gemini';

  printBanner();

  // Pull latest from web app so we see browser captures
  const syncSpinner = ora({ text: subtle('  Syncing with ENGRAM...'), spinner: 'dots' }).start();
  const sync = await syncAll();
  syncSpinner.stop();

  if (sync.pulled > 0) {
    console.log(subtle(`  ↓ ${sync.pulled} capture${sync.pulled > 1 ? 's' : ''} pulled from web app\n`));
  }

  const spinner = ora({ text: subtle('  Finding your last session...'), spinner: 'dots' }).start();
  const context = await buildContextForResume(tool);
  spinner.stop();

  if (!context) {
    printError('No previous sessions found. Start one with: engram claude');
    process.exit(1);
  }

  const { sourceSnapshot } = context;
  const toolColor = toolColors[tool] || chalk.white;

  console.log(brand('  Resuming: ') + chalk.white.italic(`"${sourceSnapshot.title}"`));
  console.log(
    subtle(`  Captured: ${sourceSnapshot.captured_at} · via ${sourceSnapshot.source} · ${toolColor(tool)}\n`)
  );
  console.log(subtle(`  "${(sourceSnapshot.summary || '').slice(0, 120)}..."\n`));
  console.log(brand('  ─────────────────────────────────────────'));
  console.log(subtle('  Context loaded. Continue the conversation naturally.\n'));

  switch (tool) {
    case 'claude':  return claudeCommand(undefined);
    case 'chatgpt': return chatgptCommand(undefined);
    case 'gemini':  return geminiCommand(undefined);
  }
}
