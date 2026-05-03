#!/usr/bin/env node
// src/index.ts
// ENGRAM CLI entry point — all commands registered via Commander.js.
// Installed globally as `engram` via `npm install -g @engram/cli`.

import { Command } from 'commander';
import { claudeCommand } from './commands/claude';
import { chatgptCommand } from './commands/chatgpt';
import { geminiCommand } from './commands/gemini';
import { resumeCommand } from './commands/resume';
import { askCommand } from './commands/ask';
import { captureCommand } from './commands/capture';
import { statusCommand } from './commands/status';
import { loginCommand } from './commands/login';
import { clearAuth, saveConfig } from './storage/config';
import { syncAll } from './core/sync';
import { printBanner, printHelp, brand, subtle, success } from './ui/print';

const program = new Command();

program
  .name('engram')
  .description('Your context, everywhere. Cross-tool AI memory for the terminal.')
  .version('0.1.0');

// ── AI tool commands ────────────────────────────────────────────────────────

program
  .command('claude [prompt]')
  .description('Chat with Claude — with your ENGRAM context pre-loaded')
  .option('--no-inject', 'Skip context injection for this session')
  .option('--no-capture', 'Skip saving this session to ENGRAM')
  .action(async (prompt?: string) => {
    await claudeCommand(prompt);
  });

program
  .command('chatgpt [prompt]')
  .description('Chat with ChatGPT — with your ENGRAM context pre-loaded')
  .action(async (prompt?: string) => {
    await chatgptCommand(prompt);
  });

program
  .command('gemini [prompt]')
  .description('Chat with Gemini — with your ENGRAM context pre-loaded')
  .action(async (prompt?: string) => {
    await geminiCommand(prompt);
  });

// ── Context commands ────────────────────────────────────────────────────────

program
  .command('resume')
  .description('Resume your last session — picks up right where you left off')
  .option('-t, --tool <tool>', 'Which tool to resume in (claude|chatgpt|gemini)', 'claude')
  .action(async (options) => {
    await resumeCommand(options);
  });

program
  .command('ask <query>')
  .description('Ask a question across all your captured sessions (uses web app if logged in)')
  .option('-s, --scope <scope>', 'Scope: personal | team | all', 'personal')
  .action(async (query: string, options: { scope?: string }) => {
    const scope = (['personal', 'team', 'all'].includes(options.scope || '')
      ? options.scope
      : 'personal') as 'personal' | 'team' | 'all';
    await askCommand(query, scope);
  });

program
  .command('capture')
  .description('Manually capture a conversation (pipe or file)')
  .option('-t, --tool <tool>', 'Source tool (claude|chatgpt|gemini)', 'claude')
  .option('-f, --file <path>', 'Path to conversation file')
  .option('--title <title>', 'Optional title for this capture')
  .action(async (options) => {
    await captureCommand(options);
  });

// ── Sync command ────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Manually sync captures with the ENGRAM web app')
  .action(async () => {
    printBanner();
    const { pushUnsynced, pullRemote } = await import('./core/sync');
    const [pushed, pulled] = await Promise.all([pushUnsynced(), pullRemote()]);
    if (pushed > 0) console.log(success(`  ↑ ${pushed} capture${pushed > 1 ? 's' : ''} pushed to web app`));
    if (pulled > 0) console.log(success(`  ↓ ${pulled} capture${pulled > 1 ? 's' : ''} pulled from web app`));
    if (pushed === 0 && pulled === 0) console.log(subtle('  Already in sync.\n'));
  });

// ── Account commands ────────────────────────────────────────────────────────

program
  .command('login')
  .description('Log in to your ENGRAM account (links CLI with the web app)')
  .action(async () => {
    await loginCommand();
  });

program
  .command('logout')
  .description('Log out of ENGRAM (local captures are preserved)')
  .action(() => {
    clearAuth();
    printBanner();
    console.log(subtle('  Logged out. Local captures are still saved.\n'));
  });

program
  .command('status')
  .description('Show your ENGRAM status — auth, API keys, captures, sync state')
  .action(async () => {
    await statusCommand();
  });

// ── Config command ──────────────────────────────────────────────────────────

program
  .command('config')
  .description('Set ENGRAM configuration')
  .option('--anthropic-key <key>', 'Anthropic API key (for Claude)')
  .option('--openai-key <key>', 'OpenAI API key (for ChatGPT)')
  .option('--gemini-key <key>', 'Gemini API key')
  .option('--api-url <url>', 'ENGRAM web app URL (e.g. https://your-app.vercel.app)')
  .option('--extension-secret <secret>', 'x-engram-secret from the web app .env')
  .option('--default-tool <tool>', 'Default AI tool (claude|chatgpt|gemini)')
  .action((options) => {
    const updates: Record<string, string> = {};
    if (options.anthropicKey)     updates.anthropicApiKey    = options.anthropicKey;
    if (options.openaiKey)        updates.openaiApiKey       = options.openaiKey;
    if (options.geminiKey)        updates.geminiApiKey       = options.geminiKey;
    if (options.apiUrl)           updates.engramApiUrl       = options.apiUrl;
    if (options.extensionSecret)  updates.extensionSecret    = options.extensionSecret;
    if (options.defaultTool)      updates.defaultTool        = options.defaultTool;

    if (Object.keys(updates).length === 0) {
      printBanner();
      printHelp([
        'Usage: engram config [options]',
        '',
        '  --anthropic-key  sk-ant-...   Set Anthropic API key',
        '  --openai-key     sk-...       Set OpenAI API key',
        '  --gemini-key     AI...        Set Gemini API key',
        '  --api-url        https://...  Set ENGRAM web app URL',
        '  --extension-secret  xxx       Set x-engram-secret',
        '  --default-tool   claude       Set default AI tool',
      ]);
    } else {
      saveConfig(updates as Parameters<typeof saveConfig>[0]);
      printBanner();
      console.log(subtle('  ✓ Config updated.\n'));
    }
  });

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  printBanner();
  printHelp([
    'Commands:',
    '',
    '  engram claude [prompt]      Chat with Claude (context pre-loaded)',
    '  engram chatgpt [prompt]     Chat with ChatGPT (context pre-loaded)',
    '  engram gemini [prompt]      Chat with Gemini (context pre-loaded)',
    '',
    '  engram resume               Resume your last session',
    '  engram ask "question"       Search your context graph',
    '  engram capture              Pipe or import a conversation',
    '  engram sync                 Sync with the ENGRAM web app',
    '',
    '  engram login                Log in to your ENGRAM account',
    '  engram status               Show status and capture stats',
    '  engram config               Set API keys and preferences',
    '',
    '  engram --help               Full help',
    '',
    brand('Examples:'),
    '',
    '  engram config --api-url https://your-app.vercel.app',
    '  engram login',
    '  engram claude "continue the JWT auth discussion"',
    '  engram ask "why did we choose Supabase?"',
    '  engram ask "how does auth work?" --scope team',
    '  cat session.txt | engram capture --tool chatgpt',
    '  engram resume --tool claude',
  ]);
}
