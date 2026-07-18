export type SectionRole = "frontmatter" | "bodymatter" | "backmatter" | "part";
export type OutputFlavor = "web" | "epub" | "print";

export interface BookConfig {
  schema: 1;
  id: string;
  title: string;
  subtitle?: string;
  language: string;
  authors: Array<{ name: string }>;
  theme: string;
  cover?: { path: string; alt: string };
  chapters: Array<{ id: string; path: string; role: SectionRole; title?: string }>;
  outputs: {
    web?: { reading?: "paged" | "continuous" };
    epub?: Record<string, never>;
    pdf?: {
      profile?: string;
      page?: "A4" | "A5" | "letter" | "6in,9in" | string;
      margins?: string;
    };
  };
}

export interface ThemeAsset {
  sourcePath: string;
  outputName: string;
  mediaType: string;
  hash: string;
}

export interface PublicationTheme {
  schema: 1;
  id: string;
  name: string;
  version: string;
  source: "built-in" | "project";
  root: string;
  hash: string;
  css: {
    tokens: string;
    body: string;
    web: string;
    epub: string;
    print: string;
    cover: string;
  };
  assets: ThemeAsset[];
}

export interface PrintProfile {
  schema: 1;
  id: string;
  name: string;
  source: "built-in" | "project";
  page: string;
  margins: string;
  bleed: string;
  binding: "screen" | "perfect" | "coil";
  color: "color" | "grayscale";
  cover: "interior" | "none";
  hash: string;
}

export interface Publication {
  schemaVersion: 1;
  id: string;
  metadata: {
    title: string;
    subtitle?: string;
    language: string;
    authors: string[];
  };
  cover?: { assetId: string; alt: string };
  spine: Section[];
  assets: Asset[];
}

export interface Section {
  id: string;
  role: SectionRole;
  title: Inline[];
  blocks: Block[];
}

export interface Asset {
  id: string;
  sourcePath: string;
  outputName: string;
  mediaType: string;
  hash: string;
}

export type Inline =
  | { type: "text"; value: string }
  | { type: "space" }
  | { type: "softBreak" }
  | { type: "lineBreak" }
  | { type: "emphasis"; children: Inline[] }
  | { type: "strong"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; title?: string; children: Inline[] }
  | { type: "image"; src: string; alt: Inline[]; title?: string; assetId?: string }
  | { type: "footnote"; id: string; blocks: Block[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: number; id: string; children: Inline[] }
  | { type: "blockquote"; blocks: Block[] }
  | { type: "sceneBreak" }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "codeBlock"; language?: string; value: string }
  | { type: "figure"; image: Extract<Inline, { type: "image" }>; caption: Inline[] }
  | { type: "table"; headers: Inline[][]; rows: Inline[][][] };

export interface BuildManifest {
  bookforgeVersion: string;
  schemaVersion: 1;
  publicationId: string;
  sourceHash: string;
  theme: { id: string; version: string; hash: string; source: "built-in" | "project" };
  printProfile?: { id: string; hash: string; source: "built-in" | "project" };
  toolVersions: Record<string, string>;
  formats: string[];
  timestamp: string;
}
