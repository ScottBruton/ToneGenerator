import type { MethodRegistryEntry } from "./methodRegistry";
import { parseMethodsRegistry } from "./methodRegistry";
import { applyTemplate, bindParameters } from "./substitute";
import type {
  CallArg,
  ParseResult,
  RobotBlock,
  ScriptCommand,
  Waveform,
} from "./types";

type Tok =
  | { k: "eof" }
  | { k: "{" }
  | { k: "}" }
  | { k: "colon" }
  | { k: "str"; v: string }
  | { k: "num"; v: number }
  | { k: "id"; v: string };

class Lexer {
  private i = 0;
  constructor(private readonly s: string) {}

  private peek(offset = 0): string {
    return this.s[this.i + offset] ?? "";
  }

  private skipWsAndComments(): void {
    while (this.i < this.s.length) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        this.i++;
        continue;
      }
      if (c === "/" && this.peek(1) === "/") {
        this.i += 2;
        while (this.i < this.s.length && this.peek() !== "\n") this.i++;
        continue;
      }
      if (c === "#") {
        this.i++;
        while (this.i < this.s.length && this.peek() !== "\n") this.i++;
        continue;
      }
      break;
    }
  }

  next(): Tok {
    this.skipWsAndComments();
    if (this.i >= this.s.length) return { k: "eof" };
    const c = this.peek();
    if (c === "{") {
      this.i++;
      return { k: "{" };
    }
    if (c === "}") {
      this.i++;
      return { k: "}" };
    }
    if (c === ":") {
      this.i++;
      return { k: "colon" };
    }
    if (c === '"') {
      this.i++;
      let out = "";
      while (this.i < this.s.length) {
        const ch = this.peek();
        if (ch === "\\") {
          this.i++;
          const esc = this.peek();
          this.i++;
          if (esc === "n") out += "\n";
          else if (esc === "r") out += "\r";
          else if (esc === "t") out += "\t";
          else out += esc;
          continue;
        }
        if (ch === '"') {
          this.i++;
          return { k: "str", v: out };
        }
        out += ch;
        this.i++;
      }
      throw new Error("Unterminated string");
    }
    if (c === "." || (c >= "0" && c <= "9")) {
      const start = this.i;
      if (c === ".") {
        this.i++;
        while (this.peek() >= "0" && this.peek() <= "9") this.i++;
      } else {
        while (this.peek() >= "0" && this.peek() <= "9") this.i++;
        if (this.peek() === ".") {
          this.i++;
          while (this.peek() >= "0" && this.peek() <= "9") this.i++;
        }
      }
      let raw = this.s.slice(start, this.i);
      const lower = this.peek().toLowerCase();
      if (lower === "h" && this.peek(1).toLowerCase() === "z") {
        this.i += 2;
        raw += "Hz";
      } else if (lower === "m" && this.peek(1).toLowerCase() === "s") {
        this.i += 2;
        raw += "ms";
      }
      const n = Number.parseFloat(raw.replace(/Hz$/i, "").replace(/ms$/i, ""));
      if (!Number.isFinite(n)) throw new Error(`Bad number near ${start}`);
      return { k: "num", v: n };
    }
    if (/[a-zA-Z_]/.test(c)) {
      const start = this.i;
      this.i++;
      while (/[a-zA-Z0-9_]/.test(this.peek())) this.i++;
      return { k: "id", v: this.s.slice(start, this.i) };
    }
    throw new Error(`Unexpected character '${c}' at ${this.i}`);
  }
}

class Parser {
  private static readonly STATEMENT_START = new Set([
    "wave",
    "chirp",
    "rest",
    "sweep",
    "warble",
    "repeat",
    "call",
    "method",
    "import",
  ]);

  private tok: Tok;
  private lex: Lexer;

  constructor(src: string) {
    this.lex = new Lexer(src);
    this.tok = this.lex.next();
  }

