import { chmod, cp, mkdtemp, mkdir, readdir, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assertTargetMatchesHost,
  assertOnlyOptions,
  mustExist,
  optionValue,
  readPackage,
  releaseAssetName,
  releaseRequirements,
  releaseTag,
  releaseTargets,
  repositoryRoot,
  requiredNodeVersion,
  run,
  sha256File,
} from "./release-lib.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const allowed = new Map([["--target", true], ["--output", true]]);
assertOnlyOptions(args, allowed);
const target = optionValue(args, "--target");
const output = path.resolve(optionValue(args, "--output", path.join(repositoryRoot, "dist", "release")));
if (!Object.hasOwn(releaseTargets, target)) throw new Error(`Unknown release target: ${target}`);
if (process.versions.node !== requiredNodeVersion) {
  throw new Error(`Release bundles require Node.js ${requiredNodeVersion}; found ${process.versions.node}`);
}
assertTargetMatchesHost(target);

const packageJson = await readPackage();
const version = packageJson.version;
const bundleName = `bookforge-${version}-${target}`;
const assetName = releaseAssetName(version, target);
const temporary = await mkdtemp(path.join(tmpdir(), "bookforge-release-"));
const deployed = path.join(temporary, bundleName);

try {
  await mustExist(path.join(repositoryRoot, "lib", "cli.js"), "compiled CLI; run pnpm run build first");
  await run("pnpm", ["--filter", packageJson.name, "deploy", "--prod", "--legacy", deployed]);
  await pruneReleaseOnlyArtifacts(deployed);

  await mkdir(path.join(deployed, "bin"), { recursive: true });
  await mkdir(path.join(deployed, "installer"), { recursive: true });
  await cp(path.join(repositoryRoot, "bin", "bookforge"), path.join(deployed, "bin", "bookforge"));
  await cp(path.join(repositoryRoot, "scripts", "release", "install.sh"), path.join(deployed, "installer", "install.sh"));
  await cp(path.join(repositoryRoot, "scripts", "release", "manage.sh"), path.join(deployed, "installer", "manage.sh"));
  await chmod(path.join(deployed, "bin", "bookforge"), 0o755);
  await chmod(path.join(deployed, "installer", "install.sh"), 0o755);
  await chmod(path.join(deployed, "installer", "manage.sh"), 0o755);

  const manifest = {
    schema: 1,
    name: packageJson.name,
    version,
    tag: releaseTag(version),
    target,
    node: requiredNodeVersion,
    sourceCommit: process.env.GITHUB_SHA ?? "local",
    requirements: releaseRequirements(),
    management: { update: "bookforge update [--check] [--version vX.Y.Z]", rollback: "bookforge rollback" },
  };
  await writeFile(path.join(deployed, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  await mkdir(output, { recursive: true });
  const temporaryArchive = path.join(temporary, assetName);
  await run("tar", ["-C", temporary, "-czf", temporaryArchive, bundleName]);
  const checksum = await sha256File(temporaryArchive);
  await writeFile(path.join(temporary, `${assetName}.sha256`), `${checksum}  ${assetName}\n`);
  await writeFile(path.join(temporary, `${assetName}.manifest.json`), `${JSON.stringify({ ...manifest, asset: assetName, sha256: checksum }, null, 2)}\n`);

  for (const file of [assetName, `${assetName}.sha256`, `${assetName}.manifest.json`]) {
    await rm(path.join(output, file), { force: true });
    await rename(path.join(temporary, file), path.join(output, file));
  }
  console.log(`Built ${path.join(output, assetName)}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function pruneReleaseOnlyArtifacts(deployed) {
  const entries = await readdir(deployed, { recursive: true });
  const unwanted = entries.filter((entry) => entry.includes(".test.") || entry.endsWith(".map"));
  await Promise.all(unwanted.map((entry) => rm(path.join(deployed, entry), { force: true })));
  const remaining = await readdir(deployed, { recursive: true });
  const leaked = remaining.filter((entry) => entry.includes(".test.") || entry.endsWith(".map"));
  if (leaked.length) throw new Error(`Release bundle still contains development artifacts: ${leaked.join(", ")}`);
}
