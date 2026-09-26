import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";
import { sendChat, type ChatMessage } from "../src/ts/ai/client";
import { describeActorPatch, describeItemPatch, dumpPatch } from "../src/ts/ai/describe";
import { splitReply } from "../src/ts/ai/extract";
import { describeHunks, hunkText, joinPatch, splitPatch, type RawDoc } from "../src/ts/ai/hunks";
import { formatSpec, joinContext, patchSystemPrompt, sheetSystemPrompt } from "../src/ts/ai/prompt";
import { AiSession, correctionText } from "../src/ts/ai/session";
import { buildActorSystem } from "../src/ts/build/actorData";
import { normalizeOps } from "../src/ts/patch/paths";
import { parseSheetText } from "../src/ts/parse";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");
const rawExample = (name: string) => yaml.load(example(name)) as RawDoc;
const all = (hunks: { id: string }[]) => new Set(hunks.map((hunk) => hunk.id));

// ops as normalizeOps sees them, minus the spec objects
function opsOf(raw: RawDoc) {
  const [patch] = parseSheetText(dumpPatch(raw)).patches;
  const ops = normalizeOps(patch);
  return { sets: ops.sets.map(({ path, value }) => ({ path, value })), lists: ops.lists.map(({ mode, path, entries }) => ({ mode, path, entries })), items: patch.items };
}

describe("splitPatch / joinPatch", () => {
  const raw = rawExample("patch.yaml");
  const hunks = splitPatch(raw);

  it("splits set paths, list entries and item ops into hunks", () => {
    const texts = hunks.map((hunk) => hunkText(hunk.op));
    expect(texts).toContain("meta.level: 5");
    expect(texts).toContain("core.saves.fortitude: 14");
    expect(texts).toContain("core.abilities.str: 5");
    expect(texts).toContain('+ core.resistances: {"type":"cold","value":5}');
    expect(texts).toContain("− core.skills.named: survival");
    expect(texts).toContain("− Shield Bash");
    expect(texts).toContain("~ Hold the Line");
    expect(texts).toContain("+ Grab");
  });

  it("joins every hunk back into the same ops", () => {
    expect(opsOf(joinPatch(raw, hunks, all(hunks)))).toEqual(opsOf(raw));
  });

  it("drops only the unselected hunks", () => {
    const drop = (text: string) => {
      const selected = all(hunks);
      selected.delete(hunks.find((hunk) => hunkText(hunk.op) === text)!.id);
      return joinPatch(raw, hunks, selected) as any;
    };
    const noAc = drop("core.ac: 23");
    expect(noAc.set["core.ac"]).toBeUndefined();
    expect(noAc.set["meta.level"]).toBe(5);

    const noCold = drop('+ core.resistances: {"type":"cold","value":5}');
    expect(noCold.add["core.resistances"]).toBeUndefined();
    expect(noCold.add["core.perception.senses"]).toEqual(["darkvision"]);

    const noLongsword = drop("~ Longsword");
    expect(noLongsword.items.update.map((entry: any) => entry.match)).toEqual(["Hold the Line"]);
    expect(noLongsword.items.remove).toEqual(["Shield Bash"]);
  });

  it("keeps kind and target outside the hunks", () => {
    const joined = joinPatch(raw, hunks, new Set());
    expect(joined).toEqual({ schemaVersion: 1, kind: "actorPatch", target: { name: "Border Warden" } });
  });

  it("keeps item patch fields whole", () => {
    const itemRaw = rawExample("item-patch.yaml");
    const itemHunks = splitPatch({ ...itemRaw, set: { ...(itemRaw.set as RawDoc), runes: { potency: 2 } } });
    expect(itemHunks.map((hunk) => hunkText(hunk.op))).toContain('runes: {"potency":2}');
  });

  it("keeps malformed values as one hunk", () => {
    const odd = { schemaVersion: 1, kind: "actorPatch", add: { "core.resistances": { type: "cold" } }, items: "nope" };
    const oddHunks = splitPatch(odd);
    expect(oddHunks).toHaveLength(2);
    expect(joinPatch(odd, oddHunks, all(oddHunks))).toEqual(odd);
  });
});

