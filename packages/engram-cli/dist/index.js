#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/ui.ts
var ui_exports = {};
__export(ui_exports, {
  AI_URLS: () => AI_URLS,
  c: () => c,
  copyToClipboard: () => copyToClipboard,
  logo: () => logo,
  openBrowser: () => openBrowser,
  prompt: () => prompt,
  promptSecret: () => promptSecret,
  relativeTime: () => relativeTime,
  select: () => select,
  spinner: () => spinner,
  table: () => table
});
function logo() {
  console.log(
    import_chalk.default.hex("#7c3aed").bold("  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557")
  );
  console.log(
    import_chalk.default.hex("#7c3aed").bold("  \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551")
  );
  console.log(
    import_chalk.default.hex("#7c3aed").bold("  \u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551")
  );
  console.log(
    import_chalk.default.hex("#7c3aed").bold("  \u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551")
  );
  console.log(
    import_chalk.default.hex("#7c3aed").bold("  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551")
  );
  console.log(
    import_chalk.default.hex("#7c3aed").bold("  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D     \u255A\u2550\u255D")
  );
  console.log(import_chalk.default.dim("  Git for AI Decisions\n"));
}
function spinner(text) {
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(
      `\r${import_chalk.default.hex("#7c3aed")(frames[i % frames.length])} ${text}`
    );
    i++;
  }, 80);
  return {
    succeed(msg) {
      clearInterval(iv);
      process.stdout.write(`\r${import_chalk.default.green("\u2714")} ${msg}
`);
    },
    fail(msg) {
      clearInterval(iv);
      process.stdout.write(`\r${import_chalk.default.red("\u2716")} ${msg}
`);
    },
    stop() {
      clearInterval(iv);
      process.stdout.write("\r\x1B[K");
    }
  };
}
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(import_chalk.default.cyan("? ") + question + " ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}
function promptSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
    process.stdout.write(import_chalk.default.cyan("? ") + question + " ");
    let pw = "";
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const handler = (ch) => {
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        rl.close();
        resolve(pw);
      } else if (ch === "") {
        process.stdin.setRawMode?.(false);
        process.exit();
      } else if (ch === "\x7F") {
        pw = pw.slice(0, -1);
      } else {
        pw += ch;
      }
    };
    process.stdin.on("data", handler);
  });
}
async function select(question, choices) {
  console.log(import_chalk.default.cyan("?") + " " + question);
  choices.forEach(
    (c2, i) => console.log(`  ${import_chalk.default.dim(String(i + 1) + ".")} ${c2.label}`)
  );
  while (true) {
    const raw = await prompt(`Enter 1-${choices.length}:`);
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= choices.length) return choices[n - 1].value;
    console.log(c.err(`  Invalid choice, enter 1\u2013${choices.length}`));
  }
}
function table(headers, rows, maxWidths) {
  const widths = headers.map((h, i) => {
    const col = [h, ...rows.map((r) => r[i] ?? "")];
    const max = Math.max(...col.map((v) => stripAnsi(v).length));
    return maxWidths?.[i] ? Math.min(max, maxWidths[i]) : max;
  });
  const hr = "\u2500".repeat(widths.reduce((a, w) => a + w + 3, 1));
  const row = (cells, bold) => {
    const line = cells.map((cell, i) => {
      const plain = stripAnsi(cell);
      const pad = " ".repeat(Math.max(0, widths[i] - plain.length));
      return ` ${cell}${pad} `;
    }).join("\u2502");
    return "\u2502" + line + "\u2502";
  };
  console.log(import_chalk.default.dim("\u250C" + hr + "\u2510"));
  console.log(
    import_chalk.default.dim("\u2502") + headers.map((h, i) => " " + import_chalk.default.bold(h) + " ".repeat(widths[i] - h.length) + " ").join(import_chalk.default.dim("\u2502")) + import_chalk.default.dim("\u2502")
  );
  console.log(import_chalk.default.dim("\u251C" + hr + "\u2524"));
  rows.forEach((r) => console.log(import_chalk.default.dim("\u2502") + row(r).slice(1, -1) + import_chalk.default.dim("\u2502")));
  console.log(import_chalk.default.dim("\u2514" + hr + "\u2518"));
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
function copyToClipboard(text) {
  const { execSync: execSync2 } = require("child_process");
  const cmds = {
    linux: `echo ${JSON.stringify(text)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(text)} | xsel --clipboard --input 2>/dev/null`,
    darwin: `echo ${JSON.stringify(text)} | pbcopy`,
    win32: `echo ${JSON.stringify(text).replace(/"/g, '""')} | clip`
  };
  const cmd = cmds[process.platform] ?? cmds.linux;
  try {
    execSync2(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function openBrowser(url) {
  const { exec } = require("child_process");
  const cmds = {
    linux: `xdg-open "${url}"`,
    darwin: `open "${url}"`,
    win32: `start "" "${url}"`
  };
  exec(cmds[process.platform] ?? cmds.linux);
}
var import_chalk, readline, c, AI_URLS;
var init_ui = __esm({
  "src/ui.ts"() {
    "use strict";
    import_chalk = __toESM(require("chalk"));
    readline = __toESM(require("readline"));
    c = {
      brand: (s) => import_chalk.default.hex("#7c3aed").bold(s),
      ok: (s) => import_chalk.default.green(s),
      warn: (s) => import_chalk.default.yellow(s),
      err: (s) => import_chalk.default.red(s),
      dim: (s) => import_chalk.default.dim(s),
      bold: (s) => import_chalk.default.bold(s),
      cyan: (s) => import_chalk.default.cyan(s),
      tool: (t) => {
        const map = {
          chatgpt: import_chalk.default.hex("#10a37f")("ChatGPT"),
          claude: import_chalk.default.hex("#d97706")("Claude"),
          gemini: import_chalk.default.hex("#4285f4")("Gemini")
        };
        return map[t] ?? import_chalk.default.white(t);
      }
    };
    AI_URLS = {
      chatgpt: "https://chatgpt.com/",
      claude: "https://claude.ai/new",
      gemini: "https://gemini.google.com/app"
    };
  }
});

// src/index.ts
var import_commander = require("commander");

// src/commands/login.ts
var import_chalk2 = __toESM(require("chalk"));

// src/config.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var CONFIG_DIR = path.join(os.homedir(), ".config", "engram");
var CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  fs.chmodSync(CONFIG_FILE, 384);
}
function clearConfig() {
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {
  }
}
function requireConfig() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error(
      "\x1B[31m\u2716 Not logged in.\x1B[0m Run \x1B[36mengram login\x1B[0m first."
    );
    process.exit(1);
  }
  return cfg;
}

// src/commands/login.ts
init_ui();
async function loginCommand(opts) {
  logo();
  console.log(c.bold("Connect your terminal to ENGRAM\n"));
  const apiUrl = opts.apiUrl ?? await prompt(
    "ENGRAM API URL (e.g. https://your-engram.replit.app):"
  );
  const email = await prompt("Email:");
  const password = await promptSecret("Password:");
  const spin = spinner("Authenticating\u2026");
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/cli`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
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
      team_id: data.team_id ?? ""
    });
    spin.succeed(
      `Logged in as ${import_chalk2.default.cyan(data.user?.full_name ?? data.user?.email ?? email)}`
    );
    console.log(import_chalk2.default.dim(`  Config saved to ~/.config/engram/config.json`));
    console.log(
      `
  ${c.brand("ENGRAM")} is ready. Try ${import_chalk2.default.cyan("engram list")} to see your captures.
`
    );
  } catch (err) {
    spin.fail(`Connection failed: ${err.message}`);
    console.log(
      import_chalk2.default.dim("\n  Make sure your ENGRAM app is running and the URL is correct.")
    );
    process.exit(1);
  }
}

// src/commands/logout.ts
var import_chalk3 = __toESM(require("chalk"));
init_ui();
function logoutCommand() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(import_chalk3.default.dim("  Not logged in."));
    return;
  }
  clearConfig();
  console.log(c.ok("\u2714") + " Logged out. Run " + import_chalk3.default.cyan("engram login") + " to reconnect.");
}

// src/commands/list.ts
var import_chalk4 = __toESM(require("chalk"));

// src/api.ts
var EngramAPI = class {
  baseUrl;
  token;
  constructor(cfg) {
    this.baseUrl = cfg.api_url.replace(/\/$/, "");
    this.token = cfg.access_token;
  }
  async req(method, path2, body) {
    const res = await fetch(`${this.baseUrl}${path2}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`
      },
      body: body ? JSON.stringify(body) : void 0
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch {
      }
      throw new Error(msg);
    }
    return res.json();
  }
  async me() {
    return this.req("GET", "/api/me");
  }
  async listContexts(opts = {}) {
    const p = new URLSearchParams();
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.scope) p.set("scope", opts.scope);
    if (opts.tool) p.set("tool", opts.tool);
    if (opts.search) p.set("search", opts.search);
    if (opts.page) p.set("page", String(opts.page));
    const qs = p.toString() ? `?${p}` : "";
    const res = await this.req("GET", `/api/contexts${qs}`);
    return { data: res.data ?? [], total: res.pagination?.total ?? 0 };
  }
  async getContext(id) {
    const res = await this.req("GET", `/api/contexts/${id}`);
    return res.data;
  }
  async exportContext(id, mode = "brief") {
    return this.req("GET", `/api/contexts/${id}/export?mode=${mode}`);
  }
  async ask(question, scope = "personal") {
    return this.req("POST", "/api/ask", { question, scope });
  }
  async capture(payload) {
    return this.req("POST", "/api/capture", payload);
  }
};

// src/commands/list.ts
init_ui();
async function listCommand(opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  const spin = spinner("Fetching captures\u2026");
  try {
    const { data, total } = await api.listContexts({
      limit: opts.limit,
      tool: opts.tool,
      scope: opts.scope,
      search: opts.search
    });
    spin.stop();
    if (!data.length) {
      console.log(import_chalk4.default.dim("  No captures found."));
      if (!opts.search) {
        console.log(
          import_chalk4.default.dim("  Tip: install the Chrome extension and start a conversation.")
        );
      }
      return;
    }
    console.log(
      `
  ${c.brand("ENGRAM")} \u2014 ${import_chalk4.default.bold(String(total))} captures ${opts.search ? `matching "${opts.search}"` : `(${opts.scope})`}
`
    );
    table(
      ["ID (short)", "Title", "Tool", "When"],
      data.map((s) => [
        import_chalk4.default.dim(s.id.slice(0, 8)),
        truncate(s.title, 52),
        c.tool(s.ai_tool),
        import_chalk4.default.dim(relativeTime(s.updated_at ?? s.created_at))
      ]),
      [10, 54, 10, 12]
    );
    console.log(
      import_chalk4.default.dim(`
  engram show <id>   \u2014 view full context`) + import_chalk4.default.dim(`
  engram resume      \u2014 resume interactively
`)
    );
  } catch (err) {
    spin.fail(err.message);
    process.exit(1);
  }
}
function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

// src/commands/show.ts
var import_chalk5 = __toESM(require("chalk"));
init_ui();
async function showCommand(id, opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  let fullId = id;
  if (id.length < 36) {
    const spin2 = spinner("Resolving ID\u2026");
    const { data } = await api.listContexts({ limit: 100 });
    const match = data.find((s) => s.id.startsWith(id));
    spin2.stop();
    if (!match) {
      console.error(c.err(`\u2716 No capture found with ID starting with "${id}"`));
      process.exit(1);
    }
    fullId = match.id;
  }
  const spin = spinner("Loading context\u2026");
  try {
    const snap = await api.getContext(fullId);
    spin.stop();
    if (opts.raw) {
      console.log(snap.rationale ?? snap.summary ?? snap.title);
      return;
    }
    const divider = import_chalk5.default.dim("\u2500".repeat(60));
    console.log(`
${c.brand("ENGRAM")} \u2014 Context Snapshot
${divider}`);
    console.log(import_chalk5.default.bold("  " + snap.title));
    console.log(
      import_chalk5.default.dim(`  ${c.tool(snap.ai_tool)}  \xB7  ${relativeTime(snap.updated_at ?? snap.created_at)}  \xB7  ${snap.visibility}`)
    );
    if (snap.tags?.length)
      console.log(import_chalk5.default.dim("  tags: ") + snap.tags.map((t) => import_chalk5.default.cyan(t)).join(", "));
    console.log(`
${divider}`);
    if (snap.summary) {
      console.log(import_chalk5.default.bold("\n  Summary\n"));
      snap.summary.split("\n").forEach((l) => console.log("  " + l));
    }
    if (snap.decision) {
      console.log(import_chalk5.default.bold("\n  Key Decisions\n"));
      snap.decision.split("\n").forEach((l) => console.log("  " + l));
    }
    if (snap.rationale) {
      console.log(import_chalk5.default.bold("\n  Handoff Brief\n"));
      snap.rationale.split("\n").forEach((l) => console.log("  " + l));
    }
    console.log(`
${divider}`);
    console.log(
      import_chalk5.default.dim(`  engram resume ${snap.id.slice(0, 8)}  \u2014 continue this session
`)
    );
  } catch (err) {
    spin.fail(err.message);
    process.exit(1);
  }
}

// src/commands/search.ts
var import_chalk6 = __toESM(require("chalk"));
init_ui();
async function searchCommand(query, opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  const spin = spinner(`Searching for "${query}"\u2026`);
  try {
    const { data } = await api.listContexts({
      search: query,
      limit: opts.limit,
      scope: opts.scope
    });
    spin.stop();
    if (!data.length) {
      console.log(import_chalk6.default.dim(`
  No captures matched "${query}"
`));
      console.log(import_chalk6.default.dim("  Tip: try engram ask for semantic search over full context."));
      return;
    }
    console.log(`
  Found ${import_chalk6.default.bold(String(data.length))} match${data.length !== 1 ? "es" : ""} for "${import_chalk6.default.cyan(query)}"
`);
    data.forEach((s, i) => {
      const num = import_chalk6.default.dim(String(i + 1).padStart(2) + ".");
      const id = import_chalk6.default.dim(s.id.slice(0, 8));
      const when = import_chalk6.default.dim(relativeTime(s.updated_at ?? s.created_at));
      console.log(`  ${num} ${import_chalk6.default.bold(s.title)}`);
      console.log(`      ${id}  ${c.tool(s.ai_tool)}  ${when}`);
      if (s.summary) {
        const preview = s.summary.slice(0, 120).replace(/\n/g, " ");
        console.log(`      ${import_chalk6.default.dim(preview + (s.summary.length > 120 ? "\u2026" : ""))}`);
      }
      console.log();
    });
    console.log(
      import_chalk6.default.dim(`  engram show <id>   \u2014 view full context`) + import_chalk6.default.dim(`
  engram resume <id> \u2014 continue a session
`)
    );
  } catch (err) {
    spin.fail(err.message);
    process.exit(1);
  }
}

// src/commands/resume.ts
var import_chalk7 = __toESM(require("chalk"));
init_ui();
var CONTINUATION_PROMPT = (brief, title) => `I'm resuming a previous session with this AI. Here is the full context:

${brief}

Please read this carefully. To confirm you're ready to continue from where we left off, state:
1. The main project goal
2. What was most recently completed or decided
3. The immediate next step

Then wait for my instruction.
`;
async function resumeCommand(id, opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  let snap;
  if (id) {
    let fullId = id;
    if (id.length < 36) {
      const spin = spinner("Resolving ID\u2026");
      const { data } = await api.listContexts({ limit: 100 });
      const match = data.find((s) => s.id.startsWith(id));
      spin.stop();
      if (!match) {
        console.error(c.err(`\u2716 No capture found with ID starting with "${id}"`));
        process.exit(1);
      }
      fullId = match.id;
    }
    const spin2 = spinner("Loading context\u2026");
    snap = await api.getContext(fullId);
    spin2.stop();
  } else {
    const spin = spinner("Fetching recent captures\u2026");
    const { data } = await api.listContexts({ limit: 20, scope: opts.scope });
    spin.stop();
    if (!data.length) {
      console.log(import_chalk7.default.dim("\n  No captures found. Capture a conversation first.\n"));
      process.exit(0);
    }
    console.log(`
  ${c.brand("ENGRAM")} \u2014 Pick a context to resume
`);
    const chosen = await select(
      "Which context?",
      data.map((s) => ({
        label: `${import_chalk7.default.bold(truncate2(s.title, 55))} ${import_chalk7.default.dim(c.tool(s.ai_tool) + "  " + relativeTime(s.updated_at ?? s.created_at))}`,
        value: s.id
      }))
    );
    const spin2 = spinner("Loading context\u2026");
    snap = await api.getContext(chosen);
    spin2.stop();
  }
  const brief = snap.rationale ?? [snap.summary, snap.decision].filter(Boolean).join("\n\n") ?? snap.title;
  const prompt3 = CONTINUATION_PROMPT(brief, snap.title);
  const divider = import_chalk7.default.dim("\u2500".repeat(60));
  console.log(`
${c.brand("ENGRAM")} \u2014 Resume Session
${divider}`);
  console.log(import_chalk7.default.bold("  " + snap.title));
  console.log(
    import_chalk7.default.dim(`  ${c.tool(snap.ai_tool)}  \xB7  ${relativeTime(snap.updated_at ?? snap.created_at)}`)
  );
  const preview = brief.split("\n").slice(0, 12).join("\n");
  console.log(`
${preview}
${divider}
`);
  if (opts.copy !== false) {
    const copied = copyToClipboard(prompt3);
    if (copied) {
      console.log(c.ok("\u2714") + " Continuation prompt " + import_chalk7.default.bold("copied to clipboard!"));
    } else {
      console.log(
        import_chalk7.default.yellow("\u26A0") + " Could not copy to clipboard. Paste this manually:\n\n" + import_chalk7.default.dim(prompt3.slice(0, 300) + "\u2026")
      );
    }
  }
  let targetTool = opts.open;
  if (!targetTool) {
    const openChoice = await select("Open in AI tool?", [
      { label: c.tool("chatgpt") + "  (chatgpt.com)", value: "chatgpt" },
      { label: c.tool("claude") + "  (claude.ai)", value: "claude" },
      { label: c.tool("gemini") + "  (gemini.google.com)", value: "gemini" },
      { label: import_chalk7.default.dim("Skip \u2014 I'll paste manually"), value: "skip" }
    ]);
    if (openChoice !== "skip") targetTool = openChoice;
  }
  if (targetTool && AI_URLS[targetTool]) {
    openBrowser(AI_URLS[targetTool]);
    console.log(
      c.ok("\u2714") + ` Opening ${c.tool(targetTool)}\u2026 paste the clipboard content to start your session.`
    );
  }
  console.log(
    import_chalk7.default.dim(
      `
  Full context exported to: engram inject ${snap.id.slice(0, 8)} > context.md
`
    )
  );
}
function truncate2(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

// src/commands/ask.ts
var import_chalk8 = __toESM(require("chalk"));
init_ui();
async function askCommand(question, opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  console.log(
    `
  ${c.brand("ENGRAM")} Ask \u2014 ${import_chalk8.default.dim("searching your AI memory\u2026")}
`
  );
  console.log(`  ${import_chalk8.default.italic(import_chalk8.default.cyan('"' + question + '"'))}
`);
  const spin = spinner("Searching + generating answer\u2026");
  try {
    const result = await api.ask(question, opts.scope);
    spin.stop();
    const divider = import_chalk8.default.dim("\u2500".repeat(60));
    console.log(divider);
    result.answer.split("\n").forEach((l) => console.log("  " + l));
    console.log(divider);
    if (result.sources?.length) {
      console.log(import_chalk8.default.dim(`
  Sources (${result.sources.length}):`));
      result.sources.slice(0, 5).forEach((s) => {
        const id = import_chalk8.default.dim(s.id.slice(0, 8));
        const score = s.similarity != null ? import_chalk8.default.dim(` (${(s.similarity * 100).toFixed(0)}%)`) : "";
        console.log(`    ${id}  ${import_chalk8.default.bold(s.title)}${score}`);
      });
    }
    console.log(
      import_chalk8.default.dim(
        `
  engram show <id>   \u2014 view full context for any source
`
      )
    );
  } catch (err) {
    spin.fail(err.message);
    process.exit(1);
  }
}

// src/commands/capture.ts
var fs2 = __toESM(require("fs"));
var import_chalk9 = __toESM(require("chalk"));
init_ui();
async function captureCommand(opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  let raw;
  if (opts.file) {
    raw = fs2.readFileSync(opts.file, "utf8");
  } else if (!process.stdin.isTTY) {
    raw = fs2.readFileSync("/dev/stdin", "utf8");
  } else {
    console.log(
      `
  ${c.brand("ENGRAM")} Capture \u2014 paste your conversation below.
` + import_chalk9.default.dim("  Format: USER: ... (newline) ASSISTANT: ...\n") + import_chalk9.default.dim("  Press Ctrl+D when done.\n")
    );
    const chunks = [];
    process.stdin.setEncoding("utf8");
    await new Promise((res) => {
      process.stdin.on("data", (d) => chunks.push(d));
      process.stdin.on("end", res);
      process.stdin.resume();
    });
    raw = chunks.join("");
  }
  const pairs = parseConversation(raw);
  if (pairs.length === 0) {
    console.error(
      c.err("\u2716 Could not parse conversation.") + import_chalk9.default.dim("\n  Expected format:\n  USER: ...\n  ASSISTANT: ...\n")
    );
    process.exit(1);
  }
  const spin = spinner(`Capturing ${pairs.length} turn${pairs.length !== 1 ? "s" : ""} to ENGRAM\u2026`);
  try {
    const result = await api.capture({
      pairs,
      tool: opts.tool,
      mode: opts.mode
    });
    spin.stop();
    if (result.duplicate) {
      console.log(import_chalk9.default.yellow("\u26A0") + ` Already in ENGRAM: ${import_chalk9.default.bold(result.title)}`);
    } else if (result.updated) {
      console.log(c.ok("\u2714") + ` Updated: ${import_chalk9.default.bold(result.title)}`);
    } else {
      console.log(c.ok("\u2714") + ` Captured: ${import_chalk9.default.bold(result.title)}`);
    }
    console.log(import_chalk9.default.dim(`  ID: ${result.id}`));
    console.log(import_chalk9.default.dim(`  engram show ${result.id.slice(0, 8)} \u2014 view it now`));
  } catch (err) {
    spin.fail(err.message);
    process.exit(1);
  }
}
function parseConversation(raw) {
  const pairs = [];
  const structured = raw.matchAll(
    /^(USER|HUMAN|ASSISTANT|AI|SYSTEM):\s*([\s\S]*?)(?=^(?:USER|HUMAN|ASSISTANT|AI|SYSTEM):|$)/gim
  );
  for (const m of structured) {
    const roleRaw = m[1].toLowerCase();
    const role = roleRaw === "user" || roleRaw === "human" ? "user" : "assistant";
    const content = m[2].trim();
    if (content) pairs.push({ role, content });
  }
  if (pairs.length > 0) return pairs;
  const trimmed = raw.trim();
  if (trimmed) return [{ role: "user", content: trimmed }];
  return [];
}

// src/commands/inject.ts
init_ui();
async function injectCommand(id, opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  let fullId = id;
  if (!fullId) {
    const spin2 = spinner("Fetching latest capture\u2026");
    const { data } = await api.listContexts({ limit: 1 });
    spin2.stop();
    if (!data.length) {
      process.stderr.write(c.err("\u2716 No captures found.\n"));
      process.exit(1);
    }
    fullId = data[0].id;
  } else if (fullId.length < 36) {
    const spin2 = spinner("Resolving ID\u2026");
    const { data } = await api.listContexts({ limit: 100 });
    const match = data.find((s) => s.id.startsWith(fullId));
    spin2.stop();
    if (!match) {
      process.stderr.write(c.err(`\u2716 No capture found with ID starting with "${fullId}"
`));
      process.exit(1);
    }
    fullId = match.id;
  }
  const spin = spinner("Exporting context\u2026");
  try {
    const { content, title } = await api.exportContext(fullId, opts.mode);
    spin.stop();
    process.stdout.write(content + "\n");
    if (opts.copy) {
      const { copyToClipboard: copyToClipboard2 } = await Promise.resolve().then(() => (init_ui(), ui_exports));
      const ok = copyToClipboard2(content);
      if (ok) process.stderr.write(c.ok("\u2714") + ` "${title}" copied to clipboard
`);
    }
  } catch (err) {
    spin.fail(err.message);
    process.exit(1);
  }
}

// src/commands/watch.ts
var import_child_process = require("child_process");
var import_chalk10 = __toESM(require("chalk"));
init_ui();
async function watchCommand(opts) {
  const cfg = requireConfig();
  const api = new EngramAPI(cfg);
  console.log(
    `
  ${c.brand("ENGRAM")} Watch \u2014 monitoring git changes every ${opts.interval}s
` + import_chalk10.default.dim("  Press Ctrl+C to stop\n")
  );
  let lastFiles = [];
  const check = async () => {
    const files = getChangedFiles();
    const changed = JSON.stringify(files.sort()) !== JSON.stringify(lastFiles.sort());
    if (!changed && files.length === 0) return;
    if (!changed) return;
    lastFiles = [...files];
    process.stdout.write("\x1B[2J\x1B[H");
    console.log(
      `
  ${c.brand("ENGRAM")} Watch \u2014 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}
`
    );
    if (files.length === 0) {
      console.log(import_chalk10.default.dim("  No modified files detected.\n"));
      return;
    }
    console.log(import_chalk10.default.bold("  Modified files:\n"));
    files.slice(0, 10).forEach((f) => console.log(`    ${import_chalk10.default.cyan(f)}`));
    if (files.length > 10)
      console.log(import_chalk10.default.dim(`    \u2026 and ${files.length - 10} more`));
    const query = `decisions and context related to: ${files.slice(0, 5).join(", ")}`;
    console.log(`
  ${import_chalk10.default.dim("Searching for relevant captures\u2026")}`);
    try {
      const { data } = await api.listContexts({
        search: files.slice(0, 3).join(" "),
        limit: 5,
        scope: opts.scope
      });
      if (data.length === 0) {
        console.log(import_chalk10.default.dim("\n  No relevant captures found for these files.\n"));
      } else {
        console.log(import_chalk10.default.bold(`
  Relevant captures (${data.length}):
`));
        data.forEach((s) => {
          console.log(
            `    ${import_chalk10.default.dim(s.id.slice(0, 8))}  ${import_chalk10.default.bold(s.title)}`
          );
          console.log(
            `    ${c.tool(s.ai_tool)}  ${import_chalk10.default.dim(relativeTime(s.updated_at ?? s.created_at))}`
          );
          if (s.summary) {
            console.log(
              import_chalk10.default.dim("    " + s.summary.slice(0, 100).replace(/\n/g, " ") + "\u2026")
            );
          }
          console.log();
        });
        console.log(
          import_chalk10.default.dim(`  engram resume \u2014 pick one to continue
`)
        );
      }
    } catch {
      console.log(import_chalk10.default.dim("\n  Could not fetch captures (check connection).\n"));
    }
  };
  await check();
  setInterval(check, opts.interval * 1e3);
  await new Promise(() => {
  });
}
function getChangedFiles() {
  try {
    const output = (0, import_child_process.execSync)("git diff --name-only HEAD 2>/dev/null && git diff --name-only 2>/dev/null", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    return [
      ...new Set(
        output.split("\n").map((f) => f.trim()).filter(Boolean)
      )
    ];
  } catch {
    return [];
  }
}

// src/index.ts
var import_chalk11 = __toESM(require("chalk"));
var program = new import_commander.Command();
program.name("engram").description("ENGRAM CLI \u2014 Git for AI Decisions. Pull context into any terminal.").version("0.1.0");
program.command("login").description("Connect your terminal to your ENGRAM account").option("--api-url <url>", "ENGRAM API URL (skip the interactive prompt)").action((opts) => loginCommand({ apiUrl: opts.apiUrl }));
program.command("logout").description("Clear stored credentials").action(() => logoutCommand());
program.command("list").alias("ls").description("List recent captures").option("-n, --limit <n>", "number of captures to show", "20").option("--tool <tool>", "filter by tool: chatgpt, claude, gemini").option("--team", "show team captures instead of personal").option("-s, --search <query>", "keyword filter").action(
  (opts) => listCommand({
    limit: parseInt(opts.limit, 10),
    tool: opts.tool,
    scope: opts.team ? "team" : "personal",
    search: opts.search
  })
);
program.command("show <id>").description("Show the full context of a capture (short IDs work)").option("--raw", "output raw markdown (useful for piping)").action((id, opts) => showCommand(id, { raw: opts.raw ?? false }));
program.command("search <query>").description("Search captures by keyword").option("-n, --limit <n>", "max results", "10").option("--team", "search team captures").action(
  (query, opts) => searchCommand(query, {
    limit: parseInt(opts.limit, 10),
    scope: opts.team ? "team" : "personal"
  })
);
program.command("resume [id]").description(
  "Resume a context in ChatGPT, Claude, or Gemini. Interactive picker if no ID."
).option("--open <tool>", "open directly in: chatgpt, claude, gemini").option("--no-copy", "do not copy the prompt to clipboard").option("--team", "pick from team captures").action(
  (id, opts) => resumeCommand(id, {
    open: opts.open,
    copy: opts.copy !== false,
    scope: opts.team ? "team" : "personal"
  })
);
program.command("inject [id]").description(
  "Output the handoff brief to stdout (pipe-friendly). Defaults to latest."
).option("--full", "include full raw conversation, not just the brief").option("--copy", "also copy to clipboard").action(
  (id, opts) => injectCommand(id, {
    mode: opts.full ? "full" : "brief",
    copy: opts.copy ?? false
  })
);
program.command("ask <question>").description("Ask a question over your entire capture history using AI").option("--team", "include team captures").option("--all", "search personal + team").action(
  (question, opts) => askCommand(question, {
    scope: opts.all ? "all" : opts.team ? "team" : "personal"
  })
);
program.command("capture").description(
  "Capture a conversation from stdin or a file.\n  Format: USER: ... \\nASSISTANT: ...\n  Example: cat convo.txt | engram capture --tool claude"
).option("--tool <tool>", "source tool: chatgpt, claude, gemini, other", "other").option("--team", "save to team scope").option("--file <path>", "read from file instead of stdin").action(
  (opts) => captureCommand({
    tool: opts.tool,
    mode: opts.team ? "team" : "personal",
    file: opts.file
  })
);
program.command("watch").description(
  "Watch git changes in real-time and surface relevant past decisions"
).option("--interval <s>", "poll interval in seconds", "5").option("--team", "search team captures").action(
  (opts) => watchCommand({
    interval: parseInt(opts.interval, 10),
    scope: opts.team ? "team" : "personal"
  })
);
program.command("status").description("Show current login status").action(() => {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(import_chalk11.default.dim("\n  Not logged in. Run ") + import_chalk11.default.cyan("engram login") + "\n");
  } else {
    console.log(`
  ${import_chalk11.default.hex("#7c3aed").bold("ENGRAM")} \u2014 logged in
`);
    console.log(`  ${import_chalk11.default.dim("User:")}    ${cfg.user_email}`);
    console.log(`  ${import_chalk11.default.dim("API:")}     ${cfg.api_url}`);
    console.log(`  ${import_chalk11.default.dim("Config:")}  ~/.config/engram/config.json
`);
  }
});
program.parse();
