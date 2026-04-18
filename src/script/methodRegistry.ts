/** Parse `method` declarations into raw bodies + parameter names (supports nested `{` }` in bodies). */

export type MethodRegistryEntry = {
  params: string[];
  bodyText: string;
};

function skipWsAndComments(s: string, i: number): number {
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    if (c === "#") {
      i++;
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

function readIdent(s: string, i: number): { v: string; next: number } {
  if (i >= s.length || !/[a-zA-Z_]/.test(s[i])) {
    throw new Error(`Expected identifier at ${i}`);
  }
  const start = i;
  i++;
  while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) i++;
  return { v: s.slice(start, i), next: i };
}

function parseParamList(s: string, i: number): { params: string[]; next: number } {
  const params: string[] = [];
  i = skipWsAndComments(s, i);
  if (s[i] === ")") return { params, next: i + 1 };
  while (true) {
    const { v, next } = readIdent(s, i);
    params.push(v);
    i = skipWsAndComments(s, next);
    if (s[i] === ")") return { params, next: i + 1 };
    if (s[i] === ",") {
      i = skipWsAndComments(s, i + 1);
      continue;
    }
    throw new Error(`Expected "," or ")" in parameter list at ${i}`);
  }
}

function readBalancedBraceBody(
  s: string,
  openIdx: number,
): { body: string; next: number } {
  if (s[openIdx] !== "{") throw new Error("Expected '{'");
  let depth = 1;
  let i = openIdx + 1;
  const contentStart = i;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "#") {
      i++;
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { body: s.slice(contentStart, i), next: i + 1 };
      }
    }
    i++;
  }
  throw new Error("Unclosed '{' in method");
}

export function parseMethodsRegistry(source: string): Map<string, MethodRegistryEntry> {
  const map = new Map<string, MethodRegistryEntry>();
  let i = 0;
  const n = source.length;

  while (true) {
    i = skipWsAndComments(source, i);
    if (i >= n) break;

    if (!source.startsWith("method", i)) {
      throw new Error(`Expected "method" at position ${i}`);
    }
    const afterKw = i + 6;
    if (afterKw < n && /[a-zA-Z0-9_]/.test(source[afterKw])) {
      throw new Error(`Invalid "method" keyword at ${i}`);
    }
    i = skipWsAndComments(source, afterKw);

    let name: string;
    if (source[i] === '"') {
      i++;
      let out = "";
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\") {
          i++;
          const esc = source[i++];
          if (esc === "n") out += "\n";
          else if (esc === "r") out += "\r";
          else if (esc === "t") out += "\t";
          else out += esc;
          continue;
        }
        out += source[i++];
      }
      if (i >= n || source[i] !== '"') {
        throw new Error("Unterminated string in method name");
      }
      i++;
      name = out;
    } else {
      const r = readIdent(source, i);
      name = r.v;
      i = r.next;
    }

    i = skipWsAndComments(source, i);
    let params: string[] = [];
    if (source[i] === "(") {
      i++;
      const pl = parseParamList(source, i);
      params = pl.params;
      i = skipWsAndComments(source, pl.next);
    }

    i = skipWsAndComments(source, i);
    if (source[i] !== "{") {
      throw new Error(`Expected "{" to start body of method "${name}"`);
    }
    const { body, next } = readBalancedBraceBody(source, i);
    if (map.has(name)) throw new Error(`Duplicate method "${name}"`);
    map.set(name, { params, bodyText: body });
    i = next;
  }

  return map;
}
