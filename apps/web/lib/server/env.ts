import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

function applyEnvFile(path: string) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

export function loadServerEnv() {
  if (loaded) return;
  loaded = true;
  applyEnvFile(resolve(process.cwd(), ".env"));
  applyEnvFile(resolve(process.cwd(), "../../.env"));
  if (process.env.INIT_CWD) applyEnvFile(resolve(process.env.INIT_CWD, ".env"));
}
