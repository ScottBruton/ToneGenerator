import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  disconnectAll,
  manualToPlayEvents,
  renderOffline,
  scheduleEvents,
  scriptToPlayEvents,
  totalDurationSec,
} from "./audio/engine";
import { encodeWavMono16 } from "./audio/wav";
import {
  COMMAND_TEMPLATES,
  SOUND_TEMPLATE_IDS,
  type SoundTemplateId,
} from "./commandTemplates";
import {
  buildMethodsFileFromList,
  defaultProject,
  isTauri,
  normalizeLoadedProject,
  type NamedScript,
  type ToneProjectV4,
  SAMPLE_RATES,
} from "./preset";
import { ScriptEditor, type ScriptEditorHandle } from "./ScriptEditor";
import { TabbedScriptEditor } from "./TabbedScriptEditor";
import {
  composeMethodRegistry,
  stripLeadingImports,
  type ImportDecl,
} from "./script/imports";
import {
  expandCalls,
  parseMainScriptFlexible,
} from "./script/parser";
import {
  PLACEHOLDER_TOOLTIP,
  scriptHasPlaceholder,
} from "./script/placeholders";
import type { ScriptCommand, Waveform } from "./script/types";
import "./App.css";

function downloadBlob(filename: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function saveProjectToDisk(project: ToneProjectV4): Promise<void> {
  const text = JSON.stringify(project, null, 2);
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      title: "Save project",
      defaultPath: `${project.name.replace(/[^\w\-]+/g, "_")}.tone-project.json`,
      filters: [{ name: "Tone project", extensions: ["json"] }],
    });
    if (path) await writeTextFile(path, text);
  } else {
    downloadBlob(
      `${project.name}.tone-project.json`,
      new Blob([text], { type: "application/json" }),
    );
  }
}

async function openProjectFromDisk(): Promise<ToneProjectV4 | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      title: "Load project",
      multiple: false,
      filters: [
        { name: "Tone project", extensions: ["json"] },
        { name: "All", extensions: ["*"] },
      ],
    });
    if (!path || Array.isArray(path)) return null;
    const raw = await readTextFile(path);
    return normalizeLoadedProject(JSON.parse(raw));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      const text = await f.text();
      resolve(normalizeLoadedProject(JSON.parse(text)));
    };
    input.click();
  });
}

async function saveWavFile(name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      title: "Export WAV",
      defaultPath: `${name.replace(/[^\w\-]+/g, "_")}.wav`,
      filters: [{ name: "WAV", extensions: ["wav"] }],
    });
    if (path) await writeFile(path, bytes);
  } else {
    downloadBlob(
      `${name}.wav`,
      new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    );
  }
}

const DEFAULT_IMPORTS: ImportDecl[] = ["sounds", "methods"];

function buildExpandedCommands(project: ToneProjectV4): ScriptCommand[] {
  const { imports, body } = stripLeadingImports(project.mainScript);
  const effectiveImports =
    imports.length > 0 ? imports : DEFAULT_IMPORTS;
  const methodsScript = buildMethodsFileFromList(project.methodsList);
  const soundsScript = buildMethodsFileFromList(project.soundsList);
  const registry = composeMethodRegistry(
    effectiveImports,
    methodsScript,
    soundsScript,
  );
  const mainCmds = parseMainScriptFlexible(body);
  return expandCalls(mainCmds, registry);
}

function isBuiltinSoundName(name: string): boolean {
  return SOUND_TEMPLATE_IDS.includes(name as SoundTemplateId);
}

function pillInsertText(id: string, soundsList: NamedScript[]): string {
  if (id === "method") {
    return (
      COMMAND_TEMPLATES.find((c) => c.id === "method")?.pillInsert ?? ""
    );
  }
  const row = soundsList.find((s) => s.name === id);
  if (row?.body.trim()) return row.body.trim();
  return COMMAND_TEMPLATES.find((c) => c.id === id)?.pillInsert ?? "";
}

function projectHasAnyPlaceholder(p: ToneProjectV4): boolean {
  if (scriptHasPlaceholder(p.mainScript)) return true;
  for (const m of p.methodsList) {
    if (scriptHasPlaceholder(m.body)) return true;
  }
  for (const s of p.soundsList) {
    if (scriptHasPlaceholder(s.body)) return true;
  }
  return false;
}

function suggestNewMethodName(items: NamedScript[]): string {
  let n = 1;
  while (items.some((x) => x.name === `method_${n}`)) n++;
  return `method_${n}`;
}

