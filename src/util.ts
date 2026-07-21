import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const BOOKFORGE_VERSION = "0.2.0";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

export function escapeXml(value: string): string {
  return escapeHtml(value);
}

export function slugify(value: string): string {
  const slug = value.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function inlineText(inlines: Array<{ type: string; value?: string; children?: unknown[] }>): string {
  return inlines.map((inline) => {
    if (inline.type === "text" || inline.type === "code") return inline.value ?? "";
    if (inline.type === "space" || inline.type === "softBreak" || inline.type === "lineBreak") return " ";
    if (Array.isArray(inline.children)) return inlineText(inline.children as never[]);
    return "";
  }).join("").replace(/\s+/g, " ").trim();
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function fileHash(file: string): Promise<string> {
  return sha256(await readFile(file));
}

export function containedPath(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error(`Absolute paths are not allowed: ${relative}`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!isContained(resolvedRoot, resolved)) {
    throw new Error(`Path escapes project root: ${relative}`);
  }
  const canonicalRoot = realPath(resolvedRoot);
  const canonicalPath = realPath(resolved);
  if (canonicalRoot && canonicalPath && !isContained(canonicalRoot, canonicalPath)) {
    throw new Error(`Path escapes project root through a symbolic link: ${relative}`);
  }
  return resolved;
}

function isContained(root: string, candidate: string): boolean {
  const relation = path.relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation));
}

function realPath(file: string): string | undefined {
  try { return realpathSync.native(file); } catch { return undefined; }
}

export async function ensureFile(file: string, label = "File"): Promise<void> {
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${label} does not exist: ${file}`);
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export interface CommandResult { stdout: string; stderr: string; code: number }

export async function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); if (!options.quiet) process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); if (!options.quiet) process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export function commandVersion(output: string): string {
  return output.trim().split(/\r?\n/, 1)[0] ?? "unknown";
}

export function sourceEpochDate(): Date {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (!raw) return new Date();
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("SOURCE_DATE_EPOCH must be a non-negative number");
  return new Date(seconds * 1000);
}

export async function atomicReplaceDirectory(stage: string, target: string, previous: string): Promise<void> {
  await rm(previous, { recursive: true, force: true });
  await rename(target, previous).catch(() => undefined);
  try {
    await rename(stage, target);
  } catch (error) {
    await rename(previous, target).catch(() => undefined);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}
