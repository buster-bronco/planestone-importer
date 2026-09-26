export interface Candidate {
  name: string;
  uuid?: string;
  pack?: string;
}

export interface Ranked extends Candidate {
  score: number;
}

// "Dagger (Returning)" → "dagger"
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// edit distance, two-row dp
function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// shared words over all words
function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / new Set([...left, ...right]).size;
}

// 0..1, 1 is an exact match after normalizing
export function similarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const edit = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  return Math.max(edit, tokenOverlap(left, right));
}

// best candidates at or above min, highest first, one per name
export function rank<T extends Candidate>(name: string, candidates: Iterable<T>, { limit = 3, min = 0.6 } = {}): (T & { score: number })[] {
  const best = new Map<string, T & { score: number }>();
  for (const candidate of candidates) {
    const score = Math.round(similarity(name, candidate.name) * 100) / 100;
    if (score < min) continue;
    const key = candidate.name.toLowerCase();
    if ((best.get(key)?.score ?? -1) < score) best.set(key, { ...candidate, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

// "Dagger (0.92), Dogslicer (0.61)"
export function formatRanked(ranked: Ranked[]): string {
  return ranked.map((hit) => `${hit.name} (${hit.score.toFixed(2)})`).join(", ");
}
