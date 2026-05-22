import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "engram");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface EngramConfig {
  api_url: string;
  access_token: string;
  refresh_token: string;
  user_email: string;
  user_id: string;
  team_id: string;
}

export function loadConfig(): EngramConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as EngramConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: EngramConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  fs.chmodSync(CONFIG_FILE, 0o600);
}

export function clearConfig(): void {
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {}
}

export function requireConfig(): EngramConfig {
  const cfg = loadConfig();
  if (!cfg) {
    console.error(
      "\x1b[31m✖ Not logged in.\x1b[0m Run \x1b[36mengram login\x1b[0m first."
    );
    process.exit(1);
  }
  return cfg;
}