describe("describeHunks", () => {
  const [warden] = parseSheetText(example("actor.yaml")).actors;
  const { system } = buildActorSystem(warden);
  const source = JSON.parse(JSON.stringify({ _id: "warden", name: warden.meta.name, system, items: [] }));

  it("labels actor hunks with before → after", () => {
    const raw: RawDoc = { schemaVersion: 1, kind: "actorPatch", set: { "core.ac": 23 }, add: { "core.resistances": [{ type: "cold", value: 5 }] } };
    const views = describeHunks(raw, splitPatch(raw), describeActorPatch(source));
    expect(views[0].label).toMatch(/→ 23/);
    expect(views[1].label).toMatch(/cold/);
    expect(views.every((view) => !view.errors.length)).toBe(true);
  });

  it("falls back to plain text and reports errors for a bad hunk", () => {
    const raw: RawDoc = { schemaVersion: 1, kind: "actorPatch", set: { "core.nope": 1 } };
    const [view] = describeHunks(raw, splitPatch(raw), describeActorPatch(source));
    expect(view.label).toBe("core.nope: 1");
    expect(view.errors.join()).toMatch(/unknown path/);
  });

  it("labels item patch hunks", () => {
    const raw: RawDoc = { schemaVersion: 1, kind: "itemPatch", set: { name: "Hold Fast", traits: ["flourish"] } };
    const item = { name: "Hold the Line", type: "action", system: { traits: { value: [] } } };
    const views = describeHunks(raw, splitPatch(raw), describeItemPatch(item));
    expect(views[0].label).toBe("name: Hold the Line → Hold Fast");
  });
});

describe("splitReply", () => {
  it("pulls the yaml block and keeps the prose as notes", () => {
    const reply = "Raised the AC.\n\n```yaml\nschemaVersion: 1\nkind: actorPatch\n```\n\nThat's all.";
    expect(splitReply(reply)).toEqual({ yaml: "schemaVersion: 1\nkind: actorPatch", notes: "Raised the AC.\n\nThat's all." });
  });

  it("takes an untagged fence", () => {
    expect(splitReply("```\na: 1\n```").yaml).toBe("a: 1");
  });

  it("falls back to the whole reply without a fence", () => {
    expect(splitReply("  a: 1\n")).toEqual({ yaml: "a: 1", notes: "" });
  });
});

describe("AiSession", () => {
  // replies in order, recording what each call saw
  function fakeSend(replies: string[]) {
    const seen: ChatMessage[][] = [];
    const send = vi.fn(async (_system: string, messages: ChatMessage[]) => {
      seen.push(messages.map((message) => ({ ...message })));
      const reply = replies.shift();
      if (reply === undefined) throw new Error("no reply");
      return reply;
    });
    return { send, seen };
  }

  it("asks and keeps the thread", async () => {
    const { send } = fakeSend(["one"]);
    const session = new AiSession("sys", send, async () => []);
    expect(await session.ask("hi")).toBe("one");
    expect(session.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "one" },
    ]);
  });

  it("repairs a failed reply once", async () => {
    const { send, seen } = fakeSend(["bad", "good"]);
    const validate = async (reply: string) => (reply === "bad" ? ["core.ac: expected number"] : []);
    const session = new AiSession("sys", send, validate);
    expect(await session.ask("hi")).toBe("good");
    expect(seen[1].at(-1)).toMatchObject({ role: "user", auto: true });
    expect(seen[1].at(-1)!.content).toMatch(/core\.ac: expected number/);
  });

  it("gives up after one repair", async () => {
    const { send } = fakeSend(["bad", "still bad"]);
    const session = new AiSession("sys", send, async () => ["broken"]);
    expect(await session.ask("hi")).toBe("still bad");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("redo drops the last reply and its repair turn", async () => {
    const { send, seen } = fakeSend(["bad", "good", "again"]);
    const session = new AiSession("sys", send, async (reply) => (reply === "bad" ? ["broken"] : []));
    await session.ask("hi");
    expect(await session.redo()).toBe("again");
    expect(seen[2]).toEqual([{ role: "user", content: "hi" }]);
  });

  it("names rejected changes in a correction", async () => {
    const { send, seen } = fakeSend(["one", "two"]);
    const session = new AiSession("sys", send, async () => []);
    await session.ask("hi");
    await session.correct("also make it fly", ["AC: 21 → 23"]);
    const last = seen[1].at(-1)!.content;
    expect(last).toMatch(/- AC: 21 → 23/);
    expect(last).toMatch(/also make it fly$/);
    expect(correctionText("", ["x"])).toMatch(/again without them/);
  });

  it("leaves the thread untouched when a call fails", async () => {
    const { send } = fakeSend(["one"]);
    const session = new AiSession("sys", send, async () => []);
    await session.ask("hi");
    await expect(session.ask("more")).rejects.toThrow("no reply");
    expect(session.messages).toHaveLength(2);
  });
});

