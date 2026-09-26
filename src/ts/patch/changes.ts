import CONSTANTS from "../constants";
import { buildLore, buildNamedSkills, isKnownSkill, type Vocabulary } from "../build/actorData";
import { computeStrike, type StrikeFlag, type StrikeStats } from "../build/strikeMath";
import { classifyAttackEffect } from "../parse";
import { isHomebrewAction, isHomebrewStrike, type AbilityKey, type ActorPatchDoc, type SheetItem } from "../schema";
import { sluggify } from "../slug";
import { fieldGroups, itemFieldUpdate, runeUpdate } from "./itemFields";
import { LIST_PATHS, loreKey, normalizeOps, type ActorSource, type ListSpec, type PathContext } from "./paths";

export interface PatchChanges {
  actorUpdate: Record<string, unknown>;
  deleteItemIds: string[];
  // built item data, ready to embed
  createItems: any[];
  // sheet items still needing compendium lookup
  addItems: SheetItem[];
  // flat-keyed embedded updates, each with an _id
  updateItems: Record<string, unknown>[];
  // level and attributes after the patch
  stats: StrikeStats;
  changes: string[];
  errors: string[];
  warnings: string[];
}

const ABILITIES: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function strikeFlag(item: any): StrikeFlag | undefined {
  return item.flags?.[CONSTANTS.MODULE_ID]?.strike;
}

// base damage roll: the one without a category, else the first
function baseRollKey(rolls: Record<string, any>): string | undefined {
  const keys = Object.keys(rolls ?? {});
  return keys.find((key) => !rolls[key].category) ?? keys[0];
}

