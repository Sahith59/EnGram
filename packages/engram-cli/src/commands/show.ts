import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI } from "../api";
import { c, relativeTime, spinner } from "../ui";

export async function showCommand(id: string, opts: { raw: boolean }) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);

  // Accept short IDs — fetch list and find matching prefix
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

  const spin = spinner("Loading context…");
  try {
    const snap = await api.getContext(fullId);
    spin.stop();

    if (opts.raw) {
      // Machine-readable: output the rationale markdown directly
      console.log(snap.rationale ?? snap.summary ?? snap.title);
      return;
    }

    const divider = chalk.dim("─".repeat(60));

    console.log(`\n${c.brand("ENGRAM")} — Context Snapshot\n${divider}`);
    console.log(chalk.bold("  " + snap.title));
    console.log(
      chalk.dim(`  ${c.tool(snap.ai_tool)}  ·  ${relativeTime(snap.updated_at ?? snap.created_at)}  ·  ${snap.visibility}`)
    );
    if (snap.tags?.length)
      console.log(chalk.dim("  tags: ") + snap.tags.map((t) => chalk.cyan(t)).join(", "));

    console.log(`\n${divider}`);

    if (snap.summary) {
      console.log(chalk.bold("\n  Summary\n"));
      snap.summary.split("\n").forEach((l) => console.log("  " + l));
    }

    if (snap.decision) {
      console.log(chalk.bold("\n  Key Decisions\n"));
      snap.decision.split("\n").forEach((l) => console.log("  " + l));
    }

    if (snap.rationale) {
      console.log(chalk.bold("\n  Handoff Brief\n"));
      snap.rationale.split("\n").forEach((l) => console.log("  " + l));
    }

    console.log(`\n${divider}`);
    console.log(
      chalk.dim(`  engram resume ${snap.id.slice(0, 8)}  — continue this session\n`)
    );
  } catch (err) {
    spin.fail((err as Error).message);
    process.exit(1);
  }
}
