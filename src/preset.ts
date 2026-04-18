import type { Waveform } from "./script/types";
import {
  builtinSoundTabDefaults,
  SOUND_TEMPLATE_IDS,
  type SoundTemplateId,
} from "./commandTemplates";
import { stripLeadingImports } from "./script/imports";
import { parseMethodsScriptToList } from "./script/parser";

export type NamedScript = { name: string; body: string; params?: string[] };

export interface TonePresetManual {
  frequencyHz: number;
  durationMs: number;
  sampleRate: number;
  loops: number;
  pauseMs: number;
  wave: Waveform;
  volume: number;
}

export interface TonePresetV1 {
  version: 1;
  name: string;
  script: string;
  manual: TonePresetManual;
}

export interface TonePresetV2 {
  version: 2;
  name: string;
  mainScript: string;
  methodsScript: string;
  manual: TonePresetManual;
}

export interface ToneProjectV3 {
  version: 3;
  name: string;
  mainScript: string;
  methodsScript: string;
  soundTemplates: Record<string, string>;
  soundsExtraScript: string;
  manual: TonePresetManual;
}

export interface ToneProjectV4 {
  version: 4;
  name: string;
  mainScript: string;
  methodsList: NamedScript[];
  soundsList: NamedScript[];
  manual: TonePresetManual;
}

export type TonePresetFile =
  | TonePresetV1
  | TonePresetV2
  | ToneProjectV3
  | ToneProjectV4;

export type ToneProject = ToneProjectV4;

export const SAMPLE_RATES = [8000, 11025, 16000, 22050, 44100, 48000] as const;

export const DEFAULT_MAIN_SCRIPT = `import methods
import sounds

wave sine
call curious_1
`;

export const DEFAULT_METHODS_SCRIPT = `method curious_1 {
  wave sine
  chirp 880Hz for 60ms vol 72
  rest 20ms
  chirp 1180Hz for 45ms vol 78
  rest 15ms
  sweep 950Hz to 1550Hz for 70ms vol 80
  rest 30ms
  chirp 640Hz for 95ms vol 68
  rest 25ms
  sweep 1450Hz to 1050Hz for 80ms vol 74
  rest 20ms
  warble 1250Hz depth 90 rate 16 for 110ms vol 70
}
`;

/** Ensure built-in sound tabs exist (correct order) and append custom methods. */
export function mergeDefaultSounds(incoming: NamedScript[]): NamedScript[] {
  const defaultsByName = new Map(
    builtinSoundTabDefaults().map((x) => [x.name, x]),
  );
  const custom = incoming.filter(
    (x) => !SOUND_TEMPLATE_IDS.includes(x.name as SoundTemplateId),
  );
  const byName = new Map(incoming.map((x) => [x.name, x]));
  const built: NamedScript[] = SOUND_TEMPLATE_IDS.map((id) => {
    const def = defaultsByName.get(id)!;
    const row = byName.get(id);
    const body = (row?.body?.trim() || def.body).trim() || def.body;
    const useParams =
      row?.params !== undefined && row.params.length > 0
        ? row.params
        : def.params.length > 0
          ? def.params
          : undefined;
    return {
      name: id,
      body,
      ...(useParams?.length ? { params: useParams } : {}),
    };
  });
  return [...built, ...custom];
}

