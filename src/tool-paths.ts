import path from "node:path";

export function projectToolExecutable(root: string, tool: string, environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment[`BOOKFORGE_${tool.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`];
  if (override) return override;
  return path.join(root, "node_modules", ".bin", tool);
}
