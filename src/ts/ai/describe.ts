import yaml from "js-yaml";
import type { Vocabulary } from "../build/actorData";
import { buildPatchChanges } from "../patch/changes";
import { buildItemPatchChanges, type ItemSource } from "../patch/item";
import type { ActorSource } from "../patch/paths";
import { parseSheetText } from "../parse";
import type { Describe, RawDoc } from "./hunks";

// raw doc → yaml text for the patch dialog and parser
export function dumpPatch(raw: RawDoc): string {
  return yaml.dump(raw, { lineWidth: -1, noRefs: true });
}

// change lines for an actor patch, without compendium lookups
export function describeActorPatch(source: ActorSource, vocab: Vocabulary = {}): Describe {
  return (raw) => {
    const parsed = parseSheetText(dumpPatch(raw));
    const patch = parsed.patches[0];
    if (parsed.errors.length || !patch) return { changes: [], errors: parsed.errors };
    const { changes, errors } = buildPatchChanges(patch, source, vocab);
    return { changes, errors };
  };
}

export function describeItemPatch(source: ItemSource): Describe {
  return (raw) => {
    const parsed = parseSheetText(dumpPatch(raw));
    const patch = parsed.itemPatches[0];
    if (parsed.errors.length || !patch) return { changes: [], errors: parsed.errors };
    const { changes, errors } = buildItemPatchChanges(patch, source);
    return { changes, errors };
  };
}
