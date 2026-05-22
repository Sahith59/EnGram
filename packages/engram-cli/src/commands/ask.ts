import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI } from "../api";
import { c, spinner } from "../ui";

export async function askCommand(
  question: string,
  opts: { scope: "personal" | "team" | "all" }
) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);

  console.log(
    `\n  ${c.brand("ENGRAM")} Ask — ${chalk.dim("searching your AI memory…")}\n`
  );
  console.log(`  ${chalk.italic(chalk.cyan('"' + question + '"'))}\n`);

  const spin = spinner("Searching + generating answer…");

  try {
    const result = await api.ask(question, opts.scope);
    spin.stop();

    const divider = chalk.dim("─".repeat(60));
    console.log(divider);
    result.answer.split("\n").forEach((l) => console.log("  " + l));
    console.log(divider);

    if (result.sources?.length) {
      console.log(chalk.dim(`\n  Sources (${result.sources.length}):`));
      result.sources.slice(0, 5).forEach((s) => {
        const id = chalk.dim(s.id.slice(0, 8));
        const score = s.similarity != null ? chalk.dim(` (${(s.similarity * 100).toFixed(0)}%)`) : "";
        console.log(`    ${id}  ${chalk.bold(s.title)}${score}`);
      });
    }

    console.log(
      chalk.dim(
        `\n  engram show <id>   — view full context for any source\n`
      )
    );
  } catch (err) {
    spin.fail((err as Error).message);
    process.exit(1);
  }
}
