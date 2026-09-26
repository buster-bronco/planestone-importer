import { LEGACY_DAMAGE_TYPES } from "./aliases";
import { mapSpans } from "./htmlSpans";
import type { Accept } from "./review";

// pf2e damage types and categories accepted inside @Damage[formula[type]]
const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison",
  "slashing", "sonic", "spirit", "vitality", "void", "bleed", "precision", "untyped",
  ...Object.keys(LEGACY_DAMAGE_TYPES),
];

// NdN with +/- terms, then an optional "[persistent] [type] damage" tail; a leading \ escapes it
const DICE_PATTERN = new RegExp(
  String.raw`(\\?)\b(\d*d\d+(?:\s*[+-]\s*\d+(?:d\d+)?)*)\b(?:(\s+)(persistent\s+)?(?:(${DAMAGE_TYPES.join("|")})\s+)?(damage)\b)?`,
  "gi",
);

function rollText(text: string, accept: Accept): string {
  return text.replace(DICE_PATTERN, (full, escape: string, dice: string, space?: string, persistent?: string, type?: string, damage?: string) => {
    if (escape) return full.slice(1);
    const formula = dice.replace(/\s+/g, "");
    let after: string;
    if (!damage) after = `[[/r ${formula}]]`;
    else {
      const slug = type?.toLowerCase();
      const tags = [persistent && "persistent", slug && (LEGACY_DAMAGE_TYPES[slug] ?? slug)].filter(Boolean);
      // tags only bind to the last term unless the formula is grouped
      const grouped = /[+-]/.test(formula) ? `(${formula})` : formula;
      after = tags.length ? `@Damage[${grouped}[${tags.join(",")}]]${space}${damage}` : `@Damage[${formula}]${space}${damage}`;
    }
    return accept("roll", full, after) ? after : full;
  });
}

// bare dice → @Damage[...] when followed by "damage", [[/r ...]] otherwise
export function applyAutoRolls(html: string, accept: Accept = () => true): string {
  return mapSpans(html, ["text"], (text) => rollText(text, accept));
}
