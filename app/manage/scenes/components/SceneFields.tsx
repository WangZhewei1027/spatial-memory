"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/** Commit complete numeric edits on blur/Enter, never transient '-' or empty input. */
export function SceneNumberField({ id, value, onCommit, label, min, max, exclusiveMin, step = 0.1, disabled = false }: {
  id?: string; value: number; onCommit: (value: number) => void; label: string; min?: number; max?: number; exclusiveMin?: number; step?: number; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = String(value);
  const finish = () => {
    const number = Number(draft);
    if (draft?.trim() && Number.isFinite(number) && (exclusiveMin === undefined || number > exclusiveMin)) onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, number)));
    setDraft(null);
  };
  return <Input id={id} aria-label={label} type="number" min={min} max={max} step={step} value={draft ?? display} disabled={disabled} className="h-8 min-w-0 px-2 tabular-nums shadow-none" onChange={(event) => setDraft(event.target.value)} onBlur={finish} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { setDraft(null); event.preventDefault(); }
  }} />;
}

/** An optional numeric field commits a complete value, or null when cleared, as one history entry. */
export function SceneOptionalNumberField({ value, onCommit, label, placeholder, min = 0, max, step = .1, disabled = false }: {
  value: number | null; onCommit: (value: number | null) => void; label: string; placeholder?: string;
  min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = value === null ? '' : String(value);
  const finish = () => {
    if (draft !== null) {
      const number = Number(draft);
      if (!draft.trim()) onCommit(null);
      else if (Number.isFinite(number)) onCommit(Math.min(max ?? Infinity, Math.max(min, number)));
    }
    setDraft(null);
  };
  return <Input type="number" aria-label={label} placeholder={placeholder} value={draft ?? display} min={min} max={max} step={step} disabled={disabled}
    className="h-8 min-w-0 px-2 tabular-nums shadow-none" onChange={event => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(null); event.preventDefault(); } }} />;
}
