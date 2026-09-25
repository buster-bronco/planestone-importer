import { z, type ZodTypeAny } from "zod";
import {
  buildImmunities,
  buildLanguages,
  buildOtherSpeeds,
  buildResistances,
  buildSenses,
  buildTraits,
  buildWeaknesses,
  formatSense,
  normalizeSize,
  parseSense,
  type Vocabulary,
  type Warn,
} from "../build/actorData";
import {
  coreSchema,
  immunityEntry,
  loreEntry,
  metaSchema,
  otherSpeedEntry,
  resistanceEntry,
  weaknessEntry,
  type ActorPatchDoc,
} from "../schema";
import { sluggify } from "../slug";

// plain actor data, as actor.toObject() returns it
export interface ActorSource {
  _id?: string;
  name: string;
  system: any;
  items: any[];
}

export interface PathContext {
  source: ActorSource;
  vocab: Vocabulary;
  warn: Warn;
}

export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), obj);
}

// ---------------------------------------------------------------------------
// scalar paths
// ---------------------------------------------------------------------------

export interface ScalarSpec {
  label: string;
  value: ZodTypeAny;
  read(source: ActorSource): unknown;
  write(value: any, ctx: PathContext): Record<string, unknown>;
}

// sheet value lands on one foundry path unchanged
function field(label: string, value: ZodTypeAny, foundryPath: string, fallback?: unknown): ScalarSpec {
  return {
    label,
    value,
    read: (source) => getPath(source, foundryPath),
    write: (v) => ({ [foundryPath]: v ?? fallback }),
  };
}

const int = z.number().int();
const core = coreSchema.shape;

// max hp change keeps a full-health npc at full health
const hpSpec: ScalarSpec = {
  label: "hp",
  value: core.hp.shape.value,
  read: (source) => source.system.attributes?.hp?.max,
  write: (max: number, { source }) => {
    const hp = source.system.attributes?.hp ?? {};
    const value = hp.value == null || hp.value >= hp.max ? max : Math.min(hp.value, max);
    return { "system.attributes.hp.max": max, "system.attributes.hp.value": value };
  },
};

export const SCALAR_PATHS: Record<string, ScalarSpec> = {
  "meta.name": field("name", metaSchema.shape.name, "name"),
  "meta.level": field("level", metaSchema.shape.level, "system.details.level.value"),
  "meta.source": field("source", z.string().nullable(), "system.details.publication.title", ""),
  "core.rarity": field("rarity", core.rarity.removeDefault(), "system.traits.rarity"),
  "core.size": {
    label: "size",
    value: z.string().refine((size) => normalizeSize(size) !== null, "unknown size"),
    read: (source) => source.system.traits?.size?.value,
    write: (size: string) => ({ "system.traits.size.value": normalizeSize(size) }),
  },
  "core.ac": field("AC", core.ac, "system.attributes.ac.value"),
  "core.hp.value": hpSpec,
  "core.hp.notes": field("hp notes", z.string().nullable(), "system.attributes.hp.details", ""),
  "core.perception.mod": field("perception", int, "system.perception.mod"),
  "core.speed.value": field("speed", core.speed.shape.value, "system.attributes.speed.value"),
  ...Object.fromEntries(
    (["fortitude", "reflex", "will"] as const).map((save) => [`core.saves.${save}`, field(save, int, `system.saves.${save}.value`)]),
  ),
  ...Object.fromEntries(
    (["str", "dex", "con", "int", "wis", "cha"] as const).map((key) => [`core.abilities.${key}`, field(key, int, `system.abilities.${key}.mod`)]),
  ),
};

// ---------------------------------------------------------------------------
// list paths
// ---------------------------------------------------------------------------

// merged by key in foundry form so untouched entries keep fields the sheet can't express
export interface ListSpec {
  label: string;
  entry: ZodTypeAny;
  current(source: ActorSource): any[];
  build(entries: any[], ctx: PathContext): any[];
  key(entry: any): string;
  removeKey(text: string): string;
  show(entry: any): string;
  write(list: any[], ctx: PathContext): Record<string, unknown>;
}

// typed iwr/speed list stored under one foundry path
function typedList(label: string, entry: ZodTypeAny, foundryPath: string, build: (entries: any[]) => any[]): ListSpec {
  return {
    label,
    entry,
    current: (source) => getPath(source, foundryPath) ?? [],
    build,
    key: (e) => e.type,
    removeKey: sluggify,
    show: (e) => (e.value == null ? e.type : `${e.type} ${e.value}`),
    write: (list) => ({ [foundryPath]: list }),
  };
}

