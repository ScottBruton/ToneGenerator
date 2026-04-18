import type { PlayEvent, ScriptCommand, Waveform } from "../script/types";

const FADE_SEC = 0.004;
const HEADROOM = 0.22;

export function mapWaveform(w: Waveform): OscillatorType {
  return w;
}

function msToSec(ms: number): number {
  return Math.max(0, ms) / 1000;
}

export function scriptToPlayEvents(
  cmds: ScriptCommand[],
  initialWave: Waveform = "sine",
): PlayEvent[] {
  let wave: Waveform = initialWave;
  const events: PlayEvent[] = [];
  for (const c of cmds) {
    if (c.type === "wave") {
      wave = c.shape;
      continue;
    }
    const oscType = mapWaveform(wave);
    if (c.type === "rest") {
      events.push({ kind: "silence", durationSec: msToSec(c.ms) });
    } else if (c.type === "chirp") {
      events.push({
        kind: "tone",
        wave: oscType,
        freqHz: c.freqHz,
        durationSec: msToSec(c.ms),
        vol: c.vol,
      });
    } else if (c.type === "sweep") {
      events.push({
        kind: "sweep",
        wave: oscType,
        fromHz: c.fromHz,
        toHz: c.toHz,
        durationSec: msToSec(c.ms),
        vol: c.vol,
      });
    } else if (c.type === "warble") {
      events.push({
        kind: "warble",
        wave: oscType,
        baseFreqHz: c.freqHz,
        depthHz: c.depthHz,
        rateHz: c.rateHz,
        durationSec: msToSec(c.ms),
        vol: c.vol,
      });
    }
  }
  return events;
}

export function totalDurationSec(events: PlayEvent[]): number {
  return events.reduce((s, e) => s + e.durationSec, 0);
}

export function manualToPlayEvents(opts: {
  wave: Waveform;
  frequencyHz: number;
  durationMs: number;
  volume: number;
  loops: number;
  pauseMs: number;
}): PlayEvent[] {
  const { wave, frequencyHz, durationMs, volume, loops, pauseMs } = opts;
  const d = msToSec(durationMs);
  const p = msToSec(pauseMs);
  const oscType = mapWaveform(wave);
  const out: PlayEvent[] = [];
  const n = Math.max(1, Math.floor(loops));
  for (let i = 0; i < n; i++) {
    out.push({
      kind: "tone",
      wave: oscType,
      freqHz: frequencyHz,
      durationSec: d,
      vol: volume,
    });
    if (i < n - 1 && p > 0) out.push({ kind: "silence", durationSec: p });
  }
  return out;
}

function connectToDest(
  ctx: BaseAudioContext,
  node: AudioNode,
  nodes: AudioNode[],
): void {
  node.connect(ctx.destination);
  nodes.push(node);
}

function scheduleTone(
  ctx: BaseAudioContext,
  t0: number,
  e: Extract<PlayEvent, { kind: "tone" }>,
  nodes: AudioNode[],
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = e.wave;
  osc.frequency.setValueAtTime(e.freqHz, t0);
  const peak = Math.max(0, Math.min(100, e.vol)) / 100;
  const v = peak * HEADROOM;
  const t1 = t0 + Math.min(FADE_SEC, e.durationSec / 4);
  const tEnd = t0 + e.durationSec;
  const tFadeOut = Math.max(t1, tEnd - Math.min(FADE_SEC, e.durationSec / 4));
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t1);
  g.gain.setValueAtTime(v, tFadeOut);
  g.gain.linearRampToValueAtTime(0, tEnd);
  osc.connect(g);
  connectToDest(ctx, g, nodes);
  osc.start(t0);
  osc.stop(tEnd + 0.02);
}

function scheduleSweep(
  ctx: BaseAudioContext,
  t0: number,
  e: Extract<PlayEvent, { kind: "sweep" }>,
  nodes: AudioNode[],
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = e.wave;
  const tEnd = t0 + e.durationSec;
  osc.frequency.setValueAtTime(e.fromHz, t0);
  osc.frequency.linearRampToValueAtTime(e.toHz, tEnd);
  const peak = Math.max(0, Math.min(100, e.vol)) / 100;
  const v = peak * HEADROOM;
  const t1 = t0 + Math.min(FADE_SEC, e.durationSec / 4);
  const tFadeOut = Math.max(t1, tEnd - Math.min(FADE_SEC, e.durationSec / 4));
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t1);
  g.gain.setValueAtTime(v, tFadeOut);
  g.gain.linearRampToValueAtTime(0, tEnd);
  osc.connect(g);
  connectToDest(ctx, g, nodes);
  osc.start(t0);
  osc.stop(tEnd + 0.02);
}

