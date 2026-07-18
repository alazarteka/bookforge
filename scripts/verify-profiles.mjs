import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fixture = path.join(root, "tests", "fixtures", "synthetic");
const output = path.join(root, "tmp", "profile-check");
const profiles = ["screen-a5", "paperback-7x10", "paperback-b5", "coil-letter"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const profile of profiles) {
  const project = path.join(output, profile);
  await cp(fixture, project, { recursive: true });
  await rm(path.join(project, "dist"), { recursive: true, force: true });
  const manifestFile = path.join(project, "book.yaml");
  const manifest = (await readFile(manifestFile, "utf8")).replace("profile: screen-a5", `profile: ${profile}`);
  await writeFile(manifestFile, manifest);
  await command(process.execPath, [path.join(root, "lib", "cli.js"), "build", project, "--format", "pdf"]);
}

function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: "inherit", env: { ...process.env, SOURCE_DATE_EPOCH: "0" } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited with ${code}`)));
  });
}
