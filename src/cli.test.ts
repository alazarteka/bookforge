import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = path.join(import.meta.dirname, "cli.js");

interface CliResult { code: number; stdout: string; stderr: string }

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const result = error as Error & { code?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      code: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
    };
  }
}

test("CLI rejects extra project paths before running commands", async () => {
  for (const args of [
    ["build", "first", "second"],
    ["preview", "first", "second"],
    ["doctor", "extra"],
  ]) {
    const result = await runCli(args);
    assert.equal(result.code, 1, args.join(" "));
    assert.match(result.stderr, /at most one project directory|does not take arguments/);
  }
});

test("build and gift reject malformed explicit format lists", async () => {
  for (const command of ["build", "gift"]) {
    for (const [format, message] of [
      ["", /non-empty comma-separated list/],
      ["web,,epub", /non-empty comma-separated list/],
      ["web,web", /must not contain duplicates/],
      ["web,print", /Unknown formats: print/],
    ] as const) {
      const result = await runCli([command, "--format", format]);
      assert.equal(result.code, 1, `${command} --format ${format}`);
      assert.match(result.stderr, message);
    }
  }
});

test("init rejects explicitly blank metadata and import flags", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "bookforge-cli-init-"));
  try {
    for (const [flag, message] of [
      ["--id", /Invalid book id/],
      ["--title", /Book title must not be empty/],
      ["--author", /Author names must not be empty/],
      ["--language", /Language must be a language tag/],
      ["--from-existing", /Markdown source directory must not be empty/],
    ] as const) {
      const target = path.join(parent, flag.slice(2));
      const result = await runCli(["init", target, flag, ""]);
      assert.equal(result.code, 1, flag);
      assert.match(result.stderr, message);
      await assert.rejects(access(target));
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
