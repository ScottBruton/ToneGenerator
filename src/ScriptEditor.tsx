import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import {
  lineHasPlaceholder,
  PLACEHOLDER_TOOLTIP,
  scriptHasPlaceholder,
} from "./script/placeholders";

export type ScriptEditorHandle = {
  insertSnippet: (text: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export const ScriptEditor = forwardRef<ScriptEditorHandle, Props>(
  function ScriptEditor({ value, onChange, className }, ref) {
    const backdropRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);

    const syncScroll = useCallback(() => {
      const b = backdropRef.current;
      const t = taRef.current;
      if (b && t) {
        b.scrollTop = t.scrollTop;
        b.scrollLeft = t.scrollLeft;
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          taRef.current?.focus();
        },
        insertSnippet: (snippet: string) => {
          const ta = taRef.current;
          if (!ta) {
            onChange(value + (value.endsWith("\n") ? "" : "\n") + snippet);
            return;
          }
          const start = ta.selectionStart ?? value.length;
          const end = ta.selectionEnd ?? value.length;
          const before = value.slice(0, start);
          const after = value.slice(end);
          const needsLead = before.length > 0 && !before.endsWith("\n");
          const insert = `${needsLead ? "\n" : ""}${snippet}`;
          const next = before + insert + after;
          onChange(next);
          requestAnimationFrame(() => {
            const pos = start + insert.length;
            ta.focus();
            ta.setSelectionRange(pos, pos);
            syncScroll();
          });
        },
      }),
      [onChange, value, syncScroll],
    );

    const lines = value.split("\n");
    const anyPh = scriptHasPlaceholder(value);

    return (
      <div className={`script-editor-wrap ${className ?? ""}`}>
        <div
          ref={backdropRef}
          className="script-editor-backdrop"
          aria-hidden
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                lineHasPlaceholder(line)
                  ? "script-line script-line-warning"
                  : "script-line"
              }
            >
              <span>{line.length ? line : " "}</span>
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          wrap="off"
          className="script-editor-ta"
          title={anyPh ? PLACEHOLDER_TOOLTIP : undefined}
        />
      </div>
    );
  },
);
