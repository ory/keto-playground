import { useState } from "react";

/**
 * Collapsible OPL schema viewer/editor panel (offline mode only).
 *
 * Receives the bundled schema string for the selected example via
 * `defaultSchema`. All edits are local state — use `ory update opl`
 * to apply changes to a live Ory Keto instance.
 *
 * Keyed on `selectedExample` in the parent so state resets automatically
 * when the example changes.
 */
export function SchemaEditor({ defaultSchema }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(defaultSchema ?? "");

  const isEdited = text !== (defaultSchema ?? "");

  function handleReset() {
    setText(defaultSchema ?? "");
  }

  return (
    <div className={`schema-editor${expanded ? " schema-editor--expanded" : ""}`}>
      {/* Toolbar strip */}
      <div className="schema-editor-toolbar">
        <button
          className="schema-toggle-btn"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="rel-toggle-icon">{expanded ? "▼" : "▲"}</span>
          Schema
          <span className="schema-lang-badge">OPL</span>
          {isEdited && <span className="rel-modified">edited</span>}
        </button>
        {expanded && isEdited && (
          <button className="rel-btn rel-btn-ghost" onClick={handleReset}>
            Reset to original
          </button>
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="schema-editor-body">
          <textarea
            className="schema-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <div className="schema-editor-footer">
            Local only — apply to Ory with{" "}
            <code>ory update opl --file namespace.ts</code>
          </div>
        </div>
      )}
    </div>
  );
}
