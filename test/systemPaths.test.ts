import { describe, expect, it } from "vitest";
import { splitPatch } from "../src/ts/ai/hunks";
import { exportItem, exportYaml } from "../src/ts/export";
import { buildItemPatchChanges, type ItemSource } from "../src/ts/patch/item";
import { rawPathLines, systemPathUpdate } from "../src/ts/patch/systemPaths";
import { parseSheetText } from "../src/ts/parse";

const dagger = (): ItemSource => ({
  _id: "dag",
  name: "Dagger",
  type: "weapon",
  system: {
    level: { value: 0 },
    price: { value: { sp: 2 } },
    bulk: { value: 0.1 },
    usage: { value: "held-in-one-hand" },
    runes: { potency: 0, striking: 0 },
    traits: { value: ["agile"], rarity: "common" },
    description: { value: "<p>A blade.</p>" },
    rules: [],
  },
});

const itemPatch = (yaml: string) => {
  const parsed = parseSheetText(`schemaVersion: 1\nkind: itemPatch\n${yaml}`);
  expect(parsed.errors).toEqual([]);
  return parsed.itemPatches[0];
};

describe("systemPathUpdate", () => {
  it("sets existing paths and new keys beside real ones", () => {
    const { update, changes, errors } = systemPathUpdate(dagger(), { "system.level.value": 3, "system.price.value.gp": 40 });
    expect(errors).toEqual([]);
    expect(update).toEqual({ "system.level.value": 3, "system.price.value.gp": 40 });
    expect(changes).toEqual(["system.level.value: 0 → 3", "system.price.value.gp: none → 40"]);
  });

  it("suggests the real path for a typo", () => {
    expect(systemPathUpdate(dagger(), { "system.levle.value": 3 }).errors[0]).toContain("did you mean system.level.value");
    expect(systemPathUpdate(dagger(), { "system.level.valeu": 3 }).errors[0]).toContain("did you mean system.level.value");
  });

  it("rejects a type change and paths with their own field", () => {
    expect(systemPathUpdate(dagger(), { "system.level.value": "3" }).errors[0]).toContain("is a number, got a string");
    expect(systemPathUpdate(dagger(), { "system.description.value": "x" }).errors[0]).toContain("use description");
    expect(systemPathUpdate(dagger(), { "system.traits.value": [] }).errors[0]).toContain("use traits");
  });
});

describe("item patch raw fields", () => {
  it("parses system paths and rules, and rejects other unknown keys with a hint", () => {
    itemPatch("set:\n  system.level.value: 2\n  rules: [{ key: FlatModifier, selector: ac, value: 1 }]");
    const { errors } = parseSheetText("schemaVersion: 1\nkind: itemPatch\nset: { nmae: X }\n");
    expect(errors.join("\n")).toContain("did you mean name");
  });

  it("builds one update with raw paths and rules", () => {
    const doc = itemPatch("set:\n  system.level.value: 2\n  rules: [{ key: FlatModifier, selector: ac, value: 1 }]");
    const { update, changes, errors } = buildItemPatchChanges(doc, dagger());
    expect(errors).toEqual([]);
    expect(update).toEqual({ "system.level.value": 2, "system.rules": [{ key: "FlatModifier", selector: "ac", value: 1 }] });
    expect(changes).toEqual(["system.level.value: 0 → 2", "rules: none → FlatModifier"]);
  });

  it("reports a bad path as a patch error", () => {
    const { errors, update } = buildItemPatchChanges(itemPatch("set: { system.levle.value: 2 }"), dagger());
    expect(errors[0]).toContain("did you mean");
    expect(update).toEqual({});
  });

  it("gives each system path its own ai hunk", () => {
    const raw = { kind: "itemPatch", set: { "system.level.value": 2, "system.bulk.value": 1, rules: [] } };
    expect(splitPatch(raw).map((hunk) => (hunk.op as any).path)).toEqual(["system.level.value", "system.bulk.value", "rules"]);
  });
});

describe("item export notes", () => {
  it("lists patchable paths as comments and leaves typed ones out", () => {
    const lines = rawPathLines(dagger().system);
    expect(lines).toContain("system.level.value: 0");
    expect(lines).toContain('system.usage.value: "held-in-one-hand"');
    expect(lines.some((line) => line.startsWith("system.description") || line.startsWith("system.runes"))).toBe(false);
  });

  it("keeps the exported sheet importable", () => {
    const text = exportYaml(exportItem({ ...dagger(), type: "action", system: { ...dagger().system, actionType: { value: "action" }, actions: { value: 1 } } }));
    expect(text).toContain("# system.level.value: 0");
    expect(parseSheetText(text).errors).toEqual([]);
  });
});
