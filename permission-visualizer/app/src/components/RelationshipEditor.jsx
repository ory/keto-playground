import { Fragment, useState } from "react";

function formatSubject(tuple) {
  if (tuple.subject_id) return tuple.subject_id;
  if (tuple.subject_set) {
    const { namespace, object, relation } = tuple.subject_set;
    return relation ? `${namespace}:${object}#${relation}` : `${namespace}:${object}`;
  }
  return "—";
}

/**
 * Parse the smart subject text field back into tuple subject fields.
 * "alice"              → { subject_id: "alice" }
 * "Role:admin"         → { subject_set: { namespace:"Role", object:"admin", relation:"" } }
 * "Role:admin#members" → { subject_set: { namespace:"Role", object:"admin", relation:"members" } }
 */
function parseSubject(str) {
  const s = str.trim();
  const colonIdx = s.indexOf(":");
  if (colonIdx === -1) return { subject_id: s };
  const namespace = s.slice(0, colonIdx).trim();
  const rest = s.slice(colonIdx + 1);
  const hashIdx = rest.indexOf("#");
  if (hashIdx === -1) return { subject_set: { namespace, object: rest.trim(), relation: "" } };
  return {
    subject_set: {
      namespace,
      object: rest.slice(0, hashIdx).trim(),
      relation: rest.slice(hashIdx + 1).trim(),
    },
  };
}

function validateAddForm(form) {
  if (!form.namespace) return "Namespace is required";
  if (!form.object.trim()) return "Object is required";
  if (!/^[a-zA-Z0-9_:.-]+$/.test(form.object.trim())) return "Object contains invalid characters";
  if (!form.relation.trim()) return "Relation is required";
  if (!/^[a-zA-Z0-9_]+$/.test(form.relation.trim())) return "Relation contains invalid characters";
  if (form.subjectType === "user_id") {
    if (!form.subjectId.trim()) return "Subject ID is required";
    if (!/^[a-zA-Z0-9_:.-]+$/.test(form.subjectId.trim())) return "Subject ID contains invalid characters";
  } else {
    if (!form.ssNamespace) return "Subject namespace is required";
    if (!form.ssObject.trim()) return "Subject object is required";
    if (form.ssRelation && !/^[a-zA-Z0-9_]+$/.test(form.ssRelation.trim())) {
      return "Subject relation contains invalid characters";
    }
  }
  return null;
}

function validateEditRow({ namespace, object, relation, subject }) {
  if (!namespace) return "Namespace is required";
  if (!object.trim()) return "Object is required";
  if (!/^[a-zA-Z0-9_:.-]+$/.test(object.trim())) return "Object contains invalid characters";
  if (!relation.trim()) return "Relation is required";
  if (!/^[a-zA-Z0-9_]+$/.test(relation.trim())) return "Relation contains invalid characters";
  if (!subject.trim()) return "Subject is required";
  return null;
}

function buildTuple(form) {
  const base = {
    namespace: form.namespace,
    object: form.object.trim(),
    relation: form.relation.trim(),
  };
  if (form.subjectType === "user_id") {
    return { ...base, subject_id: form.subjectId.trim() };
  }
  return {
    ...base,
    subject_set: {
      namespace: form.ssNamespace,
      object: form.ssObject.trim(),
      relation: form.ssRelation.trim(),
    },
  };
}

const EMPTY_FORM = {
  namespace: "",
  object: "",
  relation: "",
  subjectType: "user_id",
  subjectId: "",
  ssNamespace: "",
  ssObject: "",
  ssRelation: "",
};

