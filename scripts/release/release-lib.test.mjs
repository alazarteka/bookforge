import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isSafeArchivePath, normalizeVersion, releaseAssetName, releaseTargets, targetForHost } from "./release-lib.mjs";

function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}: ${stderr}`)); else resolve(stdout);
    });
    child.once("error", reject);
  });
}

test("normalizes supported release versions", () => {
  assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeVersion("1.2.3-rc.1"), "1.2.3-rc.1");
  assert.throws(() => normalizeVersion("latest"), /Invalid release version/);
});

test("maps only supported release hosts", () => {
  assert.equal(targetForHost("darwin", "arm64"), "darwin-arm64");
  assert.equal(targetForHost("darwin", "x64"), "darwin-x64");
  assert.equal(targetForHost("linux", "x64"), "linux-x64-gnu");
  assert.throws(() => targetForHost("linux", "arm64"), /Unsupported platform/);
});

test("rejects traversal in release archive paths", () => {
  assert.equal(isSafeArchivePath("bookforge-1.2.3/bin/bookforge"), true);
  assert.equal(isSafeArchivePath("bookforge-1.2.3/bin/"), true);
  assert.equal(isSafeArchivePath("../bookforge"), false);
  assert.equal(isSafeArchivePath("bookforge/../../etc/passwd"), false);
  assert.equal(isSafeArchivePath("/tmp/bookforge"), false);
  assert.equal(releaseAssetName("1.2.3", "darwin-arm64"), "bookforge-1.2.3-darwin-arm64.tar.gz");
});

test("aggregates all target manifests and checksums without network access", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bookforge-release-manifest-"));
  try {
    for (const target of Object.keys(releaseTargets)) {
      const asset = releaseAssetName("0.1.0", target);
      await writeFile(path.join(directory, `${asset}.manifest.json`), `${JSON.stringify({
        schema: 1, version: "0.1.0", target, asset, sha256: "a".repeat(64), requirements: {},
      })}\n`);
    }
    await writeFile(path.join(directory, "bookforge-install.sh"), "#!/usr/bin/env bash\n");
    await command(process.execPath, [path.resolve(import.meta.dirname, "create-release-manifest.mjs"), "--input", directory, "--output", directory]);
    const aggregate = JSON.parse(await readFile(path.join(directory, "bookforge-release-manifest.json"), "utf8"));
    assert.deepEqual(Object.keys(aggregate.targets).sort(), Object.keys(releaseTargets).sort());
    const checksums = await readFile(path.join(directory, "SHA256SUMS"), "utf8");
    assert.match(checksums, /bookforge-install\.sh/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
