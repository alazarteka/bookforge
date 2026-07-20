#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { buildProject } from "./build.js";
import { checkProject } from "./check.js";
import { doctor } from "./doctor.js";
import { importedChapterCount, initProject } from "./init.js";
import { lintProject } from "./lint.js";
import { generateBuiltInThemePreviews, previewProject } from "./preview.js";
import { inspectBuiltInTheme, listBuiltInThemes } from "./theme-loader.js";

const help = `Bookforge — beautiful local-first publishing

Usage:
  bookforge init <directory> [--from-existing <markdown-directory>] [--id <id>] [--title <title>] [--author <name>] [--language <tag>] [--dry-run]
  bookforge build [project] [--format web,epub,pdf] [--theme <id>]
  bookforge preview [project] [--port 4173] [--theme <id>]
  bookforge themes [list]
  bookforge themes show <id>
  bookforge themes preview [project]
  bookforge lint [project]
  bookforge preflight [project]  # alias for lint
  bookforge check [project]
  bookforge doctor
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") { console.log(help); return; }
  if (command === "init") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: {
      "from-existing": { type: "string" }, id: { type: "string" }, title: { type: "string" }, author: { type: "string", multiple: true }, language: { type: "string" }, "dry-run": { type: "boolean" },
    } });
    const target = parsed.positionals[0]; if (!target || parsed.positionals.length > 1) throw new Error("init requires exactly one destination directory");
    const options = {
      ...(parsed.values["from-existing"] ? { fromExisting: parsed.values["from-existing"] } : {}),
      ...(parsed.values.id ? { id: parsed.values.id } : {}),
      ...(parsed.values.title ? { title: parsed.values.title } : {}),
      ...(parsed.values.author?.length ? { authors: parsed.values.author } : {}),
      ...(parsed.values.language ? { language: parsed.values.language } : {}),
      ...(parsed.values["dry-run"] ? { dryRun: true } : {}),
    };
    const chapters = options.fromExisting ? await importedChapterCount(options.fromExisting) : 1;
    const root = await initProject(target, options);
    console.log(options.dryRun ? `Would create ${root} with ${chapters} chapter${chapters === 1 ? "" : "s"}; no files were changed.` : `Created ${root}`); return;
  }
  if (command === "build") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { format: { type: "string" }, theme: { type: "string" } } });
    const formats = parsed.values.format?.split(",").filter(Boolean);
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
  if (command === "lint" || command === "preflight") {
    const root = path.resolve(rest[0] ?? ".");
    if (rest.length > 1) throw new Error(`${command} accepts at most one project directory`);
    const result = await lintProject(root);
    if (result.issues.length) {
      console.error(`Found ${result.issues.length} manuscript problem${result.issues.length === 1 ? "" : "s"}:`);
      for (const issue of result.issues) console.error(`  ${issue.file}: ${issue.message}`);
      process.exitCode = 1;
    } else console.log(`✓ ${result.chapters} chapter${result.chapters === 1 ? "" : "s"} passed manuscript validation`);
    return;
  }
  if (command === "doctor") { if (!await doctor()) process.exitCode = 1; return; }
  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error) => { console.error(`bookforge: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
