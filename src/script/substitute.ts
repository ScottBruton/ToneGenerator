import type { CallArg } from "./types";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function bindParameters(
  params: string[],
  args: CallArg[],
): Record<string, string> {
  if (params.length === 0) {
    if (args.length > 0) {
      throw new Error(
        "This method takes no parameters; remove arguments from the call",
      );
    }
    return {};
  }

  const map: Record<string, string> = {};
  const named = args.filter((a): a is Extract<CallArg, { kind: "named" }> => a.kind === "named");
  const pos = args.filter(
    (a): a is Extract<CallArg, { kind: "positional" }> => a.kind === "positional",
  );

  for (const n of named) {
    if (!params.includes(n.name)) {
      throw new Error(`Unknown parameter "${n.name}"`);
    }
    map[n.name] = n.value;
  }

  let pi = 0;
  for (const p of params) {
    if (map[p] !== undefined) continue;
    if (pi >= pos.length) {
      throw new Error(`Missing value for parameter "${p}"`);
    }
    map[p] = pos[pi].value;
    pi++;
  }

  if (pi < pos.length) {
    throw new Error("Too many positional arguments");
  }

  return map;
}

/** Replace `{{ name }}` placeholders (whitespace inside braces optional). */
export function applyTemplate(
  body: string,
  bindings: Record<string, string>,
): string {
  let result = body;
  const names = Object.keys(bindings).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(
      `\\{\\{\\s*${escapeRe(name)}\\s*\\}\\}`,
      "g",
    );
    result = result.replace(re, bindings[name]);
  }
  const unresolved = result.match(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g);
  if (unresolved?.length) {
    throw new Error(`Unresolved placeholders: ${unresolved.join(", ")}`);
  }
  return result;
}
