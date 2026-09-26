import { formatRanked, rank } from "../fuzzy";

// system paths that already have a typed patch field
const TYPED_FIELDS: Record<string, string> = {
  "system.description": "description",
  "system.rules": "rules",
  "system.traits.value": "traits",
  "system.slug": "name",
  "system.actionType": "actionType",
  "system.actions": "actionType",
  "system.category": "category",
  "system.bonus": "attackBonus",
  "system.damageRolls": "damageRolls",
  "system.attackEffects": "attackEffects",
  "system.runes": "runes",
};

export interface SystemPathResult {
  update: Record<string, unknown>;
  changes: string[];
  errors: string[];
}

export function isSystemPath(key: string): boolean {
  return key.startsWith("system.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// "system.level.value" → source.system.level.value
function getPath(source: unknown, path: string): unknown {
  let value: unknown = source;
  for (const part of path.split(".")) {
    if (!isPlainObject(value)) return undefined;
    value = value[part];
  }
  return value;
}

// every leaf under system; arrays count as leaves
export function leafPaths(value: unknown, prefix = "system"): string[] {
  if (!isPlainObject(value) || !Object.keys(value).length) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, `${prefix}.${key}`));
}

function kindOf(value: unknown): string {
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}

function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function typedField(path: string): string | null {
  for (const [prefix, field] of Object.entries(TYPED_FIELDS)) if (path === prefix || path.startsWith(`${prefix}.`)) return field;
  return null;
}

// one checked system path; returns an error or null
function checkPath(source: { system?: unknown }, path: string, value: unknown): string | null {
  const field = typedField(path);
  if (field) return `${path} has its own field; use ${field}`;

  const existing = getPath(source, path);
  if (existing === undefined) {
    const parentPath = path.slice(0, path.lastIndexOf("."));
    const parent = getPath(source, parentPath);
    // a new key next to real ones is fine unless it reads like a typo of one
    if (isPlainObject(parent)) {
      const leaf = path.slice(parentPath.length + 1);
      // short keys like pp/gp/sp are too close to each other to call typos
      const near = leaf.length < 4 ? [] : rank(leaf, Object.keys(parent).map((name) => ({ name })), { limit: 1, min: 0.6 });
      return near.length ? `no ${path}; did you mean ${parentPath}.${near[0].name}?` : null;
    }
    const near = rank(path, leafPaths(source.system).map((name) => ({ name })));
    return near.length ? `no ${path}; did you mean ${formatRanked(near)}?` : `no ${path} on this item`;
  }

  if (value !== null && existing !== null && kindOf(existing) !== kindOf(value)) return `${path} is a ${kindOf(existing)}, got a ${kindOf(value)}`;
  return null;
}

// system.* keys of a patch set → foundry update, change lines and errors
export function systemPathUpdate(source: { system?: unknown }, fields: Record<string, unknown>): SystemPathResult {
  const result: SystemPathResult = { update: {}, changes: [], errors: [] };
  for (const [path, value] of Object.entries(fields)) {
    if (!isSystemPath(path)) continue;
    const error = checkPath(source, path, value);
    if (error) {
      result.errors.push(`set: ${error}`);
      continue;
    }
    const before = getPath(source, path);
    result.update[path] = value;
    if (show(before) !== show(value)) result.changes.push(`${path}: ${show(before)} → ${show(value)}`);
  }
  return result;
}

// pf2e's rule element registry, when running in foundry
function ruleKeys(): string[] | null {
  const all = (globalThis as any).game?.pf2e?.RuleElements?.all;
  return all ? Object.keys(all) : null;
}

// rules replace the whole array; keys are checked against pf2e when it's loaded
export function rulesUpdate(source: { system?: any }, rules: { key: string }[]): SystemPathResult {
  const result: SystemPathResult = { update: { "system.rules": rules }, changes: [], errors: [] };
  const known = ruleKeys();
  rules.forEach((rule, index) => {
    if (!known || known.includes(rule.key)) return;
    const near = rank(rule.key, known.map((name) => ({ name })), { limit: 1 });
    result.errors.push(`set: rules.${index}: no rule element "${rule.key}"${near.length ? `; did you mean ${near[0].name}?` : ""}`);
  });
  const keys = (list: { key?: string }[]) => (list.length ? list.map((rule) => rule.key ?? "?").join(", ") : "none");
  const before: { key?: string }[] = source.system?.rules ?? [];
  result.changes.push(`rules: ${keys(before)} → ${keys(rules)}`);
  return result;
}

// noise that isn't worth patching by hand
const SKIPPED_PATHS = ["system._migration", "system.publication", "system.schema"];

// "system.level.value: 3" lines for every patchable leaf, typed fields and long text left out
export function rawPathLines(system: unknown): string[] {
  return leafPaths(system)
    .filter((path) => !typedField(path) && !SKIPPED_PATHS.some((skip) => path === skip || path.startsWith(`${skip}.`)))
    .map((path) => [path, JSON.stringify(getPath({ system }, path)) ?? "null"] as const)
    .filter(([, value]) => value.length <= 80)
    .map(([path, value]) => `${path}: ${value}`);
}
