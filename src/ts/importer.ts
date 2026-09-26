import CONSTANTS from "./constants";
import { buildActorSystem, type Vocabulary } from "./build/actorData";
import { addWeaponStrike, resolveItem, sheetItemName, type PreparedWeapon } from "./items";
import type { LinkTarget } from "./linkMarks";
import { PackIndex } from "./packIndex";
import { parseSheetText } from "./parse";
import type { ActorDoc, SheetItem } from "./schema";
import { getGame } from "./utils";

export type { PreparedWeapon } from "./items";

export interface PreparedActor {
  doc: ActorDoc;
  system: Record<string, unknown>;
  items: any[];
  weapons: PreparedWeapon[];
  warnings: string[];
  errors: string[];
}

export interface PreparedWorldItem {
  doc: SheetItem;
  data: any;
}

export interface ImportPlan {
  actors: PreparedActor[];
  items: PreparedWorldItem[];
  errors: string[];
  warnings: string[];
}

export interface ImportResult {
  name: string;
  ok: boolean;
  actorUuid?: string;
  itemUuid?: string;
  error?: string;
}

export function vocabulary(): Vocabulary {
  const pf2e = CONFIG.PF2E ?? {};
  const keys = (record: unknown) => (record && typeof record === "object" ? new Set(Object.keys(record)) : undefined);
  return {
    creatureTraits: keys(pf2e.creatureTraits),
    languages: keys(pf2e.languages),
    senses: keys(pf2e.senses),
    skills: keys(pf2e.skills),
  };
}

async function prepareActor(doc: ActorDoc, index: PackIndex, targets: Map<string, LinkTarget>, vocab: Vocabulary): Promise<PreparedActor> {
  const { system, loreItems, warnings } = buildActorSystem(doc, vocab);
  const prepared: PreparedActor = { doc, system, items: [...loreItems], weapons: [], warnings, errors: [] };
  const name = doc.meta.name;
  const warn = (message: string) => prepared.warnings.push(`${name}: ${message}`);
  const fail = (message: string) => prepared.errors.push(`${name}: ${message}`);

  for (const item of doc.items) {
    const resolved = await resolveItem(item, { index, targets, warn, fail });
    if (!resolved) continue;
    if ("weapon" in resolved) prepared.weapons.push(resolved.weapon);
    else prepared.items.push(resolved.data);
  }

  return prepared;
}

// parse, validate and resolve everything without touching the world
export async function prepareImport(text: string): Promise<ImportPlan> {
  const parsed = parseSheetText(text);
  const plan: ImportPlan = { actors: [], items: [], errors: [...parsed.errors], warnings: [...parsed.warnings] };
  if (parsed.patches.length) plan.errors.push("patches are applied from an npc sheet's Patch button");
  if (parsed.itemPatches.length) plan.errors.push("item patches are applied from an item sheet's Patch button");
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
  for (const doc of parsed.items) {
    const name = sheetItemName(doc);
    const warn = (message: string) => plan.warnings.push(`${name}: ${message}`);
    const fail = (message: string) => plan.errors.push(`${name}: ${message}`);
    const resolved = await resolveItem(doc, { index, targets, warn, fail, spells: true });
    if (resolved && "data" in resolved) plan.items.push({ doc, data: resolved.data });
  }
  return plan;
}

export interface ImportOptions {
  // actor folder id; null or missing imports at the root
  folderId?: string | null;
  // item folder id for world items, same rules
  itemFolderId?: string | null;
}

export interface FolderOption {
  id: string;
  label: string;
}

// folders of one document type in tree order, one dash per nesting level
export function folderOptions(type: "Actor" | "Item"): FolderOption[] {
  const byParent = new Map<string | null, any[]>();
  for (const folder of getGame().folders.filter((f: any) => f.type === type)) {
    const parent = folder.folder?.id ?? null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }

  const options: FolderOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of children) {
      options.push({ id: folder.id, label: depth ? `${"-".repeat(depth)} ${folder.name}` : folder.name });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
}

// folder may have been deleted since the dialog opened
function liveFolder(id: string | null | undefined): string | null {
  return id && getGame().folders.get(id) ? id : null;
}

// creates each actor and item on its own; a failed actor is rolled back and reported
export async function executeImport(plan: ImportPlan, options: ImportOptions = {}): Promise<ImportResult[]> {
  if (plan.errors.length) throw new Error("import plan has errors");
  const folder = liveFolder(options.folderId);
  const itemFolder = liveFolder(options.itemFolderId);
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
      const stats = { level: meta.level, abilities: prepared.doc.core.abilities };
      for (const weapon of prepared.weapons) await addWeaponStrike(actor, weapon, stats);
      results.push({ name: meta.name, ok: true, actorUuid: actor.uuid });
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      if (actor) await actor.delete().catch(() => null);
      results.push({ name: meta.name, ok: false, error: (err as Error).message });
    }
  }

  for (const { data } of plan.items) {
    try {
      const flags = foundry.utils.mergeObject(data.flags ?? {}, { [CONSTANTS.MODULE_ID]: { schemaVersion: 1 } }, { inplace: false });
      const item = await Item.implementation.create({ ...data, folder: itemFolder, flags });
      results.push({ name: data.name, ok: true, itemUuid: item.uuid });
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      results.push({ name: data.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