export function RelationshipEditor({
  baseTuples,
  customTuples,
  deletedTupleKeys,
  namespaces,
  onAddTuple,
  onDeleteBaseTuple,
  onDeleteCustomTuple,
  onUpdateCustomTuple,
  onReset,
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  // Inline edit state
  const [editingRow, setEditingRow] = useState(null);
  // null | { type:'base'|'custom', index, namespace, object, relation, subject }
  const [editError, setEditError] = useState("");

  const activeBaseCount = baseTuples.length - deletedTupleKeys.size;
  const totalVisible = activeBaseCount + customTuples.length;
  const hasChanges = deletedTupleKeys.size > 0 || customTuples.length > 0;

  // ── Add form handlers ──────────────────────────────────────────────

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError("");
  }

  function handleSubmit(e) {
    e.preventDefault();
    const error = validateAddForm(form);
    if (error) { setFormError(error); return; }
    onAddTuple(buildTuple(form));
    setForm(EMPTY_FORM);
    setFormError("");
    setShowAddForm(false);
  }

  function handleReset() {
    if (window.confirm("Reset all relationship edits and restore the original example data?")) {
      onReset();
      setEditingRow(null);
      setEditError("");
    }
  }

  // ── Inline edit handlers ───────────────────────────────────────────

  function startEdit(type, index, tuple) {
    setShowAddForm(false);
    setEditingRow({
      type,
      index,
      namespace: tuple.namespace,
      object: tuple.object,
      relation: tuple.relation,
      subject: formatSubject(tuple),
    });
    setEditError("");
  }

  function cancelEdit() {
    setEditingRow(null);
    setEditError("");
  }

  function setEditField(key, value) {
    setEditingRow((prev) => ({ ...prev, [key]: value }));
    setEditError("");
  }

  function handleEditSave() {
    const error = validateEditRow(editingRow);
    if (error) { setEditError(error); return; }

    const { type, index, namespace, object, relation, subject } = editingRow;
    const newTuple = {
      namespace,
      object: object.trim(),
      relation: relation.trim(),
      ...parseSubject(subject),
    };

    if (type === "base") {
      // Replace: delete original, add as new custom tuple
      onDeleteBaseTuple(index);
      onAddTuple(newTuple);
    } else {
      onUpdateCustomTuple(index, newTuple);
    }
    setEditingRow(null);
    setEditError("");
  }

  // ── Row renderers ──────────────────────────────────────────────────

  const editKeyDown = (e) => {
    if (e.key === "Enter") handleEditSave();
    if (e.key === "Escape") cancelEdit();
  };

  function renderEditRow(key, rowClass) {
    return (
      <Fragment key={key}>
        <tr className={`rel-row rel-row-editing ${rowClass}`}>
          <td>
            <select
              className="rel-input rel-input-cell"
              value={editingRow.namespace}
              onChange={(e) => setEditField("namespace", e.target.value)}
              onKeyDown={editKeyDown}
            >
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
          </td>
          <td>
            <input
              className="rel-input rel-input-cell"
              value={editingRow.object}
              onChange={(e) => setEditField("object", e.target.value)}
              onKeyDown={editKeyDown}
            />
          </td>
          <td>
            <input
              className="rel-input rel-input-cell"
              value={editingRow.relation}
              onChange={(e) => setEditField("relation", e.target.value)}
              onKeyDown={editKeyDown}
            />
          </td>
          <td>
            <input
              className="rel-input rel-input-cell rel-subject-input"
              value={editingRow.subject}
              placeholder="user-id  or  NS:obj#rel"
              onChange={(e) => setEditField("subject", e.target.value)}
              onKeyDown={editKeyDown}
            />
          </td>
          <td className="rel-edit-actions">
            <button className="rel-save-btn" onClick={handleEditSave} title="Save (Enter)">✓</button>
            <button className="rel-cancel-btn" onClick={cancelEdit} title="Cancel (Esc)">✗</button>
          </td>
        </tr>
        {editError && (
          <tr className="rel-row-error">
            <td colSpan="5" className="rel-edit-error">{editError}</td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div className={`rel-editor${expanded ? " rel-editor--expanded" : ""}`}>
      {/* Toolbar strip */}
      <div className="rel-editor-toolbar">
        <button className="rel-toggle-btn" onClick={() => setExpanded((v) => !v)}>
          <span className="rel-toggle-icon">{expanded ? "▼" : "▲"}</span>
          Relationships
          <span className="rel-count">{totalVisible} tuples</span>
          {hasChanges && <span className="rel-modified">edited</span>}
        </button>
        {expanded && (
          <div className="rel-toolbar-right">
            <button
              className="rel-btn rel-btn-secondary"
              onClick={() => {
                setShowAddForm((v) => !v);
                setFormError("");
                setEditingRow(null);
                setEditError("");
              }}
            >
              {showAddForm ? "Cancel" : "+ Add Tuple"}
            </button>
            {hasChanges && (
              <button className="rel-btn rel-btn-ghost" onClick={handleReset}>
                Reset to default
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="rel-editor-body">
          {/* Add form */}
          {showAddForm && (
            <form className="rel-add-form" onSubmit={handleSubmit}>
              <div className="rel-add-row">
                <select
                  className="rel-input"
                  value={form.namespace}
                  onChange={(e) => setField("namespace", e.target.value)}
                >
                  <option value="">Namespace...</option>
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
                <input
                  className="rel-input"
                  placeholder="Object"
                  value={form.object}
                  onChange={(e) => setField("object", e.target.value)}
                />
                <input
                  className="rel-input"
                  placeholder="Relation"
                  value={form.relation}
                  onChange={(e) => setField("relation", e.target.value)}
                />
                <div className="rel-subject-type-toggle">
                  <button
                    type="button"
                    className={`rel-type-btn${form.subjectType === "user_id" ? " active" : ""}`}
                    onClick={() => setField("subjectType", "user_id")}
                  >
                    User ID
                  </button>
                  <button
                    type="button"
                    className={`rel-type-btn${form.subjectType === "subject_set" ? " active" : ""}`}
                    onClick={() => setField("subjectType", "subject_set")}
                  >
                    Subject Set
                  </button>
                </div>
                {form.subjectType === "user_id" ? (
                  <input
                    className="rel-input"
                    placeholder="Subject ID"
                    value={form.subjectId}
                    onChange={(e) => setField("subjectId", e.target.value)}
                  />
                ) : (
                  <>
                    <select
                      className="rel-input"
                      value={form.ssNamespace}
                      onChange={(e) => setField("ssNamespace", e.target.value)}
                    >
                      <option value="">Namespace...</option>
                      {namespaces.map((ns) => (
                        <option key={ns} value={ns}>{ns}</option>
                      ))}
                    </select>
                    <input
                      className="rel-input"
                      placeholder="Object"
                      value={form.ssObject}
                      onChange={(e) => setField("ssObject", e.target.value)}
                    />
                    <input
                      className="rel-input rel-input-sm"
                      placeholder="Relation (optional)"
                      value={form.ssRelation}
                      onChange={(e) => setField("ssRelation", e.target.value)}
                    />
                  </>
                )}
                <button type="submit" className="rel-btn rel-btn-primary">Add</button>
              </div>
              {formError && <div className="rel-form-error">{formError}</div>}
            </form>
          )}

          {/* Table */}
          <div className="rel-table-wrap">
            <table className="rel-table">
              <thead>
                <tr>
                  <th>Namespace</th>
                  <th>Object</th>
                  <th>Relation</th>
                  <th>Subject</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {baseTuples.map((t, i) => {
                  if (deletedTupleKeys.has(i)) return null;
                  if (editingRow?.type === "base" && editingRow?.index === i) {
                    return renderEditRow(`b-${i}`, "");
                  }
                  return (
                    <tr key={`b-${i}`} className="rel-row">
                      <td>{t.namespace}</td>
                      <td className="rel-mono">{t.object}</td>
                      <td><span className="rel-relation-tag">{t.relation}</span></td>
                      <td className="rel-mono rel-subject-cell">{formatSubject(t)}</td>
                      <td className="rel-row-actions">
                        <button
                          className="rel-edit-btn"
                          onClick={() => startEdit("base", i, t)}
                          title="Edit this tuple"
                        >
                          ✏
                        </button>
                        <button
                          className="rel-delete-btn"
                          onClick={() => onDeleteBaseTuple(i)}
                          title="Remove this tuple"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {customTuples.map((t, i) => {
                  if (editingRow?.type === "custom" && editingRow?.index === i) {
                    return renderEditRow(`c-${i}`, "rel-row-custom");
                  }
                  return (
                    <tr key={`c-${i}`} className="rel-row rel-row-custom">
                      <td>{t.namespace}</td>
                      <td className="rel-mono">{t.object}</td>
                      <td><span className="rel-relation-tag">{t.relation}</span></td>
                      <td className="rel-mono rel-subject-cell">{formatSubject(t)}</td>
                      <td className="rel-row-actions">
                        <button
                          className="rel-edit-btn"
                          onClick={() => startEdit("custom", i, t)}
                          title="Edit this tuple"
                        >
                          ✏
                        </button>
                        <button
                          className="rel-delete-btn"
                          onClick={() => onDeleteCustomTuple(i)}
                          title="Remove this tuple"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
