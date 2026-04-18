export type Waveform = "sine" | "square" | "sawtooth" | "triangle";

export type CallArg =
  | { kind: "positional"; value: string }
  | { kind: "named"; name: string; value: string };

export type ScriptCommand =
  | { type: "wave"; shape: Waveform }
  | { type: "chirp"; freqHz: number; ms: number; vol: number }
  | { type: "rest"; ms: number }
  | {
      type: "sweep";
      fromHz: number;
      toHz: number;
      ms: number;
      vol: number;
    }
  | {
      type: "warble";
      freqHz: number;
      depthHz: number;
      rateHz: number;
      ms: number;
      vol: number;
    }
  | { type: "repeat"; count: number; gapMs: number; body: ScriptCommand[] }
  | { type: "call"; name: string; args: CallArg[] };

/** @deprecated Legacy robot block; use main + methods + call */
export interface RobotBlock {
  name: string;
  commands: ScriptCommand[];
}

/** @deprecated */
export interface ParseResult {
  robots: RobotBlock[];
}

export type PlayEvent =
  | {
      kind: "tone";
      wave: OscillatorType;
      freqHz: number;
      durationSec: number;
      vol: number;
    }
  | {
      kind: "sweep";
      wave: OscillatorType;
      fromHz: number;
      toHz: number;
      durationSec: number;
      vol: number;
    }
  | {
      kind: "warble";
      wave: OscillatorType;
      baseFreqHz: number;
      depthHz: number;
      rateHz: number;
      durationSec: number;
      vol: number;
    }
  | { kind: "silence"; durationSec: number };
