#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { buildProject, type Format } from "./build.js";
import { checkProject } from "./check.js";
import { doctor } from "./doctor.js";
import { initProject } from "./init.js";
import { previewProject } from "./preview.js";

const help = `Bookforge — beautiful local-first publishing

Usage:
  bookforge init <directory>
  bookforge build [project] [--format web,epub,pdf]
  bookforge preview [project] [--port 4173]
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
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { format: { type: "string" } } });
    const formats = parsed.values.format?.split(",").filter(Boolean) as Format[] | undefined;
    const destination = await buildProject(parsed.positionals[0] ?? ".", formats);
    console.log(`Built ${destination}`); return;
  }
  if (command === "preview") {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: { port: { type: "string" } } });
    const port = Number(parsed.values.port ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535");
    await previewProject(parsed.positionals[0] ?? ".", port); return;
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
