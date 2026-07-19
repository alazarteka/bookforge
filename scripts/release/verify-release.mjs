import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { mustExist, readPackage, releaseTag, repositoryRoot, requiredNodeVersion } from "./release-lib.mjs";

const expectedTag = process.env.RELEASE_TAG ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
const packageJson = await readPackage();

if (packageJson.private !== true) throw new Error("GitHub Releases distribution requires package.json to remain private");
if (process.versions.node !== requiredNodeVersion) {
  throw new Error(`Release commands require Node.js ${requiredNodeVersion}; found ${process.versions.node}`);
}
if (expectedTag && expectedTag !== releaseTag(packageJson.version)) {
  throw new Error(`Release tag ${expectedTag} does not match package version ${packageJson.version}`);
}
const source = await readFile(path.join(repositoryRoot, "src", "util.ts"), "utf8");
const runtimeVersion = source.match(/export const BOOKFORGE_VERSION = "([^"]+)";/)?.[1];
if (runtimeVersion !== packageJson.version) {
  throw new Error(`Runtime version ${runtimeVersion ?? "missing"} does not match package version ${packageJson.version}`);
}
await mustExist(new URL("../../LICENSE", import.meta.url), "MIT license");
await mustExist(new URL("../../bin/bookforge", import.meta.url), "release launcher");
await mustExist(new URL("../../scripts/release/install.sh", import.meta.url), "release installer");
await mustExist(new URL("../../themes", import.meta.url), "bundled themes");
await mustExist(new URL("../../profiles", import.meta.url), "bundled profiles");
console.log(`Release metadata verified for ${packageJson.name}@${packageJson.version} in ${repositoryRoot}`);
