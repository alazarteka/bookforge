import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../..");
export const requiredNodeVersion = "24.18.0";

export const releaseTargets = Object.freeze({
  "darwin-arm64": { os: "darwin", arch: "arm64", runner: "macos-14" },
  "darwin-x64": { os: "darwin", arch: "x64", runner: "macos-13" },
  "linux-x64-gnu": { os: "linux", arch: "x64", libc: "glibc", runner: "ubuntu-24.04" },
});

export function releaseAssetName(version, target) {
  return `bookforge-${version}-${target}.tar.gz`;
}

export function targetForHost(platform, arch, glibc = true) {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64" && glibc) return "linux-x64-gnu";
  throw new Error(`Unsupported platform: ${platform}-${arch}${platform === "linux" ? " (requires glibc)" : ""}`);
}

export function normalizeVersion(value) {
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) throw new Error(`Invalid release version: ${value}`);
  return normalized;
}

export function releaseTag(version) {
  return `v${normalizeVersion(version)}`;
}

export async function readPackage(root = repositoryRoot) {
  return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
}

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export async function mustExist(file, label = file) {
  await access(file).catch(() => { throw new Error(`Missing ${label}: ${file}`); });
}

export async function run(command, args, { cwd = repositoryRoot, env = process.env, quiet = false } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    if (quiet) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export function optionValue(args, option, fallback) {
  const index = args.indexOf(option);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function assertOnlyOptions(args, allowed) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (!allowed.get(arg)) continue;
    index += 1;
    if (index >= args.length || args[index].startsWith("--")) throw new Error(`${arg} requires a value`);
  }
}

export function releaseRequirements() {
  return {
    node: requiredNodeVersion,
    pandoc: "3.7.0.2",
    epubcheck: "5.3.0 with Java",
    browser: "Google Chrome or Chromium",
    poppler: "pdfinfo and pdftoppm",
  };
}

export function isSafeArchivePath(entry) {
  const normalized = entry.replace(/\/+$/, "");
  return Boolean(normalized)
    && !normalized.startsWith("/")
    && !normalized.startsWith("\\")
    && !normalized.split("/").some((part) => part === "..");
}
