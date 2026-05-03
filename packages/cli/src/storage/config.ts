// src/storage/config.ts
// Reads and writes ~/.engram/config.json
// Single source of truth for all CLI configuration and auth state.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const ENGRAM_DIR = path.join(os.homedir(), '.engram');
export const CONFIG_PATH = path.join(ENGRAM_DIR, 'config.json');
export const DB_PATH = path.join(ENGRAM_DIR, 'engram.db');

export interface EngramConfig {
  // Auth — stored after `engram login`
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  userEmail?: string;

  // AI API keys — user's own keys (optional, used for local streaming)
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;

  // ENGRAM web app backend (the Next.js + Supabase app)
  engramApiUrl: string;       // e.g. https://your-app.vercel.app
  extensionSecret?: string;   // x-engram-secret (from EXTENSION_SECRET env)

  // Supabase direct access (for sync)
  supabaseUrl?: string;
  supabaseAnonKey?: string;

  // CLI preferences
  defaultTool: 'claude' | 'chatgpt' | 'gemini';
  autoCapture: boolean;
  autoInject: boolean;
  streamOutput: boolean;
  maxContextPairs: number;
}

const DEFAULTS: EngramConfig = {
  engramApiUrl: process.env.ENGRAM_API_URL || '',
  extensionSecret: process.env.EXTENSION_SECRET || '',
  defaultTool: 'claude',
  autoCapture: true,
  autoInject: true,
  streamOutput: true,
  maxContextPairs: 8,
};

export function ensureEngramDir(): void {
  if (!fs.existsSync(ENGRAM_DIR)) {
    fs.mkdirSync(ENGRAM_DIR, { recursive: true });
  }
}

export function loadConfig(): EngramConfig {
  ensureEngramDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(updates: Partial<EngramConfig>): void {
  ensureEngramDir();
  const current = loadConfig();
  const updated = { ...current, ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
}

export function isLoggedIn(): boolean {
  const config = loadConfig();
  return !!(config.accessToken && config.userId);
}

export function clearAuth(): void {
  saveConfig({
    accessToken: undefined,
    refreshToken: undefined,
    userId: undefined,
    userEmail: undefined,
  });
}
