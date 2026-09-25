import CONSTANTS from "./constants";
import { buildActorSystem, type Vocabulary } from "./build/actorData";
import { addWeaponStrike, resolveItem, type PreparedWeapon } from "./items";
import type { LinkTarget } from "./linkMarks";
import { PackIndex } from "./packIndex";
import { parseSheetText } from "./parse";
import type { ActorDoc } from "./schema";
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
  const plan: ImportPlan = { actors: [], errors: [...parsed.errors], warnings: [...parsed.warnings] };
  if (parsed.patches.length) plan.errors.push("patches are applied from an npc sheet's Patch button");
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

export interface ImportOptions {
  // actor folder id; null or missing imports at the root
  folderId?: string | null;
}

export interface FolderOption {
  id: string;
  label: string;
}

// actor folders in tree order, one dash per nesting level
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
      options.push({ id: folder.id, label: depth ? `${"-".repeat(depth)} ${folder.name}` : folder.name });
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
      const stats = { level: meta.level, abilities: prepared.doc.core.abilities };
      for (const weapon of prepared.weapons) await addWeaponStrike(actor, weapon, stats);
      results.push({ name: meta.name, ok: true, actorUuid: actor.uuid });
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      if (actor) await actor.delete().catch(() => null);
      results.push({ name: meta.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
