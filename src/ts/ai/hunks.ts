import { flattenSet } from "../patch/paths";

// one accept/reject unit of an ai patch; whole = a malformed value kept as one piece
export type HunkOp =
  | { section: "set"; path: string; value: unknown }
  | { section: "add" | "remove"; path: string; entry: unknown; whole?: boolean }
  | { section: "items"; list: string; entry: unknown; whole?: boolean }
  | { section: "raw"; key: string; value: unknown };

export interface Hunk {
  id: string;
  op: HunkOp;
}

export type RawDoc = Record<string, unknown>;

// top-level keys split into hunks; the rest (kind, target, …) is kept as is
const HUNK_KEYS = new Set(["set", "add", "remove", "items"]);

function isObject(value: unknown): value is RawDoc {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// raw patch yaml (before zod) → one hunk per set path, list entry and item op
export function splitPatch(raw: RawDoc): Hunk[] {
  const hunks: Hunk[] = [];
  const push = (op: HunkOp) => hunks.push({ id: `h${hunks.length}`, op });
  // item patch fields are whole values; actor patch sets flatten into sheet paths
  const itemPatch = raw.kind === "itemPatch";

  if (isObject(raw.set)) {
    const entries = itemPatch ? Object.entries(raw.set) : flattenSet(raw.set);
    for (const [path, value] of entries) push({ section: "set", path, value });
  } else if (raw.set !== undefined) push({ section: "raw", key: "set", value: raw.set });

  for (const section of ["add", "remove"] as const) {
    const record = raw[section];
    if (!isObject(record)) {
      if (record !== undefined) push({ section: "raw", key: section, value: record });
      continue;
    }
    for (const [path, entries] of Object.entries(record)) {
      if (Array.isArray(entries)) for (const entry of entries) push({ section, path, entry });
      else push({ section, path, entry: entries, whole: true });
    }
  }

  if (isObject(raw.items)) {
    for (const [list, entries] of Object.entries(raw.items)) {
      if (Array.isArray(entries)) for (const entry of entries) push({ section: "items", list, entry });
      else push({ section: "items", list, entry: entries, whole: true });
    }
  } else if (raw.items !== undefined) push({ section: "raw", key: "items", value: raw.items });

  return hunks;
}

// raw patch with only the selected hunks
export function joinPatch(raw: RawDoc, hunks: Hunk[], selected: Set<string>): RawDoc {
  const doc: RawDoc = {};
  for (const [key, value] of Object.entries(raw)) if (!HUNK_KEYS.has(key)) doc[key] = value;
  const record = (key: string) => ((doc[key] ??= {}) as RawDoc);
  const append = (target: RawDoc, key: string, entry: unknown, whole?: boolean) => {
    if (whole) target[key] = entry;
    else ((target[key] ??= []) as unknown[]).push(entry);
  };

  for (const { id, op } of hunks) {
    if (!selected.has(id)) continue;
    if (op.section === "set") record("set")[op.path] = op.value;
    else if (op.section === "items") append(record("items"), op.list, op.entry, op.whole);
    else if (op.section === "raw") doc[op.key] = op.value;
    else append(record(op.section), op.path, op.entry, op.whole);
  }
  return doc;
}

function brief(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

function itemName(entry: unknown): string {
  if (!isObject(entry)) return brief(entry);
  const lookup = isObject(entry.lookup) ? entry.lookup.name : undefined;
  return String(entry.name ?? lookup ?? entry.match ?? brief(entry));
}

const ITEM_MARKS: Record<string, string> = { add: "+", remove: "−", update: "~", replace: "↻" };

// plain text for a hunk, used when the patch code can't describe it
export function hunkText(op: HunkOp): string {
  switch (op.section) {
    case "set":
      return `${op.path}: ${brief(op.value)}`;
    case "add":
      return `+ ${op.path}: ${brief(op.entry)}`;
    case "remove":
      return `− ${op.path}: ${brief(op.entry)}`;
    case "items": {
      const mark = ITEM_MARKS[op.list];
      return mark && !op.whole ? `${mark} ${itemName(op.entry)}` : `items.${op.list}: ${brief(op.entry)}`;
    }
    case "raw":
      return `${op.key}: ${brief(op.value)}`;
  }
}

export interface HunkView {
  id: string;
  label: string;
  errors: string[];
}

// patch text → change lines and errors, from the real patch code
export type Describe = (raw: RawDoc) => { changes: string[]; errors: string[] };

// each hunk described on its own, as a patch holding only that hunk
export function describeHunks(raw: RawDoc, hunks: Hunk[], describe: Describe): HunkView[] {
  return hunks.map((hunk) => {
    const { changes, errors } = describe(joinPatch(raw, hunks, new Set([hunk.id])));
    return { id: hunk.id, label: changes.length ? changes.join("; ") : hunkText(hunk.op), errors };
  });
}
