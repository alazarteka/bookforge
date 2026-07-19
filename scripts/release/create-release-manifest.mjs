import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { assertOnlyOptions, optionValue, readPackage, releaseAssetName, releaseTag, releaseTargets, repositoryRoot, sha256File } from "./release-lib.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
assertOnlyOptions(args, new Map([["--input", true], ["--output", true]]));
const input = path.resolve(optionValue(args, "--input", path.join(repositoryRoot, "dist", "release")));
const output = path.resolve(optionValue(args, "--output", input));
const packageJson = await readPackage();
const version = packageJson.version;
const manifests = (await readdir(input)).filter((file) => file.endsWith(".manifest.json") && file !== "bookforge-release-manifest.json");
const targets = {};

for (const file of manifests) {
  const manifest = JSON.parse(await readFile(path.join(input, file), "utf8"));
  if (manifest.version !== version || !Object.hasOwn(releaseTargets, manifest.target)) continue;
  const expectedAsset = releaseAssetName(version, manifest.target);
  if (manifest.asset !== expectedAsset || typeof manifest.sha256 !== "string") throw new Error(`Invalid target manifest: ${file}`);
  targets[manifest.target] = { asset: manifest.asset, sha256: manifest.sha256, requirements: manifest.requirements };
}

const missing = Object.keys(releaseTargets).filter((target) => !Object.hasOwn(targets, target));
if (missing.length) throw new Error(`Missing release bundles: ${missing.join(", ")}`);
const sourceEpoch = process.env.SOURCE_DATE_EPOCH;
const generatedAt = sourceEpoch ? new Date(Number(sourceEpoch) * 1000).toISOString() : new Date().toISOString();
const aggregate = { schema: 1, name: packageJson.name, version, tag: releaseTag(version), generatedAt, targets };
await writeFile(path.join(output, "bookforge-release-manifest.json"), `${JSON.stringify(aggregate, null, 2)}\n`);

const checksumLines = [];
for (const target of Object.keys(releaseTargets)) checksumLines.push(`${targets[target].sha256}  ${targets[target].asset}`);
const installer = path.join(output, "bookforge-install.sh");
if (await access(installer).then(() => true).catch(() => false)) {
  checksumLines.push(`${await sha256File(installer)}  bookforge-install.sh`);
}
await writeFile(path.join(output, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
console.log(`Wrote release manifest for ${version}`);
