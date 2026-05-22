import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI } from "../api";
import { c, relativeTime, spinner } from "../ui";

export async function searchCommand(
  query: string,
  opts: { limit: number; scope: "personal" | "team" }
) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  const spin = spinner(`Searching for "${query}"…`);

  try {
    const { data } = await api.listContexts({
      search: query,
      limit: opts.limit,
      scope: opts.scope,
    });
    spin.stop();

    if (!data.length) {
      console.log(chalk.dim(`\n  No captures matched "${query}"\n`));
      console.log(chalk.dim("  Tip: try engram ask for semantic search over full context."));
      return;
    }

    console.log(`\n  Found ${chalk.bold(String(data.length))} match${data.length !== 1 ? "es" : ""} for "${chalk.cyan(query)}"\n`);

    data.forEach((s, i) => {
      const num = chalk.dim(String(i + 1).padStart(2) + ".");
      const id = chalk.dim(s.id.slice(0, 8));
      const when = chalk.dim(relativeTime(s.updated_at ?? s.created_at));
      console.log(`  ${num} ${chalk.bold(s.title)}`);
      console.log(`      ${id}  ${c.tool(s.ai_tool)}  ${when}`);
      if (s.summary) {
        const preview = s.summary.slice(0, 120).replace(/\n/g, " ");
        console.log(`      ${chalk.dim(preview + (s.summary.length > 120 ? "…" : ""))}`);
      }
      console.log();
    });

    console.log(
      chalk.dim(`  engram show <id>   — view full context`) +
      chalk.dim(`\n  engram resume <id> — continue a session\n`)
    );
  } catch (err) {
    spin.fail((err as Error).message);
    process.exit(1);
  }
}
