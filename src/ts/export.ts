import yaml from "js-yaml";
import CONSTANTS from "./constants";
import { formatSense } from "./build/actorData";
import type { StrikeFlag } from "./build/strikeMath";
import type { ActorSource } from "./patch/paths";
import type { ItemSource } from "./patch/item";

// compendium uuid → that entry's name, e.g. via fromUuidSync
export type SourceName = (uuid: string) => string | undefined;

export interface SheetExport {
  sheet: Record<string, unknown>;
  // items with no sheet form, noted as yaml comments
  skipped: string[];
}

const SIZE_NAMES: Record<string, string> = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" };

const REFTYPE_BY_ITEM: Record<string, "action" | "equipment" | "spell"> = {
  action: "action",
  spell: "spell",
  weapon: "equipment",
  armor: "equipment",
  shield: "equipment",
  equipment: "equipment",
  consumable: "equipment",
  treasure: "equipment",
  backpack: "equipment",
  ammo: "equipment",
};

// _stats.compendiumSource is v12+; flags.core.sourceId is the older spot
function compendiumSource(item: any): string | undefined {
  const uuid = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  return typeof uuid === "string" && uuid.startsWith("Compendium.") ? uuid : undefined;
}

// "Compendium.pf2e.actionspf2e.Item.x" → "actionspf2e"
function packOf(uuid: string): string {
  const [, scope, name] = uuid.split(".");
  return scope === "pf2e" ? name : `${scope}.${name}`;
}

function strikeFlag(item: any): StrikeFlag | undefined {
  return item.flags?.[CONSTANTS.MODULE_ID]?.strike;
}

function nonEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)),
  ) as Partial<T>;
}

// inverse of reactionHtml: trigger paragraph, rule, effect
function splitTrigger(html: string): { trigger?: string; description: string } {
  const match = html.match(/^<p><strong>Trigger<\/strong>\s*([\s\S]*?)<\/p>\s*<hr\s*\/?>\s*([\s\S]*)$/);
  if (!match) return { description: html };
  return { trigger: match[1].trim(), description: match[2].replace(/^<p><strong>Effect<\/strong>\s*/, "<p>").trim() };
}

function compendiumRef(item: any, uuid: string, sourceName: SourceName) {
  return {
    origin: "compendiumRef",
    refType: REFTYPE_BY_ITEM[item.type],
    lookup: { name: sourceName(uuid) ?? item.name, pack: packOf(uuid) },
  };
}

function homebrewAction(item: any) {
  const system = item.system ?? {};
  const kind = system.actionType?.value ?? "action";
  const actionType = kind === "action" ? (system.actions?.value ?? 1) : kind;
  const { trigger, description } = splitTrigger(system.description?.value ?? "");
  return nonEmpty({
    origin: "homebrew",
    type: actionType === "passive" ? "passive" : "action",
    name: item.name,
    actionType,
    category: system.category,
    trigger,
    traits: system.traits?.value,
    description,
  });
}

function homebrewStrike(item: any) {
  const system = item.system ?? {};
  const traits: string[] = system.traits?.value ?? [];
  const ranged = system.weaponType?.value === "ranged" || traits.some((t) => /^range-/.test(t));
  return nonEmpty({
    origin: "homebrew",
    type: ranged ? "ranged" : "melee",
    name: item.name,
    attackBonus: system.bonus?.value ?? 0,
    damageRolls: Object.values(system.damageRolls ?? {}).map((roll: any) => ({ damage: roll.damage, damageType: roll.damageType })),
    traits,
    attackEffects: system.attackEffects?.value,
    description: system.description?.value,
  });
}

function equippedWeapon(name: string, flag: StrikeFlag, keepInInventory: boolean) {
  return {
    origin: "equippedWeapon",
    lookup: { name },
    proficiency: flag.proficiency,
    runes: { potency: flag.potency, striking: flag.striking },
    abilityOverride: flag.abilityOverride,
    damageAbilityOverride: flag.damageAbilityOverride,
    keepInInventory,
  };
}

// one embedded or world item → sheet item entry, or null when there's no sheet form
function exportSheetItem(item: any, sourceName: SourceName): Record<string, unknown> | null {
  const uuid = compendiumSource(item);
  if (item.type === "melee") return homebrewStrike(item);
  if (uuid && REFTYPE_BY_ITEM[item.type]) return compendiumRef(item, uuid, sourceName);
  if (item.type === "action") return homebrewAction(item);
  return null;
}