function suggestNewSoundName(items: NamedScript[]): string {
  let n = 1;
  while (items.some((x) => x.name === `sound_${n}`)) n++;
  return `sound_${n}`;
}

const WAVES: { value: Waveform; label: string }[] = [
  { value: "sine", label: "Sine" },
  { value: "square", label: "Square" },
  { value: "triangle", label: "Triangle" },
  { value: "sawtooth", label: "Sawtooth" },
];

export default function App() {
  const [project, setProject] = useState<ToneProjectV4>(() => defaultProject());
  const [parseError, setParseError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [modeTab, setModeTab] = useState<"manual" | "script">("script");
  const [scriptPane, setScriptPane] = useState<"main" | "methods" | "sounds">(
    "main",
  );

  const mainEditorRef = useRef<ScriptEditorHandle>(null);
  const methodsEditorRef = useRef<ScriptEditorHandle>(null);
  const soundsEditorRef = useRef<ScriptEditorHandle>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);

  const stopPlayback = useCallback(() => {
    disconnectAll(nodesRef.current);
    nodesRef.current = [];
    setPlaying(false);
  }, []);

  const ensureCtx = useCallback(async (preferredSampleRate?: number) => {
    if (ctxRef.current?.state === "closed") ctxRef.current = null;

    const needNew =
      !ctxRef.current ||
      (preferredSampleRate !== undefined &&
        Math.round(ctxRef.current.sampleRate) !==
          Math.round(preferredSampleRate));

    if (needNew && ctxRef.current) {
      disconnectAll(nodesRef.current);
      nodesRef.current = [];
      try {
        await ctxRef.current.close();
      } catch {
        /* ignore */
      }
      ctxRef.current = null;
    }

    if (!ctxRef.current) {
      try {
        ctxRef.current =
          preferredSampleRate !== undefined
            ? new AudioContext({ sampleRate: preferredSampleRate })
            : new AudioContext();
      } catch {
        ctxRef.current = new AudioContext();
      }
    }
    if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const scriptEvents = useMemo(() => {
    try {
      const expanded = buildExpandedCommands(project);
      return scriptToPlayEvents(expanded);
    } catch {
      return null;
    }
  }, [project]);

  const scriptDuration =
    scriptEvents !== null ? totalDurationSec(scriptEvents) : null;

  const manualEvents = useMemo(
    () =>
      manualToPlayEvents({
        wave: project.manual.wave,
        frequencyHz: project.manual.frequencyHz,
        durationMs: project.manual.durationMs,
        volume: project.manual.volume,
        loops: project.manual.loops,
        pauseMs: project.manual.pauseMs,
      }),
    [project.manual],
  );

  const manualDuration = totalDurationSec(manualEvents);

  const playMainScript = useCallback(async () => {
    setParseError(null);
    if (projectHasAnyPlaceholder(project)) {
      setParseError(PLACEHOLDER_TOOLTIP);
      return;
    }
    let expanded;
    try {
      expanded = buildExpandedCommands(project);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    stopPlayback();
    const ctx = await ensureCtx(project.manual.sampleRate);
    const events = scriptToPlayEvents(expanded);
    nodesRef.current = scheduleEvents(ctx, events);
    setPlaying(true);
    window.setTimeout(
      () => {
        setPlaying(false);
      },
      Math.ceil(totalDurationSec(events) * 1000) + 80,
    );
  }, [ensureCtx, project, stopPlayback]);

  const playManual = useCallback(async () => {
    stopPlayback();
    const ctx = await ensureCtx(project.manual.sampleRate);
    const events = manualToPlayEvents({
      wave: project.manual.wave,
      frequencyHz: project.manual.frequencyHz,
      durationMs: project.manual.durationMs,
      volume: project.manual.volume,
      loops: project.manual.loops,
      pauseMs: project.manual.pauseMs,
    });
    nodesRef.current = scheduleEvents(ctx, events);
    setPlaying(true);
    window.setTimeout(
      () => setPlaying(false),
      Math.ceil(totalDurationSec(events) * 1000) + 80,
    );
  }, [ensureCtx, project.manual, stopPlayback]);

  const exportScriptWav = useCallback(async () => {
    setParseError(null);
    if (projectHasAnyPlaceholder(project)) {
      setParseError(PLACEHOLDER_TOOLTIP);
      return;
    }
    let expanded;
    try {
      expanded = buildExpandedCommands(project);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    const events = scriptToPlayEvents(expanded);
    const sr = project.manual.sampleRate;
    const buf = await renderOffline(events, sr);
    const bytes = encodeWavMono16(buf);
    await saveWavFile(project.name + "_main", bytes);
  }, [project]);

  const exportManualWav = useCallback(async () => {
    const events = manualToPlayEvents({
      wave: project.manual.wave,
      frequencyHz: project.manual.frequencyHz,
      durationMs: project.manual.durationMs,
      volume: project.manual.volume,
      loops: project.manual.loops,
      pauseMs: project.manual.pauseMs,
    });
    const buf = await renderOffline(events, project.manual.sampleRate);
    const bytes = encodeWavMono16(buf);
    await saveWavFile(project.name + "_manual", bytes);
  }, [project.manual, project.name]);

  const applyLoadedProject = useCallback((p: ToneProjectV4) => {
    setProject(p);
    setParseError(null);
  }, []);

  const saveProject = useCallback(async () => {
    await saveProjectToDisk(project);
  }, [project]);

  const loadProject = useCallback(async () => {
    const p = await openProjectFromDisk();
    if (p) applyLoadedProject(p);
  }, [applyLoadedProject]);

  const updateManual = useCallback(
    (patch: Partial<ToneProjectV4["manual"]>) => {
      setProject((prev) => ({
        ...prev,
        manual: { ...prev.manual, ...patch },
      }));
    },
    [],
  );

  const insertTemplate = useCallback(
    (id: string) => {
      const text = pillInsertText(id, project.soundsList);
      const ref =
        scriptPane === "main"
          ? mainEditorRef
          : scriptPane === "methods"
            ? methodsEditorRef
            : soundsEditorRef;
      ref.current?.insertSnippet(text);
    },
    [scriptPane, project.soundsList],
  );

  useEffect(() => {
    if (modeTab !== "script") return;
    if (scriptPane === "main") mainEditorRef.current?.focus();
    else if (scriptPane === "methods") methodsEditorRef.current?.focus();
    else soundsEditorRef.current?.focus();
  }, [modeTab, scriptPane]);

  const visiblePills =
    scriptPane === "sounds"
      ? []
      : COMMAND_TEMPLATES.filter((t) =>
          scriptPane === "main"
            ? t.showOnMain !== false
            : t.showOnMethods !== false,
        );

  return (
    <div className="app">
      <header className="header">
        <h1>Tone Generator</h1>
        <p className="subtitle">
          Manual tones or scripted sequences (Web Audio). Export WAV at your
          chosen sample rate.
        </p>
      </header>

      <div className="toolbar">
        <label className="field inline">
          <span>Project name</span>
          <input
            value={project.name}
            onChange={(e) =>
              setProject((p) => ({ ...p, name: e.target.value }))
            }
          />
        </label>
        <button type="button" onClick={saveProject}>
          Save project…
        </button>
        <button type="button" onClick={loadProject}>
          Load project…
        </button>
        {playing ? (
          <button type="button" className="secondary" onClick={stopPlayback}>
            Stop
          </button>
        ) : null}
      </div>

      <div className="tabs mode-tabs">
        <button
          type="button"
          className={modeTab === "script" ? "active" : ""}
          onClick={() => setModeTab("script")}
        >
          Script
        </button>
        <button
          type="button"
          className={modeTab === "manual" ? "active" : ""}
          onClick={() => setModeTab("manual")}
        >
          Manual
        </button>
      </div>

      <div className="main-grid">
        {modeTab === "script" ? (
          <section className="panel script-panel">
            <div className="script-file-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={scriptPane === "main"}
                className={scriptPane === "main" ? "active" : ""}
                onClick={() => setScriptPane("main")}
              >
                main
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scriptPane === "methods"}
                className={scriptPane === "methods" ? "active" : ""}
                onClick={() => setScriptPane("methods")}
              >
                methods
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scriptPane === "sounds"}
                className={scriptPane === "sounds" ? "active" : ""}
                onClick={() => setScriptPane("sounds")}
              >
                sounds
              </button>
            </div>
            <div className="panel-head">
              <h2>
                {scriptPane === "main"
                  ? "main()"
                  : scriptPane === "methods"
                    ? "methods"
                    : "sounds"}
              </h2>
              {scriptPane !== "sounds" && scriptDuration !== null ? (
                <span className="meta">
                  main() duration ~{scriptDuration.toFixed(3)}s
                </span>
              ) : null}
            </div>

            {scriptPane === "main" ? (
              <ScriptEditor
                ref={mainEditorRef}
                value={project.mainScript}
                onChange={(mainScript) =>
                  setProject((p) => ({ ...p, mainScript }))
                }
              />
            ) : scriptPane === "methods" ? (
              <TabbedScriptEditor
                ref={methodsEditorRef}
                items={project.methodsList}
                onItemsChange={(methodsList) =>
                  setProject((p) => ({ ...p, methodsList }))
                }
                canDeleteTab={() => true}
                canRenameTab={() => true}
                addLabel="New method"
                suggestNewName={suggestNewMethodName}
                emptyBodyForNew="wave sine"
              />
            ) : (
              <TabbedScriptEditor
                ref={soundsEditorRef}
                items={project.soundsList}
                onItemsChange={(soundsList) =>
                  setProject((p) => ({ ...p, soundsList }))
                }
                canDeleteTab={(item) => !isBuiltinSoundName(item.name)}
                canRenameTab={(item) => !isBuiltinSoundName(item.name)}
                addLabel="New sound"
                suggestNewName={suggestNewSoundName}
                emptyBodyForNew="wave sine"
              />
            )}

            {scriptPane !== "sounds" ? (
              <>
                <div className="script-actions">
                  <button type="button" onClick={playMainScript}>
                    Play main() script
                  </button>
                  <button type="button" onClick={exportScriptWav}>
                    Export main() as WAV…
                  </button>
                </div>

                <div className="command-pills" aria-label="Insert command template">
                  {visiblePills.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="pill"
                      onClick={() => insertTemplate(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="hint hint-tight">
                  Start <code>main</code> with <code>import methods</code> and/or{" "}
                  <code>import sounds</code>. Methods/sounds can declare parameters
                  (comma-separated under the tabs) and use{" "}
                  <code>&#123;&#123;name&#125;&#125;</code> in the body; call with
                  positional or{" "}
                  <code>name: value</code> arguments. Pills insert{" "}
                  <code>call …</code> lines for reusable sounds. Replace{" "}
                  <code>XXX</code> where shown.
                </p>
              </>
            ) : (
              <p className="hint hint-tight sounds-tab-hint">
                Built-in tabs (<code>wave</code> … <code>call</code>) keep their
                names; use + for extra callable sounds. Edit parameters and{" "}
                <code>&#123;&#123;placeholders&#125;&#125;</code> like on methods.
                Double-click a
                tab to rename (custom sounds only).
              </p>
            )}
          </section>
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2>Manual tone</h2>
              <span className="meta">
                Duration ~{manualDuration.toFixed(3)}s
              </span>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Wave</span>
                <select
                  value={project.manual.wave}
                  onChange={(e) =>
                    updateManual({ wave: e.target.value as Waveform })
                  }
                >
                  {WAVES.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Frequency (Hz)</span>
                <input
                  type="number"
                  min={20}
                  max={20000}
                  step={1}
                  value={project.manual.frequencyHz}
                  onChange={(e) =>
                    updateManual({
                      frequencyHz: Number.parseFloat(e.target.value) || 440,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Duration (ms)</span>
                <input
                  type="number"
                  min={1}
                  max={600000}
                  step={1}
                  value={project.manual.durationMs}
                  onChange={(e) =>
                    updateManual({
                      durationMs: Number.parseFloat(e.target.value) || 1,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Volume (0–100)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={project.manual.volume}
                  onChange={(e) =>
                    updateManual({
                      volume: Number.parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Loops</span>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  step={1}
                  value={project.manual.loops}
                  onChange={(e) =>
                    updateManual({
                      loops: Math.max(
                        1,
                        Math.floor(Number.parseFloat(e.target.value) || 1),
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Pause between loops (ms)</span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  step={1}
                  value={project.manual.pauseMs}
                  onChange={(e) =>
                    updateManual({
                      pauseMs: Math.max(
                        0,
                        Number.parseFloat(e.target.value) || 0,
                      ),
                    })
                  }
                />
              </label>
            </div>
            <div className="script-actions">
              <button type="button" onClick={playManual}>
                Play manual
              </button>
              <button type="button" onClick={exportManualWav}>
                Export manual as WAV…
              </button>
            </div>
          </section>
        )}

        <aside className="panel side">
          <h2>Output resolution</h2>
          <p className="side-note">
            Used for WAV export and for the live audio context when supported.
          </p>
          <label className="field">
            <span>Sample rate (Hz)</span>
            <select
              value={project.manual.sampleRate}
              onChange={(e) =>
                updateManual({ sampleRate: Number.parseInt(e.target.value, 10) })
              }
            >
              {SAMPLE_RATES.map((sr) => (
                <option key={sr} value={sr}>
                  {sr}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary full"
            onClick={async () => {
              await ensureCtx(project.manual.sampleRate);
            }}
          >
            Apply sample rate to engine
          </button>
          {parseError ? (
            <div className="error" role="alert">
              {parseError}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
