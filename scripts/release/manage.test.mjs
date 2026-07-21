import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryRoot, run } from "./release-lib.mjs";

test("manager supports per-release state with a legacy shared-state fallback", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "bookforge-manage-"));
  try {
    const home = path.join(temporary, "home");
    const root = path.join(home, "releases", "v1.2.3", "test-target");
    const installer = path.join(root, "installer");
    const manager = path.join(installer, "manage.sh");
    const sharedState = path.join(home, "install-state.json");
    const releaseState = path.join(root, "install-state.json");
    const baseState = {
      schema: 1,
      baseUrl: "https://github.com/alazarteka/bookforge",
      binDir: path.join(temporary, "bin"),
      target: "test-target",
      version: "1.2.3",
      manualAssets: false,
    };
    await mkdir(installer, { recursive: true });
    await copyFile(path.join(repositoryRoot, "scripts", "release", "manage.sh"), manager);
    await writeFile(path.join(installer, "install.sh"), "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\"\n");
    await chmod(path.join(installer, "install.sh"), 0o755);

    await writeFile(sharedState, `${JSON.stringify({ ...baseState, manualAssets: true })}\n`);
    await writeFile(releaseState, `${JSON.stringify(baseState)}\n`);
    const preferred = await run("bash", [manager, "update", "--check"], {
      env: { ...process.env, BOOKFORGE_HOME: home },
      quiet: true,
    });
    assert.match(preferred.stdout, /--check/);

    await unlink(releaseState);
    await writeFile(sharedState, `${JSON.stringify(baseState)}\n`);
    const fallback = await run("bash", [manager, "update", "--check"], {
      env: { ...process.env, BOOKFORGE_HOME: home },
      quiet: true,
    });
    assert.match(fallback.stdout, /--check/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
