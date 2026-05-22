import chalk from "chalk";
import { saveConfig } from "../config";
import { logo, prompt, promptSecret, spinner, c } from "../ui";

export async function loginCommand(opts: { apiUrl?: string }) {
  logo();
  console.log(c.bold("Connect your terminal to ENGRAM\n"));

  const apiUrl =
    opts.apiUrl ??
    (await prompt(
      "ENGRAM API URL (e.g. https://your-engram.replit.app):"
    ));

  const email = await prompt("Email:");
  const password = await promptSecret("Password:");

  const spin = spinner("Authenticating…");

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/cli`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = (await res.json()) as {
      error?: string;
      access_token?: string;
      refresh_token?: string;
      user?: { id: string; email: string; full_name?: string };
      team_id?: string;
    };

    if (!res.ok || !data.access_token) {
      spin.fail(data.error ?? "Login failed");
      process.exit(1);
    }

    saveConfig({
      api_url: apiUrl.replace(/\/$/, ""),
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? "",
      user_email: data.user?.email ?? email,
      user_id: data.user?.id ?? "",
      team_id: data.team_id ?? "",
    });

    spin.succeed(
      `Logged in as ${chalk.cyan(data.user?.full_name ?? data.user?.email ?? email)}`
    );
    console.log(chalk.dim(`  Config saved to ~/.config/engram/config.json`));
    console.log(
      `\n  ${c.brand("ENGRAM")} is ready. Try ${chalk.cyan("engram list")} to see your captures.\n`
    );
  } catch (err) {
    spin.fail(`Connection failed: ${(err as Error).message}`);
    console.log(
      chalk.dim("\n  Make sure your ENGRAM app is running and the URL is correct.")
    );
    process.exit(1);
  }
}
