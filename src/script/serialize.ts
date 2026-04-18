import type { ScriptCommand, Waveform } from "./types";

function fmtWave(w: Waveform): string {
  if (w === "sawtooth") return "sawtooth";
  return w;
}

function serializeLeaf(c: ScriptCommand): string {
  switch (c.type) {
    case "wave":
      return `wave ${fmtWave(c.shape)}`;
    case "chirp":
      return `chirp ${c.freqHz}Hz for ${c.ms}ms vol ${c.vol}`;
    case "rest":
      return `rest ${c.ms}ms`;
    case "sweep":
      return `sweep ${c.fromHz}Hz to ${c.toHz}Hz for ${c.ms}ms vol ${c.vol}`;
    case "warble":
      return `warble ${c.freqHz}Hz depth ${c.depthHz} rate ${c.rateHz} for ${c.ms}ms vol ${c.vol}`;
    case "call": {
      const q = /^[a-zA-Z_]\w*$/.test(c.name)
        ? c.name
        : `"${c.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      if (!c.args.length) return `call ${q}`;
      const parts = c.args.map((a) =>
        a.kind === "positional" ? a.value : `${a.name}: ${a.value}`,
      );
      return `call ${q} ${parts.join(" ")}`;
    }
    case "repeat":
      throw new Error("repeat must be serialized via serializeCommands");
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

/** Serialize commands as method body lines (with optional line prefix indent). */
export function serializeCommands(
  cmds: ScriptCommand[],
  lineIndent = "  ",
): string {
  const parts: string[] = [];
  for (const c of cmds) {
    if (c.type === "repeat") {
      const inner = serializeCommands(c.body, lineIndent + "  ");
      parts.push(
        `${lineIndent}repeat ${c.count} {\n${inner}\n${lineIndent}}`,
      );
    } else {
      parts.push(lineIndent + serializeLeaf(c));
    }
  }
  return parts.join("\n");
}