export function buildMethodsFileFromList(items: NamedScript[]): string {
  return items
    .filter((x) => x.name.trim())
    .map(({ name, body, params }) => {
      const n = name.trim();
      const decl = /^[a-zA-Z_]\w*$/.test(n)
        ? n
        : `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const b = body.replace(/\s*$/, "");
      const paramList =
        params !== undefined && params.length > 0
          ? `(${params.join(", ")})`
          : "";
      return `method ${decl}${paramList} {\n${b}\n}`;
    })
    .join("\n\n");
}

export function defaultProject(): ToneProjectV4 {
  return {
    version: 4,
    name: "Untitled",
    mainScript: DEFAULT_MAIN_SCRIPT,
    methodsList: parseMethodsScriptToList(DEFAULT_METHODS_SCRIPT),
    soundsList: mergeDefaultSounds([]),
    manual: {
      frequencyHz: 440,
      durationMs: 250,
      sampleRate: 48000,
      loops: 1,
      pauseMs: 100,
      wave: "sine",
      volume: 80,
    },
  };
}

export function defaultPreset(): ToneProjectV4 {
  return defaultProject();
}

function migrateV3ToV4(p: ToneProjectV3, manual: TonePresetManual): ToneProjectV4 {
  const st = p.soundTemplates ?? {};
  const fromBuiltins: NamedScript[] = SOUND_TEMPLATE_IDS.map((id) => ({
    name: id,
    body:
      typeof st[id] === "string" && st[id].trim() ? st[id].trim() : "",
  }));
  const extra = parseMethodsScriptToList(
    typeof p.soundsExtraScript === "string" ? p.soundsExtraScript : "",
  ).filter(
    (x) => !SOUND_TEMPLATE_IDS.includes(x.name as SoundTemplateId),
  );
  return {
    version: 4,
    name: p.name,
    mainScript: p.mainScript,
    methodsList: parseMethodsScriptToList(p.methodsScript),
    soundsList: mergeDefaultSounds([...fromBuiltins, ...extra]),
    manual,
  };
}

export function normalizeLoadedProject(raw: unknown): ToneProjectV4 {
  const base = defaultProject();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const p = raw as Record<string, unknown>;
  const manualIn = p.manual as TonePresetManual | undefined;
  const manual: TonePresetManual = {
    ...base.manual,
    ...(manualIn && typeof manualIn === "object" ? manualIn : {}),
  };

  if (p.version === 4 && Array.isArray(p.methodsList)) {
    const methodsList = (p.methodsList as unknown[])
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        if (typeof r.name !== "string" || typeof r.body !== "string")
          return null;
        const pr = r.params;
        const params =
          Array.isArray(pr) && pr.every((x) => typeof x === "string")
            ? (pr as string[]).map((s) => s.trim()).filter(Boolean)
            : undefined;
        return {
          name: r.name,
          body: r.body,
          ...(params?.length ? { params } : {}),
        };
      })
      .filter((x): x is NamedScript => x !== null);
    const soundsRaw = Array.isArray(p.soundsList)
      ? (p.soundsList as unknown[])
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            if (typeof r.name !== "string" || typeof r.body !== "string")
              return null;
            const pr = r.params;
            const params =
              Array.isArray(pr) && pr.every((x) => typeof x === "string")
                ? (pr as string[]).map((s) => s.trim()).filter(Boolean)
                : undefined;
            return {
              name: r.name,
              body: r.body,
              ...(params?.length ? { params } : {}),
            };
          })
          .filter((x): x is NamedScript => x !== null)
      : [];
    return {
      version: 4,
      name: typeof p.name === "string" ? p.name : base.name,
      mainScript:
        typeof p.mainScript === "string" ? p.mainScript : base.mainScript,
      methodsList: methodsList.length ? methodsList : base.methodsList,
      soundsList: mergeDefaultSounds(soundsRaw),
      manual,
    };
  }

  if (p.version === 3 && typeof p.mainScript === "string") {
    return migrateV3ToV4(
      {
        version: 3,
        name: typeof p.name === "string" ? p.name : base.name,
        mainScript: p.mainScript,
        methodsScript:
          typeof p.methodsScript === "string" ? p.methodsScript : "",
        soundTemplates:
          p.soundTemplates && typeof p.soundTemplates === "object"
            ? (p.soundTemplates as Record<string, string>)
            : {},
        soundsExtraScript:
          typeof p.soundsExtraScript === "string" ? p.soundsExtraScript : "",
        manual,
      },
      manual,
    );
  }

  if (p.version === 2 && typeof p.mainScript === "string") {
    const { imports } = stripLeadingImports(p.mainScript);
    const mainScript =
      imports.length > 0
        ? p.mainScript
        : `import methods\nimport sounds\n\n${p.mainScript}`;
    return migrateV3ToV4(
      {
        version: 3,
        name: typeof p.name === "string" ? p.name : base.name,
        mainScript,
        methodsScript:
          typeof p.methodsScript === "string" ? p.methodsScript : "",
        soundTemplates: {},
        soundsExtraScript: "",
        manual,
      },
      manual,
    );
  }

  if (p.version === 1 && typeof p.script === "string") {
    const { imports } = stripLeadingImports(p.script);
    const mainScript =
      imports.length > 0
        ? p.script
        : `import methods\nimport sounds\n\n${p.script}`;
    return migrateV3ToV4(
      {
        version: 3,
        name: typeof p.name === "string" ? p.name : base.name,
        mainScript,
        methodsScript: "",
        soundTemplates: {},
        soundsExtraScript: "",
        manual,
      },
      manual,
    );
  }

  return {
    ...base,
    name: typeof p.name === "string" ? p.name : base.name,
    manual,
  };
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
