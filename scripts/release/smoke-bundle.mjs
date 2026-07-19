import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { assertOnlyOptions, isSafeArchivePath, optionValue, run } from "./release-lib.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
assertOnlyOptions(args, new Map([["--archive", true]]));
const archive = path.resolve(optionValue(args, "--archive"));
const listing = (await run("tar", ["-tzf", archive], { quiet: true })).stdout.trim().split("\n").filter(Boolean);
if (!listing.length || listing.some((entry) => !isSafeArchivePath(entry))) throw new Error("Release archive contains an unsafe path");
if (listing.some((entry) => entry.includes(".test.") || entry.endsWith(".map"))) throw new Error("Release archive contains development test or source-map artifacts");
const root = listing[0].split("/", 1)[0];
if (!root.startsWith("bookforge-")) throw new Error("Release archive does not have a Bookforge root directory");
if (listing.some((entry) => entry.split("/", 1)[0] !== root)) throw new Error("Release archive has multiple top-level paths");

const temporary = await mkdtemp(path.join(tmpdir(), "bookforge-release-smoke-"));
try {
  await run("tar", ["-xzf", archive, "-C", temporary]);
  const entries = await readdir(temporary);
  if (entries.length !== 1 || entries[0] !== root) throw new Error("Unexpected extraction result");
  await access(path.join(temporary, root, "bin", "node")).then(() => {
    throw new Error("Release bundle must not embed a Node.js runtime");
  }).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await run(path.join(temporary, root, "bin", "bookforge"), ["--help"]);
  console.log(`Smoke-tested ${path.basename(archive)}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
