import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { loadReleaseSeal } from "./seal.js";
import { sourceEpochDate } from "./util.js";

export async function archiveProject(project: string, label?: string): Promise<string> {
  const root = path.resolve(project);
  const config = await loadConfig(root);
  const dist = path.join(root, "dist");
  const seal = await loadReleaseSeal(path.join(dist, "release-seal.json")).catch(() => undefined);
  const stamp = sourceEpochDate().toISOString().slice(0, 10);
  const version = label ?? seal?.sourceHash.slice(0, 8) ?? "build";
  const folderName = `${config.id}-${version}-${stamp}`.replace(/[^\w.-]+/g, "-");
  const archives = path.join(root, "archives");
  const destination = path.join(archives, folderName);
  await mkdir(destination, { recursive: true });
  await cp(dist, path.join(destination, "dist"), { recursive: true });
  await cp(path.join(root, "book.yaml"), path.join(destination, "book.yaml"));
  const themeDir = path.join(root, "theme");
  await cp(themeDir, path.join(destination, "theme"), { recursive: true }).catch(() => undefined);
  const indexPath = path.join(archives, "INDEX.md");
  const previous = await readFile(indexPath, "utf8").catch(() => "# Archives\n\n");
  const line = `- \`${folderName}\` — ${config.title} (${stamp}${seal ? `, seal ${seal.sourceHash.slice(0, 12)}` : ""})\n`;
  if (!previous.includes(folderName)) await writeFile(indexPath, previous.endsWith("\n") ? `${previous}${line}` : `${previous}\n${line}`);
  return destination;
}