  private eat(): Tok {
    const t = this.tok;
    this.tok = this.lex.next();
    return t;
  }

  /** Avoid control-flow narrowing on the mutable `tok` field. */
  private cur(): Tok {
    return this.tok;
  }

  private expectId(lowercase?: string): string {
    const t = this.eat();
    if (t.k !== "id") throw new Error(`Expected word, got ${t.k}`);
    if (lowercase && t.v.toLowerCase() !== lowercase)
      throw new Error(`Expected '${lowercase}', got '${t.v}'`);
    return t.v;
  }

  /** Legacy: robot "name" { ... } */
  parseRobots(): ParseResult {
    const robots: RobotBlock[] = [];
    while (this.tok.k !== "eof") {
      this.expectId("robot");
      let name: string;
      if (this.tok.k === "str") {
        const st = this.eat();
        if (st.k !== "str") throw new Error("Expected string");
        name = st.v;
      } else if (this.tok.k === "id") {
        const idTok = this.eat();
        if (idTok.k !== "id") throw new Error("Expected name");
        name = idTok.v;
      } else {
        throw new Error("Expected robot name");
      }
      if (this.eat().k !== "{") throw new Error("Expected '{' after robot name");
      const commands = this.parseCommands();
      if (this.eat().k !== "}") throw new Error("Expected '}' after robot body");
      robots.push({ name, commands });
    }
    return { robots };
  }

  parseMainScript(): ScriptCommand[] {
    const out = this.parseCommandsUntilEof();
    if (this.tok.k !== "eof") throw new Error("Unexpected extra input in main script");
    return out;
  }

  private parseCommandsUntilEof(): ScriptCommand[] {
    const out: ScriptCommand[] = [];
    while (this.tok.k !== "eof") {
      out.push(this.parseStatement());
    }
    return out;
  }

  private parseCommands(): ScriptCommand[] {
    const out: ScriptCommand[] = [];
    while (this.tok.k !== "}" && this.tok.k !== "eof") {
      out.push(this.parseStatement());
    }
    return out;
  }

  parseCommandsUntilEofAndFinish(ctx: string): ScriptCommand[] {
    const cmds = this.parseCommandsUntilEof();
    if (this.tok.k !== "eof") {
      throw new Error(`Unexpected extra input in ${ctx}`);
    }
    return cmds;
  }

  private parseStatement(): ScriptCommand {
    if (this.tok.k !== "id") throw new Error("Expected command");
    const head = this.tok.v.toLowerCase();
    this.eat();
    if (head === "wave") return this.parseWave();
    if (head === "chirp") return this.parseChirp();
    if (head === "rest") return this.parseRest();
    if (head === "sweep") return this.parseSweep();
    if (head === "warble") return this.parseWarble();
    if (head === "repeat") return this.parseRepeat();
    if (head === "call") return this.parseCall();
    throw new Error(`Unknown command '${head}'`);
  }

  private readCallArgValue(): string {
    const k = this.cur().k;
    if (k === "num") {
      const t = this.eat();
      if (t.k !== "num") throw new Error("Expected number");
      return String(t.v);
    }
    if (k === "id") {
      const t = this.eat();
      if (t.k !== "id") throw new Error("Expected identifier");
      return t.v;
    }
    if (k === "str") {
      const t = this.eat();
      if (t.k !== "str") throw new Error("Expected string");
      return t.v;
    }
    throw new Error("Expected value in call argument");
  }

