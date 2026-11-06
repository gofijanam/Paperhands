import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Load KEY=VALUE lines from a secrets file into process.env without overwriting
 * already-set vars. Never logs values.
 */
export function loadEnvFile(filePath: string): { loaded: string[]; missing: boolean } {
  if (!fs.existsSync(filePath)) return { loaded: [], missing: true };
  const text = fs.readFileSync(filePath, "utf8");
  const loaded: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
      loaded.push(key);
    }
  }
  return { loaded, missing: false };
}

export function loadHeliusSecrets(): { keys: string[] } {
  const p = path.join(os.homedir(), ".secrets", "helius.env");
  const r = loadEnvFile(p);
  return { keys: r.loaded };
}
