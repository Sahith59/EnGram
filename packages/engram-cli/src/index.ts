import { Command } from "commander";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { listCommand } from "./commands/list";
import { showCommand } from "./commands/show";
import { searchCommand } from "./commands/search";
import { resumeCommand } from "./commands/resume";
import { askCommand } from "./commands/ask";
import { captureCommand } from "./commands/capture";
import { injectCommand } from "./commands/inject";
import { watchCommand } from "./commands/watch";
import { loadConfig } from "./config";
import chalk from "chalk";

const program = new Command();

program
  .name("engram")
  .description("ENGRAM CLI — Git for AI Decisions. Pull context into any terminal.")
  .version("0.1.0");

// ── Auth ────────────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Connect your terminal to your ENGRAM account")
  .option("--api-url <url>", "ENGRAM API URL (skip the interactive prompt)")
  .action((opts) => loginCommand({ apiUrl: opts.apiUrl }));

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => logoutCommand());

// ── Captures ────────────────────────────────────────────────────────────────

program
  .command("list")
  .alias("ls")
  .description("List recent captures")
  .option("-n, --limit <n>", "number of captures to show", "20")
  .option("--tool <tool>", "filter by tool: chatgpt, claude, gemini")
  .option("--team", "show team captures instead of personal")
  .option("-s, --search <query>", "keyword filter")
  .action((opts) =>
    listCommand({
      limit: parseInt(opts.limit, 10),
      tool: opts.tool,
      scope: opts.team ? "team" : "personal",
      search: opts.search,
    })
  );

program
  .command("show <id>")
  .description("Show the full context of a capture (short IDs work)")
  .option("--raw", "output raw markdown (useful for piping)")
  .action((id, opts) => showCommand(id, { raw: opts.raw ?? false }));

program
  .command("search <query>")
  .description("Search captures by keyword")
  .option("-n, --limit <n>", "max results", "10")
  .option("--team", "search team captures")
  .action((query, opts) =>
    searchCommand(query, {
      limit: parseInt(opts.limit, 10),
      scope: opts.team ? "team" : "personal",
    })
  );

// ── Resume & Inject ─────────────────────────────────────────────────────────

program
  .command("resume [id]")
  .description(
    "Resume a context in ChatGPT, Claude, or Gemini. Interactive picker if no ID."
  )
  .option("--open <tool>", "open directly in: chatgpt, claude, gemini")
  .option("--no-copy", "do not copy the prompt to clipboard")
  .option("--team", "pick from team captures")
  .action((id, opts) =>
    resumeCommand(id, {
      open: opts.open,
      copy: opts.copy !== false,
      scope: opts.team ? "team" : "personal",
    })
  );

program
  .command("inject [id]")
  .description(
    "Output the handoff brief to stdout (pipe-friendly). Defaults to latest."
  )
  .option("--full", "include full raw conversation, not just the brief")
  .option("--copy", "also copy to clipboard")
  .action((id, opts) =>
    injectCommand(id, {
      mode: opts.full ? "full" : "brief",
      copy: opts.copy ?? false,
    })
  );

// ── AI Q&A ──────────────────────────────────────────────────────────────────

program
  .command("ask <question>")
  .description("Ask a question over your entire capture history using AI")
  .option("--team", "include team captures")
  .option("--all", "search personal + team")
  .action((question, opts) =>
    askCommand(question, {
      scope: opts.all ? "all" : opts.team ? "team" : "personal",
    })
  );

// ── Capture ─────────────────────────────────────────────────────────────────

program
  .command("capture")
  .description(
    "Capture a conversation from stdin or a file.\n" +
      "  Format: USER: ... \\nASSISTANT: ...\n" +
      "  Example: cat convo.txt | engram capture --tool claude"
  )
  .option("--tool <tool>", "source tool: chatgpt, claude, gemini, other", "other")
  .option("--team", "save to team scope")
  .option("--file <path>", "read from file instead of stdin")
  .action((opts) =>
    captureCommand({
      tool: opts.tool,
      mode: opts.team ? "team" : "personal",
      file: opts.file,
    })
  );

// ── Watch ────────────────────────────────────────────────────────────────────

program
  .command("watch")
  .description(
    "Watch git changes in real-time and surface relevant past decisions"
  )
  .option("--interval <s>", "poll interval in seconds", "5")
  .option("--team", "search team captures")
  .action((opts) =>
    watchCommand({
      interval: parseInt(opts.interval, 10),
      scope: opts.team ? "team" : "personal",
    })
  );

// ── Status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show current login status")
  .action(() => {
    const cfg = loadConfig();
    if (!cfg) {
      console.log(chalk.dim("\n  Not logged in. Run ") + chalk.cyan("engram login") + "\n");
    } else {
      console.log(`\n  ${chalk.hex("#7c3aed").bold("ENGRAM")} — logged in\n`);
      console.log(`  ${chalk.dim("User:")}    ${cfg.user_email}`);
      console.log(`  ${chalk.dim("API:")}     ${cfg.api_url}`);
      console.log(`  ${chalk.dim("Config:")}  ~/.config/engram/config.json\n`);
    }
  });

program.parse();