  private parseCall(): ScriptCommand {
    let name: string;
    const nameKind = this.cur().k;
    if (nameKind === "str") {
      const st = this.eat();
      if (st.k !== "str") throw new Error("Expected method name");
      name = st.v;
    } else if (nameKind === "id") {
      const idTok = this.eat();
      if (idTok.k !== "id") throw new Error("Expected method name");
      name = idTok.v;
    } else {
      throw new Error("Expected method name after call");
    }
    const args: CallArg[] = [];
    for (;;) {
      const k = this.cur().k;
      if (k === "eof" || k === "}") break;
      if (k === "id") {
        const tPeek = this.cur();
        if (tPeek.k !== "id") throw new Error("Expected identifier");
        const idLower = tPeek.v.toLowerCase();
        if (Parser.STATEMENT_START.has(idLower)) break;
        const idTok = this.eat();
        if (idTok.k !== "id") throw new Error("Expected identifier");
        if (this.cur().k === "colon") {
          this.eat();
          const value = this.readCallArgValue();
          args.push({ kind: "named", name: idTok.v, value });
        } else {
          args.push({ kind: "positional", value: idTok.v });
        }
        continue;
      }
      if (k === "num") {
        const t = this.eat();
        if (t.k !== "num") throw new Error("Expected number");
        args.push({ kind: "positional", value: String(t.v) });
        continue;
      }
      if (k === "str") {
        const t = this.eat();
        if (t.k !== "str") throw new Error("Expected string");
        args.push({ kind: "positional", value: t.v });
        continue;
      }
      break;
    }
    return { type: "call", name, args };
  }

  private parseWave(): ScriptCommand {
    if (this.tok.k !== "id") throw new Error("Expected waveform name");
    const wt = this.eat();
    if (wt.k !== "id") throw new Error("Expected waveform name");
    const w = wt.v.toLowerCase();
    let shape: Waveform;
    if (w === "sine") shape = "sine";
    else if (w === "square") shape = "square";
    else if (w === "triangle") shape = "triangle";
    else if (w === "saw" || w === "sawtooth") shape = "sawtooth";
    else throw new Error(`Unknown wave '${w}'`);
    return { type: "wave", shape };
  }

  private readMs(): number {
    const t = this.eat();
    if (t.k !== "num") throw new Error("Expected duration in ms");
    if (this.tok.k === "id" && this.tok.v.toLowerCase() === "ms") this.eat();
    return t.v;
  }

  private readHz(): number {
    const t = this.eat();
    if (t.k !== "num") throw new Error("Expected frequency in Hz");
    if (this.tok.k === "id" && this.tok.v.toLowerCase() === "hz") this.eat();
    return t.v;
  }

  private parseChirp(): ScriptCommand {
    const freqHz = this.readHz();
    this.expectId("for");
    const ms = this.readMs();
    let vol = 100;
    if (this.tok.k === "id" && this.tok.v.toLowerCase() === "vol") {
      this.eat();
      const t = this.eat();
      if (t.k !== "num") throw new Error("Expected volume0-100");
      vol = t.v;
    }
    return { type: "chirp", freqHz, ms, vol };
  }

  private parseRest(): ScriptCommand {
    const ms = this.readMs();
    return { type: "rest", ms };
  }

  /** sweep <from>Hz to <to>Hz for <dur> [vol <n>] */
  private parseSweep(): ScriptCommand {
    const fromHz = this.readHz();
    this.expectId("to");
    const toHz = this.readHz();
    this.expectId("for");
    const ms = this.readMs();
    let vol = 100;
    if (this.tok.k === "id" && this.tok.v.toLowerCase() === "vol") {
      this.eat();
      const t = this.eat();
      if (t.k !== "num") throw new Error("Expected volume 0-100");
      vol = t.v;
    }
    return { type: "sweep", fromHz, toHz, ms, vol };
  }

  private parseWarble(): ScriptCommand {
    const freqHz = this.readHz();
    this.expectId("depth");
    const tDepth = this.eat();
    if (tDepth.k !== "num") throw new Error("Expected warble depth");
    const depthHz = tDepth.v;
    this.expectId("rate");
    const tRate = this.eat();
    if (tRate.k !== "num") throw new Error("Expected warble rate in Hz");
    const rateHz = tRate.v;
    this.expectId("for");
    const ms = this.readMs();
    let vol = 100;
    if (this.tok.k === "id" && this.tok.v.toLowerCase() === "vol") {
      this.eat();
      const t = this.eat();
      if (t.k !== "num") throw new Error("Expected volume 0-100");
      vol = t.v;
    }
    return { type: "warble", freqHz, depthHz, rateHz, ms, vol };
  }

