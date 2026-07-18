import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function initProject(target: string): Promise<string> {
  const root = path.resolve(target);
  await mkdir(path.join(root, "chapters"), { recursive: true });
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
  await writeExclusive(path.join(root, "book.yaml"), manifest);
  await writeExclusive(path.join(root, "chapters", "01-opening.md"), chapter);
  return root;
}

async function writeExclusive(file: string, content: string): Promise<void> {
  await writeFile(file, content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`Refusing to overwrite existing file: ${file}`);
    throw error;
  });
}
