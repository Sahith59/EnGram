import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI, Snapshot } from "../api";
import {
  c,
  relativeTime,
  spinner,
  select,
  copyToClipboard,
  openBrowser,
  AI_URLS,
} from "../ui";

const CONTINUATION_PROMPT = (brief: string, title: string) => `\
I'm resuming a previous session with this AI. Here is the full context:

${brief}

Please read this carefully. To confirm you're ready to continue from where we left off, state:
1. The main project goal
2. What was most recently completed or decided
3. The immediate next step

Then wait for my instruction.
`;

export async function resumeCommand(
  id: string | undefined,
  opts: { open?: string; copy: boolean; scope: "personal" | "team" }
) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);

  let snap: Snapshot;

  if (id) {
    // Resolve short ID
    let fullId = id;
    if (id.length < 36) {
      const spin = spinner("Resolving ID…");
      const { data } = await api.listContexts({ limit: 100 });
      const match = data.find((s) => s.id.startsWith(id));
      spin.stop();
      if (!match) {
        console.error(c.err(`✖ No capture found with ID starting with "${id}"`));
        process.exit(1);
      }
      fullId = match.id;
    }
    const spin2 = spinner("Loading context…");
    snap = await api.getContext(fullId);
    spin2.stop();
  } else {
    // Interactive picker
    const spin = spinner("Fetching recent captures…");
    const { data } = await api.listContexts({ limit: 20, scope: opts.scope });
    spin.stop();

    if (!data.length) {
      console.log(chalk.dim("\n  No captures found. Capture a conversation first.\n"));
      process.exit(0);
    }

    console.log(`\n  ${c.brand("ENGRAM")} — Pick a context to resume\n`);
    const chosen = await select(
      "Which context?",
      data.map((s) => ({
        label: `${chalk.bold(truncate(s.title, 55))} ${chalk.dim(c.tool(s.ai_tool) + "  " + relativeTime(s.updated_at ?? s.created_at))}`,
        value: s.id,
      }))
    );
    const spin2 = spinner("Loading context…");
    snap = await api.getContext(chosen);
    spin2.stop();
  }

  // Build continuation prompt
  const brief =
    snap.rationale ??
    [snap.summary, snap.decision].filter(Boolean).join("\n\n") ??
    snap.title;
  const prompt = CONTINUATION_PROMPT(brief, snap.title);

  const divider = chalk.dim("─".repeat(60));
  console.log(`\n${c.brand("ENGRAM")} — Resume Session\n${divider}`);
  console.log(chalk.bold("  " + snap.title));
  console.log(
    chalk.dim(`  ${c.tool(snap.ai_tool)}  ·  ${relativeTime(snap.updated_at ?? snap.created_at)}`)
  );

  // Show brief preview (first section only)
  const preview = brief.split("\n").slice(0, 12).join("\n");
  console.log(`\n${preview}\n${divider}\n`);

  // Copy to clipboard
  if (opts.copy !== false) {
    const copied = copyToClipboard(prompt);
    if (copied) {
      console.log(c.ok("✔") + " Continuation prompt " + chalk.bold("copied to clipboard!"));
    } else {
      console.log(
        chalk.yellow("⚠") +
          " Could not copy to clipboard. Paste this manually:\n\n" +
          chalk.dim(prompt.slice(0, 300) + "…")
      );
    }
  }

  // Open in browser
  let targetTool = opts.open;
  if (!targetTool) {
    const openChoice = await select("Open in AI tool?", [
      { label: c.tool("chatgpt") + "  (chatgpt.com)", value: "chatgpt" },
      { label: c.tool("claude") + "  (claude.ai)", value: "claude" },
      { label: c.tool("gemini") + "  (gemini.google.com)", value: "gemini" },
      { label: chalk.dim("Skip — I'll paste manually"), value: "skip" },
    ]);
    if (openChoice !== "skip") targetTool = openChoice;
  }

  if (targetTool && AI_URLS[targetTool]) {
    openBrowser(AI_URLS[targetTool]);
    console.log(
      c.ok("✔") +
        ` Opening ${c.tool(targetTool)}… paste the clipboard content to start your session.`
    );
  }

  console.log(
    chalk.dim(
      `\n  Full context exported to: engram inject ${snap.id.slice(0, 8)} > context.md\n`
    )
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