  private parseRepeat(): ScriptCommand {
    const t = this.eat();
    if (t.k !== "num" || t.v < 1) throw new Error("repeat expects a positive count");
    const count = Math.floor(t.v);
    if (this.eat().k !== "{") throw new Error("Expected '{' after repeat count");
    const body = this.parseCommands();
    if (this.eat().k !== "}") throw new Error("Expected '}' after repeat body");
    return { type: "repeat", count, body };
  }
}

export function parseLegacyRobotScript(source: string): ParseResult {
  return new Parser(source).parseRobots();
}

export function parseMainScript(source: string): ScriptCommand[] {
  return new Parser(source).parseMainScript();
}

/** Ordered list for UI tabs (preserves declaration order). */
export function parseMethodsScriptToList(source: string): {
  name: string;
  body: string;
  params?: string[];
}[] {
  if (!source.trim()) return [];
  const reg = parseMethodsRegistry(source);
  const out: { name: string; body: string; params?: string[] }[] = [];
  for (const [name, { params, bodyText }] of reg) {
    out.push({
      name,
      body: bodyText.replace(/\s*$/, ""),
      ...(params.length ? { params } : {}),
    });
  }
  return out;
}

export function parseInlineCommands(source: string): ScriptCommand[] {
  const p = new Parser(source.trim());
  return p.parseCommandsUntilEofAndFinish("expanded call");
}

/** Try modern main; fall back to legacy robot blocks (v1 presets). */
export function parseMainScriptFlexible(source: string): ScriptCommand[] {
  try {
    return parseMainScript(source);
  } catch {
    const { robots } = parseLegacyRobotScript(source);
    return robots.flatMap((r) => r.commands);
  }
}

export function expandCalls(
  cmds: ScriptCommand[],
  registry: Map<string, MethodRegistryEntry>,
  stack: string[] = [],
): ScriptCommand[] {
  const out: ScriptCommand[] = [];
  for (const c of cmds) {
    if (c.type === "call") {
      if (stack.includes(c.name)) {
        throw new Error(`Recursive call: ${c.name}`);
      }
      const entry = registry.get(c.name);
      if (!entry) {
        throw new Error(`Unknown method "${c.name}"`);
      }
      let bindings: Record<string, string>;
      try {
        bindings = bindParameters(entry.params, c.args);
      } catch (e) {
        throw new Error(
          `call ${c.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      let text: string;
      try {
        text = applyTemplate(entry.bodyText, bindings);
      } catch (e) {
        throw new Error(
          `call ${c.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      let inner: ScriptCommand[];
      try {
        inner = parseInlineCommands(text);
      } catch (e) {
        throw new Error(
          `call ${c.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      out.push(...expandCalls(inner, registry, [...stack, c.name]));
    } else if (c.type === "repeat") {
      const inner = expandCalls(c.body, registry, stack);
      for (let i = 0; i < c.count; i++) {
        out.push(...inner);
      }
    } else {
      out.push(c);
    }
  }
  return out;
}

/** @deprecated Use parseLegacyRobotScript */
export function parseScript(source: string): ParseResult {
  return parseLegacyRobotScript(source);
}

/** Unroll repeat only (no calls). */
export function flattenCommands(cmds: ScriptCommand[]): ScriptCommand[] {
  const out: ScriptCommand[] = [];
  for (const c of cmds) {
    if (c.type === "repeat") {
      for (let i = 0; i < c.count; i++) out.push(...flattenCommands(c.body));
    } else {
      out.push(c);
    }
  }
  return out;
}
