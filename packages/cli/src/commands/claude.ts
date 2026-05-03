// src/commands/claude.ts
// `engram claude [prompt]`
//
// - With prompt: single-shot Q&A, captures on exit
// - Without prompt: interactive REPL, captures on Ctrl+C or 'exit'
// - Context is automatically injected as a system prompt from local SQLite
//   (which may include captures synced from the Chrome extension / web app)

import * as readline from 'readline';
import {
  createSession, addUserMessage, addAssistantMessage, sessionHasContent,
} from '../core/session';
import { buildContextForPrompt } from '../core/inject';
import { captureSession } from '../core/capture';
import { syncAll } from '../core/sync';
import { streamClaude } from '../ai/claude';
import { loadConfig } from '../storage/config';
import {
  printBanner, printContextInjected, printCaptureSaved,
  printSyncStatus, printError, subtle, brand, toolLabel,
} from '../ui/print';
import ora from 'ora';

export async function claudeCommand(initialPrompt?: string): Promise<void> {
  const config = loadConfig();
  printBanner();

  const session = createSession('claude');

  // --- Context injection ---
  const spinner = ora({ text: subtle('  Loading context...'), spinner: 'dots' }).start();
  const injected = await buildContextForPrompt(initialPrompt || '', 'claude');
  spinner.stop();

  if (injected) {
    session.messages.push({ role: 'system', content: injected.systemPrompt });
    session.injectedContext = injected.systemPrompt;
    printContextInjected(injected.sourceSnapshot.title, 'claude', injected.matchType);
  } else {
    console.log(subtle('  (no prior context — starting fresh)\n'));
  }

  // --- Single-shot mode ---
  if (initialPrompt) {
    addUserMessage(session, initialPrompt);
    console.log(toolLabel('claude') + ':\n');
    try {
      const response = await streamClaude(session.messages);
      addAssistantMessage(session, response);

      if (config.autoCapture) {
        const captSpinner = ora({ text: subtle('  Saving to ENGRAM...'), spinner: 'dots' }).start();
        const captured = await captureSession(session);
        captSpinner.stop();
        if (captured) {
          printCaptureSaved(captured.title, captured.pairCount, captured.synced);
          if (!captured.synced) {
            const sync = await syncAll();
            printSyncStatus(sync.pushed, sync.pulled);
          }
        }
      }
    } catch (e: unknown) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    return;
  }

  // --- Interactive REPL mode ---
  console.log(toolLabel('claude') + subtle(' interactive — type your message, "exit" to quit\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: brand('  You: '),
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (['exit', 'quit', ':q'].includes(input)) { rl.close(); return; }

    addUserMessage(session, input);
    console.log('\n' + toolLabel('claude') + ':\n');

    try {
      const response = await streamClaude(session.messages);
      addAssistantMessage(session, response);
      console.log();
    } catch (e: unknown) {
      printError(e instanceof Error ? e.message : String(e));
    }

    rl.prompt();
  });

  const handleExit = async () => {
    console.log();
    if (config.autoCapture && sessionHasContent(session)) {
      const capSpinner = ora({ text: subtle('  Saving to ENGRAM...'), spinner: 'dots' }).start();
      const captured = await captureSession(session);
      capSpinner.stop();

      if (captured) {
        printCaptureSaved(captured.title, captured.pairCount, captured.synced);
        if (!captured.synced) {
          const sync = await syncAll();
          printSyncStatus(sync.pushed, sync.pulled);
        }
      }
    }
    process.exit(0);
  };

  rl.on('close', handleExit);
  process.on('SIGINT', handleExit);
}
