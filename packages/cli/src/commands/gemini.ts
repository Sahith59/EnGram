// src/commands/gemini.ts
// `engram gemini [prompt]` — same pattern but uses Google Generative AI

import * as readline from 'readline';
import {
  createSession, addUserMessage, addAssistantMessage, sessionHasContent,
} from '../core/session';
import { buildContextForPrompt } from '../core/inject';
import { captureSession } from '../core/capture';
import { syncAll } from '../core/sync';
import { streamGemini } from '../ai/gemini';
import { loadConfig } from '../storage/config';
import {
  printBanner, printContextInjected, printCaptureSaved,
  printSyncStatus, printError, subtle, brand, toolLabel,
} from '../ui/print';
import ora from 'ora';

export async function geminiCommand(initialPrompt?: string): Promise<void> {
  const config = loadConfig();
  printBanner();

  const session = createSession('gemini');

  const spinner = ora({ text: subtle('  Loading context...'), spinner: 'dots' }).start();
  const injected = await buildContextForPrompt(initialPrompt || '', 'gemini');
  spinner.stop();

  if (injected) {
    session.messages.push({ role: 'system', content: injected.systemPrompt });
    session.injectedContext = injected.systemPrompt;
    printContextInjected(injected.sourceSnapshot.title, 'gemini', injected.matchType);
  } else {
    console.log(subtle('  (no prior context — starting fresh)\n'));
  }

  if (initialPrompt) {
    addUserMessage(session, initialPrompt);
    console.log(toolLabel('gemini') + ':\n');
    try {
      const response = await streamGemini(session.messages);
      addAssistantMessage(session, response);
      if (config.autoCapture) {
        const captured = await captureSession(session);
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

  console.log(toolLabel('gemini') + subtle(' interactive — type your message, "exit" to quit\n'));

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
    console.log('\n' + toolLabel('gemini') + ':\n');
    try {
      const response = await streamGemini(session.messages);
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
      const captured = await captureSession(session);
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
