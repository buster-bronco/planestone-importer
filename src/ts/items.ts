import CONSTANTS from "./constants";
import { buildHomebrewAction, buildHomebrewStrike } from "./build/homebrew";
import { buildHomebrewSpell } from "./build/spellData";
import { computeStrike, dieFromDamage, type StrikeFlag, type StrikeStats } from "./build/strikeMath";
import { applyLinkMarks, type LinkTarget } from "./linkMarks";
import { normalizePackId, type PackIndex } from "./packIndex";
import { isHomebrewSpell, isHomebrewStrike, type EquippedWeaponItem, type SheetItem, type SpellRef } from "./schema";
import { getGame } from "./utils";

export interface PreparedWeapon {
  item: EquippedWeaponItem;
  source: any;
}

export interface ItemContext {
  index: PackIndex;
  targets: Map<string, LinkTarget>;
  warn: (message: string) => void;
  fail: (message: string) => void;
}

export type ResolvedItem = { data: any } | { weapon: PreparedWeapon } | null;

// compendium document → embeddable data with compendiumSource set
async function compendiumItemData(uuid: string): Promise<any> {
  const document = await fromUuid(uuid);
  if (!document) throw new Error(`compendium item ${uuid} not found`);
  return getGame().items.fromCompendium(document);
}

export function linkHtml(html: string, itemName: string, targets: Map<string, LinkTarget>, warn: (message: string) => void): string {
  const result = applyLinkMarks(html, (name) => targets.get(name) ?? null);
  for (const term of result.unresolved) warn(`"${itemName}": no condition or action named "${term}", left as plain text`);
  return result.html;
}

function linkDescription(itemData: any, targets: Map<string, LinkTarget>, warn: (message: string) => void): void {
  const description = itemData.system?.description;
  if (!description?.value) return;
  description.value = linkHtml(description.value, itemData.name, targets, warn);
}

export function sheetItemName(item: SheetItem): string {
  return item.origin === "homebrew" ? item.name : item.lookup.name;
}

function homebrewData(item: Extract<SheetItem, { origin: "homebrew" }>, ctx: ItemContext): any {
  const data = isHomebrewSpell(item) ? buildHomebrewSpell(item) : isHomebrewStrike(item) ? buildHomebrewStrike(item, ctx.warn) : buildHomebrewAction(item);
  linkDescription(data, ctx.targets, ctx.warn);
  return data;
}

// compendium lookup by name; a miss or a bad pack hint calls fail and returns null
async function findCompendium(lookup: { name: string; pack?: string }, refType: "action" | "equipment" | "spell", label: string, ctx: ItemContext): Promise<string | null> {
  const packs = lookup.pack ? [normalizePackId(lookup.pack)] : CONSTANTS.PACKS_BY_REF_TYPE[refType];
  if (lookup.pack && !game.packs.get(packs[0])) {
    ctx.fail(`pack "${lookup.pack}" not found for "${lookup.name}"`);
    return null;
  }

  const hit = await ctx.index.find(packs, lookup.name, label === "weapon" ? ["weapon"] : refType === "equipment" ? undefined : [refType]);
  if (!hit) {
    ctx.fail(`no ${label} named "${lookup.name}" in ${packs.join(", ")}`);
    return null;
  }
  if (hit.alternatives.length) ctx.warn(`"${lookup.name}" matched ${hit.alternatives.length + 1} items; using ${hit.uuid}`);
  return hit.uuid;
}

// sheet item → item data, or a weapon still waiting for its strike
export async function resolveItem(item: SheetItem, ctx: ItemContext): Promise<ResolvedItem> {
  if (item.origin === "homebrew") return { data: homebrewData(item, ctx) };

  const isWeapon = item.origin === "equippedWeapon";
  const refType = isWeapon ? "equipment" : item.refType;
  const uuid = await findCompendium(item.lookup, refType, isWeapon ? "weapon" : refType, ctx);
  if (!uuid) return null;

  const data = await compendiumItemData(uuid);
  return isWeapon ? { weapon: { item, source: data } } : { data };
}

// spell list entry → spell item data, not yet placed in an entry
export async function resolveSpell(ref: SpellRef, ctx: ItemContext): Promise<any | null> {
  const { item } = ref;
  if (item.origin === "homebrew") return homebrewData(item, ctx);
  const uuid = await findCompendium(item.lookup, "spell", "spell", ctx);
  return uuid ? compendiumItemData(uuid) : null;
}

// weapon → pf2e's generated npc attack, with pc-style numbers swapped in; created ids go into `created`
export async function addWeaponStrike(actor: any, weapon: PreparedWeapon, stats: StrikeStats, created: string[] = []): Promise<void> {
  const { item } = weapon;
  const source = foundry.utils.deepClone(weapon.source);
  foundry.utils.setProperty(source, "system.runes.potency", item.runes.potency);
  foundry.utils.setProperty(source, "system.runes.striking", item.runes.striking);

  const [weaponDoc] = await actor.createEmbeddedDocuments("Item", [source]);
  created.push(weaponDoc.id);
  const attacks = weaponDoc.toNPCAttacks().map((attack: any) => {
    const data = attack.toObject();
    const rolls: any[] = Object.values(data.system.damageRolls);
    const base = rolls.find((roll) => !roll.category) ?? rolls[0];
    const flag: StrikeFlag = {
      weapon: weaponDoc.name,
      proficiency: item.proficiency,
      potency: item.runes.potency,
      striking: item.runes.striking,
      die: dieFromDamage(base?.damage ?? "") ?? weaponDoc.system.damage.die,
      abilityOverride: item.abilityOverride,
      damageAbilityOverride: item.damageAbilityOverride,
    };
    const result = computeStrike({ ...stats, ...flag, traits: data.system.traits.value });
    data.system.bonus.value = result.attackBonus;
    if (base) base.damage = result.damage;
    foundry.utils.setProperty(data, `flags.${CONSTANTS.MODULE_ID}.strike`, flag);
    return data;
  });

  const strikes = await actor.createEmbeddedDocuments("Item", attacks);
  created.push(...strikes.map((strike: any) => strike.id));
  if (!item.keepInInventory) {
    await weaponDoc.delete();
    created.splice(created.indexOf(weaponDoc.id), 1);
  }
}
