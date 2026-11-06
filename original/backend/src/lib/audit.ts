import type { Db } from "../db.js";
import { id, nowIso } from "./ids.js";

export function audit(db: Db, actor: string, action: string, detail: Record<string, unknown>) {
  db.prepare(`INSERT INTO audit_log (id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)`).run(
    id("aud_"),
    nowIso(),
    actor,
    action,
    JSON.stringify(detail),
  );
}
