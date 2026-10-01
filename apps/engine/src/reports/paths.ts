import { resolve, sep } from "node:path";
import { OctoError } from "../errors.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function safePathSegment(value: string): string {
  if (!SAFE_ID.test(value)) throw new OctoError("unsafe_path", value);
  return value;
}

export function resolveInside(root: string, ...parts: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...parts);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new OctoError("unsafe_path", target);
  }
  return target;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
