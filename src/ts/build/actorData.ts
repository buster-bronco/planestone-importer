import type { ActorDoc } from "../schema";
import { sluggify } from "../slug";

// valid slugs pulled from CONFIG.PF2E at import time; omitted sets skip the check
export interface Vocabulary {
  creatureTraits?: Set<string>;
  languages?: Set<string>;
  senses?: Set<string>;
  skills?: Set<string>;
}

export const DEFAULT_SKILLS = new Set([
  "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine",
  "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery",
]);

const SIZES: Record<string, string> = {
  tiny: "tiny",
  small: "sm", sm: "sm",
  medium: "med", med: "med",
  large: "lg", lg: "lg",
  huge: "huge",
  gargantuan: "grg", grg: "grg",
};

export function normalizeSize(size: string): string | null {
  return SIZES[size.trim().toLowerCase()] ?? null;
}

export interface Sense {
  type: string;
  acuity?: "precise" | "imprecise" | "vague";
  range?: number;
}

// "scent (imprecise) 30 feet" → { type: "scent", acuity: "imprecise", range: 30 }
export function parseSense(text: string): Sense | null {
  const match = text.trim().match(/^(.+?)(?:\s*\((precise|imprecise|vague)\))?(?:\s+(\d+)\s*(?:feet|foot|ft\.?)?)?$/i);
  if (!match) return null;
  const sense: Sense = { type: sluggify(match[1]) };
  if (match[2]) sense.acuity = match[2].toLowerCase() as Sense["acuity"];
  if (match[3]) sense.range = Number(match[3]);
  return sense.type ? sense : null;
}

export interface LoreItemData {
  name: string;
  type: "lore";
  system: { mod: { value: number } };
}

export interface ActorBuild {
  system: Record<string, unknown>;
  loreItems: LoreItemData[];
  warnings: string[];
}

export function buildActorSystem(doc: ActorDoc, vocab: Vocabulary = {}): ActorBuild {
  const { meta, core } = doc;
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(`${meta.name}: ${message}`);

  // traits, with ancestry folded in as a creature trait
  const traitSlugs = [...core.traits, ...(core.ancestry ? [core.ancestry] : [])].map(sluggify);
  const traits = [...new Set(traitSlugs)].filter((trait) => {
    if (!vocab.creatureTraits || vocab.creatureTraits.has(trait)) return true;
    warn(`unknown creature trait "${trait}" dropped`);
    return false;
  });

  if (core.alignment) warn("alignment ignored; pf2e remaster has no alignment field");

  const size = normalizeSize(core.size);
  if (!size) warn(`unknown size "${core.size}", using medium`);

  // pf2e languages are slugs; anything else lands in the free-text details
  const languages: string[] = [];
  const extraLanguages: string[] = [];
  for (const language of core.languages) {
    const slug = sluggify(language);
    if (!vocab.languages || vocab.languages.has(slug)) languages.push(slug);
    else extraLanguages.push(language);
  }
  if (extraLanguages.length) warn(`languages not known to pf2e moved to details: ${extraLanguages.join(", ")}`);

  const senses: Sense[] = [];
  for (const text of core.perception.senses) {
    const sense = parseSense(text);
    if (!sense) warn(`couldn't parse sense "${text}"`);
    else if (vocab.senses && !vocab.senses.has(sense.type)) warn(`unknown sense "${sense.type}" dropped`);
    else senses.push(sense);
  }

  const skillSet = vocab.skills ?? DEFAULT_SKILLS;
  const skills: Record<string, { base: number }> = {};
  for (const [name, mod] of Object.entries(core.skills.named)) {
    const slug = sluggify(name);
    if (skillSet.has(slug)) skills[slug] = { base: mod };
    else warn(`unknown skill "${name}" dropped; lore skills go under skills.lore`);
  }

  const loreItems: LoreItemData[] = core.skills.lore.map((lore) => ({
    name: /\blore$/i.test(lore.name) ? lore.name : `${lore.name} Lore`,
    type: "lore",
    system: { mod: { value: lore.mod } },
  }));

  const abilities = Object.fromEntries(Object.entries(core.abilities).map(([key, mod]) => [key, { mod }]));

  const system = {
    abilities,
    attributes: {
      ac: { value: core.ac, details: "" },
      hp: { value: core.hp.value, max: core.hp.value, temp: 0, details: core.hp.notes ?? "" },
      speed: {
        value: core.speed.value,
        otherSpeeds: core.speed.other.map((speed) => ({ type: sluggify(speed.type), value: speed.value })),
        details: "",
      },
      allSaves: { value: "" },
      resistances: core.resistances.map((r) => ({ type: sluggify(r.type), value: r.value, exceptions: r.exceptions.map(sluggify) })),
      weaknesses: core.weaknesses.map((w) => ({ type: sluggify(w.type), value: w.value })),
      immunities: core.immunities.map((i) => ({ type: sluggify(i.type), exceptions: [] })),
    },
    details: {
      level: { value: meta.level },
      languages: { value: languages, details: extraLanguages.join(", ") },
      blurb: "",
      publicNotes: "",
      privateNotes: "",
      publication: { title: meta.source ?? "", authors: "", license: "ORC", remaster: true },
    },
    initiative: { statistic: "perception" },
    perception: { mod: core.perception.mod, senses, details: "" },
    saves: {
      fortitude: { value: core.saves.fortitude, saveDetail: "" },
      reflex: { value: core.saves.reflex, saveDetail: "" },
      will: { value: core.saves.will, saveDetail: "" },
    },
    skills,
    traits: { value: traits, rarity: core.rarity, size: { value: size ?? "med" } },
  };

  return { system, loreItems, warnings };
}
