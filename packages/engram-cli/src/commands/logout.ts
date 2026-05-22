import chalk from "chalk";
import { clearConfig, loadConfig } from "../config";
import { c } from "../ui";

export function logoutCommand() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(chalk.dim("  Not logged in."));
    return;
  }
  clearConfig();
  console.log(c.ok("✔") + " Logged out. Run " + chalk.cyan("engram login") + " to reconnect.");
}
