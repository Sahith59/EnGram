import * as fs from "fs";
import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI } from "../api";
import { c, spinner, prompt, select } from "../ui";

export async function captureCommand(opts: {
  tool: string;
  mode: "personal" | "team";
  file?: string;
}) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);

  let raw: string;

  if (opts.file) {
    raw = fs.readFileSync(opts.file, "utf8");
  } else if (!process.stdin.isTTY) {
    // Piped input
    raw = fs.readFileSync("/dev/stdin", "utf8");
  } else {
    // Interactive multi-line input
    console.log(
      `\n  ${c.brand("ENGRAM")} Capture — paste your conversation below.\n` +
        chalk.dim("  Format: USER: ... (newline) ASSISTANT: ...\n") +
        chalk.dim("  Press Ctrl+D when done.\n")
    );
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    await new Promise<void>((res) => {
      process.stdin.on("data", (d: string) => chunks.push(d));
      process.stdin.on("end", res);
      process.stdin.resume();
    });
    raw = chunks.join("");
  }

  const pairs = parseConversation(raw);
  if (pairs.length === 0) {
    console.error(
      c.err("✖ Could not parse conversation.") +
        chalk.dim("\n  Expected format:\n  USER: ...\n  ASSISTANT: ...\n")
    );
    process.exit(1);
  }

  const spin = spinner(`Capturing ${pairs.length} turn${pairs.length !== 1 ? "s" : ""} to ENGRAM…`);

  try {
    const result = await api.capture({
      pairs,
      tool: opts.tool,
      mode: opts.mode,
    });
    spin.stop();

    if (result.duplicate) {
      console.log(chalk.yellow("⚠") + ` Already in ENGRAM: ${chalk.bold(result.title)}`);
    } else if (result.updated) {
      console.log(c.ok("✔") + ` Updated: ${chalk.bold(result.title)}`);
    } else {
      console.log(c.ok("✔") + ` Captured: ${chalk.bold(result.title)}`);
    }
    console.log(chalk.dim(`  ID: ${result.id}`));
    console.log(chalk.dim(`  engram show ${result.id.slice(0, 8)} — view it now`));
  } catch (err) {
    spin.fail((err as Error).message);
    process.exit(1);
  }
}

function parseConversation(raw: string): Array<{ role: string; content: string }> {
  const pairs: Array<{ role: string; content: string }> = [];

  // Try structured USER:/ASSISTANT: format
  const structured = raw.matchAll(
    /^(USER|HUMAN|ASSISTANT|AI|SYSTEM):\s*([\s\S]*?)(?=^(?:USER|HUMAN|ASSISTANT|AI|SYSTEM):|$)/gim
  );
  for (const m of structured) {
    const roleRaw = m[1].toLowerCase();
    const role =
      roleRaw === "user" || roleRaw === "human" ? "user" : "assistant";
    const content = m[2].trim();
    if (content) pairs.push({ role, content });
  }
  if (pairs.length > 0) return pairs;

  // Fallback: treat entire text as a single user message
  const trimmed = raw.trim();
  if (trimmed) return [{ role: "user", content: trimmed }];
  return [];
}
