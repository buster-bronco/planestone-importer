// legacy (pre-remaster) pf2e names → remaster names
const LEGACY_NAMES: Record<string, string> = {
  "flat-footed": "off-guard",
  "flat footed": "off-guard",
  "magic missile": "force barrage",
  "burning hands": "breathe fire",
  "ray of enfeeblement": "enfeeble",
  "true strike": "sure strike",
  "magic weapon": "runic weapon",
  "magic fang": "runic body",
  "mage armor": "mystic armor",
  "mage hand": "telekinetic hand",
  "color spray": "dizzying colors",
  "hideous laughter": "laughing fit",
  "feather fall": "gentle landing",
  "dimension door": "translocate",
  "finger of death": "execute",
  "baleful polymorph": "cursed metamorphosis",
  "remove curse": "cleanse affliction",
  "tanglefoot": "tangle vine",
  "produce flame": "ignition",
  "ray of frost": "frostbite",
  "disrupt undead": "vitality lash",
  "chill touch": "void warp",
  "acid splash": "caustic blast",
  "see invisibility": "see the unseen",
  "flaming sphere": "floating flame",
  "calm emotions": "calm",
  "stoneskin": "mountain resilience",
  "bag of holding": "spacious pouch",
};

// legacy damage types; alignment damage has no remaster type
export const LEGACY_DAMAGE_TYPES: Record<string, string> = {
  positive: "vitality",
  negative: "void",
};

export function remasterName(name: string): string | null {
  return LEGACY_NAMES[name.trim().toLowerCase()] ?? null;
}

export function legacyNames(): string[] {
  return Object.keys(LEGACY_NAMES);
}
