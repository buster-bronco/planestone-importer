import type { HomebrewSpellItem, SpellcastingEntry, SpellRankKey } from "../schema";
import { randomID, sluggify, titleCase } from "../slug";
import { reactionHtml, toHtml } from "./homebrew";

export interface PlacedSpell {
  data: any;
  // pf2e slot index; slot0 holds cantrips
  slot: number;
}

export function entryName(entry: SpellcastingEntry): string {
  return entry.name ?? `${titleCase(entry.tradition)} ${titleCase(entry.type)} Spells`;
}

// spell slot key → rank number, cantrips are 0
export function rankOf(key: SpellRankKey): number {
  return key === "cantrips" ? 0 : Number(key.slice(4));
}

// pf2e spellcastingEntry item; spelldc.value is the attack modifier
export function buildSpellcastingEntry(entry: SpellcastingEntry, id: string) {
  const slots = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`slot${i}`, { prepared: [] as { id: string; expended: boolean }[], value: 0, max: 0 }]));
  for (const [key, count] of Object.entries(entry.slots ?? {})) {
    if (count === undefined) continue;
    const slot = slots[`slot${rankOf(key as SpellRankKey)}`];
    slot.max = slot.value = count;
  }

  return {
    _id: id,
    name: entryName(entry),
    type: "spellcastingEntry",
    system: {
      tradition: { value: entry.tradition },
      prepared: { value: entry.type, flexible: false },
      ability: { value: entry.ability },
      spelldc: { value: entry.attack ?? entry.dc - 10, dc: entry.dc },
      slots,
      showSlotlessLevels: { value: false },
      proficiency: { value: 1 },
      autoHeightenLevel: { value: null },
    },
  };
}

export function buildHomebrewSpell(item: HomebrewSpellItem) {
  const traits = item.traits.map(sluggify);
  if (item.cantrip && !traits.includes("cantrip")) traits.push("cantrip");
  if (item.focus && !traits.includes("focus")) traits.push("focus");
  if (item.defense?.save === "ac" && !traits.includes("attack")) traits.push("attack");

  const damageIds = item.damage.map(() => randomID());
  const damage = Object.fromEntries(
    item.damage.map((roll, i) => [damageIds[i], { formula: roll.formula, kinds: ["damage"], type: sluggify(roll.type), category: roll.category, materials: [] }]),
  );
  // interval heightening maps damage ids to the formula added every n ranks
  const heightening = item.heightening
    ? { type: "interval", interval: item.heightening.every, damage: Object.fromEntries(item.heightening.damage.map((formula, i) => [damageIds[i], formula])) }
    : undefined;

  const defense = !item.defense
    ? null
    : item.defense.save === "ac"
      ? { passive: { statistic: "ac" } }
      : { save: { statistic: item.defense.save, basic: item.defense.basic } };

  return {
    name: item.name,
    type: "spell",
    system: {
      slug: sluggify(item.name),
      level: { value: item.rank },
      traits: { value: traits, rarity: item.rarity, traditions: item.traditions },
      time: { value: String(item.actions) },
      requirements: item.requirements,
      range: { value: item.range },
      area: item.area,
      target: { value: item.targets },
      duration: { value: item.duration, sustained: item.sustained },
      defense,
      damage,
      ...(heightening ? { heightening } : {}),
      cost: { value: "" },
      counteraction: false,
      location: { value: null },
      description: { value: item.trigger ? reactionHtml(item.trigger, item.description) : toHtml(item.description) },
      rules: [],
    },
  };
}

// puts a resolved spell into an entry at the rank it was listed under
export function placeSpell(
  source: any,
  entry: SpellcastingEntry,
  entryId: string,
  key: SpellRankKey,
  uses: number | "at-will" | "constant" | undefined,
  warn: (message: string) => void,
): PlacedSpell {
  const data = structuredClone(source);
  data._id = randomID();
  const system = data.system;
  const base: number = system.level?.value ?? 1;
  const isCantrip = (system.traits?.value ?? []).includes("cantrip");
  let rank = rankOf(key);

  if (isCantrip && rank) {
    warn(`"${data.name}" is a cantrip; listed with the cantrips`);
    rank = 0;
  } else if (!isCantrip && !rank) {
    warn(`"${data.name}" isn't a cantrip; listed at rank ${base}`);
    rank = base;
  } else if (rank && rank < base) {
    warn(`"${data.name}" is rank ${base}; can't be listed at rank ${rank}, listed at rank ${base}`);
    rank = base;
  }

  // prepared spells heighten from their slot
  const location: Record<string, unknown> = { value: entryId };
  if (rank > base && entry.type !== "prepared") location.heightenedLevel = rank;
  if (typeof uses === "number") location.uses = { value: uses, max: uses };
  // pf2e bestiaries mark these with a name suffix
  else if (uses === "at-will") data.name = `${data.name} (At Will)`;
  else if (uses === "constant") data.name = `${data.name} (Constant)`;
  system.location = location;

  return { data, slot: rank };
}

// prepared spells fill their slots; runs after lookups so dropped spells leave no slot behind
export function fillPreparedSlots(entryData: ReturnType<typeof buildSpellcastingEntry>, entry: SpellcastingEntry, placed: PlacedSpell[]): void {
  if (entry.type !== "prepared") return;
  for (const { data, slot } of placed) entryData.system.slots[`slot${slot}`].prepared.push({ id: data._id, expended: false });
  for (const slot of Object.values(entryData.system.slots)) {
    if (!slot.max) slot.max = slot.value = slot.prepared.length;
  }
}

// focus pool from every focus entry, pf2e caps it at 3
export function focusPool(entries: SpellcastingEntry[]): number {
  const total = entries.filter((entry) => entry.type === "focus").reduce((sum, entry) => sum + (entry.focusPoints ?? 1), 0);
  return Math.min(total, 3);
}
