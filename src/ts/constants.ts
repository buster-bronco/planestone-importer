import { id } from "../module.json";

export const CONSTANTS = {
  MODULE_ID: id,
  MODULE_NAME: "Planestone Importer",
  DEBUG_PREFIX: "PLANESTONE-IMPORTER:",
  SUPPORTED_SCHEMA_VERSION: 1,
  // estimated tokens of world context before prompts warn
  CONTEXT_WARN_TOKENS: 8000,

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
    feat: ["pf2e.feats-srd"],
    effect: ["pf2e.spell-effects", "pf2e.equipment-effects", "pf2e.feat-effects", "pf2e.other-effects"],
  },

  // packs searched for [[term]] marks
  LINK_PACKS: ["pf2e.conditionitems", "pf2e.actionspf2e"],
} as const;

export default CONSTANTS;
