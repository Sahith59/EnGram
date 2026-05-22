import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI, Snapshot } from "../api";
import { c, table, relativeTime, spinner } from "../ui";

export async function listCommand(opts: {
  limit: number;
  tool?: string;
  scope: "personal" | "team";
  search?: string;
}) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  const spin = spinner("Fetching captures…");

  try {
    const { data, total } = await api.listContexts({
      limit: opts.limit,
      tool: opts.tool,
      scope: opts.scope,
      search: opts.search,
    });
    spin.stop();

    if (!data.length) {
      console.log(chalk.dim("  No captures found."));
      if (!opts.search) {
        console.log(
          chalk.dim("  Tip: install the Chrome extension and start a conversation.")
        );
      }
      return;
    }

    console.log(
      `\n  ${c.brand("ENGRAM")} — ${chalk.bold(String(total))} captures ${opts.search ? `matching "${opts.search}"` : `(${opts.scope})`}\n`
    );

    table(
      ["ID (short)", "Title", "Tool", "When"],
      data.map((s: Snapshot) => [
        chalk.dim(s.id.slice(0, 8)),
        truncate(s.title, 52),
        c.tool(s.ai_tool),
        chalk.dim(relativeTime(s.updated_at ?? s.created_at)),
      ]),
      [10, 54, 10, 12]
    );

    console.log(
      chalk.dim(`\n  engram show <id>   — view full context`) +
      chalk.dim(`\n  engram resume      — resume interactively\n`)
    );
  } catch (err) {
    spin.fail((err as Error).message);
    process.exit(1);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
