import * as fs from "fs";
import { requireConfig } from "../config";
import { EngramAPI } from "../api";
import { c, spinner } from "../ui";

export async function injectCommand(
  id: string | undefined,
  opts: { mode: "brief" | "full"; copy: boolean }
) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);

  let fullId = id;
  if (!fullId) {
    // Use most recent
    const spin = spinner("Fetching latest capture…");
    const { data } = await api.listContexts({ limit: 1 });
    spin.stop();
    if (!data.length) {
      process.stderr.write(c.err("✖ No captures found.\n"));
      process.exit(1);
    }
    fullId = data[0].id;
  } else if (fullId.length < 36) {
    const spin = spinner("Resolving ID…");
    const { data } = await api.listContexts({ limit: 100 });
    const match = data.find((s) => s.id.startsWith(fullId!));
    spin.stop();
    if (!match) {
      process.stderr.write(c.err(`✖ No capture found with ID starting with "${fullId}"\n`));
      process.exit(1);
    }
    fullId = match.id;
  }

  const spin = spinner("Exporting context…");
  try {
    const { content, title } = await api.exportContext(fullId, opts.mode);
    spin.stop();

    // Write to stdout — composable with pipes
    process.stdout.write(content + "\n");

    if (opts.copy) {
      const { copyToClipboard } = await import("../ui");
      const ok = copyToClipboard(content);
      if (ok) process.stderr.write(c.ok("✔") + ` "${title}" copied to clipboard\n`);
    }
  } catch (err) {
    spin.fail((err as Error).message);
    process.exit(1);
  }
}
