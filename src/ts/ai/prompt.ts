import readme from "../../../Readme.md?raw";

export type PromptKind = "sheet" | "actorPatch" | "itemPatch" | "flavor";

// readme ### headings sent per prompt kind, without their "(…)" suffix
export const SPEC_SECTIONS: Record<PromptKind, string[]> = {
  sheet: ["Envelope", "Actor", "Vehicle", "Hazard", "Items", "Links in descriptions", "Automatic rolls", "World items", "Spellcasting"],
  actorPatch: ["Envelope", "Actor", "Items", "Links in descriptions", "Automatic rolls", "Patches"],
  itemPatch: ["Envelope", "Items", "Links in descriptions", "Automatic rolls", "Item patches"],
  flavor: ["Links in descriptions", "Automatic rolls"],
};

// the readme's sheet format section, split on ### headings
export function specSections(text: string = readme): Map<string, string> {
  const sections = new Map<string, string>();
  const start = text.indexOf("## Planestone sheet format");
  if (start < 0) return sections;
  const end = text.indexOf("\n## ", start + 1);
  for (const part of text.slice(start, end < 0 ? undefined : end).split(/^(?=### )/m).slice(1)) {
    const name = part.slice(4, part.indexOf("\n")).trim().replace(/\s*\(.*$/, "");
    sections.set(name, part.trim());
  }
  return sections;
}

// the format reference slice for one prompt kind, in readme order
export function formatSpec(kind: PromptKind, text: string = readme): string {
  const wanted = SPEC_SECTIONS[kind];
  const picked = [...specSections(text)].filter(([name]) => wanted.includes(name)).map(([, section]) => section);
  return `## Planestone sheet format (v1)\n\n${picked.join("\n\n")}`;
}

// rough token count, ~4 characters each
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const INTRO = `You write Planestone sheets: YAML documents that a Foundry VTT module turns into Pathfinder 2e (pf2e, remaster rules) documents.

Reply with one or two sentences on what you did, then exactly one \`\`\`yaml code block. Nothing is created or changed until the GM reviews your reply.`;

const STYLE = `# Descriptions

Descriptions are flavor text for the table, in the voice of a pf2e bestiary entry.
- Keep flavor to one or two sentences on what the creature, item or ability is or does.
- No appearance paragraphs, art direction or backstory unless the GM asks for them.
- Ability and item descriptions carry their rules text; flavor is at most a sentence ahead of it.`;

// text box first, then each file under its own name, as tagged documents
export function joinContext(text: string, files: { path: string; content: string }[]): string {
  const parts: string[] = [];
  if (text.trim()) parts.push(`<note source="gm">\n${text.trim()}\n</note>`);
  for (const { path, content } of files) {
    if (content.trim()) parts.push(`<document source="${path.split("/").pop()}">\n${content.trim()}\n</document>`);
  }
  return parts.length ? `<world_context>\n${parts.join("\n")}\n</world_context>` : "";
}

function worldSection(context: string): string {
  if (!context.trim()) return "";
  return `# World context

Background on the GM's setting. Use it to keep names, species, tone and assumptions consistent. Don't bring setting details into a description unless the request or the document involves them.

${context.trim()}`;
}

// system prompt parts, stable first; providers cache each part as a prefix
function systemParts(kind: PromptKind, context: string, task: string): string[] {
  const head = `${INTRO}\n\n${STYLE}\n\n# Format reference\n\n${formatSpec(kind)}`;
  return [head, worldSection(context), task].filter(Boolean);
}

export interface PatchPromptInput {
  kind: "actorPatch" | "itemPatch";
  // the document's current sheet yaml
  sheet: string;
  context: string;
}

const PATCH_RULES = `- Leave out \`target\`.
- Every reply holds the complete patch; it replaces your earlier one.
- When the GM lists rejected changes, leave them out unless they ask for them again.`;

function currentSheet(sheet: string): string {
  return `# Current sheet\n\n\`\`\`yaml\n${sheet.trim()}\n\`\`\``;
}

function subject(kind: PatchPromptInput["kind"]): string {
  return kind === "actorPatch" ? "NPC" : "world item";
}

export function patchSystemPrompt({ kind, sheet, context }: PatchPromptInput): string[] {
  const task = `# Task

The GM wants to change the existing ${subject(kind)} under "Current sheet". Reply with a single \`kind: ${kind}\` document (\`schemaVersion: 1\`) that makes the requested change.
- Change only what was asked, plus what has to move with it (a level change moves AC, saves, HP, attacks, DCs and skills).
${PATCH_RULES}

${currentSheet(sheet)}`;
  return systemParts(kind, context, task);
}

const FLAVOR_EXAMPLES: Record<PatchPromptInput["kind"], string> = {
  actorPatch: `schemaVersion: 1
kind: actorPatch
items:
  update:
    - match: Tail Lash
      set: { description: "<p>…</p>" }`,
  itemPatch: `schemaVersion: 1
kind: itemPatch
set:
  description: "<p>…</p>"`,
};

// descriptions only; no sheet format beyond the description rules
export function flavorSystemPrompt({ kind, sheet, context }: PatchPromptInput): string[] {
  const task = `# Task

The GM wants new flavor text for the ${subject(kind)} under "Current sheet". Reply with a single \`kind: ${kind}\` document that sets only descriptions, shaped like this:

\`\`\`yaml
${FLAVOR_EXAMPLES[kind]}
\`\`\`

- Keep every rule, number, trait and link already in a description; rewrite only the flavor around them.
${PATCH_RULES}

${currentSheet(sheet)}`;
  return systemParts("flavor", context, task);
}

export function sheetSystemPrompt({ context }: { context: string }): string[] {
  const task = `# Task

The GM wants a new sheet. Reply with a single document (\`schemaVersion: 1\`) of kind actor, vehicle, hazard, item, itemBatch or actorBatch.
- Follow pf2e creature and hazard building guidelines for the level.
- Prefer compendium references for standard actions, equipment and spells; write homebrew items for anything new.
- On follow-up requests, reply with the complete revised sheet.`;
  return systemParts("sheet", context, task);
}
