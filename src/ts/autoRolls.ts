// pf2e damage types and categories accepted inside @Damage[formula[type]]
const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison",
  "slashing", "sonic", "spirit", "vitality", "void", "bleed", "precision", "untyped",
];

// NdN with +/- terms, then an optional "[persistent] [type] damage" tail; a leading \ escapes it
const DICE_PATTERN = new RegExp(
  String.raw`(\\?)\b(\d*d\d+(?:\s*[+-]\s*\d+(?:d\d+)?)*)\b(?:(\s+)(persistent\s+)?(?:(${DAMAGE_TYPES.join("|")})\s+)?(damage)\b)?`,
  "gi",
);

// index just past the bracket that closes the one at `start`
function closeBracket(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i + 1;
  }
  return text.length;
}

// end of a {label} right after an enricher, or `end` if none
function skipLabel(text: string, end: number): number {
  return text[end] === "{" ? closeBracket(text, end, "{", "}") : end;
}

// end of a span that must not be touched: html tag, [[inline roll]], @Enricher[...]
function protectedEnd(text: string, i: number): number | null {
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    return close === -1 ? text.length : close + 1;
  }
  if (text.startsWith("[[", i)) return skipLabel(text, closeBracket(text, i, "[", "]"));
  const enricher = text.slice(i).match(/^@\w+\[/);
  if (enricher) return skipLabel(text, closeBracket(text, i + enricher[0].length - 1, "[", "]"));
  return null;
}

function rollText(text: string): string {
  return text.replace(DICE_PATTERN, (full, escape: string, dice: string, space?: string, persistent?: string, type?: string, damage?: string) => {
    if (escape) return full.slice(1);
    const formula = dice.replace(/\s+/g, "");
    if (!damage) return `[[/r ${formula}]]`;
    const tags = [persistent && "persistent", type?.toLowerCase()].filter(Boolean);
    if (!tags.length) return `@Damage[${formula}]${space}${damage}`;
    // tags only bind to the last term unless the formula is grouped
    const grouped = /[+-]/.test(formula) ? `(${formula})` : formula;
    return `@Damage[${grouped}[${tags.join(",")}]]${space}${damage}`;
  });
}

// bare dice → @Damage[...] when followed by "damage", [[/r ...]] otherwise
export function applyAutoRolls(html: string): string {
  let output = "";
  let text = "";
  let i = 0;
  while (i < html.length) {
    const end = protectedEnd(html, i);
    if (end === null) {
      text += html[i++];
      continue;
    }
    output += rollText(text) + html.slice(i, end);
    text = "";
    i = end;
  }
  return output + rollText(text);
}
