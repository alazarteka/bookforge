import { access } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await access(path.join(root, "tests", "fixtures", "synthetic", "assets", "marker.png"));
