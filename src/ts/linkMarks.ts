import { titleCase } from "./slug";

export interface LinkTarget {
  uuid: string;
  name: string;
}

// [[...]] not followed by a {label}; inline rolls are filtered separately
const MARK_PATTERN = /\[\[([^[\]]+?)\]\](?!\{)/g;

// foundry inline rolls: [[/r 1d6]], [[/gmr ...]], bare [[2d6+3]]
export function isInlineRoll(content: string): boolean {
  const text = content.trim();
  if (text.startsWith("/")) return true;
  if (/^[\d\s+\-*/().]+$/.test(text)) return true;
  return /\d*d\d+/i.test(text) || text.includes("@");
}

// "stupefied 1" → name "stupefied", value 1
export function parseMarkTerm(content: string): { name: string; value: number | null } {
  const match = content.trim().match(/^(.+?)(?:\s+(\d+))?$/);
  return { name: match?.[1] ?? content.trim(), value: match?.[2] ? Number(match[2]) : null };
}

// swaps [[term]] marks for @UUID links; unresolved marks fall back to plain text
export function applyLinkMarks(html: string, resolve: (name: string) => LinkTarget | null): { html: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const output = html.replace(MARK_PATTERN, (full, content: string) => {
    if (isInlineRoll(content)) return full;
    const { name, value } = parseMarkTerm(content);
    const target = resolve(name.toLowerCase());
    if (!target) {
      unresolved.push(content.trim());
      return content.trim();
    }
    const label = value === null ? titleCase(target.name) : `${titleCase(target.name)} ${value}`;
    return `@UUID[${target.uuid}]{${label}}`;
  });
  return { html: output, unresolved };
}
