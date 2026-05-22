import chalk from "chalk";
import * as readline from "readline";

export const c = {
  brand: (s: string) => chalk.hex("#7c3aed").bold(s),
  ok: (s: string) => chalk.green(s),
  warn: (s: string) => chalk.yellow(s),
  err: (s: string) => chalk.red(s),
  dim: (s: string) => chalk.dim(s),
  bold: (s: string) => chalk.bold(s),
  cyan: (s: string) => chalk.cyan(s),
  tool: (t: string) => {
    const map: Record<string, string> = {
      chatgpt: chalk.hex("#10a37f")("ChatGPT"),
      claude: chalk.hex("#d97706")("Claude"),
      gemini: chalk.hex("#4285f4")("Gemini"),
    };
    return map[t] ?? chalk.white(t);
  },
};

export function logo() {
  console.log(
    chalk.hex("#7c3aed").bold("  ███████╗███╗   ██╗ ██████╗ ██████╗  █████╗ ███╗   ███╗")
  );
  console.log(
    chalk.hex("#7c3aed").bold("  ██╔════╝████╗  ██║██╔════╝ ██╔══██╗██╔══██╗████╗ ████║")
  );
  console.log(
    chalk.hex("#7c3aed").bold("  █████╗  ██╔██╗ ██║██║  ███╗██████╔╝███████║██╔████╔██║")
  );
  console.log(
    chalk.hex("#7c3aed").bold("  ██╔══╝  ██║╚██╗██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║")
  );
  console.log(
    chalk.hex("#7c3aed").bold("  ███████╗██║ ╚████║╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║")
  );
  console.log(
    chalk.hex("#7c3aed").bold("  ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝")
  );
  console.log(chalk.dim("  Git for AI Decisions\n"));
}

export function spinner(text: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(
      `\r${chalk.hex("#7c3aed")(frames[i % frames.length])} ${text}`
    );
    i++;
  }, 80);
  return {
    succeed(msg: string) {
      clearInterval(iv);
      process.stdout.write(`\r${chalk.green("✔")} ${msg}\n`);
    },
    fail(msg: string) {
      clearInterval(iv);
      process.stdout.write(`\r${chalk.red("✖")} ${msg}\n`);
    },
    stop() {
      clearInterval(iv);
      process.stdout.write("\r\x1b[K");
    },
  };
}

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(chalk.cyan("? ") + question + " ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    process.stdout.write(chalk.cyan("? ") + question + " ");
    let pw = "";
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const handler = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        rl.close();
        resolve(pw);
      } else if (ch === "\u0003") {
        process.stdin.setRawMode?.(false);
        process.exit();
      } else if (ch === "\u007f") {
        pw = pw.slice(0, -1);
      } else {
        pw += ch;
      }
    };
    process.stdin.on("data", handler);
  });
}

export async function select<T extends string>(
  question: string,
  choices: Array<{ label: string; value: T }>
): Promise<T> {
  console.log(chalk.cyan("?") + " " + question);
  choices.forEach((c, i) =>
    console.log(`  ${chalk.dim(String(i + 1) + ".")} ${c.label}`)
  );
  while (true) {
    const raw = await prompt(`Enter 1-${choices.length}:`);
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= choices.length) return choices[n - 1].value;
    console.log(c.err(`  Invalid choice, enter 1–${choices.length}`));
  }
}

export function table(
  headers: string[],
  rows: string[][],
  maxWidths?: number[]
) {
  const widths = headers.map((h, i) => {
    const col = [h, ...rows.map((r) => r[i] ?? "")];
    const max = Math.max(...col.map((v) => stripAnsi(v).length));
    return maxWidths?.[i] ? Math.min(max, maxWidths[i]) : max;
  });

  const hr = "─".repeat(widths.reduce((a, w) => a + w + 3, 1));
  const row = (cells: string[], bold?: boolean) => {
    const line = cells
      .map((cell, i) => {
        const plain = stripAnsi(cell);
        const pad = " ".repeat(Math.max(0, widths[i] - plain.length));
        return ` ${cell}${pad} `;
      })
      .join("│");
    return "│" + line + "│";
  };

  console.log(chalk.dim("┌" + hr + "┐"));
  console.log(
    chalk.dim("│") +
      headers
        .map((h, i) => " " + chalk.bold(h) + " ".repeat(widths[i] - h.length) + " ")
        .join(chalk.dim("│")) +
      chalk.dim("│")
  );
  console.log(chalk.dim("├" + hr + "┤"));
  rows.forEach((r) => console.log(chalk.dim("│") + row(r).slice(1, -1) + chalk.dim("│")));
  console.log(chalk.dim("└" + hr + "┘"));
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function copyToClipboard(text: string): boolean {
  const { execSync } = require("child_process");
  const cmds: Record<string, string> = {
    linux: `echo ${JSON.stringify(text)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(text)} | xsel --clipboard --input 2>/dev/null`,
    darwin: `echo ${JSON.stringify(text)} | pbcopy`,
    win32: `echo ${JSON.stringify(text).replace(/"/g, '""')} | clip`,
  };
  const cmd = cmds[process.platform] ?? cmds.linux;
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function openBrowser(url: string): void {
  const { exec } = require("child_process");
  const cmds: Record<string, string> = {
    linux: `xdg-open "${url}"`,
    darwin: `open "${url}"`,
    win32: `start "" "${url}"`,
  };
  exec(cmds[process.platform] ?? cmds.linux);
}

export const AI_URLS: Record<string, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
};
