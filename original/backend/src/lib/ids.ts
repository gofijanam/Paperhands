import { randomBytes } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}${randomBytes(10).toString("hex")}`;
}

export function nowIso(d = new Date()): string {
  return d.toISOString();
}