// npc actor data → kind: actor sheet
export function exportActor(source: ActorSource & { flags?: any }, sourceName: SourceName = () => undefined): SheetExport {
  const system = source.system ?? {};
  const attributes = system.attributes ?? {};
  const languages = system.details?.languages ?? {};
  const skipped: string[] = [];

  // weapon strikes regroup under the weapon they came from
  const strikesByWeapon = new Map<string, StrikeFlag>();
  for (const item of source.items) {
    const flag = strikeFlag(item);
    if (item.type === "melee" && flag && !strikesByWeapon.has(flag.weapon)) strikesByWeapon.set(flag.weapon, flag);
  }

  const items: Record<string, unknown>[] = [];
  const weaponsSeen = new Set<string>();
  for (const item of source.items) {
    if (item.type === "lore" || (item.type === "melee" && strikeFlag(item))) continue;
    const flag = item.type === "weapon" ? strikesByWeapon.get(item.name) : undefined;
    if (flag) {
      const uuid = compendiumSource(item);
      items.push(equippedWeapon((uuid && sourceName(uuid)) ?? item.name, flag, true));
      weaponsSeen.add(item.name);
      continue;
    }
    if (item.type === "spell") {
      skipped.push(`${item.name} (spell; npc spellcasting isn't supported yet)`);
      continue;
    }
    const entry = exportSheetItem(item, sourceName);
    if (entry) items.push(entry);
    else skipped.push(`${item.name} (${item.type})`);
  }
  // strikes whose weapon was dropped after import
  for (const [weapon, flag] of strikesByWeapon) if (!weaponsSeen.has(weapon)) items.push(equippedWeapon(weapon, flag, false));

  const moduleFlags = source.flags?.[CONSTANTS.MODULE_ID] ?? {};
  const extraLanguages = (languages.details ?? "").split(",").map((text: string) => text.trim()).filter(Boolean);
  const abilities = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((key) => [key, system.abilities?.[key]?.mod ?? 0]));

  const sheet = {
    schemaVersion: 1,
    kind: "actor",
    meta: nonEmpty({
      name: source.name,
      actorType: "npc",
      level: system.details?.level?.value ?? 0,
      freeArchetype: moduleFlags.freeArchetype ?? false,
      source: system.details?.publication?.title,
    }),
    core: {
      traits: system.traits?.value ?? [],
      rarity: system.traits?.rarity ?? "common",
      size: SIZE_NAMES[system.traits?.size?.value] ?? "medium",
      languages: [...(languages.value ?? []), ...extraLanguages],
      abilities,
      perception: { mod: system.perception?.mod ?? 0, senses: (system.perception?.senses ?? []).map(formatSense) },
      ac: attributes.ac?.value ?? 10,
      saves: Object.fromEntries(["fortitude", "reflex", "will"].map((save) => [save, system.saves?.[save]?.value ?? 0])),
      hp: nonEmpty({ value: attributes.hp?.max ?? attributes.hp?.value ?? 1, notes: attributes.hp?.details }),
      speed: {
        value: attributes.speed?.value ?? 0,
        other: (attributes.speed?.otherSpeeds ?? []).map((s: any) => ({ type: s.type, value: s.value })),
      },
      skills: {
        named: Object.fromEntries(Object.entries(system.skills ?? {}).map(([slug, skill]: [string, any]) => [slug, skill?.base ?? 0])),
        lore: source.items.filter((item) => item.type === "lore").map((item) => ({ name: item.name, mod: item.system?.mod?.value ?? 0 })),
      },
      resistances: (attributes.resistances ?? []).map((r: any) => ({ type: r.type, value: r.value, exceptions: r.exceptions ?? [] })),
      weaknesses: (attributes.weaknesses ?? []).map((w: any) => ({ type: w.type, value: w.value })),
      immunities: (attributes.immunities ?? []).map((i: any) => ({ type: i.type })),
    },
    items,
  };
  return { sheet, skipped };
}

// world item data → kind: item sheet
export function exportItem(source: ItemSource & { flags?: any; _stats?: any }, sourceName: SourceName = () => undefined): SheetExport {
  const entry = exportSheetItem(source, sourceName);
  if (!entry) return { sheet: { schemaVersion: 1, kind: "item" }, skipped: [`${source.name} (${source.type})`] };
  return { sheet: { schemaVersion: 1, kind: "item", ...entry }, skipped: [] };
}

// yaml text, with skipped items listed on top
export function exportYaml({ sheet, skipped }: SheetExport): string {
  const notes = skipped.map((text) => `# not exported: ${text}\n`).join("");
  return notes + yaml.dump(sheet, { lineWidth: -1, noRefs: true });
}
