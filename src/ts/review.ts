import { formatRanked, type Ranked } from "./fuzzy";

// condition: plain text linked; legacy: remaster rename; typo: misspelled mark; roll: dice made clickable
export type FixKind = "condition" | "legacy" | "typo" | "roll";

// one automatic text change the gm can reject by id
export interface TextFix {
  id: string;
  where: string;
  kind: FixKind;
  before: string;
  after: string;
  applied: boolean;
}

// a compendium name that missed, with the closest real names
export interface Suggestion {
  where: string;
  name: string;
  refType: string;
  candidates: Ranked[];
}

export interface ReviewOptions {
  // condition lint on/off; defaults to the user setting in foundry
  lint?: boolean;
  // TextFix ids to leave unapplied
  rejectFixes?: Iterable<string>;
}

// collects fixes and suggestions for one prepare run
export interface Review {
  lint: boolean;
  rejected: ReadonlySet<string>;
  fixes: TextFix[];
  suggestions: Suggestion[];
}

export function newReview({ lint = false, rejectFixes = [] }: ReviewOptions = {}): Review {
  return { lint, rejected: new Set(rejectFixes), fixes: [], suggestions: [] };
}

// fix accepter for one text field; ids repeat across runs so rejections stick
export type Accept = (kind: FixKind, before: string, after: string) => boolean;

export function accepter(review: Review | undefined, where: string): Accept {
  const seen = new Map<string, number>();
  return (kind, before, after) => {
    if (!review) return true;
    const base = `${where}|${kind}|${before}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = `${base}|${count}`;
    const applied = !review.rejected.has(id);
    review.fixes.push({ id, where, kind, before, after, applied });
    return applied;
  };
}

// errors plus missed names the plan only warned about, for the ai repair turn
export function repairErrors(plan: { errors: string[]; suggestions: Suggestion[] }): string[] {
  const missed = plan.suggestions
    .filter((suggestion) => !plan.errors.some((error) => error.includes(`"${suggestion.name}"`)))
    .map((suggestion) => `${suggestion.where}: no ${suggestion.refType} named "${suggestion.name}"; did you mean ${formatRanked(suggestion.candidates)}?`);
  return [...plan.errors, ...missed];
}