describe("sendChat", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi", auto: true }];
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 401, statusText: "nope", json: async () => body }) as any);

  it("calls anthropic with browser access and a cached system prompt", async () => {
    const fetcher = reply({ content: [{ type: "text", text: "ok" }] });
    expect(await sendChat({ provider: "anthropic", apiKey: "k", model: "" }, "sys", messages, fetcher)).toBe("ok");
    const [url, init] = fetcher.mock.calls[0] as any;
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system[0]).toMatchObject({ text: "sys", cache_control: { type: "ephemeral" } });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("calls openai with the system prompt first", async () => {
    const fetcher = reply({ choices: [{ message: { content: "ok" } }] });
    expect(await sendChat({ provider: "openai", apiKey: "k", model: "gpt-x" }, "sys", messages, fetcher)).toBe("ok");
    const [url, init] = fetcher.mock.calls[0] as any;
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer k");
    expect(body.model).toBe("gpt-x");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("calls openrouter, caching the system prompt for anthropic models", async () => {
    const fetcher = reply({ choices: [{ message: { content: "ok" } }] });
    expect(await sendChat({ provider: "openrouter", apiKey: "k", model: "" }, "sys", messages, fetcher)).toBe("ok");
    const [url, init] = fetcher.mock.calls[0] as any;
    const body = JSON.parse(init.body);
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer k");
    expect(body.model).toBe("anthropic/claude-sonnet-5");
    expect(body.messages[0].content[0]).toMatchObject({ text: "sys", cache_control: { type: "ephemeral" } });
  });

  it("sends a plain system prompt to other openrouter models", async () => {
    const fetcher = reply({ choices: [{ message: { content: "ok" } }] });
    await sendChat({ provider: "openrouter", apiKey: "k", model: "google/gemini-3-pro" }, "sys", messages, fetcher);
    const body = JSON.parse((fetcher.mock.calls[0] as any)[1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("surfaces the api error message", async () => {
    const fetcher = reply({ error: { message: "invalid x-api-key" } }, false);
    await expect(sendChat({ provider: "anthropic", apiKey: "k", model: "" }, "sys", messages, fetcher)).rejects.toThrow("anthropic 401: invalid x-api-key");
  });
});

describe("prompts", () => {
  const readme = readFileSync(new URL("../Readme.md", import.meta.url), "utf-8");

  it("uses the readme from the sheet format section on", () => {
    const spec = formatSpec(readme);
    expect(spec.startsWith("## Planestone sheet format")).toBe(true);
    expect(spec).toContain("### Patches (`actorPatch`)");
  });

  it("puts the sheet and world context in the patch prompt", () => {
    const prompt = patchSystemPrompt({ kind: "actorPatch", sheet: "kind: actor\n", context: "no humans exist" });
    expect(prompt).toContain("`kind: actorPatch`");
    expect(prompt).toContain("```yaml\nkind: actor\n```");
    expect(prompt).toContain("no humans exist");
  });

  it("joins the context text and files", () => {
    const files = [{ path: "worlds/w/notes/species.md", content: "no humans\n" }];
    expect(joinContext(" kobolds rule ", files)).toBe("kobolds rule\n\n## species.md\n\nno humans");
    expect(joinContext("", files)).toBe("## species.md\n\nno humans");
  });

  it("skips an empty world context", () => {
    expect(sheetSystemPrompt({ context: "  " })).not.toContain("# World context");
  });
});
