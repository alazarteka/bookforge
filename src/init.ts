import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function initProject(target: string): Promise<string> {
  const root = path.resolve(target);
  if (await lstat(root).then(() => true).catch(() => false)) throw new Error(`Refusing to initialize an existing directory: ${root}`);
  await mkdir(path.dirname(root), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(root), `.${path.basename(root)}.bookforge-init-`));
  const manifest = `schema: 1
id: my-book
title: My Book
subtitle: A Bookforge edition
language: en
authors:
  - name: Your Name
theme: classic
chapters:
  - id: opening
    path: chapters/01-opening.md
    role: bodymatter
outputs:
  web: {}
  epub: {}
  pdf:
    profile: screen-a5
`;
  const chapter = `# Opening

Begin your book here. Bookforge turns this manuscript into a browser reader,
an EPUB, and a PDF from the same semantic source.

---

This rule becomes a scene break in every format.
`;
  try {
    await mkdir(path.join(stage, "chapters"));
    await writeFile(path.join(stage, "book.yaml"), manifest, { flag: "wx" });
    await writeFile(path.join(stage, "chapters", "01-opening.md"), chapter, { flag: "wx" });
    await rename(stage, root);
    return root;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
