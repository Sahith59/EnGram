// src/ui/print.ts
// All terminal output goes through here.
// Consistent colors, ENGRAM branding, and source attribution.

import chalk from 'chalk';

export const brand   = chalk.hex('#7c3aed');  // ENGRAM purple
export const subtle  = chalk.hex('#8b949e');  // GitHub gray
export const success = chalk.hex('#3fb950');  // green
export const warning = chalk.hex('#d29922');  // amber
export const err     = chalk.hex('#f85149');  // red

export const toolColors: Record<string, ReturnType<typeof chalk.hex>> = {
  claude:  chalk.hex('#d4623a'),
  chatgpt: chalk.hex('#10a37f'),
  gemini:  chalk.hex('#4285f4'),
  other:   chalk.hex('#8b949e'),
};

export function printToken(token: string): void {
  process.stdout.write(token);
}

export function printBanner(): void {
  console.log(brand.bold('\n  ⬡ ENGRAM') + subtle(' — your context, everywhere\n'));
}

export function printContextInjected(title: string, tool: string, matchType: string): void {
  const toolColor = toolColors[tool] || chalk.white;
  const matchLabel =
    matchType === 'search' ? 'matched' :
    matchType === 'remote' ? 'synced from browser' : 'loaded';
  console.log(
    brand('  ⬡ Context ') +
    matchLabel + ': ' +
    chalk.italic.white(`"${title}"`) + ' ' +
    subtle(`(${toolColor(tool)})\n`)
  );
}

export function printCaptureSaved(title: string, pairCount: number, synced: boolean): void {
  const syncIcon = synced ? success('↑ synced') : subtle('local');
  console.log(
    success('\n  ✓ Captured: ') +
    chalk.white(`"${title}"`) + ' ' +
    subtle(`(${pairCount} exchange${pairCount !== 1 ? 's' : ''})`) + ' · ' +
    syncIcon + '\n'
  );
}

export function printSyncStatus(pushed: number, pulled: number): void {
  if (pushed > 0 || pulled > 0) {
    console.log(subtle(`  ↑ ${pushed} pushed  ↓ ${pulled} pulled\n`));
  }
}

export function printError(msg: string): void {
  console.error(err('  ✗ ') + msg);
}

export function printHelp(lines: string[]): void {
  lines.forEach(l => console.log('  ' + l));
}

export function toolLabel(tool: string): string {
  const color = toolColors[tool] || chalk.white;
  return color.bold(tool.charAt(0).toUpperCase() + tool.slice(1));
}
