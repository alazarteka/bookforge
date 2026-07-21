import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { BookConfig, PrintProfile } from "./model.js";
import { containedPath, sha256 } from "./util.js";

const length = String.raw`(?:0|\d+(?:\.\d+)?(?:mm|cm|in|pt))`;
const pageValue = z.string()
  .regex(new RegExp(String.raw`^(?:A[345]|B[45]|JIS-B[45]|letter|legal|ledger|${length},${length})$`, "i"), "must be a supported page preset or width,height pair")
  .refine((value) => !value.includes(",") || value.split(",").every((dimension) => Number(dimension.replace(/(?:mm|cm|in|pt)$/i, "")) > 0), "custom page dimensions must be strictly positive");
const bareZero = z.literal(0).transform(() => "0");
const marginValue = z.union([z.string().regex(new RegExp(String.raw`^${length}(?:\s+${length}){0,3}$`), "must contain one to four absolute lengths"), bareZero]);
const bleedValue = z.union([z.string().regex(new RegExp(String.raw`^${length}$`), "must be one absolute length"), bareZero]);
const profileSchema = z.object({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  page: pageValue,
  margins: marginValue,
  bleed: bleedValue.default("0mm"),
  binding: z.enum(["screen", "perfect", "coil"]),
  color: z.enum(["color", "grayscale"]).default("color"),
  cover: z.enum(["interior", "none"]).default("interior"),
  imposition: z.enum(["none", "booklet"]).default("none"),
}).strict();

export async function loadPrintProfile(projectRoot: string, pdf: BookConfig["outputs"]["pdf"]): Promise<PrintProfile> {
  const id = pdf?.profile ?? "screen-a5";
  const bundledProfiles = path.resolve(import.meta.dirname, "..", "profiles");
  const candidates: Array<{ file: string; source: "project" | "built-in" }> = [
    { file: containedPath(projectRoot, path.join("profiles", `${id}.yaml`)), source: "project" },
    { file: containedPath(bundledProfiles, `${id}.yaml`), source: "built-in" },
  ];
  for (const candidate of candidates) {
    if (!(await stat(candidate.file).catch(() => undefined))?.isFile()) continue;
    const raw = await readFile(candidate.file, "utf8");
    const parsed = profileSchema.parse(YAML.parse(raw, { strict: true, uniqueKeys: true }));
    if (parsed.id !== id) throw new Error(`Print profile requested "${id}" but declares "${parsed.id}"`);
    const resolved = {
      ...parsed,
      source: candidate.source,
      page: pageValue.parse(pdf?.page ?? parsed.page),
      margins: marginValue.parse(pdf?.margins ?? parsed.margins),
    };
    return { ...resolved, hash: sha256(`${raw}\0${resolved.page}\0${resolved.margins}`) };
  }
  throw new Error(`Print profile not found: ${id}`);
}