export const LIST_PATHS: Record<string, ListSpec> = {
  "core.traits": {
    label: "traits",
    entry: z.string().min(1),
    current: (source) => source.system.traits?.value ?? [],
    build: (entries, { vocab, warn }) => buildTraits(entries, undefined, vocab, warn),
    key: (e) => e,
    removeKey: sluggify,
    show: (e) => e,
    write: (list) => ({ "system.traits.value": list }),
  },
  // raw names round-trip; the pf2e/details split happens on write
  "core.languages": {
    label: "languages",
    entry: z.string().min(1),
    current: (source) => {
      const languages = source.system.details?.languages ?? {};
      const extra = (languages.details ?? "").split(",").map((text: string) => text.trim()).filter(Boolean);
      return [...(languages.value ?? []), ...extra];
    },
    build: (entries) => entries,
    key: sluggify,
    removeKey: sluggify,
    show: (e) => e,
    write: (list, { vocab, warn }) => {
      const { value, details } = buildLanguages(list, vocab, warn);
      return { "system.details.languages.value": value, "system.details.languages.details": details };
    },
  },
  "core.perception.senses": {
    label: "senses",
    entry: z.string().min(1),
    current: (source) => source.system.perception?.senses ?? [],
    build: (entries, { vocab, warn }) => buildSenses(entries, vocab, warn),
    key: (e) => e.type,
    removeKey: (text) => parseSense(text)?.type ?? sluggify(text),
    show: formatSense,
    write: (list) => ({ "system.perception.senses": list }),
  },
  "core.speed.other": typedList("speeds", otherSpeedEntry, "system.attributes.speed.otherSpeeds", buildOtherSpeeds),
  "core.resistances": typedList("resistances", resistanceEntry, "system.attributes.resistances", buildResistances),
  "core.weaknesses": typedList("weaknesses", weaknessEntry, "system.attributes.weaknesses", buildWeaknesses),
  "core.immunities": typedList("immunities", immunityEntry, "system.attributes.immunities", buildImmunities),
};

// lore skills are items, handled in changes.ts
export const LORE_PATH = "core.skills.lore";
export const SKILLS_PATH = "core.skills.named";

// "Sailing" and "Sailing Lore" are the same skill
export function loreKey(name: string): string {
  return sluggify(name.replace(/\s*lore\s*$/i, ""));
}

// ---------------------------------------------------------------------------
// op normalization
// ---------------------------------------------------------------------------

export type SetOp =
  | { kind: "scalar"; path: string; spec: ScalarSpec; value: any }
  | { kind: "skill"; path: string; name: string; value: number | null }
  | { kind: "skills"; path: string; value: Record<string, number> }
  | { kind: "list"; path: string; spec: ListSpec; value: any[] }
  | { kind: "lore"; path: string; value: { name: string; mod: number }[] };

export type ListOp =
  | { kind: "list"; mode: "add" | "remove"; path: string; spec: ListSpec; entries: any[] }
  | { kind: "lore"; mode: "add" | "remove"; path: string; entries: any[] }
  | { kind: "skills"; mode: "remove"; path: string; entries: string[] };

export interface PatchOps {
  sets: SetOp[];
  lists: ListOp[];
  errors: string[];
}

function isKnownPath(path: string): boolean {
  return path in SCALAR_PATHS || path in LIST_PATHS || path === LORE_PATH || path === SKILLS_PATH || path.startsWith(`${SKILLS_PATH}.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// nested objects expand into dotted paths until a known path is hit
function flattenSet(set: Record<string, unknown>, prefix = ""): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(set)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isKnownPath(path) || !isPlainObject(value)) out.push([path, value]);
    else out.push(...flattenSet(value, path));
  }
  return out;
}

function issueText(error: z.ZodError): string {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
}

// dotted paths → typed ops; unknown paths and bad values become errors
export function normalizeOps(doc: Pick<ActorPatchDoc, "set" | "add" | "remove">): PatchOps {
  const ops: PatchOps = { sets: [], lists: [], errors: [] };
  const check = (where: string, schema: ZodTypeAny, value: unknown): any => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    ops.errors.push(`${where}: ${issueText(parsed.error)}`);
    return undefined;
  };

  for (const [path, raw] of flattenSet(doc.set)) {
    const where = `set.${path}`;
    let value: any;
    if (path in SCALAR_PATHS) {
      const spec = SCALAR_PATHS[path];
      if ((value = check(where, spec.value, raw)) !== undefined) ops.sets.push({ kind: "scalar", path, spec, value });
    } else if (path in LIST_PATHS) {
      const spec = LIST_PATHS[path];
      if ((value = check(where, z.array(spec.entry), raw))) ops.sets.push({ kind: "list", path, spec, value });
    } else if (path === LORE_PATH) {
      if ((value = check(where, z.array(loreEntry), raw))) ops.sets.push({ kind: "lore", path, value });
    } else if (path === SKILLS_PATH) {
      if ((value = check(where, z.record(z.string(), int), raw))) ops.sets.push({ kind: "skills", path, value });
    } else if (path.startsWith(`${SKILLS_PATH}.`)) {
      if ((value = check(where, int.nullable(), raw)) !== undefined) ops.sets.push({ kind: "skill", path, name: path.slice(SKILLS_PATH.length + 1), value });
    } else {
      ops.errors.push(`${where}: unknown path`);
    }
  }

  for (const [mode, record] of [["add", doc.add], ["remove", doc.remove]] as const) {
    for (const [path, raw] of Object.entries(record)) {
      const where = `${mode}.${path}`;
      if (path in LIST_PATHS) {
        const spec = LIST_PATHS[path];
        const entries = mode === "add" ? check(where, z.array(spec.entry), raw) : raw;
        if (entries) ops.lists.push({ kind: "list", mode, path, spec, entries });
      } else if (path === LORE_PATH) {
        const entries = mode === "add" ? check(where, z.array(loreEntry), raw) : raw;
        if (entries) ops.lists.push({ kind: "lore", mode, path, entries });
      } else if (path === SKILLS_PATH && mode === "remove") {
        ops.lists.push({ kind: "skills", mode, path, entries: raw as string[] });
      } else if (path === SKILLS_PATH) {
        ops.errors.push(`${where}: use set.${SKILLS_PATH}.<skill> to add a skill`);
      } else {
        ops.errors.push(`${where}: ${isKnownPath(path) ? "not a list; use set" : "unknown path"}`);
      }
    }
  }
  return ops;
}