function scheduleWarble(
  ctx: BaseAudioContext,
  t0: number,
  e: Extract<PlayEvent, { kind: "warble" }>,
  nodes: AudioNode[],
): void {
  const carrier = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const g = ctx.createGain();
  carrier.type = e.wave;
  lfo.type = "sine";
  carrier.frequency.setValueAtTime(e.baseFreqHz, t0);
  lfo.frequency.setValueAtTime(Math.max(0.1, e.rateHz), t0);
  lfoGain.gain.setValueAtTime(Math.max(0, e.depthHz), t0);
  lfo.connect(lfoGain);
  lfoGain.connect(carrier.frequency);
  const tEnd = t0 + e.durationSec;
  const peak = Math.max(0, Math.min(100, e.vol)) / 100;
  const v = peak * HEADROOM;
  const t1 = t0 + Math.min(FADE_SEC, e.durationSec / 4);
  const tFadeOut = Math.max(t1, tEnd - Math.min(FADE_SEC, e.durationSec / 4));
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t1);
  g.gain.setValueAtTime(v, tFadeOut);
  g.gain.linearRampToValueAtTime(0, tEnd);
  carrier.connect(g);
  connectToDest(ctx, g, nodes);
  lfo.start(t0);
  carrier.start(t0);
  lfo.stop(tEnd + 0.02);
  carrier.stop(tEnd + 0.02);
}

export function scheduleEvents(
  ctx: BaseAudioContext,
  events: PlayEvent[],
  startWhen = 0,
): AudioNode[] {
  const nodes: AudioNode[] = [];
  let t = startWhen + ctx.currentTime;
  for (const e of events) {
    if (e.kind === "silence") {
      t += e.durationSec;
      continue;
    }
    if (e.kind === "tone") scheduleTone(ctx, t, e, nodes);
    else if (e.kind === "sweep") scheduleSweep(ctx, t, e, nodes);
    else scheduleWarble(ctx, t, e, nodes);
    t += e.durationSec;
  }
  return nodes;
}

export function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function renderOffline(
  events: PlayEvent[],
  sampleRate: number,
): Promise<AudioBuffer> {
  const dur = totalDurationSec(events);
  const length = Math.max(1, Math.ceil(dur * sampleRate));
  const offline = new OfflineAudioContext(1, length, sampleRate);
  const master = offline.createGain();
  master.gain.value = 1;
  master.connect(offline.destination);

  let t = 0;
  for (const e of events) {
    if (e.kind === "silence") {
      t += e.durationSec;
      continue;
    }
    if (e.kind === "tone") {
      const osc = offline.createOscillator();
      const g = offline.createGain();
      osc.type = e.wave;
      osc.frequency.setValueAtTime(e.freqHz, t);
      const peak = Math.max(0, Math.min(100, e.vol)) / 100;
      const v = peak * HEADROOM;
      const t0 = t;
      const tEnd = t + e.durationSec;
      const t1 = t0 + Math.min(FADE_SEC, e.durationSec / 4);
      const tFadeOut = Math.max(t1, tEnd - Math.min(FADE_SEC, e.durationSec / 4));
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v, t1);
      g.gain.setValueAtTime(v, tFadeOut);
      g.gain.linearRampToValueAtTime(0, tEnd);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(tEnd + 0.02);
    } else if (e.kind === "sweep") {
      const osc = offline.createOscillator();
      const g = offline.createGain();
      osc.type = e.wave;
      const t0 = t;
      const tEnd = t + e.durationSec;
      osc.frequency.setValueAtTime(e.fromHz, t0);
      osc.frequency.linearRampToValueAtTime(e.toHz, tEnd);
      const peak = Math.max(0, Math.min(100, e.vol)) / 100;
      const v = peak * HEADROOM;
      const t1 = t0 + Math.min(FADE_SEC, e.durationSec / 4);
      const tFadeOut = Math.max(t1, tEnd - Math.min(FADE_SEC, e.durationSec / 4));
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v, t1);
      g.gain.setValueAtTime(v, tFadeOut);
      g.gain.linearRampToValueAtTime(0, tEnd);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(tEnd + 0.02);
    } else {
      const carrier = offline.createOscillator();
      const lfo = offline.createOscillator();
      const lfoGain = offline.createGain();
      const g = offline.createGain();
      carrier.type = e.wave;
      lfo.type = "sine";
      const t0 = t;
      const tEnd = t + e.durationSec;
      carrier.frequency.setValueAtTime(e.baseFreqHz, t0);
      lfo.frequency.setValueAtTime(Math.max(0.1, e.rateHz), t0);
      lfoGain.gain.setValueAtTime(Math.max(0, e.depthHz), t0);
      lfo.connect(lfoGain);
      lfoGain.connect(carrier.frequency);
      const peak = Math.max(0, Math.min(100, e.vol)) / 100;
      const v = peak * HEADROOM;
      const t1 = t0 + Math.min(FADE_SEC, e.durationSec / 4);
      const tFadeOut = Math.max(t1, tEnd - Math.min(FADE_SEC, e.durationSec / 4));
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v, t1);
      g.gain.setValueAtTime(v, tFadeOut);
      g.gain.linearRampToValueAtTime(0, tEnd);
      carrier.connect(g);
      g.connect(master);
      lfo.start(t0);
      carrier.start(t0);
      lfo.stop(tEnd + 0.02);
      carrier.stop(tEnd + 0.02);
    }
    t += e.durationSec;
  }

  return offline.startRendering();
}
