import type { ActorDoc, CoreData } from "../schema";
import { sluggify } from "../slug";

// valid slugs pulled from CONFIG.PF2E at import time; omitted sets skip the check
export interface Vocabulary {
  creatureTraits?: Set<string>;
  vehicleTraits?: Set<string>;
  hazardTraits?: Set<string>;
  languages?: Set<string>;
  senses?: Set<string>;
  skills?: Set<string>;
}

export type Warn = (message: string) => void;

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

// inverse of parseSense, for previews
export function formatSense(sense: Sense): string {
  return [sense.type, sense.acuity && `(${sense.acuity})`, sense.range && `${sense.range} feet`].filter(Boolean).join(" ");
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

// traits, with ancestry folded in as a creature trait
export function buildTraits(list: string[], ancestry: string | undefined, vocab: Vocabulary, warn: Warn): string[] {
  const slugs = [...list, ...(ancestry ? [ancestry] : [])].map(sluggify);
  return [...new Set(slugs)].filter((trait) => {
    if (!vocab.creatureTraits || vocab.creatureTraits.has(trait)) return true;
    warn(`unknown creature trait "${trait}" dropped`);
    return false;
  });
}

// pf2e languages are slugs; anything else lands in the free-text details
export function buildLanguages(list: string[], vocab: Vocabulary, warn: Warn): { value: string[]; details: string } {
  const value: string[] = [];
  const extra: string[] = [];
  for (const language of list) {
    const slug = sluggify(language);
    if (!vocab.languages || vocab.languages.has(slug)) value.push(slug);
    else extra.push(language);
  }
  if (extra.length) warn(`languages not known to pf2e moved to details: ${extra.join(", ")}`);
  return { value, details: extra.join(", ") };
}

export function buildSenses(list: string[], vocab: Vocabulary, warn: Warn): Sense[] {
  const senses: Sense[] = [];
  for (const text of list) {
    const sense = parseSense(text);
    if (!sense) warn(`couldn't parse sense "${text}"`);
    else if (vocab.senses && !vocab.senses.has(sense.type)) warn(`unknown sense "${sense.type}" dropped`);
    else senses.push(sense);
  }
  return senses;
}

export function isKnownSkill(slug: string, vocab: Vocabulary): boolean {
  return (vocab.skills ?? DEFAULT_SKILLS).has(slug);
}

export function buildNamedSkills(named: Record<string, number>, vocab: Vocabulary, warn: Warn): Record<string, { base: number }> {
  const skills: Record<string, { base: number }> = {};
  for (const [name, mod] of Object.entries(named)) {
    const slug = sluggify(name);
    if (isKnownSkill(slug, vocab)) skills[slug] = { base: mod };
    else warn(`unknown skill "${name}" dropped; lore skills go under skills.lore`);
  }
  return skills;
}

export function loreName(name: string): string {
  return /\blore$/i.test(name) ? name : `${name} Lore`;
}

export function buildLore(lore: CoreData["skills"]["lore"]): LoreItemData[] {
  return lore.map((entry) => ({ name: loreName(entry.name), type: "lore", system: { mod: { value: entry.mod } } }));
}

export function buildOtherSpeeds(list: CoreData["speed"]["other"]) {
  return list.map((speed) => ({ type: sluggify(speed.type), value: speed.value }));
}

export function buildResistances(list: CoreData["resistances"]) {
  return list.map((r) => ({ type: sluggify(r.type), value: r.value, exceptions: r.exceptions.map(sluggify) }));
}

export function buildWeaknesses(list: CoreData["weaknesses"]) {
  return list.map((w) => ({ type: sluggify(w.type), value: w.value }));
}

export function buildImmunities(list: CoreData["immunities"]) {
  return list.map((i) => ({ type: sluggify(i.type), exceptions: [] }));
}

export function buildActorSystem(doc: ActorDoc, vocab: Vocabulary = {}): ActorBuild {
  const { meta, core } = doc;
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(`${meta.name}: ${message}`);

  const traits = buildTraits(core.traits, core.ancestry, vocab, warn);

  if (core.alignment) warn("alignment ignored; pf2e remaster has no alignment field");

  const size = normalizeSize(core.size);
  if (!size) warn(`unknown size "${core.size}", using medium`);

  const languages = buildLanguages(core.languages, vocab, warn);
  const senses = buildSenses(core.perception.senses, vocab, warn);
  const skills = buildNamedSkills(core.skills.named, vocab, warn);
  const loreItems = buildLore(core.skills.lore);

  const abilities = Object.fromEntries(Object.entries(core.abilities).map(([key, mod]) => [key, { mod }]));

  const system = {
    abilities,
    attributes: {
      ac: { value: core.ac, details: "" },
      hp: { value: core.hp.value, max: core.hp.value, temp: 0, details: core.hp.notes ?? "" },
      speed: {
        value: core.speed.value,
        otherSpeeds: buildOtherSpeeds(core.speed.other),
        details: "",
      },
      allSaves: { value: "" },
      resistances: buildResistances(core.resistances),
      weaknesses: buildWeaknesses(core.weaknesses),
      immunities: buildImmunities(core.immunities),
    },
    details: {
      level: { value: meta.level },
      languages,
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
