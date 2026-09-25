import type { AbilityKey } from "../schema";

export type Proficiency = "trained" | "expert" | "master" | "legendary";

const PROFICIENCY_BONUS: Record<Proficiency, number> = { trained: 2, expert: 4, master: 6, legendary: 8 };

export interface StrikeInput {
  level: number;
  proficiency: Proficiency;
  abilities: Record<AbilityKey, number>;
  potency: number;
  striking: number;
  // traits of the generated npc attack, e.g. ["finesse", "thrown-10"]
  traits: string[];
  // die size from the weapon, e.g. "d8"
  die: string;
  abilityOverride?: AbilityKey | null;
  damageAbilityOverride?: AbilityKey | null;
}

// actor-wide numbers a strike depends on
export interface StrikeStats {
  level: number;
  abilities: Record<AbilityKey, number>;
}

// stored on generated strikes as flags.npc-sheet-importer.strike, for later recalcs
export interface StrikeFlag {
  weapon: string;
  proficiency: Proficiency;
  potency: number;
  striking: number;
  die: string;
  abilityOverride: AbilityKey | null;
  damageAbilityOverride: AbilityKey | null;
}

export interface StrikeResult {
  attackBonus: number;
  damage: string;
}

// pf2e treats range-* and thrown-* traits as ranged on npc attacks
export function isRangedAttack(traits: string[]): boolean {
  return traits.some((t) => /^(?:range|thrown)-/.test(t));
}

export function isThrownAttack(traits: string[]): boolean {
  return traits.some((t) => t.startsWith("thrown-"));
}

// pc-style strike: level + proficiency + attribute + potency, striking adds dice
export function computeStrike(input: StrikeInput): StrikeResult {
  const { abilities, traits } = input;
  const ranged = isRangedAttack(traits);
  const thrown = isThrownAttack(traits);

  const attackAbility =
    input.abilityOverride ?? (ranged ? "dex" : traits.includes("finesse") && abilities.dex > abilities.str ? "dex" : "str");
  const attackBonus = input.level + PROFICIENCY_BONUS[input.proficiency] + abilities[attackAbility] + input.potency;

  let damageMod: number;
  if (input.damageAbilityOverride) damageMod = abilities[input.damageAbilityOverride];
  else if (!ranged || thrown) damageMod = abilities.str;
  // propulsive adds half a positive str, the full penalty when negative
  else if (traits.includes("propulsive")) damageMod = abilities.str > 0 ? Math.floor(abilities.str / 2) : abilities.str;
  else damageMod = 0;

  const dice = 1 + input.striking;
  const modText = damageMod > 0 ? `+${damageMod}` : damageMod < 0 ? `${damageMod}` : "";
  return { attackBonus, damage: `${dice}${input.die}${modText}` };
}

// pulls the die size out of a damage string like "2d8+4"
export function dieFromDamage(damage: string): string | null {
  return damage.match(/\d*(d\d+)/)?.[1] ?? null;
}
