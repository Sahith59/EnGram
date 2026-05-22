import { execSync } from "child_process";
import chalk from "chalk";
import { requireConfig } from "../config";
import { EngramAPI } from "../api";
import { c, relativeTime } from "../ui";

export async function watchCommand(opts: { interval: number; scope: "personal" | "team" }) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);

  console.log(
    `\n  ${c.brand("ENGRAM")} Watch — monitoring git changes every ${opts.interval}s\n` +
      chalk.dim("  Press Ctrl+C to stop\n")
  );

  let lastFiles: string[] = [];

  const check = async () => {
    const files = getChangedFiles();
    const changed =
      JSON.stringify(files.sort()) !== JSON.stringify(lastFiles.sort());

    if (!changed && files.length === 0) return;
    if (!changed) return;

    lastFiles = [...files];
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen

    console.log(
      `\n  ${c.brand("ENGRAM")} Watch — ${new Date().toLocaleTimeString()}\n`
    );

    if (files.length === 0) {
      console.log(chalk.dim("  No modified files detected.\n"));
      return;
    }

    console.log(chalk.bold("  Modified files:\n"));
    files.slice(0, 10).forEach((f) => console.log(`    ${chalk.cyan(f)}`));
    if (files.length > 10)
      console.log(chalk.dim(`    … and ${files.length - 10} more`));

    const query = `decisions and context related to: ${files.slice(0, 5).join(", ")}`;
    console.log(`\n  ${chalk.dim("Searching for relevant captures…")}`);

    try {
      const { data } = await api.listContexts({
        search: files.slice(0, 3).join(" "),
        limit: 5,
        scope: opts.scope,
      });

      if (data.length === 0) {
        console.log(chalk.dim("\n  No relevant captures found for these files.\n"));
      } else {
        console.log(chalk.bold(`\n  Relevant captures (${data.length}):\n`));
        data.forEach((s) => {
          console.log(
            `    ${chalk.dim(s.id.slice(0, 8))}  ${chalk.bold(s.title)}`
          );
          console.log(
            `    ${c.tool(s.ai_tool)}  ${chalk.dim(relativeTime(s.updated_at ?? s.created_at))}`
          );
          if (s.summary) {
            console.log(
              chalk.dim("    " + s.summary.slice(0, 100).replace(/\n/g, " ") + "…")
            );
          }
          console.log();
        });
        console.log(
          chalk.dim(`  engram resume — pick one to continue\n`)
        );
      }
    } catch {
      console.log(chalk.dim("\n  Could not fetch captures (check connection).\n"));
    }
  };

  await check();
  setInterval(check, opts.interval * 1000);

  // Keep alive
  await new Promise(() => {});
}

function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only HEAD 2>/dev/null && git diff --name-only 2>/dev/null", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return [
      ...new Set(
        output
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean)
      ),
    ];
  } catch {
    return [];
  }
}
