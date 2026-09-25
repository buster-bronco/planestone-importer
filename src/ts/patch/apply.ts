import CONSTANTS from "../constants";
import { addWeaponStrike } from "../items";
import type { PreparedPatch } from "./prepare";

export interface PatchResult {
  name: string;
  ok: boolean;
  actorUuid?: string;
  error?: string;
}

// applies one patch; on failure the actor's system and items are put back from a snapshot
export async function executePatch(prepared: PreparedPatch): Promise<PatchResult> {
  const { actor, changes, name } = prepared;
  const snapshot = actor.toObject();
  const created: string[] = [];

  try {
    if (Object.keys(changes.actorUpdate).length) await actor.update(changes.actorUpdate);
    if (changes.deleteItemIds.length) await actor.deleteEmbeddedDocuments("Item", changes.deleteItemIds);
    if (prepared.items.length) {
      const docs = await actor.createEmbeddedDocuments("Item", prepared.items);
      created.push(...docs.map((doc: any) => doc.id));
    }
    for (const weapon of prepared.weapons) await addWeaponStrike(actor, weapon, changes.stats, created);
    if (changes.updateItems.length) await actor.updateEmbeddedDocuments("Item", changes.updateItems);
    return { name, ok: true, actorUuid: actor.uuid };
  } catch (err) {
    console.error(CONSTANTS.DEBUG_PREFIX, err);
    await rollback(actor, snapshot, created);
    return { name, ok: false, actorUuid: actor.uuid, error: (err as Error).message };
  }
}

// recursive: false swaps whole objects back in
async function rollback(actor: any, snapshot: any, created: string[]): Promise<void> {
  const quiet = (promise: Promise<unknown>) => promise.catch((err) => console.error(CONSTANTS.DEBUG_PREFIX, "rollback", err));
  await quiet(actor.update({ name: snapshot.name, system: snapshot.system }, { recursive: false, diff: false }));

  const alive = created.filter((id) => actor.items.has(id));
  if (alive.length) await quiet(actor.deleteEmbeddedDocuments("Item", alive));

  const missing = snapshot.items.filter((item: any) => !actor.items.has(item._id));
  if (missing.length) await quiet(actor.createEmbeddedDocuments("Item", missing, { keepId: true }));

  const changed = snapshot.items
    .filter((item: any) => actor.items.has(item._id))
    .map((item: any) => ({ _id: item._id, name: item.name, system: item.system, flags: item.flags }));
  if (changed.length) await quiet(actor.updateEmbeddedDocuments("Item", changed, { recursive: false, diff: false }));
}
