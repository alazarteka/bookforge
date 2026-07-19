#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { buildProject, type Format } from "./build.js";
import { checkProject } from "./check.js";
import { doctor } from "./doctor.js";
import { initProject } from "./init.js";
import { generateBuiltInThemePreviews, previewProject } from "./preview.js";
import { inspectBuiltInTheme, listBuiltInThemes } from "./theme-loader.js";

const help = `Bookforge — beautiful local-first publishing

Usage:
  bookforge init <directory>
  bookforge build [project] [--format web,epub,pdf]
  bookforge preview [project] [--port 4173] [--theme <id>]
  bookforge themes [list]
  bookforge themes show <id>
  bookforge themes preview [project]
  bookforge check [project]
  bookforge doctor
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") { console.log(help); return; }
  if (command === "init") {
    const target = rest[0]; if (!target) throw new Error("init requires a directory");
    console.log(`Created ${await initProject(target)}`); return;
  }
  if (command === "build") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { format: { type: "string" }, theme: { type: "string" } } });
    const formats = parsed.values.format?.split(",").filter(Boolean) as Format[] | undefined;
    const destination = await buildProject(parsed.positionals[0] ?? ".", formats, parsed.values.theme);
    console.log(`Built ${destination}`); return;
  }
  if (command === "preview") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { port: { type: "string" }, theme: { type: "string" } } });
    const port = Number(parsed.values.port ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535");
    await previewProject(parsed.positionals[0] ?? ".", port, parsed.values.theme); return;
  }
  if (command === "themes") {
    const [subcommand, ...themeArgs] = rest;
    if (!subcommand || subcommand === "list") {
      if (themeArgs.length) throw new Error("themes list does not take arguments");
      for (const theme of await listBuiltInThemes()) console.log(`${theme.id}\t${theme.name}\tv${theme.version}`);
      return;
    }
    if (subcommand === "show") {
      const id = themeArgs[0]; if (!id || themeArgs.length !== 1) throw new Error("themes show requires exactly one theme id");
      const theme = await inspectBuiltInTheme(id);
      console.log(`Name: ${theme.name}\nID: ${theme.id}\nVersion: ${theme.version}\nStyles:\n${theme.styles.map((style) => `  - ${style}`).join("\n")}\nAssets (${theme.assets.length}):\n${theme.assets.map((asset) => `  - ${asset}`).join("\n")}`);
      return;
    }
    if (subcommand === "preview") {
      const parsed = parseArgs({ args: themeArgs, allowPositionals: true, options: {} });
      if (parsed.positionals.length > 1) throw new Error("themes preview accepts at most one project path");
      const destination = await generateBuiltInThemePreviews(parsed.positionals[0] ?? ".");
      console.log(`Generated built-in theme previews in ${destination}`);
      return;
    }
    throw new Error(`Unknown themes command: ${subcommand}`);
  }
  if (command === "check") {
    const root = path.resolve(rest[0] ?? ".");
    const checked = await checkProject(root);
    console.log(`✓ ${checked.sections} sections and ${checked.assets} assets are valid`); return;
  }
  if (command === "doctor") { if (!await doctor()) process.exitCode = 1; return; }
  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error) => { console.error(`bookforge: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
