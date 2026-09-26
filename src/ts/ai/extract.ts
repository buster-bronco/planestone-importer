// first fenced block; the language tag is optional
const FENCE = /```[\w-]*[^\S\n]*\n([\s\S]*?)```/;

export interface SplitReply {
  yaml: string;
  // the reply's prose around the yaml block
  notes: string;
}

// ai reply → the sheet yaml and the note around it
export function splitReply(reply: string): SplitReply {
  const match = FENCE.exec(reply);
  if (!match) return { yaml: reply.trim(), notes: "" };
  const notes = `${reply.slice(0, match.index)}\n${reply.slice(match.index + match[0].length)}`.replace(/\n{3,}/g, "\n\n").trim();
  return { yaml: match[1].trim(), notes };
}
