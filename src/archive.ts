import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { assertStoredSealMatchesArtifacts } from "./seal.js";
import { sourceEpochDate } from "./util.js";

export async function archiveProject(project: string, label?: string): Promise<string> {
  const root = path.resolve(project);
  const config = await loadConfig(root);
  const dist = path.join(root, "dist");
  if (!(await stat(dist).catch(() => undefined))?.isDirectory()) {
    throw new Error("No dist/ build found. Run `bookforge build` before `bookforge archive`.");
  }
  const seal = await assertStoredSealMatchesArtifacts(dist);
  const stamp = sourceEpochDate().toISOString().slice(0, 10);
  const version = label ?? seal.sourceHash.slice(0, 8);
  const folderName = `${config.id}-${version}-${stamp}`.replace(/[^\w.-]+/g, "-");
  const archives = path.join(root, "archives");
  const destination = path.join(archives, folderName);
  await mkdir(archives, { recursive: true });
  if (await stat(destination).catch(() => undefined)) {
    throw new Error(`Archive already exists: ${destination}. Choose a different --label.`);
  }

  const stage = await mkdtemp(path.join(archives, ".bookforge-archive-"));
  const indexStage = await mkdtemp(path.join(archives, ".bookforge-index-"));
  let published = false;
  try {
    await cp(dist, path.join(stage, "dist"), { recursive: true });
    await cp(path.join(root, "book.yaml"), path.join(stage, "book.yaml"));
    try {
      await cp(path.join(root, "theme"), path.join(stage, "theme"), { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const indexPath = path.join(archives, "INDEX.md");
    const previous = await readFile(indexPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "# Archives\n\n";
      throw error;
    });
    const line = `- \`${folderName}\` — ${config.title} (${stamp}, seal ${seal.sourceHash.slice(0, 12)})\n`;
    const nextIndex = previous.endsWith("\n") ? `${previous}${line}` : `${previous}\n${line}`;
    const stagedIndex = path.join(indexStage, "INDEX.md");
    await writeFile(stagedIndex, nextIndex);

    try {
      await rename(stage, destination);
    } catch (error) {
      if (await stat(destination).catch(() => undefined)) {
        throw new Error(`Archive already exists: ${destination}. Choose a different --label.`, { cause: error });
      }
      throw error;
    }
    try {
      await rename(stagedIndex, indexPath);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
    published = true;
    return destination;
  } finally {
    if (!published) await rm(stage, { recursive: true, force: true });
    await rm(indexStage, { recursive: true, force: true });
  }
}
