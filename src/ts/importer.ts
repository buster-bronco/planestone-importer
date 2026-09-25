import CONSTANTS from "./constants";
import { buildActorSystem, type Vocabulary } from "./build/actorData";
import { buildHomebrewAction, buildHomebrewStrike } from "./build/homebrew";
import { computeStrike, dieFromDamage } from "./build/strikeMath";
import { applyLinkMarks, type LinkTarget } from "./linkMarks";
import { normalizePackId, PackIndex } from "./packIndex";
import { parseSheetText } from "./parse";
import { isHomebrewStrike, type ActorDoc, type EquippedWeaponItem } from "./schema";
import { getGame } from "./utils";

export interface PreparedWeapon {
  item: EquippedWeaponItem;
  source: any;
}

export interface PreparedActor {
  doc: ActorDoc;
  system: Record<string, unknown>;
  items: any[];
  weapons: PreparedWeapon[];
  warnings: string[];
  errors: string[];
}

export interface ImportPlan {
  actors: PreparedActor[];
  errors: string[];
  warnings: string[];
}

export interface ImportResult {
  name: string;
  ok: boolean;
  actorUuid?: string;
  error?: string;
}

function vocabulary(): Vocabulary {
  const pf2e = CONFIG.PF2E ?? {};
  const keys = (record: unknown) => (record && typeof record === "object" ? new Set(Object.keys(record)) : undefined);
  return {
    creatureTraits: keys(pf2e.creatureTraits),
    languages: keys(pf2e.languages),
    senses: keys(pf2e.senses),
    skills: keys(pf2e.skills),
  };
}

// compendium document → embeddable data with compendiumSource set
async function compendiumItemData(uuid: string): Promise<any> {
  const document = await fromUuid(uuid);
  if (!document) throw new Error(`compendium item ${uuid} not found`);
  return getGame().items.fromCompendium(document);
}

function linkDescription(itemData: any, targets: Map<string, LinkTarget>, warn: (message: string) => void): void {
  const description = itemData.system?.description;
  if (!description?.value) return;
  const { html, unresolved } = applyLinkMarks(description.value, (name) => targets.get(name) ?? null);
  description.value = html;
  for (const term of unresolved) warn(`"${itemData.name}": no condition or action named "${term}", left as plain text`);
}

async function prepareActor(doc: ActorDoc, index: PackIndex, targets: Map<string, LinkTarget>, vocab: Vocabulary): Promise<PreparedActor> {
  const { system, loreItems, warnings } = buildActorSystem(doc, vocab);
  const prepared: PreparedActor = { doc, system, items: [...loreItems], weapons: [], warnings, errors: [] };
  const name = doc.meta.name;
  const warn = (message: string) => prepared.warnings.push(`${name}: ${message}`);
  const fail = (message: string) => prepared.errors.push(`${name}: ${message}`);

  for (const item of doc.items) {
    if (item.origin === "homebrew") {
      const data = isHomebrewStrike(item) ? buildHomebrewStrike(item, warn) : buildHomebrewAction(item);
      linkDescription(data, targets, warn);
      prepared.items.push(data);
      continue;
    }

    const isWeapon = item.origin === "equippedWeapon";
    const refType = isWeapon ? "equipment" : item.refType;
    if (refType === "spell") {
      warn(`spell "${item.lookup.name}" skipped; spells need a spellcasting entry`);
      continue;
    }

    const packs = item.lookup.pack ? [normalizePackId(item.lookup.pack)] : CONSTANTS.PACKS_BY_REF_TYPE[refType];
    if (item.lookup.pack && !game.packs.get(packs[0])) {
      fail(`pack "${item.lookup.pack}" not found for "${item.lookup.name}"`);
      continue;
    }

    const hit = await index.find(packs, item.lookup.name, isWeapon ? ["weapon"] : refType === "action" ? ["action"] : undefined);
    if (!hit) {
      fail(`no ${isWeapon ? "weapon" : refType} named "${item.lookup.name}" in ${packs.join(", ")}`);
      continue;
    }
    if (hit.alternatives.length) warn(`"${item.lookup.name}" matched ${hit.alternatives.length + 1} items; using ${hit.uuid}`);

    const data = await compendiumItemData(hit.uuid);
    if (isWeapon) prepared.weapons.push({ item, source: data });
    else prepared.items.push(data);
  }

  return prepared;
}

