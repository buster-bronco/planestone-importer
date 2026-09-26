import type { Vocabulary } from "../build/actorData";
import { linkHtml, resolveItem, type PreparedWeapon } from "../items";
import type { LinkTarget } from "../linkMarks";
import { PackIndex } from "../packIndex";
import { parseSheetText } from "../parse";
import type { ActorPatchDoc } from "../schema";
import { buildPatchChanges, type PatchChanges } from "./changes";

export interface PreparedPatch {
  doc: ActorPatchDoc;
  actor: any;
  name: string;
  changes: PatchChanges;
  items: any[];
  weapons: PreparedWeapon[];
  errors: string[];
  warnings: string[];
}

export interface PatchPlan {
  patch: PreparedPatch | null;
  errors: string[];
  warnings: string[];
}

// an optional target guards against pasting a patch onto the wrong sheet
export function targetMismatch(target: ActorPatchDoc["target"], document: any): string | null {
  const { name, uuid } = target ?? {};
  if (uuid && uuid !== document.uuid) return `patch targets ${uuid}, but this sheet is ${document.uuid}`;
  if (name && name.trim().toLowerCase() !== document.name.trim().toLowerCase()) return `patch targets "${name}", but this sheet is "${document.name}"`;
  return null;
}

export async function preparePatch(
  doc: ActorPatchDoc,
  actor: any,
  index: PackIndex,
  targets: Map<string, LinkTarget>,
  vocab: Vocabulary,
): Promise<PreparedPatch> {
  const name = actor.name;
  const changes = buildPatchChanges(doc, actor.toObject(), vocab);
  const prepared: PreparedPatch = {
    doc,
    actor,
    name,
    changes,
    items: [...changes.createItems],
    weapons: [],
    errors: [...changes.errors],
    warnings: [...changes.warnings],
  };
  const warn = (message: string) => prepared.warnings.push(message);
  const fail = (message: string) => prepared.errors.push(message);

  const mismatch = targetMismatch(doc.target, actor);
  if (mismatch) fail(mismatch);

  // [[term]] marks in edited descriptions
  for (const update of changes.updateItems) {
    const html = update["system.description.value"];
    if (typeof html === "string") update["system.description.value"] = linkHtml(html, (update.name as string) ?? name, targets, warn);
  }

  for (const item of changes.addItems) {
    const resolved = await resolveItem(item, { index, targets, warn, fail });
    if (!resolved) continue;
    if ("weapon" in resolved) prepared.weapons.push(resolved.weapon);
    else prepared.items.push(resolved.data);
  }

  if (!changes.changes.length && !prepared.errors.length) warn("patch changes nothing");
  return prepared;
}

// text → one validated patch against this actor, nothing written yet
export async function preparePatchText(actor: any, text: string, vocab: Vocabulary): Promise<PatchPlan> {
  const parsed = parseSheetText(text);
  const plan: PatchPlan = { patch: null, errors: [...parsed.errors], warnings: [...parsed.warnings] };
  if (plan.errors.length) return plan;
  if (parsed.patches.length !== 1 || parsed.itemPatches.length || parsed.actors.length || parsed.vehicles.length || parsed.hazards.length || parsed.items.length || parsed.spellLists.length) {
    plan.errors.push("expected a single kind: actorPatch document");
    return plan;
  }

  const index = new PackIndex();
  const patch = await preparePatch(parsed.patches[0], actor, index, await index.linkTargets(), vocab);
  plan.patch = patch;
  plan.errors.push(...patch.errors);
  plan.warnings.push(...patch.warnings);
  return plan;
}
