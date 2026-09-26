import yaml from "js-yaml";
import type { ZodIssue } from "zod";
import { normalizeOps } from "./patch/paths";
import {
  isHomebrewAction,
  isHomebrewStrike,
  sheetFile,
  sheetItem,
  type ActorDoc,
  type ActorPatchDoc,
  type ItemPatchDoc,
  type SheetItem,
  type SpellListDoc,
} from "./schema";
import { sluggify } from "./slug";

// attack effects pf2e knows without a matching action item (CONFIG.PF2E.attackEffects)
export const BUILTIN_ATTACK_EFFECTS = new Set([
  "grab",
  "improved-grab",
  "constrict",
  "greater-constrict",
  "knockdown",
  "improved-knockdown",
  "push",
  "improved-push",
  "trip",
]);

export interface ParsedSheet {
  actors: ActorDoc[];
  patches: ActorPatchDoc[];
  // world items, not attached to an actor
  items: SheetItem[];
  itemPatches: ItemPatchDoc[];
  spellLists: SpellListDoc[];
  errors: string[];
  warnings: string[];
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

// yaml is a superset of json, so one loader covers both
export function parseSheetText(text: string): ParsedSheet {
  const result: ParsedSheet = { actors: [], patches: [], items: [], itemPatches: [], spellLists: [], errors: [], warnings: [] };

  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    result.errors.push(`could not read file: ${(err as Error).message}`);
    return result;
  }

  const parsed = sheetFile.safeParse(raw);
  if (!parsed.success) {
    result.errors.push(...parsed.error.issues.map(formatIssue));
    return result;
  }

  const doc = parsed.data;
  if (doc.kind === "actor") result.actors.push(doc);
  else if (doc.kind === "spellList") result.spellLists.push(doc);
  else if (doc.kind === "actorPatch") result.patches.push(doc);
  else if (doc.kind === "itemPatch") result.itemPatches.push(doc);
  else if (doc.kind === "itemBatch") result.items.push(...doc.items);
  else if (doc.kind === "item") {
    const { schemaVersion: _version, kind: _kind, ...fields } = doc;
    const item = sheetItem.safeParse(fields);
    if (!item.success) {
      result.errors.push(...item.error.issues.map(formatIssue));
      return result;
    }
    result.items.push(item.data);
  } else {
    result.actors.push(...doc.actors);
    result.spellLists.push(...doc.spellLists);
  }

  if (result.spellLists.length) {
    result.warnings.push(`${result.spellLists.length} spell list(s) found; spellcasting import isn't supported yet`);
  }

  for (const actor of result.actors) checkActor(actor, result);
  for (const patch of result.patches) checkPatch(patch, result);
  result.items.forEach((item, index) => checkWorldItem(item, doc.kind === "itemBatch" ? `items.${index}` : "(root)", result));
  return result;
}

export function patchLabel(patch: ActorPatchDoc): string {
  return patch.target?.name ?? patch.target?.uuid ?? "patch";
}

// path and value checks that don't need the target actor
function checkPatch(patch: ActorPatchDoc, result: ParsedSheet): void {
  const label = patchLabel(patch);
  for (const error of normalizeOps(patch).errors) result.errors.push(`patch ${label}: ${error}`);
}

// strikes and weapon strikes only mean something on an npc
function checkWorldItem(item: SheetItem, where: string, result: ParsedSheet): void {
  if (item.origin === "equippedWeapon") {
    result.errors.push(`${where}: equippedWeapon makes an npc strike; use compendiumRef with refType: equipment for a world weapon`);
  } else if (isHomebrewStrike(item)) {
    result.errors.push(`${where}: "${item.name}" is a strike; strikes only exist on actors`);
  }
}

// ok: an action on the actor; builtin: pf2e knows it without one; unknown: neither
export function classifyAttackEffect(effect: string, actionSlugs: Set<string>): "ok" | "builtin" | "unknown" {
  const slug = sluggify(effect);
  if (actionSlugs.has(slug)) return "ok";
  return BUILTIN_ATTACK_EFFECTS.has(slug) ? "builtin" : "unknown";
}

// cross-field rules zod can't express per object
function checkActor(actor: ActorDoc, result: ParsedSheet): void {
  const name = actor.meta.name;

  const actionSlugs = new Set<string>();
  for (const item of actor.items) {
    if (isHomebrewAction(item)) actionSlugs.add(sluggify(item.name));
    if (item.origin === "compendiumRef" && item.refType === "action") actionSlugs.add(sluggify(item.lookup.name));
  }

  actor.items.forEach((item, index) => {
    if (!isHomebrewStrike(item)) return;
    for (const effect of item.attackEffects) {
      const kind = classifyAttackEffect(effect, actionSlugs);
      if (kind === "builtin") {
        result.warnings.push(`${name}: "${item.name}" attack effect "${sluggify(effect)}" has no matching action; the roll card will show the label only`);
      } else if (kind === "unknown") {
        result.errors.push(`${name}: items.${index}.attackEffects: "${effect}" doesn't match any action item on this actor`);
      }
    }
  });

  if (actor.spellcasting !== undefined) {
    const ref = actor.spellcasting;
    if (typeof ref === "string" && !result.spellLists.some((list) => list.id === ref)) {
      result.errors.push(`${name}: spellcasting references unknown spell list "${ref}"`);
    }
    result.warnings.push(`${name}: spellcasting is ignored until spell import lands`);
  }
}