// parse, validate and resolve everything without touching the world
export async function prepareImport(text: string): Promise<ImportPlan> {
  const parsed = parseSheetText(text);
  const plan: ImportPlan = { actors: [], errors: [...parsed.errors], warnings: [...parsed.warnings] };
  if (plan.errors.length) return plan;

  const index = new PackIndex();
  const targets = await index.linkTargets();
  const vocab = vocabulary();
  for (const doc of parsed.actors) {
    const prepared = await prepareActor(doc, index, targets, vocab);
    plan.actors.push(prepared);
    plan.errors.push(...prepared.errors);
    plan.warnings.push(...prepared.warnings);
  }
  return plan;
}

// weapon → pf2e's generated npc attack, with pc-style numbers swapped in
async function addWeaponStrike(actor: any, prepared: PreparedActor, weapon: PreparedWeapon): Promise<void> {
  const { item } = weapon;
  const source = foundry.utils.deepClone(weapon.source);
  foundry.utils.setProperty(source, "system.runes.potency", item.runes.potency);
  foundry.utils.setProperty(source, "system.runes.striking", item.runes.striking);

  const [created] = await actor.createEmbeddedDocuments("Item", [source]);
  const attacks = created.toNPCAttacks().map((attack: any) => {
    const data = attack.toObject();
    const rolls: any[] = Object.values(data.system.damageRolls);
    const base = rolls.find((roll) => !roll.category) ?? rolls[0];
    const die = dieFromDamage(base?.damage ?? "") ?? created.system.damage.die;
    const result = computeStrike({
      level: prepared.doc.meta.level,
      proficiency: item.proficiency,
      abilities: prepared.doc.core.abilities,
      potency: item.runes.potency,
      striking: item.runes.striking,
      traits: data.system.traits.value,
      die,
      abilityOverride: item.abilityOverride,
      damageAbilityOverride: item.damageAbilityOverride,
    });
    data.system.bonus.value = result.attackBonus;
    if (base) base.damage = result.damage;
    return data;
  });

  await actor.createEmbeddedDocuments("Item", attacks);
  if (!item.keepInInventory) await created.delete();
}

export interface ImportOptions {
  // actor folder id; null or missing imports at the root
  folderId?: string | null;
}

export interface FolderOption {
  id: string;
  label: string;
}

// actor folders in tree order, nested names indented
export function actorFolderOptions(): FolderOption[] {
  const byParent = new Map<string | null, any[]>();
  for (const folder of getGame().folders.filter((f: any) => f.type === "Actor")) {
    const parent = folder.folder?.id ?? null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }

  const options: FolderOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of children) {
      options.push({ id: folder.id, label: `${"   ".repeat(depth)}${folder.name}` });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
}

// creates each actor on its own; a failed actor is rolled back and reported
export async function executeImport(plan: ImportPlan, options: ImportOptions = {}): Promise<ImportResult[]> {
  if (plan.errors.length) throw new Error("import plan has errors");
  // folder may have been deleted since the dialog opened
  const folder = options.folderId && getGame().folders.get(options.folderId) ? options.folderId : null;
  const results: ImportResult[] = [];

  for (const prepared of plan.actors) {
    const { meta } = prepared.doc;
    let actor: any = null;
    try {
      actor = await Actor.implementation.create({
        name: meta.name,
        type: "npc",
        folder,
        system: prepared.system,
        items: prepared.items,
        flags: { [CONSTANTS.MODULE_ID]: { schemaVersion: 1, source: meta.source ?? null, freeArchetype: meta.freeArchetype } },
      });
      for (const weapon of prepared.weapons) await addWeaponStrike(actor, prepared, weapon);
      results.push({ name: meta.name, ok: true, actorUuid: actor.uuid });
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      if (actor) await actor.delete().catch(() => null);
      results.push({ name: meta.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
