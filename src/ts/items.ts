import CONSTANTS from "./constants";
import { buildHomebrewAction, buildHomebrewStrike } from "./build/homebrew";
import { applyInventory, buildHomebrewGear } from "./build/gearData";
import { buildHomebrewSpell } from "./build/spellData";
import { computeStrike, dieFromDamage, type StrikeFlag, type StrikeStats } from "./build/strikeMath";
import { applyAutoRolls } from "./autoRolls";
import { remasterName } from "./aliases";
import { formatRanked, rank } from "./fuzzy";
import { lintConditions } from "./lint";
import { applyLinkMarks, type LinkTarget } from "./linkMarks";
import { normalizePackId, type PackIndex, type RefType } from "./packIndex";
import { accepter, type Review } from "./review";
import { isHomebrewGear, isHomebrewSpell, isHomebrewStrike, type EquippedWeaponItem, type SheetItem, type SpellRef } from "./schema";
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
  // fixes and suggestions for the plan; absent in pure builds
  review?: Review;
  // owner label for suggestions, e.g. the actor name
  owner?: string;
}

export type ResolvedItem = { data: any } | { weapon: PreparedWeapon } | null;

// compendium document → embeddable data with compendiumSource set
async function compendiumItemData(uuid: string): Promise<any> {
  const document = await fromUuid(uuid);
  if (!document) throw new Error(`compendium item ${uuid} not found`);
  return getGame().items.fromCompendium(document);
}

// " (did you mean stupefied?)" for a mark that didn't resolve
function markHint(term: string, targets: Map<string, LinkTarget>): string {
  const name = term.replace(/\s+\d+$/, "");
  const legacy = remasterName(name);
  const best = legacy && targets.has(legacy) ? legacy : rank(name, [...targets.values()], { limit: 1 })[0]?.name.toLowerCase();
  return best ? ` (did you mean ${best}?)` : "";
}

// condition lint → [[term]] links → dice rolls; each automatic change is a rejectable fix
export function linkHtml(html: string, where: string, targets: Map<string, LinkTarget>, warn: (message: string) => void, review?: Review): string {
  const accept = accepter(review, where);
  const linted = review?.lint ? lintConditions(html, targets, accept) : html;
  const result = applyLinkMarks(linted, (name) => targets.get(name) ?? null);
  for (const term of result.unresolved) warn(`"${where}": no condition or action named "${term}", left as plain text${markHint(term, targets)}`);
  return applyAutoRolls(result.html, accept);
}

function linkDescription(itemData: any, ctx: ItemContext): void {
  const description = itemData.system?.description;
  if (!description?.value) return;
  description.value = linkHtml(description.value, itemData.name, ctx.targets, ctx.warn, ctx.review);
}

export function sheetItemName(item: SheetItem): string {
  return item.origin === "homebrew" ? item.name : item.lookup.name;
}

function homebrewData(item: Extract<SheetItem, { origin: "homebrew" }>, ctx: ItemContext): any {
  if (isHomebrewGear(item)) {
    const gear = buildHomebrewGear(item);
    applyInventory(gear, item, ctx.warn);
    linkDescription(gear, ctx);
    return gear;
  }
  const data = isHomebrewSpell(item) ? buildHomebrewSpell(item) : isHomebrewStrike(item) ? buildHomebrewStrike(item, ctx.warn) : buildHomebrewAction(item);
  linkDescription(data, ctx);
  return data;
}

// compendium lookup by name; a miss or a bad pack hint calls fail and returns null
async function findCompendium(lookup: { name: string; pack?: string }, refType: RefType, label: string, ctx: ItemContext): Promise<string | null> {
  const packs = lookup.pack ? [normalizePackId(lookup.pack)] : CONSTANTS.PACKS_BY_REF_TYPE[refType];
  if (lookup.pack && !game.packs.get(packs[0])) {
    ctx.fail(`pack "${lookup.pack}" not found for "${lookup.name}"`);
    return null;
  }

  const types = label === "weapon" ? ["weapon"] : refType === "equipment" ? undefined : [refType];
  let hit = await ctx.index.find(packs, lookup.name, types);
  const legacy = hit ? null : remasterName(lookup.name);
  if (legacy) {
    hit = await ctx.index.find(packs, legacy, types);
    if (hit) ctx.warn(`"${lookup.name}" is a legacy name; used ${legacy}`);
  }
  if (!hit) {
    ctx.fail(await missMessage(lookup.name, packs, types, refType, label, ctx));
    return null;
  }
  if (hit.alternatives.length) ctx.warn(`"${lookup.name}" matched ${hit.alternatives.length + 1} items; using ${hit.uuid}`);
  return hit.uuid;
}

// why a lookup missed: wrong refType, or the closest names
async function missMessage(name: string, packs: readonly string[], types: string[] | undefined, refType: RefType, label: string, ctx: ItemContext): Promise<string> {
  const base = `no ${label} named "${name}" in ${packs.join(", ")}`;
  const other = await ctx.index.elsewhere(name, refType);
  if (other) return `${base}; "${other.name}" is a ${other.refType}, use refType: ${other.refType}`;
  const candidates = await ctx.index.suggest(packs, name, types);
  if (!candidates.length) return base;
  ctx.review?.suggestions.push({ where: ctx.owner ? `${ctx.owner}: ${name}` : name, name, refType, candidates });
  return `${base}; did you mean ${formatRanked(candidates)}?`;
}

// sheet item → item data, or a weapon still waiting for its strike
export async function resolveItem(item: SheetItem, ctx: ItemContext): Promise<ResolvedItem> {
  if (item.origin === "homebrew") return { data: homebrewData(item, ctx) };

  const isWeapon = item.origin === "equippedWeapon";
  const refType = isWeapon ? "equipment" : item.refType;
  const uuid = await findCompendium(item.lookup, refType, isWeapon ? "weapon" : refType, ctx);
  if (!uuid) return null;

  const data = await compendiumItemData(uuid);
  if (isWeapon || refType === "equipment") applyInventory(data, item, ctx.warn);
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
