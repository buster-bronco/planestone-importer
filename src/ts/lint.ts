import { legacyNames, remasterName } from "./aliases";
import { rank } from "./fuzzy";
import { mapSpans } from "./htmlSpans";
import { isInlineRoll, parseMarkTerm, type LinkTarget } from "./linkMarks";
import type { Accept } from "./review";

// conditions that take a value, e.g. frightened 2
const VALUED = new Set(["clumsy", "doomed", "drained", "dying", "enfeebled", "frightened", "sickened", "slowed", "stunned", "stupefied", "wounded"]);

// condition names that read as ordinary prose far more often than as the condition
const PROSE = new Set(["friendly", "helpful", "hostile", "indifferent", "unfriendly", "observed", "controlled", "broken", "persistent damage"]);

const CONDITION_PACK = ".conditionitems.";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// lowercase condition name → its link target, legacy names included
function conditionNames(targets: Map<string, LinkTarget>): Map<string, LinkTarget> {
  const names = new Map<string, LinkTarget>();
  for (const [name, target] of targets) if (target.uuid.includes(CONDITION_PACK) && !PROSE.has(name)) names.set(name, target);
  for (const legacy of legacyNames()) {
    const target = names.get(remasterName(legacy)!);
    if (target) names.set(legacy, target);
  }
  return names;
}

// first plain mention of each condition not already linked in this text → [[mark]]
function linkPlainConditions(html: string, targets: Map<string, LinkTarget>, accept: Accept): string {
  const names = conditionNames(targets);
  if (!names.size) return html;
  const lower = html.toLowerCase();
  const linked = new Set([...names.values()].filter((target) => html.includes(target.uuid) || lower.includes(`[[${target.name.toLowerCase()}`)).map((target) => target.uuid));
  const alternatives = [...names.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const pattern = new RegExp(String.raw`(?<![\w-])(${alternatives})(?:\s+(\d+))?(?![\w-])`, "gi");

  return mapSpans(html, ["text"], (text) =>
    text.replace(pattern, (full, word: string, value?: string) => {
      const target = names.get(word.toLowerCase())!;
      if (linked.has(target.uuid)) return full;
      const name = target.name.toLowerCase();
      const valued = VALUED.has(name) && value;
      // a number after a non-valued condition is just the next word
      const before = valued ? full : word;
      const tail = valued ? "" : full.slice(word.length);
      const after = `[[${valued ? `${name} ${value}` : name}]]`;
      linked.add(target.uuid);
      return accept(remasterName(word) ? "legacy" : "condition", before, after) ? after + tail : full;
    }),
  );
}

// [[term]] that won't resolve → its remaster name or the closest real term
function fixMarks(html: string, targets: Map<string, LinkTarget>, accept: Accept): string {
  return mapSpans(html, ["mark"], (mark) => {
    const match = mark.match(/^\[\[([^[\]]+?)\]\]$/);
    if (!match || isInlineRoll(match[1])) return mark;
    const { name, value } = parseMarkTerm(match[1]);
    if (targets.has(name.toLowerCase())) return mark;
    const legacy = remasterName(name);
    const fixed = legacy && targets.has(legacy) ? legacy : rank(name, [...targets.values()], { limit: 1, min: 0.8 })[0]?.name.toLowerCase();
    if (!fixed) return mark;
    const after = `[[${value === null ? fixed : `${fixed} ${value}`}]]`;
    return accept(legacy ? "legacy" : "typo", mark, after) ? after : mark;
  });
}

// condition lint: fix broken marks, then mark plain conditions
export function lintConditions(html: string, targets: Map<string, LinkTarget>, accept: Accept): string {
  return linkPlainConditions(fixMarks(html, targets, accept), targets, accept);
}
