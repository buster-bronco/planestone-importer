import type { HazardDoc } from "../schema";
import { sluggify } from "../slug";
import { buildImmunities, buildResistances, buildWeaknesses, normalizeSize, type Vocabulary, type Warn } from "./actorData";
import { toHtml } from "./homebrew";

export interface HazardBuild {
  system: Record<string, unknown>;
  warnings: string[];
}

// hazard text fields that hold html, under system.details
export const HAZARD_HTML_FIELDS = ["description", "disable", "routine", "reset"] as const;

// hazard trait slugs come from CONFIG.PF2E.hazardTraits
export function buildHazardTraits(list: string[], vocab: Vocabulary, warn: Warn): string[] {
  return [...new Set(list.map(sluggify))].filter((trait) => {
    if (!vocab.hazardTraits || vocab.hazardTraits.has(trait)) return true;
    warn(`unknown hazard trait "${trait}" dropped`);
    return false;
  });
}

// a missing save is null; pf2e hides it on the sheet
function save(value: number | undefined) {
  return { value: value ?? null, saveDetail: "" };
}

export function buildHazardSystem(doc: HazardDoc, vocab: Vocabulary = {}): HazardBuild {
  const { meta, core } = doc;
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(`${meta.name}: ${message}`);

  const size = normalizeSize(core.size);
  if (!size) warn(`unknown size "${core.size}", using medium`);

  const hp = core.hp ? { value: core.hp.value, max: core.hp.value, temp: 0, details: core.hp.notes ?? "" } : { value: 0, max: 0, temp: 0, details: "" };

  const system = {
    attributes: {
      ac: { value: core.ac ?? 0 },
      hardness: core.hardness,
      hasHealth: !!core.hp,
      hp,
      stealth: { value: core.stealth.mod, details: toHtml(core.stealth.notes ?? "") },
      emitsSound: core.emitsSound,
      resistances: buildResistances(core.resistances),
      weaknesses: buildWeaknesses(core.weaknesses),
      immunities: buildImmunities(core.immunities),
    },
    details: {
      level: { value: meta.level },
      isComplex: core.complex,
      ...Object.fromEntries(HAZARD_HTML_FIELDS.map((field) => [field, toHtml(core[field])])),
      publication: { title: meta.source ?? "", authors: "", license: "ORC", remaster: true },
    },
    saves: { fortitude: save(core.saves.fortitude), reflex: save(core.saves.reflex), will: save(core.saves.will) },
    traits: { value: buildHazardTraits(core.traits, vocab, warn), rarity: core.rarity, size: { value: size ?? "med" } },
  };

  return { system, warnings };
}
