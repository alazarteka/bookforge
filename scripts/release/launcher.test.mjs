import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "./release-lib.mjs";

async function execute(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("launcher resolves a relative file symlink without GNU readlink -f", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "bookforge-launcher-"));
  try {
    const bundle = path.join(temporary, "bundle");
    const shim = path.join(temporary, "bin");
    const tools = path.join(temporary, "tools");
    await mkdir(path.join(bundle, "bin"), { recursive: true });
    await mkdir(path.join(bundle, "lib"), { recursive: true });
    await mkdir(shim);
    await mkdir(tools);
    await cp(path.join(repositoryRoot, "bin", "bookforge"), path.join(bundle, "bin", "bookforge"));
    await chmod(path.join(bundle, "bin", "bookforge"), 0o755);
    await writeFile(path.join(bundle, "lib", "cli.js"), "process.stdout.write(JSON.stringify({ file: import.meta.filename, args: process.argv.slice(2) }));\n");
    await symlink("../bundle/bin/bookforge", path.join(shim, "bookforge"));
    // BSD readlink (macOS) has no -f option. This shim rejects options so the
    // launcher test also guards that portability constraint.
    await writeFile(path.join(tools, "readlink"), "#!/usr/bin/env sh\ncase ${1:-} in -*) exit 64;; esac\n[ $# -eq 1 ] || exit 64\nexec /usr/bin/readlink \"$1\"\n");
    await chmod(path.join(tools, "readlink"), 0o755);

    const result = await execute(path.join(shim, "bookforge"), ["fixture"], {
      env: { ...process.env, PATH: `${tools}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { file: await realpath(path.join(bundle, "lib", "cli.js")), args: ["fixture"] });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
