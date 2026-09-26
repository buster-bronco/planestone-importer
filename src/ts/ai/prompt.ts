import readme from "../../../Readme.md?raw";

// the readme's sheet format reference, bundled at build time
export function formatSpec(text: string = readme): string {
  const start = text.indexOf("## Planestone sheet format");
  return start < 0 ? text : text.slice(start);
}

const INTRO = `You write Planestone sheets: YAML documents that a Foundry VTT module turns into Pathfinder 2e (pf2e, remaster rules) documents. The format reference is at the end.

Reply with one or two sentences on what you did, then exactly one \`\`\`yaml code block. Nothing is created or changed until the GM reviews your reply.`;

// text box first, then each file under its own name
export function joinContext(text: string, files: { path: string; content: string }[]): string {
  const parts = [text.trim(), ...files.map(({ path, content }) => `## ${path.split("/").pop()}\n\n${content.trim()}`)];
  return parts.filter(Boolean).join("\n\n");
}

function worldSection(context: string): string {
  return context.trim() ? `\n\n# World context\n\nThe GM's setting notes. Follow them whenever they apply.\n\n${context.trim()}` : "";
}

function formatSection(): string {
  return `\n\n# Format reference\n\n${formatSpec()}`;
}

export interface PatchPromptInput {
  kind: "actorPatch" | "itemPatch";
  // the document's current sheet yaml
  sheet: string;
  context: string;
}

export function patchSystemPrompt({ kind, sheet, context }: PatchPromptInput): string {
  const what = kind === "actorPatch" ? "NPC" : "world item";
  const task = `# Task

The GM wants to change the existing ${what} under "Current sheet". Reply with a single \`kind: ${kind}\` document (\`schemaVersion: 1\`) that makes the requested change.
- Change only what was asked, plus what has to move with it (a level change moves AC, saves, HP, attacks, DCs and skills).
- Leave out \`target\`.
- Every reply holds the complete patch; it replaces your earlier one.
- When the GM lists rejected changes, leave them out unless they ask for them again.

# Current sheet

\`\`\`yaml
${sheet.trim()}
\`\`\``;
  return `${INTRO}\n\n${task}${worldSection(context)}${formatSection()}`;
}

export function sheetSystemPrompt({ context }: { context: string }): string {
  const task = `# Task

The GM wants a new sheet. Reply with a single document (\`schemaVersion: 1\`) of kind actor, vehicle, hazard, item, itemBatch or actorBatch.
- Follow pf2e creature and hazard building guidelines for the level.
- Prefer compendium references for standard actions, equipment and spells; write homebrew items for anything new.
- On follow-up requests, reply with the complete revised sheet.`;
  return `${INTRO}\n\n${task}${worldSection(context)}${formatSection()}`;
}
