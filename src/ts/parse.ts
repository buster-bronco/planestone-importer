import yaml from "js-yaml";
import type { ZodIssue } from "zod";
import { normalizeOps } from "./patch/paths";
import {
  isHomebrewAction,
  isHazardDoc,
  isHomebrewStrike,
  isSpellItem,
  isVehicleDoc,
  sheetFile,
  sheetItem,
  type ActorDoc,
  type ActorPatchDoc,
  type HazardDoc,
  type InventoryFields,
  type ItemPatchDoc,
  type SheetItem,
  type SpellListDoc,
  type VehicleDoc,
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
  vehicles: VehicleDoc[];
  hazards: HazardDoc[];
  patches: ActorPatchDoc[];
  // world items, not attached to an actor
  items: SheetItem[];
  itemPatches: ItemPatchDoc[];
  spellLists: SpellListDoc[];
  errors: string[];
  warnings: string[];
}

// one file holds actors or world items; each kind names which
const CONTAINER_KEYS = new Set(["actors", "items", "spellLists"]);

function formatIssue(issue: ZodIssue, kind?: unknown): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => `"${key}"`).join(", ");
    const mixed = !issue.path.length && issue.keys.some((key) => CONTAINER_KEYS.has(key));
    const hint = mixed ? `; kind: ${kind} can't hold that list, put it in its own file` : "";
    return `${path}: unknown key(s) ${keys}${hint}`;
  }
  return `${path}: ${issue.message}`;
}

// yaml is a superset of json, so one loader covers both
export function parseSheetText(text: string): ParsedSheet {
  const result: ParsedSheet = { actors: [], vehicles: [], hazards: [], patches: [], items: [], itemPatches: [], spellLists: [], errors: [], warnings: [] };

  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    result.errors.push(`could not read file: ${(err as Error).message}`);
    return result;
  }

  const parsed = sheetFile.safeParse(asActorKind(raw));
  if (!parsed.success) {
    const kind = (raw as any)?.kind;
    result.errors.push(...parsed.error.issues.map((issue) => formatIssue(issue, kind)));
    return result;
  }

  const doc = parsed.data;
  if (doc.kind === "actor") result.actors.push(doc);
  else if (doc.kind === "vehicle") result.vehicles.push(doc);
  else if (doc.kind === "hazard") result.hazards.push(doc);
  else if (doc.kind === "spellList") {
    result.spellLists.push(doc);
    result.warnings.push(`spell list "${doc.id}" imports nothing on its own; put it in an actorBatch's spellLists and point spellcasting at it`);
  }
  else if (doc.kind === "actorPatch") result.patches.push(doc);
  else if (doc.kind === "itemPatch") result.itemPatches.push(doc);
  else if (doc.kind === "itemBatch") result.items.push(...doc.items);
  else if (doc.kind === "item") {
    const { schemaVersion: _version, kind: _kind, ...fields } = doc;
    const stray = Object.keys(fields).filter((key) => CONTAINER_KEYS.has(key));
    if (stray.length) {
      result.errors.push(`(root): unknown key(s) ${stray.map((key) => `"${key}"`).join(", ")}; kind: item can't hold that list, use itemBatch or its own file`);
      return result;
    }
    const item = sheetItem.safeParse(fields);
    if (!item.success) {
      result.errors.push(...item.error.issues.map(formatIssue));
      return result;
    }
    result.items.push(item.data);
  } else {
    for (const actor of doc.actors) {
      if (isVehicleDoc(actor)) result.vehicles.push(actor);
      else if (isHazardDoc(actor)) result.hazards.push(actor);
      else result.actors.push(actor);
    }
    result.spellLists.push(...doc.spellLists);
  }

  for (const actor of result.actors) checkActor(actor, result);
  for (const vehicle of result.vehicles) checkVehicle(vehicle, result);
  for (const hazard of result.hazards) checkHazard(hazard, result);
  for (const patch of result.patches) checkPatch(patch, result);
  result.items.forEach((item, index) => checkWorldItem(item, doc.kind === "itemBatch" ? `items.${index}` : "(root)", result));
  return result;
}

// kind: actor with meta.actorType: vehicle or hazard reads as that kind
function asActorKind(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const doc = raw as Record<string, any>;
  const type = doc.meta?.actorType;
  return doc.kind === "actor" && (type === "vehicle" || type === "hazard") ? { ...doc, kind: type } : raw;
}

export function patchLabel(patch: ActorPatchDoc): string {
  return patch.target?.name ?? patch.target?.uuid ?? "patch";
}

