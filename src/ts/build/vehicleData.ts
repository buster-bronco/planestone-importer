import type { VehicleDoc } from "../schema";
import { sluggify } from "../slug";
import { buildImmunities, buildResistances, buildWeaknesses, normalizeSize, type Vocabulary, type Warn } from "./actorData";
import { toHtml } from "./homebrew";

export interface VehicleBuild {
  system: Record<string, unknown>;
  warnings: string[];
}

// vehicle trait slugs come from CONFIG.PF2E.vehicleTraits
export function buildVehicleTraits(list: string[], vocab: Vocabulary, warn: Warn): string[] {
  return [...new Set(list.map(sluggify))].filter((trait) => {
    if (!vocab.vehicleTraits || vocab.vehicleTraits.has(trait)) return true;
    warn(`unknown vehicle trait "${trait}" dropped`);
    return false;
  });
}

export function buildVehicleSystem(doc: VehicleDoc, vocab: Vocabulary = {}): VehicleBuild {
  const { meta, core } = doc;
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(`${meta.name}: ${message}`);

  const size = normalizeSize(core.size);
  if (!size) warn(`unknown size "${core.size}", using large`);

  const attributes: Record<string, unknown> = {
    ac: { value: core.ac, details: "" },
    hardness: core.hardness,
    hp: { value: core.hp.value, max: core.hp.value, temp: 0, details: core.hp.notes ?? "" },
    emitsSound: core.emitsSound,
    resistances: buildResistances(core.resistances),
    weaknesses: buildWeaknesses(core.weaknesses),
    immunities: buildImmunities(core.immunities),
  };
  if (core.collision) {
    attributes.collisionDC = { value: core.collision.dc };
    attributes.collisionDamage = { value: core.collision.damage };
  }

  const system = {
    attributes,
    details: {
      level: { value: meta.level },
      description: toHtml(core.description),
      price: core.price,
      space: core.space,
      crew: core.crew,
      passengers: core.passengers,
      pilotingCheck: core.pilotingCheck,
      speed: core.speed,
      publication: { title: meta.source ?? "", authors: "", license: "ORC", remaster: true },
    },
    saves: { fortitude: { value: core.saves.fortitude, saveDetail: "" } },
    traits: { value: buildVehicleTraits(core.traits, vocab, warn), rarity: core.rarity, size: { value: size ?? "lg" } },
  };

  return { system, warnings };
}
