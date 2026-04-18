/**
 * Built-in sound tab ids: audio primitives you `call` after `import sounds`.
 * `repeat` is a control-flow keyword for methods/main only — not a sound tab.
 */
export const SOUND_TEMPLATE_IDS = [
  "wave",
  "chirp",
  "rest",
  "sweep",
  "warble",
  "call",
] as const;
export type SoundTemplateId = (typeof SOUND_TEMPLATE_IDS)[number];

const BUILTIN_SOUND_DEF: Record<
  SoundTemplateId,
  { params: string[]; body: string }
> = {
  wave: { params: ["shape"], body: "wave {{shape}}" },
  chirp: {
    params: ["freq", "ms", "vol"],
    body: "chirp {{freq}}Hz for {{ms}}ms vol {{vol}}",
  },
  rest: { params: ["ms"], body: "rest {{ms}}ms" },
  sweep: {
    params: ["from_hz", "to_hz", "dur_ms", "vol"],
    body:
      "sweep {{from_hz}}Hz to {{to_hz}}Hz for {{dur_ms}}ms vol {{vol}}",
  },
  warble: {
    params: ["freq", "depth", "rate", "ms", "vol"],
    body:
      "warble {{freq}}Hz depth {{depth}} rate {{rate}} for {{ms}}ms vol {{vol}}",
  },
  call: { params: ["target"], body: "call {{target}}" },
};

/** Default tab rows for built-in sounds (parameterized bodies). */
export function builtinSoundTabDefaults(): Array<{
  name: string;
  body: string;
  params: string[];
}> {
  return SOUND_TEMPLATE_IDS.map((id) => {
    const d = BUILTIN_SOUND_DEF[id];
    return { name: id, params: d.params, body: d.body };
  });
}

export interface CommandTemplate {
  id: string;
  label: string;
  /**
   * Inserted at caret: pitch/time use real defaults; optional parts (e.g. vol) use XXX.
   */
  pillInsert: string;
  showOnMain?: boolean;
  showOnMethods?: boolean;
}

export const COMMAND_TEMPLATES: CommandTemplate[] = [
  {
    id: "wave",
    label: "wave",
    pillInsert: "call wave sine",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "chirp",
    label: "chirp",
    pillInsert: "call chirp 440 120 XXX",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "rest",
    label: "rest",
    pillInsert: "call rest 120",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "sweep",
    label: "sweep",
    pillInsert: "call sweep 440 880 200 XXX",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "warble",
    label: "warble",
    pillInsert: "call warble 440 40 6 240 XXX",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "repeat",
    label: "repeat",
    pillInsert:
      "repeat 3 gap 40ms {\n  call YOUR_SOUND\n}",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "call",
    label: "call",
    pillInsert: "call call curious_1",
    showOnMain: true,
    showOnMethods: true,
  },
  {
    id: "method",
    label: "method",
    pillInsert: "method new_method {\n  wave sine\n}",
    showOnMain: false,
    showOnMethods: true,
  },
];

/** @deprecated Prefer builtinSoundTabDefaults(); kept for callers that only need body text. */
export function defaultSoundBodies(): Record<SoundTemplateId, string> {
  const o = {} as Record<SoundTemplateId, string>;
  for (const x of builtinSoundTabDefaults()) {
    o[x.name as SoundTemplateId] = x.body;
  }
  return o;
}
