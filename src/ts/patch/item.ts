import CONSTANTS from "../constants";
import { linkHtml } from "../items";
import { PackIndex } from "../packIndex";
import { parseSheetText } from "../parse";
import type { ItemPatchDoc } from "../schema";
import { fieldGroups, itemFieldUpdate, runeUpdate } from "./itemFields";
import { targetMismatch } from "./prepare";

// plain item data, as item.toObject() returns it
export interface ItemSource {
  _id?: string;
  name: string;
  type: string;
  system: any;
}

export interface ItemPatchChanges {
  update: Record<string, unknown>;
  changes: string[];
  errors: string[];
  warnings: string[];
}

export interface PreparedItemPatch {
  doc: ItemPatchDoc;
  item: any;
  name: string;
  changes: ItemPatchChanges;
  errors: string[];
  warnings: string[];
}

export interface ItemPatchPlan {
  patch: PreparedItemPatch | null;
  errors: string[];
  warnings: string[];
}

export interface ItemPatchResult {
  name: string;
  ok: boolean;
  itemUuid?: string;
  error?: string;
}

function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}

// actionType as the sheet writes it: passive/free/reaction or an action count
function actionTypeOf(system: any): unknown {
  const kind = system?.actionType?.value;
  return kind === "action" ? system?.actions?.value : kind;
}

// patch + plain item data → one foundry update, no foundry calls
export function buildItemPatchChanges(doc: ItemPatchDoc, source: ItemSource): ItemPatchChanges {
  const result: ItemPatchChanges = { update: {}, changes: [], errors: [], warnings: [] };
  const { changes, errors } = result;
  const fields = doc.set;
  const groups = fieldGroups(fields);
  const type = source.type;

  if (![...groups.weapon, ...groups.action, ...groups.strike, ...groups.common].length) errors.push("set: nothing to change");
  const strikeOnly = groups.weapon.filter((key) => key !== "runes");
  if (strikeOnly.length) errors.push(`set: ${strikeOnly.join(", ")} only apply to npc strikes; patch them from the actor`);
  if (groups.weapon.includes("runes") && type !== "weapon") errors.push(`set: runes need a weapon, but this is a ${type} item`);
  if (groups.action.length && type !== "action") errors.push(`set: ${groups.action.join(", ")} need an action, but this is a ${type} item`);
  if (groups.strike.length && type !== "melee") errors.push(`set: ${groups.strike.join(", ")} need a strike, but this is a ${type} item`);
  if (fields.trigger && fields.description === undefined) errors.push("set: trigger needs description in the same set");
  if (errors.length) return result;

  Object.assign(result.update, itemFieldUpdate(source, fields), runeUpdate(fields));

  const system = source.system ?? {};
  const diff = (label: string, before: unknown, after: unknown) => {
    if (show(before) !== show(after)) changes.push(`${label}: ${show(before)} → ${show(after)}`);
  };
  if (fields.name) diff("name", source.name, fields.name);
  if (fields.traits) diff("traits", system.traits?.value, result.update["system.traits.value"]);
  if (fields.actionType !== undefined) diff("actions", actionTypeOf(system), fields.actionType);
  if (fields.category !== undefined) diff("category", system.category, fields.category);
  if (fields.runes?.potency !== undefined) diff("potency", system.runes?.potency, fields.runes.potency);
  if (fields.runes?.striking !== undefined) diff("striking", system.runes?.striking, fields.runes.striking);
  if (fields.attackBonus !== undefined) diff("attack", system.bonus?.value, fields.attackBonus);
  if (fields.damageRolls) changes.push(`damage: ${fields.damageRolls.map((roll) => `${roll.damage} ${roll.damageType}`).join(" + ")}`);
  if (fields.attackEffects) diff("attack effects", system.attackEffects?.value, result.update["system.attackEffects.value"]);
  if (fields.description !== undefined && result.update["system.description.value"] !== system.description?.value) {
    changes.push(fields.trigger ? "trigger and description rewritten" : "description rewritten");
  }
  return result;
}

// text → one validated patch against this world item, nothing written yet
export async function prepareItemPatchText(item: any, text: string): Promise<ItemPatchPlan> {
  const parsed = parseSheetText(text);
  const plan: ItemPatchPlan = { patch: null, errors: [...parsed.errors], warnings: [...parsed.warnings] };
  if (plan.errors.length) return plan;
  if (parsed.itemPatches.length !== 1 || parsed.patches.length || parsed.actors.length || parsed.items.length || parsed.spellLists.length) {
    plan.errors.push("expected a single kind: itemPatch document");
    return plan;
  }

  const doc = parsed.itemPatches[0];
  const changes = buildItemPatchChanges(doc, item.toObject());
  const patch: PreparedItemPatch = { doc, item, name: item.name, changes, errors: [...changes.errors], warnings: [...changes.warnings] };
  const warn = (message: string) => patch.warnings.push(message);

  const mismatch = targetMismatch(doc.target, item);
  if (mismatch) patch.errors.push(mismatch);

  // [[term]] marks in the new description
  const html = changes.update["system.description.value"];
  if (typeof html === "string" && !patch.errors.length) {
    const targets = await new PackIndex().linkTargets();
    changes.update["system.description.value"] = linkHtml(html, (changes.update.name as string) ?? item.name, targets, warn);
  }

  if (!changes.changes.length && !patch.errors.length) warn("patch changes nothing");
  plan.patch = patch;
  plan.errors.push(...patch.errors);
  plan.warnings.push(...patch.warnings);
  return plan;
}

// one item.update() call, so there's nothing to roll back
export async function executeItemPatch(prepared: PreparedItemPatch): Promise<ItemPatchResult> {
  const { item, changes, name } = prepared;
  try {
    await item.update(changes.update);
    return { name, ok: true, itemUuid: item.uuid };
  } catch (err) {
    console.error(CONSTANTS.DEBUG_PREFIX, err);
    return { name, ok: false, itemUuid: item.uuid, error: (err as Error).message };
  }
}