// patch + plain actor data → everything executePatch needs, no foundry calls
export function buildPatchChanges(doc: ActorPatchDoc, source: ActorSource, vocab: Vocabulary = {}): PatchChanges {
  const result: PatchChanges = {
    actorUpdate: {},
    deleteItemIds: [],
    createItems: [],
    addItems: [],
    updateItems: [],
    stats: { level: 0, abilities: {} as Record<AbilityKey, number> },
    changes: [],
    errors: [],
    warnings: [],
  };
  const { actorUpdate, changes, errors } = result;
  const warn = (message: string) => result.warnings.push(message);
  const ctx: PathContext = { source, vocab, warn };
  const ops = normalizeOps(doc);
  errors.push(...ops.errors);

  // --- scalars, named skills, whole-list sets ---------------------------------
  const lists = new Map<string, { spec: ListSpec; list: any[]; before: any[] }>();
  const listState = (path: string) => {
    const spec = LIST_PATHS[path];
    if (!lists.has(path)) {
      const before = spec.current(source);
      lists.set(path, { spec, list: [...before], before });
    }
    return lists.get(path)!;
  };
  const loreOps: { mode: "set" | "add" | "remove"; entries: any[] }[] = [];

  for (const op of ops.sets) {
    if (op.kind === "scalar") {
      const before = op.spec.read(source);
      Object.assign(actorUpdate, op.spec.write(op.value, ctx));
      if (show(before) !== show(op.value)) changes.push(`${op.spec.label}: ${show(before)} → ${show(op.value)}`);
    } else if (op.kind === "skill") {
      const slug = sluggify(op.name);
      const before = source.system.skills?.[slug]?.base;
      if (op.value === null) {
        if (before === undefined) warn(`skill "${op.name}" isn't on the actor`);
        else {
          actorUpdate[`system.skills.-=${slug}`] = null;
          changes.push(`${slug}: ${signed(before)} → none`);
        }
      } else if (!isKnownSkill(slug, vocab)) {
        errors.push(`set.${op.path}: unknown skill; lore skills go under core.skills.lore`);
      } else {
        actorUpdate[`system.skills.${slug}.base`] = op.value;
        if (before !== op.value) changes.push(`${slug}: ${before === undefined ? "none" : signed(before)} → ${signed(op.value)}`);
      }
    } else if (op.kind === "skills") {
      const skills = buildNamedSkills(op.value, vocab, warn);
      const current = Object.keys(source.system.skills ?? {});
      for (const slug of current) if (!(slug in skills)) actorUpdate[`system.skills.-=${slug}`] = null;
      for (const [slug, { base }] of Object.entries(skills)) actorUpdate[`system.skills.${slug}.base`] = base;
      changes.push(`skills: ${show(current)} → ${show(Object.keys(skills))}`);
    } else if (op.kind === "list") {
      listState(op.path).list = op.spec.build(op.value, ctx);
    } else {
      loreOps.push({ mode: "set", entries: op.value });
    }
  }

  // --- list add/remove ----------------------------------------------------------
  for (const op of ops.lists) {
    if (op.kind === "lore") {
      loreOps.push({ mode: op.mode, entries: op.entries });
    } else if (op.kind === "skills") {
      for (const name of op.entries) {
        const slug = sluggify(name);
        const before = source.system.skills?.[slug]?.base;
        if (before === undefined) warn(`remove.${op.path}: "${name}" isn't on the actor`);
        else {
          actorUpdate[`system.skills.-=${slug}`] = null;
          changes.push(`${slug}: ${signed(before)} → none`);
        }
      }
    } else if (op.mode === "add") {
      const state = listState(op.path);
      const added = op.spec.build(op.entries, ctx);
      const keys = new Set(added.map(op.spec.key));
      state.list = [...state.list.filter((entry) => !keys.has(op.spec.key(entry))), ...added];
    } else {
      const state = listState(op.path);
      for (const text of op.entries) {
        const key = op.spec.removeKey(text);
        if (!state.list.some((entry) => op.spec.key(entry) === key)) warn(`remove.${op.path}: "${text}" isn't on the actor`);
        state.list = state.list.filter((entry) => op.spec.key(entry) !== key);
      }
    }
  }

  for (const { spec, list, before } of lists.values()) {
    Object.assign(actorUpdate, spec.write(list, ctx));
    const was = before.map(spec.show);
    const now = list.map(spec.show);
    const added = now.filter((entry) => !was.includes(entry));
    const removed = was.filter((entry) => !now.includes(entry));
    if (added.length || removed.length) {
      changes.push(`${spec.label}: ${[...added.map((e) => `+ ${e}`), ...removed.map((e) => `− ${e}`)].join(", ")}`);
    }
  }

  // --- lore items ---------------------------------------------------------------
  const deleted = new Set<string>();
  const updates = new Map<string, Record<string, unknown>>();
  const updateFor = (id: string) => {
    if (!updates.has(id)) updates.set(id, { _id: id });
    return updates.get(id)!;
  };

  if (loreOps.length) {
    const existing = new Map<string, any>(source.items.filter((item) => item.type === "lore").map((item) => [loreKey(item.name), item]));
    const wanted = new Map<string, { name: string; mod: number } | null>();
    for (const op of loreOps) {
      if (op.mode === "set") {
        for (const key of existing.keys()) wanted.set(key, null);
        for (const key of [...wanted.keys()]) if (!existing.has(key)) wanted.delete(key);
      }
      if (op.mode === "remove") {
        for (const name of op.entries) {
          if (!existing.has(loreKey(name)) && !wanted.get(loreKey(name))) warn(`remove.core.skills.lore: "${name}" isn't on the actor`);
          wanted.set(loreKey(name), null);
        }
      } else {
        for (const entry of op.entries) wanted.set(loreKey(entry.name), entry);
      }
    }
    for (const [key, entry] of wanted) {
      const item = existing.get(key);
      if (!entry) {
        if (item) {
          deleted.add(item._id);
          changes.push(`− ${item.name}`);
        }
      } else if (item) {
        if (item.system?.mod?.value !== entry.mod) {
          updateFor(item._id)["system.mod.value"] = entry.mod;
          changes.push(`${item.name}: ${signed(item.system?.mod?.value ?? 0)} → ${signed(entry.mod)}`);
        }
      } else {
        const [data] = buildLore([entry]);
        result.createItems.push(data);
        changes.push(`+ ${data.name} ${signed(entry.mod)}`);
      }
    }
  }

  // --- items ---------------------------------------------------------------------
  const live = () => source.items.filter((item) => !deleted.has(item._id));
  const byName = (name: string) => live().filter((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());

  for (const name of doc.items.remove) {
    const hits = byName(name);
    if (!hits.length) errors.push(`items.remove: no item named "${name}"`);
    for (const item of hits) {
      deleted.add(item._id);
      changes.push(`− ${item.name} (${item.type})`);
    }
  }

  for (const { match, with: item } of doc.items.replace) {
    const hits = byName(match);
    if (!hits.length) errors.push(`items.replace: no item named "${match}"`);
    else {
      for (const hit of hits) deleted.add(hit._id);
      result.addItems.push(item);
      changes.push(`↻ ${hits[0].name}`);
    }
  }

  // weapon field edits, keyed by strike id
  const flagEdits = new Map<string, StrikeFlag>();

  doc.items.update.forEach(({ match, set: fields }, index) => {
    const where = `items.update.${index}`;
    const { weapon: weaponKeys, action: actionKeys, strike: strikeKeys, common: commonKeys } = fieldGroups(fields);
    const hits = byName(match);
    const wanted = match.trim().toLowerCase();

    if (weaponKeys.length) {
      const strikes = live().filter((item) => {
        const flag = strikeFlag(item);
        return item.type === "melee" && flag && (flag.weapon.toLowerCase() === wanted || item.name.toLowerCase() === wanted);
      });
      if (!strikes.length) errors.push(`${where}: ${weaponKeys.join(", ")} need a strike imported from a weapon named "${match}"`);
      for (const strike of strikes) {
        const flag = { ...strikeFlag(strike)!, ...flagEdits.get(strike._id) };
        if (fields.proficiency) flag.proficiency = fields.proficiency;
        if (fields.runes?.potency !== undefined) flag.potency = fields.runes.potency;
        if (fields.runes?.striking !== undefined) flag.striking = fields.runes.striking;
        if (fields.abilityOverride !== undefined) flag.abilityOverride = fields.abilityOverride;
        if (fields.damageAbilityOverride !== undefined) flag.damageAbilityOverride = fields.damageAbilityOverride;
        flagEdits.set(strike._id, flag);
      }
      for (const weapon of hits.filter((item) => item.type === "weapon")) Object.assign(updateFor(weapon._id), runeUpdate(fields));
    }

    if (!actionKeys.length && !strikeKeys.length && !commonKeys.length) {
      if (!weaponKeys.length) errors.push(`${where}: nothing to change`);
      return;
    }
    if (actionKeys.length && strikeKeys.length) {
      errors.push(`${where}: ${actionKeys.join(", ")} and ${strikeKeys.join(", ")} can't apply to the same item`);
      return;
    }
    const types = actionKeys.length ? ["action"] : strikeKeys.length ? ["melee"] : ["action", "melee"];
    const targets = hits.filter((item) => types.includes(item.type));
    if (!targets.length) {
      errors.push(`${where}: no ${types.join(" or ")} item named "${match}"`);
      return;
    }
    if (fields.trigger && fields.description === undefined) {
      errors.push(`${where}: trigger needs description in the same set`);
      return;
    }

    for (const item of targets) {
      Object.assign(updateFor(item._id), itemFieldUpdate(item, fields));
      changes.push(`~ ${item.name}: ${[...commonKeys, ...actionKeys, ...strikeKeys].join(", ")}`);
    }
  });

  for (const item of doc.items.add) {
    result.addItems.push(item);
    changes.push(`+ ${item.origin === "homebrew" ? item.name : item.lookup.name}`);
  }

  // --- attack effects must name an action on the patched actor ---------------------
  const actionSlugs = new Set<string>(live().filter((item) => item.type === "action").map((item) => item.system?.slug || sluggify(item.name)));
  for (const item of result.addItems) {
    if (isHomebrewAction(item)) actionSlugs.add(sluggify(item.name));
    if (item.origin === "compendiumRef" && item.refType === "action") actionSlugs.add(sluggify(item.lookup.name));
  }
  const checkEffects = (name: string, effects: string[], where: string) => {
    for (const effect of effects) {
      const kind = classifyAttackEffect(effect, actionSlugs);
      if (kind === "builtin") warn(`"${name}" attack effect "${sluggify(effect)}" has no matching action; the roll card will show the label only`);
      if (kind === "unknown") errors.push(`${where}: "${effect}" doesn't match any action item on this actor`);
    }
  };
  result.addItems.forEach((item) => {
    if (isHomebrewStrike(item)) checkEffects(item.name, item.attackEffects, `items: "${item.name}".attackEffects`);
  });
  doc.items.update.forEach(({ match, set }, index) => {
    if (set.attackEffects) checkEffects(match, set.attackEffects, `items.update.${index}.attackEffects`);
  });

  // --- strike recalc ---------------------------------------------------------------
  const level = (actorUpdate["system.details.level.value"] as number | undefined) ?? source.system.details?.level?.value ?? 0;
  const abilities = Object.fromEntries(
    ABILITIES.map((key) => [key, (actorUpdate[`system.abilities.${key}.mod`] as number | undefined) ?? source.system.abilities?.[key]?.mod ?? 0]),
  ) as Record<AbilityKey, number>;
  result.stats = { level, abilities };

  const statsChanged =
    "system.details.level.value" in actorUpdate || ABILITIES.some((key) => `system.abilities.${key}.mod` in actorUpdate);
  const strikes = live().filter((item) => item.type === "melee");
  for (const strike of strikes) {
    const flag = flagEdits.get(strike._id) ?? strikeFlag(strike);
    if (!flag || (!statsChanged && !flagEdits.has(strike._id))) continue;

    const u = updateFor(strike._id);
    const traits = (u["system.traits.value"] as string[] | undefined) ?? strike.system?.traits?.value ?? [];
    const next = computeStrike({ ...result.stats, ...flag, traits });
    const rolls = strike.system?.damageRolls ?? {};
    const key = baseRollKey(rolls);
    const beforeBonus = strike.system?.bonus?.value;
    const beforeDamage = key ? rolls[key].damage : undefined;

    u["system.bonus.value"] = next.attackBonus;
    if (key && !Object.keys(u).some((path) => path.startsWith("system.damageRolls."))) u[`system.damageRolls.${key}.damage`] = next.damage;
    if (flagEdits.has(strike._id)) u[`flags.${CONSTANTS.MODULE_ID}.strike`] = flag;

    const parts = [];
    if (beforeBonus !== next.attackBonus) parts.push(`${signed(beforeBonus ?? 0)} → ${signed(next.attackBonus)}`);
    if (beforeDamage !== next.damage) parts.push(`${beforeDamage ?? "none"} → ${next.damage}`);
    if (parts.length) changes.push(`${strike.name} strike: ${parts.join(", ")}`);
  }
  if (statsChanged) {
    const manual = strikes.filter((strike) => !strikeFlag(strike)).length;
    if (manual) warn(`${manual} strike(s) weren't made from an imported weapon and keep their numbers`);
  }

  result.deleteItemIds = [...deleted];
  result.updateItems = [...updates.values()].filter((u) => !deleted.has(u._id as string) && Object.keys(u).length > 1);
  return result;
}
