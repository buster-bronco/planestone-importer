import yaml from "js-yaml";
import type { ZodIssue } from "zod";
import { isHomebrewAction, isHomebrewStrike, sheetFile, type ActorDoc, type SpellListDoc } from "./schema";
import { sluggify } from "./slug";

// attack effects pf2e knows without a matching action item (CONFIG.PF2E.attackEffects)
export const BUILTIN_ATTACK_EFFECTS = new Set([
  "grab",
  "improved-grab",
  "constrict",
  "greater-constrict",
  "knockdown",
  "improved-knockdown",
  "push",
  "improved-push",
  "trip",
]);

export interface ParsedSheet {
  actors: ActorDoc[];
  spellLists: SpellListDoc[];
  errors: string[];
  warnings: string[];
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

// yaml is a superset of json, so one loader covers both
export function parseSheetText(text: string): ParsedSheet {
  const result: ParsedSheet = { actors: [], spellLists: [], errors: [], warnings: [] };

  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    result.errors.push(`could not read file: ${(err as Error).message}`);
    return result;
  }

  const parsed = sheetFile.safeParse(raw);
  if (!parsed.success) {
    result.errors.push(...parsed.error.issues.map(formatIssue));
    return result;
  }

  const doc = parsed.data;
  if (doc.kind === "actor") result.actors.push(doc);
  else if (doc.kind === "spellList") result.spellLists.push(doc);
  else {
    result.actors.push(...doc.actors);
    result.spellLists.push(...doc.spellLists);
  }

  if (result.spellLists.length) {
    result.warnings.push(`${result.spellLists.length} spell list(s) found; spellcasting import isn't supported yet`);
  }

  for (const actor of result.actors) checkActor(actor, result);
  return result;
}

// cross-field rules zod can't express per object
function checkActor(actor: ActorDoc, result: ParsedSheet): void {
  const name = actor.meta.name;

  const actionSlugs = new Set<string>();
  for (const item of actor.items) {
    if (isHomebrewAction(item)) actionSlugs.add(sluggify(item.name));
    if (item.origin === "compendiumRef" && item.refType === "action") actionSlugs.add(sluggify(item.lookup.name));
  }

  actor.items.forEach((item, index) => {
    if (!isHomebrewStrike(item)) return;
    for (const effect of item.attackEffects) {
      const slug = sluggify(effect);
      if (actionSlugs.has(slug)) continue;
      if (BUILTIN_ATTACK_EFFECTS.has(slug)) {
        result.warnings.push(`${name}: "${item.name}" attack effect "${slug}" has no matching action; the roll card will show the label only`);
      } else {
        result.errors.push(`${name}: items.${index}.attackEffects: "${effect}" doesn't match any action item on this actor`);
      }
    }
  });

  if (actor.spellcasting !== undefined) {
    const ref = actor.spellcasting;
    if (typeof ref === "string" && !result.spellLists.some((list) => list.id === ref)) {
      result.errors.push(`${name}: spellcasting references unknown spell list "${ref}"`);
    }
    result.warnings.push(`${name}: spellcasting is ignored until spell import lands`);
  }
}
