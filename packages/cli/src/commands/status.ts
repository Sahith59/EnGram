// src/commands/status.ts
// `engram status` — shows auth, web app URL, API keys, local capture counts

import { getRecentSnapshots } from '../storage/db';
import { loadConfig, isLoggedIn } from '../storage/config';
import { printBanner, brand, subtle, success, warning, err, toolColors } from '../ui/print';
import chalk from 'chalk';

export async function statusCommand(): Promise<void> {
  printBanner();

  const config = loadConfig();
  const snapshots = await getRecentSnapshots(50);

  // Auth + web app
  console.log(brand('  Account:'));
  if (isLoggedIn()) {
    console.log(success('    ✓ Logged in: ') + chalk.white(config.userEmail));
  } else {
    console.log(warning('    ○ Not logged in ') + subtle('(run: engram login)'));
  }

  if (config.engramApiUrl) {
    console.log(subtle('    Web app: ') + chalk.white(config.engramApiUrl));
  } else {
    console.log(err('    ✗ No web app URL ') + subtle('(run: engram config --api-url https://...)'));
  }

  // API keys
  console.log('\n' + brand('  API Keys:'));
  const keys = [
    { name: 'Claude (Anthropic)', set: !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY) },
    { name: 'ChatGPT (OpenAI)', set: !!(config.openaiApiKey || process.env.OPENAI_API_KEY) },
    { name: 'Gemini', set: !!(config.geminiApiKey || process.env.GEMINI_API_KEY) },
  ];
  keys.forEach(k => {
    const icon = k.set ? success('✓') : subtle('○');
    console.log(`    ${icon} ${k.set ? chalk.white(k.name) : subtle(k.name)}`);
  });

  // Capture stats
  console.log('\n' + brand('  Captures:'));
  if (snapshots.length === 0) {
    console.log(subtle('    (none yet)\n'));
  } else {
    const byTool: Record<string, number> = {};
    snapshots.forEach(s => {
      byTool[s.ai_tool] = (byTool[s.ai_tool] || 0) + 1;
    });

    Object.entries(byTool).forEach(([tool, count]) => {
      const color = toolColors[tool] || chalk.white;
      console.log(subtle('    ') + color(tool) + subtle(`: ${count} session${count !== 1 ? 's' : ''}`));
    });

    const last = snapshots[0];
    console.log('\n' + subtle('    Last: ') + chalk.white.italic(`"${last.title}"`));
    console.log(subtle(`      ${last.ai_tool} · ${last.captured_at} · from ${last.source}`));

    const unsynced = snapshots.filter(s => s.synced === 0).length;
    if (unsynced > 0) {
      console.log('\n' + warning(`    ${unsynced} capture${unsynced > 1 ? 's' : ''} pending sync`) +
        subtle(' (run: engram sync)'));
    }
  }

  console.log();
}
