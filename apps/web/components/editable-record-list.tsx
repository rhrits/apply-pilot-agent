"use client";

/**
 * Editable, reorderable list of profile records (experience, education, projects).
 *
 * Order is real data: recruiters read the most recent role first, so the candidate's
 * chosen sequence is persisted rather than left to whatever order the database returns.
 *
 * Reordering is available two ways on purpose — pointer drag for speed, and Move
 * up/down buttons so the same action is reachable by keyboard and assistive tech.
 */

import { useState } from "react";

export interface RecordField<T> {
  key: keyof T & string;
  label: string;
  placeholder?: string;
  /** `text` is a single line, `area` a textarea, `list` a newline-separated string[]. */
  type?: "text" | "area" | "list";
  full?: boolean;
}

interface EditableRecordListProps<T> {
  items: T[];
  fields: Array<RecordField<T>>;
  title: (item: T, index: number) => string;
  subtitle?: (item: T, index: number) => string;
  onChange: (next: T[]) => void;
  createEmpty: () => T;
  addLabel: string;
  emptyHint: string;
}

export function EditableRecordList<T extends object>({
  items,
  fields,
  title,
  subtitle,
  onChange,
  createEmpty,
  addLabel,
  emptyHint,
}: EditableRecordListProps<T>) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  /** Interfaces have no index signature, so field access goes through one cast here. */
  const read = (item: T, key: keyof T & string): unknown => (item as Record<string, unknown>)[key];

  function update(index: number, key: keyof T & string, value: unknown) {
    const next = items.map((item, position) => (position === index ? { ...item, [key]: value } : item));
    onChange(next);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    if (openIndex === from) setOpenIndex(to);
  }

  function remove(index: number) {
    onChange(items.filter((_, position) => position !== index));
    setOpenIndex(null);
  }

  function duplicate(index: number) {
    const next = [...items];
    next.splice(index + 1, 0, { ...items[index] });
    onChange(next);
    setOpenIndex(index + 1);
  }

  function add() {
    onChange([...items, createEmpty()]);
    setOpenIndex(items.length);
  }

  return <div className="record-list">
    {items.length === 0 && <p className="empty-state">{emptyHint}</p>}

    {items.map((item, index) => {
      const isOpen = openIndex === index;
      return <article
        key={index}
        className={`record-card${isOpen ? " open" : ""}${dragOverIndex === index ? " drop-target" : ""}${dragIndex === index ? " dragging" : ""}`}
        draggable
        onDragStart={() => setDragIndex(index)}
        onDragOver={(event) => { event.preventDefault(); setDragOverIndex(index); }}
        onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          if (dragIndex !== null) move(dragIndex, index);
          setDragIndex(null);
          setDragOverIndex(null);
        }}
        onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
      >
        <div className="record-head">
          <span className="drag-handle" aria-hidden="true">⠿</span>
          <button
            type="button"
            className="record-summary"
            onClick={() => setOpenIndex(isOpen ? null : index)}
            aria-expanded={isOpen}
          >
            <strong>{title(item, index) || "Untitled"}</strong>
            {subtitle && <small>{subtitle(item, index)}</small>}
          </button>
          <div className="record-actions">
            <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label="Move up" title="Move up">↑</button>
            <button type="button" onClick={() => move(index, index + 1)} disabled={index === items.length - 1} aria-label="Move down" title="Move down">↓</button>
            <button type="button" onClick={() => duplicate(index)} aria-label="Duplicate" title="Duplicate">⧉</button>
            <button type="button" className="record-remove" onClick={() => remove(index)} aria-label="Remove" title="Remove">×</button>
          </div>
        </div>

        {isOpen && <div className="record-body">
          {fields.map((field) => {
            const raw = read(item, field.key);
            if (field.type === "list") {
              const list = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
              return <label key={field.key} className="record-field full">
                <span>{field.label}</span>
                <textarea
                  value={list.join("\n")}
                  rows={Math.min(8, Math.max(3, list.length + 1))}
                  placeholder={field.placeholder}
                  onChange={(event) => update(index, field.key, event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))}
                />
                <small className="record-hint">One per line</small>
              </label>;
            }
            if (field.type === "area") {
              return <label key={field.key} className="record-field full">
                <span>{field.label}</span>
                <textarea value={String(raw ?? "")} rows={4} placeholder={field.placeholder} onChange={(event) => update(index, field.key, event.target.value)} />
              </label>;
            }
            return <label key={field.key} className={`record-field${field.full ? " full" : ""}`}>
              <span>{field.label}</span>
              <input value={String(raw ?? "")} placeholder={field.placeholder} onChange={(event) => update(index, field.key, event.target.value)} />
            </label>;
          })}
        </div>}
      </article>;
    })}

    <button type="button" className="ghost-button record-add" onClick={add}>{addLabel}</button>
  </div>;
}
