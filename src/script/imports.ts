import type { MethodRegistryEntry } from "./methodRegistry";
import { parseMethodsRegistry } from "./methodRegistry";

export type ImportDecl = "methods" | "sounds";

/**
 * Parse leading `import methods` / `import sounds` lines (comments/blank lines allowed).
 */
export function stripLeadingImports(source: string): {
  imports: ImportDecl[];
  body: string;
} {
  const imports: ImportDecl[] = [];
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === "" || t.startsWith("//") || t.startsWith("#")) {
      i++;
      continue;
    }
    const m = /^import\s+(methods|sounds)\s*$/i.exec(t);
    if (m) {
      imports.push(m[1].toLowerCase() as ImportDecl);
      i++;
      continue;
    }
    break;
  }
  return { imports, body: lines.slice(i).join("\n") };
}

/**
 * Merge method/sound registries in import order. Later imports overwrite same name.
 */
export function composeMethodRegistry(
  imports: ImportDecl[],
  methodsScript: string,
  soundsScript: string,
): Map<string, MethodRegistryEntry> {
  const map = new Map<string, MethodRegistryEntry>();
  for (const im of imports) {
    const src = im === "methods" ? methodsScript : soundsScript;
    if (!src.trim()) continue;
    const chunk = parseMethodsRegistry(src);
    for (const [k, v] of chunk) {
      map.set(k, v);
    }
  }
  return map;
}
