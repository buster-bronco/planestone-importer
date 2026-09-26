import type { Suggestion, TextFix } from "../review";

interface Reviewed {
  fixes: TextFix[];
  suggestions: Suggestion[];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// template data for the fixes block both dialogs share
export function fixContext(plan: Reviewed | null, lint: boolean, canPick: boolean) {
  return {
    lint,
    fixes: (plan?.fixes ?? []).map((fix) => ({ id: fix.id, kind: fix.kind, label: `${fix.where}: ${fix.before} → ${fix.after}`, checked: fix.applied })),
    suggestions: (plan?.suggestions ?? []).map((suggestion) => ({
      where: suggestion.where,
      name: suggestion.name,
      candidates: suggestion.candidates.map((candidate) => ({ name: candidate.name, score: candidate.score.toFixed(2) })),
    })),
    canPick,
  };
}

export interface FixHandlers {
  toggleFix: (id: string, applied: boolean) => void;
  toggleLint: (enabled: boolean) => void;
  pick: (name: string, candidate: string) => void;
}

export function bindFixControls(root: HTMLElement, handlers: FixHandlers): void {
  const lint = root.querySelector("input[data-lint]") as HTMLInputElement | null;
  lint?.addEventListener("change", () => handlers.toggleLint(lint.checked));
  for (const box of root.querySelectorAll("input[data-fix]") as NodeListOf<HTMLInputElement>) {
    box.addEventListener("change", () => handlers.toggleFix(box.dataset.fix!, box.checked));
  }
  for (const button of root.querySelectorAll("button[data-pick]") as NodeListOf<HTMLButtonElement>) {
    button.addEventListener("click", () => handlers.pick(button.dataset.name!, button.dataset.pick!));
  }
}

// first `name: Daggor` in the sheet → `name: Dagger`, keeping any quotes
export function replaceLookupName(text: string, name: string, candidate: string): string | null {
  const pattern = new RegExp(String.raw`(name:\s*)(["']?)${escapeRegex(name)}\2(?=\s*(?:[,}\r\n]|$))`);
  return pattern.test(text) ? text.replace(pattern, (_full, key: string, quote: string) => `${key}${quote}${candidate}${quote}`) : null;
}
