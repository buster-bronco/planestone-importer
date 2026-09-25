import { id } from "../module.json";

export const CONSTANTS = {
  MODULE_ID: id,
  MODULE_NAME: "Planestone Importer",
  DEBUG_PREFIX: "PLANESTONE-IMPORTER:",
  SUPPORTED_SCHEMA_VERSION: 1,

  // pack search order per refType, first hit wins
  PACKS_BY_REF_TYPE: {
    action: [
      "pf2e.bestiary-ability-glossary-srd",
      "pf2e.actionspf2e",
      "pf2e.bestiary-family-ability-glossary",
      "pf2e.adventure-specific-actions",
    ],
    equipment: ["pf2e.equipment-srd"],
    spell: ["pf2e.spells-srd"],
  },

  // packs searched for [[term]] marks
  LINK_PACKS: ["pf2e.conditionitems", "pf2e.actionspf2e"],
} as const;

export default CONSTANTS;
