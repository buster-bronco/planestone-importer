// text is plain prose; the rest are enricher or markup spans kept as written
export type SpanKind = "text" | "tag" | "mark" | "enricher";

export interface Span {
  kind: SpanKind;
  text: string;
}

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

// html tag, [[mark]] or @Enricher[...] starting at i
function spanAt(text: string, i: number): { kind: SpanKind; end: number } | null {
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    return { kind: "tag", end: close === -1 ? text.length : close + 1 };
  }
  if (text.startsWith("[[", i)) return { kind: "mark", end: skipLabel(text, closeBracket(text, i, "[", "]")) };
  const enricher = text.slice(i).match(/^@\w+\[/);
  if (enricher) return { kind: "enricher", end: skipLabel(text, closeBracket(text, i + enricher[0].length - 1, "[", "]")) };
  return null;
}

export function splitSpans(html: string): Span[] {
  const spans: Span[] = [];
  let text = "";
  let i = 0;
  while (i < html.length) {
    const span = spanAt(html, i);
    if (!span) {
      text += html[i++];
      continue;
    }
    if (text) spans.push({ kind: "text", text });
    spans.push({ kind: span.kind, text: html.slice(i, span.end) });
    text = "";
    i = span.end;
  }
  if (text) spans.push({ kind: "text", text });
  return spans;
}

// rewrites only spans of the given kinds
export function mapSpans(html: string, kinds: SpanKind[], rewrite: (text: string) => string): string {
  return splitSpans(html)
    .map((span) => (kinds.includes(span.kind) ? rewrite(span.text) : span.text))
    .join("");
}
