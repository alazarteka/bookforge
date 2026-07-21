#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { archiveProject } from "./archive.js";
import { buildProject } from "./build.js";
import { checkProject } from "./check.js";
import { driftReport, formatProofDiff, proofDiff } from "./diff.js";
import { doctor } from "./doctor.js";
import { giftProject } from "./gift.js";
import { importedChapterCount, initProject } from "./init.js";
import { lintProject } from "./lint.js";
import { generateBuiltInThemePreviews, previewProject } from "./preview.js";
import { formatPulse, statusProject } from "./status.js";
import { inspectBuiltInTheme, listBuiltInThemes } from "./theme-loader.js";
import { testBuiltInThemes } from "./theme-contract.js";

const help = `Bookforge — beautiful local-first publishing

Usage:
  bookforge init <directory> [--from-existing <markdown-directory>] [--id <id>] [--title <title>] [--author <name>] [--language <tag>] [--dry-run]
  bookforge build [project] [--format web,epub,pdf] [--theme <id>] [--include-drafts] [--edition <id>] [--all-editions]
  bookforge preview [project] [--port 4173] [--theme <id>]
  bookforge status [project]
  bookforge gift [project] [--to <name>] [--format web,epub,pdf] [--output <file>]
  bookforge archive [project] [--label <name>]
  bookforge diff [project] [--against <path>]
  bookforge drift [project]
  bookforge themes [list]
  bookforge themes show <id>
  bookforge themes preview [project]
  bookforge themes test
  bookforge lint [project] [--ship]
  bookforge preflight [project] [--ship]  # alias for lint
  bookforge check [project] [--ship] [--seal]
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
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        format: { type: "string" },
        theme: { type: "string" },
        "include-drafts": { type: "boolean" },
        edition: { type: "string" },
        "all-editions": { type: "boolean" },
      },
    });
    const formats = parsed.values.format?.split(",").filter(Boolean);
    const destination = await buildProject(parsed.positionals[0] ?? ".", formats, parsed.values.theme, {
      includeDrafts: parsed.values["include-drafts"] ?? false,
      allEditions: parsed.values["all-editions"] ?? false,
      ...(parsed.values.edition ? { editionId: parsed.values.edition } : {}),
    });
    console.log(`Built ${destination}`); return;
  }
  if (command === "preview") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { port: { type: "string" }, theme: { type: "string" } } });
    const port = Number(parsed.values.port ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535");
    await previewProject(parsed.positionals[0] ?? ".", port, parsed.values.theme); return;
  }
  if (command === "status") {
    if (rest.length > 1) throw new Error("status accepts at most one project directory");
    process.stdout.write(formatPulse(await statusProject(rest[0] ?? ".")));
    return;
  }
  if (command === "gift") {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { to: { type: "string" }, format: { type: "string" }, output: { type: "string" } },
    });
    if (parsed.positionals.length > 1) throw new Error("gift accepts at most one project directory");
    const formats = parsed.values.format?.split(",").filter(Boolean) as Array<"web" | "epub" | "pdf"> | undefined;
    const file = await giftProject(parsed.positionals[0] ?? ".", {
      ...(parsed.values.to ? { to: parsed.values.to } : {}),
      ...(formats?.length ? { formats } : {}),
      ...(parsed.values.output ? { output: parsed.values.output } : {}),
    });
    console.log(`Packed ${file}`);
    return;
  }
  if (command === "archive") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { label: { type: "string" } } });
    if (parsed.positionals.length > 1) throw new Error("archive accepts at most one project directory");
    const destination = await archiveProject(parsed.positionals[0] ?? ".", parsed.values.label);
    console.log(`Archived ${destination}`);
    return;
  }
  if (command === "diff") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { against: { type: "string" } } });
    if (parsed.positionals.length > 1) throw new Error("diff accepts at most one project directory");
    process.stdout.write(formatProofDiff(await proofDiff(parsed.positionals[0] ?? ".", parsed.values.against)));
    return;
  }
  if (command === "drift") {
    if (rest.length > 1) throw new Error("drift accepts at most one project directory");
    process.stdout.write(await driftReport(rest[0] ?? "."));
    return;
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
    if (subcommand === "test") {
      if (themeArgs.length) throw new Error("themes test does not take arguments");
      const results = await testBuiltInThemes();
      let failed = 0;
      for (const result of results) {
        console.log(`${result.ok ? "✓" : "✗"} ${result.themeId}: ${result.message}`);
        if (!result.ok) failed += 1;
      }
      if (failed) process.exitCode = 1;
      else console.log(`✓ ${results.length} built-in theme${results.length === 1 ? "" : "s"} passed contract`);
      return;
    }
    throw new Error(`Unknown themes command: ${subcommand}`);
  }
  if (command === "check") {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { ship: { type: "boolean" }, seal: { type: "boolean" } },
    });
    if (parsed.positionals.length > 1) throw new Error("check accepts at most one project directory");
    const root = path.resolve(parsed.positionals[0] ?? ".");
    const checked = await checkProject(root, {
      ship: parsed.values.ship ?? false,
      seal: parsed.values.seal ?? false,
    });
    console.log(`✓ ${checked.sections} sections and ${checked.assets} assets are valid`); return;
  }
  if (command === "lint" || command === "preflight") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { ship: { type: "boolean" } } });
    if (parsed.positionals.length > 1) throw new Error(`${command} accepts at most one project directory`);
    const root = path.resolve(parsed.positionals[0] ?? ".");
    const result = await lintProject(root, { ship: parsed.values.ship ?? false });
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
