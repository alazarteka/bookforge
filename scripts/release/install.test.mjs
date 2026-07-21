import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { repositoryRoot, run, targetForHost } from "./release-lib.mjs";

test("installer accepts manually downloaded private-release assets without curl", async (t) => {
  let target;
  try {
    target = targetForHost(process.platform, process.arch, process.platform !== "linux" || Boolean(process.report?.getReport?.().header?.glibcVersionRuntime));
  } catch {
    t.skip("host is not a supported release target");
    return;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "bookforge-install-"));
  try {
    const version = "1.2.3";
    const root = `bookforge-${version}-${target}`;
    const assets = path.join(temporary, "assets");
    const bundle = path.join(temporary, root);
    const home = path.join(temporary, "home");
    const bin = path.join(temporary, "bin");
    const asset = `bookforge-${version}-${target}.tar.gz`;
    await mkdir(path.join(bundle, "bin"), { recursive: true });
    await mkdir(path.join(bundle, "lib"), { recursive: true });
    await mkdir(path.join(bundle, "docs"), { recursive: true });
    await mkdir(assets);
    await writeFile(path.join(bundle, "bin", "bookforge"), "#!/usr/bin/env sh\nprintf 'fixture\\n'\n");
    await chmod(path.join(bundle, "bin", "bookforge"), 0o755);
    await writeFile(path.join(bundle, "lib", "cli.js"), "// fixture\n");
    await writeFile(path.join(bundle, "docs", "RELEASES.md"), "# Release guide\n");
    await writeFile(path.join(bundle, "release-manifest.json"), `${JSON.stringify({ version, target })}\n`);
    const bulk = path.join(bundle, "bulk");
    await mkdir(bulk);
    for (let offset = 0; offset < 5_000; offset += 250) {
      await Promise.all(Array.from({ length: 250 }, (_, index) => {
        const sequence = String(offset + index).padStart(5, "0");
        return writeFile(path.join(bulk, `${sequence}-${"x".repeat(180)}`), "");
      }));
    }
    await run("tar", ["-C", temporary, "-czf", path.join(assets, asset), root], { quiet: true });
    const listing = await run("tar", ["-tzf", path.join(assets, asset)], { quiet: true });
    assert.ok(Buffer.byteLength(listing.stdout) > 1024 * 1024, "fixture must exceed Node's former execFileSync buffer");
    const sha256 = createHash("sha256").update(await readFile(path.join(assets, asset))).digest("hex");
    await writeFile(path.join(assets, "bookforge-release-manifest.json"), `${JSON.stringify({ version, targets: { [target]: { asset, sha256 } } })}\n`);

    await run("bash", [path.join(repositoryRoot, "scripts", "release", "install.sh"), "--assets-dir", assets, "--home", home, "--bin-dir", bin], { quiet: true });
    assert.equal((await run(path.join(bin, "bookforge"), [], { quiet: true })).stdout, "fixture\n");
    assert.equal(await readFile(path.join(home, "install-state.json"), "utf8").then(JSON.parse).then((state) => state.manualAssets), true);
    assert.equal(await readlink(path.join(home, "current")), path.join(home, "releases", `v${version}`, target));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
