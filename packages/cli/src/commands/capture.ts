// src/commands/capture.ts
// `engram capture` — manually capture a conversation from:
//   stdin pipe:  cat convo.txt | engram capture --tool claude
//   file:        engram capture --file convo.txt --tool chatgpt

import * as fs from 'fs';
import { captureSession } from '../core/capture';
import { createSession, addUserMessage, addAssistantMessage } from '../core/session';
import { syncAll } from '../core/sync';
import {
  printBanner, printCaptureSaved, printSyncStatus, printError,
} from '../ui/print';
import ora from 'ora';

interface CaptureOptions {
  tool: 'claude' | 'chatgpt' | 'gemini';
  file?: string;
  title?: string;
}

export async function captureCommand(options: CaptureOptions): Promise<void> {
  printBanner();

  let rawText = '';

  if (options.file) {
    if (!fs.existsSync(options.file)) {
      printError(`File not found: ${options.file}`);
      process.exit(1);
    }
    rawText = fs.readFileSync(options.file, 'utf-8');
  } else if (!process.stdin.isTTY) {
    rawText = await readStdin();
  } else {
    printError(
      'Provide a file (--file) or pipe content:\n  cat conversation.txt | engram capture --tool claude'
    );
    process.exit(1);
  }

  const pairs = parseConversationText(rawText);

  if (pairs.length === 0) {
    printError(
      'Could not parse any Q&A pairs from the input.\n  Expected format: "User: ...\\nAssistant: ..."'
    );
    process.exit(1);
  }

  const session = createSession(options.tool);
  pairs.forEach(p => {
    addUserMessage(session, p.user);
    addAssistantMessage(session, p.assistant);
  });

  const spinner = ora('  Summarizing...').start();
  const captured = await captureSession(session);
  spinner.stop();

  if (!captured) {
    printError('Capture failed.');
    process.exit(1);
  }

  printCaptureSaved(captured.title, captured.pairCount, captured.synced);
  if (!captured.synced) {
    const sync = await syncAll();
    printSyncStatus(sync.pushed, sync.pulled);
  }
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

function parseConversationText(text: string): Array<{ user: string; assistant: string }> {
  const userPattern = /^(user|human|you|q):\s*/im;
  const assistantPattern = /^(assistant|claude|chatgpt|gpt|gemini|ai|a):\s*/im;

  const lines = text.split('\n');
  const pairs: Array<{ user: string; assistant: string }> = [];
  let currentRole: 'user' | 'assistant' | null = null;
  let currentContent = '';
  let lastUserContent = '';

  for (const line of lines) {
    if (userPattern.test(line)) {
      if (currentRole === 'assistant' && lastUserContent) {
        pairs.push({ user: lastUserContent, assistant: currentContent.trim() });
        lastUserContent = '';
      }
      currentRole = 'user';
      currentContent = line.replace(userPattern, '');
    } else if (assistantPattern.test(line)) {
      if (currentRole === 'user') {
        lastUserContent = currentContent.trim();
      }
      currentRole = 'assistant';
      currentContent = line.replace(assistantPattern, '');
    } else {
      currentContent += '\n' + line;
    }
  }

  if (currentRole === 'assistant' && lastUserContent) {
    pairs.push({ user: lastUserContent, assistant: currentContent.trim() });
  }

  return pairs;
}