// path and value checks that don't need the target actor
function checkPatch(patch: ActorPatchDoc, result: ParsedSheet): void {
  const label = patchLabel(patch);
  for (const error of normalizeOps(patch).errors) result.errors.push(`patch ${label}: ${error}`);
  patch.items.add.forEach((item, index) => {
    if (isSpellItem(item)) result.errors.push(`patch ${label}: items.add.${index}: patching spells isn't supported yet`);
  });
  patch.items.replace.forEach(({ with: item }, index) => {
    if (isSpellItem(item)) result.errors.push(`patch ${label}: items.replace.${index}.with: patching spells isn't supported yet`);
  });
}

// strikes and weapon strikes only mean something on an npc
function checkWorldItem(item: SheetItem, where: string, result: ParsedSheet): void {
  if (item.origin === "equippedWeapon") {
    result.errors.push(`${where}: equippedWeapon makes an npc strike; use compendiumRef with refType: equipment for a world weapon`);
  } else if (isHomebrewStrike(item)) {
    result.errors.push(`${where}: "${item.name}" is a strike; strikes only exist on actors`);
  }
  for (const key of ["equipped", "hands", "invested"] as const) {
    if ((item as InventoryFields)[key] !== undefined) result.errors.push(`${where}.${key}: world items aren't carried by anyone; only quantity applies`);
  }
}

// vehicles hold actions and gear; pf2e vehicle sheets have no strikes
function checkVehicle(vehicle: VehicleDoc, result: ParsedSheet): void {
  const name = vehicle.meta.name;
  vehicle.items.forEach((item, index) => {
    if (item.origin === "equippedWeapon" || isHomebrewStrike(item)) {
      result.errors.push(`${name}: items.${index}: vehicles can't hold strikes; describe mounted weapons as homebrew actions`);
    } else if (isSpellItem(item)) {
      result.errors.push(`${name}: items.${index}: vehicles can't hold spells`);
    }
  });
}

// hazards take homebrew strikes, but weapon strike math needs npc attributes
function checkHazard(hazard: HazardDoc, result: ParsedSheet): void {
  const name = hazard.meta.name;
  hazard.items.forEach((item, index) => {
    if (item.origin === "equippedWeapon") {
      result.errors.push(`${name}: items.${index}: hazards can't use equippedWeapon; write the attack as a homebrew melee or ranged strike`);
    } else if (isSpellItem(item)) {
      result.errors.push(`${name}: items.${index}: hazards can't hold spells; describe the effect in a homebrew action`);
    }
  });
  if (hazard.core.routine && !hazard.core.complex) result.warnings.push(`${name}: routine is set but complex is false; pf2e only shows it on complex hazards`);
  checkAttackEffects(name, hazard.items, result);
}

// ok: an action on the actor; builtin: pf2e knows it without one; unknown: neither
export function classifyAttackEffect(effect: string, actionSlugs: Set<string>): "ok" | "builtin" | "unknown" {
  const slug = sluggify(effect);
  if (actionSlugs.has(slug)) return "ok";
  return BUILTIN_ATTACK_EFFECTS.has(slug) ? "builtin" : "unknown";
}

// strike attackEffects point at action items on the same actor
function checkAttackEffects(name: string, items: SheetItem[], result: ParsedSheet): void {
  const actionSlugs = new Set<string>();
  for (const item of items) {
    if (isHomebrewAction(item)) actionSlugs.add(sluggify(item.name));
    if (item.origin === "compendiumRef" && item.refType === "action") actionSlugs.add(sluggify(item.lookup.name));
  }

  items.forEach((item, index) => {
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
}

// cross-field rules zod can't express per object
function checkActor(actor: ActorDoc, result: ParsedSheet): void {
  const name = actor.meta.name;
  checkAttackEffects(name, actor.items, result);

  actor.items.forEach((item, index) => {
    if (isSpellItem(item)) result.errors.push(`${name}: items.${index}: spells go under spellcasting, not items`);
  });

  // spell list ids become copies of the list so the importer only sees entries
  actor.spellcasting = actor.spellcasting.map((ref) => {
    if (typeof ref !== "string") return ref;
    const list = result.spellLists.find((candidate) => candidate.id === ref);
    if (!list) {
      result.errors.push(`${name}: spellcasting references unknown spell list "${ref}"`);
      return ref;
    }
    const { id: _id, kind: _kind, schemaVersion: _version, ...entry } = list as typeof list & { kind?: string; schemaVersion?: number };
    return structuredClone(entry);
  });
}
