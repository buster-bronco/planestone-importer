import { reactionHtml, toHtml } from "../build/homebrew";
import type { ItemPatchFields } from "../schema";
import { randomID, sluggify } from "../slug";

export const WEAPON_FIELDS = ["proficiency", "runes", "abilityOverride", "damageAbilityOverride"] as const;
export const ACTION_FIELDS = ["actionType", "category", "trigger"] as const;
export const STRIKE_FIELDS = ["attackBonus", "damageRolls", "attackEffects"] as const;
export const COMMON_FIELDS = ["name", "description", "traits"] as const;

// item types that carry a slug made from their name
const SLUGGED_TYPES = new Set(["action", "melee"]);

// fields present in a patch set, per group
export function fieldGroups(fields: ItemPatchFields) {
  const has = (keys: readonly string[]) => keys.filter((key) => key in fields);
  return { weapon: has(WEAPON_FIELDS), action: has(ACTION_FIELDS), strike: has(STRIKE_FIELDS), common: has(COMMON_FIELDS) };
}

// common, action and strike fields → flat-keyed foundry update for one item
export function itemFieldUpdate(item: any, fields: ItemPatchFields): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (fields.name) {
    u.name = fields.name;
    if (SLUGGED_TYPES.has(item.type)) u["system.slug"] = sluggify(fields.name);
  }
  if (fields.traits) u["system.traits.value"] = fields.traits.map(sluggify);
  if (fields.description !== undefined) {
    u["system.description.value"] = fields.trigger ? reactionHtml(fields.trigger, fields.description) : toHtml(fields.description);
  }
  if (fields.actionType !== undefined) {
    const counted = typeof fields.actionType === "number";
    u["system.actionType.value"] = counted ? "action" : fields.actionType;
    u["system.actions.value"] = counted ? fields.actionType : null;
  }
  if (fields.category !== undefined) u["system.category"] = fields.category;
  if (fields.attackBonus !== undefined) u["system.bonus.value"] = fields.attackBonus;
  if (fields.attackEffects) u["system.attackEffects.value"] = fields.attackEffects.map(sluggify);
  if (fields.damageRolls) {
    for (const key of Object.keys(item.system?.damageRolls ?? {})) u[`system.damageRolls.-=${key}`] = null;
    for (const roll of fields.damageRolls) {
      u[`system.damageRolls.${randomID()}`] = { damage: roll.damage, damageType: sluggify(roll.damageType), category: null };
    }
  }
  return u;
}

// weapon item runes; potency and striking live on the weapon itself
export function runeUpdate(fields: ItemPatchFields): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (fields.runes?.potency !== undefined) u["system.runes.potency"] = fields.runes.potency;
  if (fields.runes?.striking !== undefined) u["system.runes.striking"] = fields.runes.striking;
  return u;
}
