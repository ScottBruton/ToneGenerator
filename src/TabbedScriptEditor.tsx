import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { NamedScript } from "./preset";
import { ScriptEditor, type ScriptEditorHandle } from "./ScriptEditor";

export type TabbedScriptEditorProps = {
  items: NamedScript[];
  onItemsChange: (items: NamedScript[]) => void;
  /** If false, tab cannot be removed */
  canDeleteTab: (item: NamedScript, index: number) => boolean;
  /** If false, double-click rename disabled */
  canRenameTab: (item: NamedScript, index: number) => boolean;
  addLabel?: string;
  suggestNewName: (items: NamedScript[]) => string;
  emptyBodyForNew: string;
};

export const TabbedScriptEditor = forwardRef<
  ScriptEditorHandle,
  TabbedScriptEditorProps
>(function TabbedScriptEditor(
  {
    items,
    onItemsChange,
    canDeleteTab,
    canRenameTab,
    addLabel = "Add",
    suggestNewName,
    emptyBodyForNew,
  },
  ref,
) {
  const [activeIndex, setActiveIndex] = useState(0);
  const innerRef = useRef<ScriptEditorHandle>(null);

  useImperativeHandle(ref, () => ({
    insertSnippet: (text: string) => innerRef.current?.insertSnippet(text),
    focus: () => innerRef.current?.focus(),
  }));

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, activeIndex]);

  const active = items[activeIndex];

  const updateBody = useCallback(
    (body: string) => {
      if (!active) return;
      const next = items.slice();
      next[activeIndex] = { ...next[activeIndex], body };
      onItemsChange(next);
    },
    [items, activeIndex, onItemsChange, active],
  );

  const updateParams = useCallback(
    (raw: string) => {
      if (!active) return;
      const params = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const next = items.slice();
      const base = { ...next[activeIndex] };
      if (params.length) base.params = params;
      else delete base.params;
      next[activeIndex] = base;
      onItemsChange(next);
    },
    [items, activeIndex, onItemsChange, active],
  );

  const renameAt = useCallback(
    (index: number) => {
      const it = items[index];
      if (!it || !canRenameTab(it, index)) return;
      const nextName = window.prompt("Method name", it.name);
      if (nextName === null) return;
      const name = nextName.trim().replace(/\s+/g, "_");
      if (!name) return;
      if (items.some((x, i) => i !== index && x.name === name)) {
        window.alert(`A tab named "${name}" already exists.`);
        return;
      }
      const next = items.slice();
      next[index] = { ...next[index], name };
      onItemsChange(next);
    },
    [items, onItemsChange, canRenameTab],
  );

  const deleteAt = useCallback(
    (index: number, e: MouseEvent) => {
      e.stopPropagation();
      const it = items[index];
      if (!it || !canDeleteTab(it, index)) return;
      if (!window.confirm(`Remove "${it.name}"?`)) return;
      const next = items.filter((_, i) => i !== index);
      onItemsChange(next);
      setActiveIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
    },
    [items, onItemsChange, canDeleteTab],
  );

  const addItem = useCallback(() => {
    const suggestion = suggestNewName(items);
    const entered = window.prompt(`${addLabel} name`, suggestion);
    if (entered === null) return;
    const name = entered.trim().replace(/\s+/g, "_");
    if (!name) return;
    if (items.some((x) => x.name === name)) {
      window.alert(`"${name}" already exists.`);
      return;
    }
    const next = [...items, { name, body: emptyBodyForNew }];
    onItemsChange(next);
    setActiveIndex(next.length - 1);
  }, [items, onItemsChange, suggestNewName, emptyBodyForNew, addLabel]);

  return (
    <div className="tabbed-script-editor">
      <div className="tabbed-editor-tabs" role="tablist">
        {items.map((it, i) => (
          <div key={`${i}-${it.name}`} className="tabbed-editor-tab-wrap">
            <button
              type="button"
              role="tab"
              className={`tabbed-editor-tab ${i === activeIndex ? "active" : ""}`}
              aria-selected={i === activeIndex}
              onClick={() => setActiveIndex(i)}
              onDoubleClick={(e) => {
                e.preventDefault();
                renameAt(i);
              }}
              title={
                canRenameTab(it, i)
                  ? "Double-click to rename"
                  : undefined
              }
            >
              {it.name}
            </button>
            {canDeleteTab(it, i) ? (
              <button
                type="button"
                className="tabbed-editor-tab-close"
                aria-label={`Remove ${it.name}`}
                onClick={(e) => deleteAt(i, e)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="tabbed-editor-tab tabbed-editor-tab-add"
          onClick={addItem}
          title="New method"
        >
          +
        </button>
      </div>
      {items.length === 0 ? (
        <p className="tabbed-editor-empty">Nothing here yet — click + to add.</p>
      ) : active ? (
        <>
          <label className="tabbed-params">
            <span>Parameters</span>
            <input
              type="text"
              className="tabbed-params-input"
              spellCheck={false}
              placeholder="comma-separated, e.g. freq, ms, vol"
              value={(active.params ?? []).join(", ")}
              onChange={(e) => updateParams(e.target.value)}
              aria-label="Method or sound parameters"
            />
          </label>
          <ScriptEditor
            ref={innerRef}
            value={active.body}
            onChange={updateBody}
          />
        </>
      ) : null}
    </div>
  );
});
