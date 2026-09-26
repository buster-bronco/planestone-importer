import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHomebrewAction } from "../src/ts/build/homebrew";
import { buildItemPatchChanges, type ItemSource } from "../src/ts/patch/item";
import { parseSheetText } from "../src/ts/parse";
import type { HomebrewActionItem } from "../src/ts/schema";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");

const itemPatch = (yaml: string) => {
  const parsed = parseSheetText(`schemaVersion: 1\nkind: itemPatch\n${yaml}`);
  expect(parsed.errors).toEqual([]);
  return parsed.itemPatches[0];
};

// what item.toObject() looks like for hold the line after import
function holdTheLine(): ItemSource {
  const [item] = parseSheetText(example("items.yaml")).items;
  return JSON.parse(JSON.stringify({ _id: "htl", ...buildHomebrewAction(item as HomebrewActionItem) }));
}

describe("world item parsing", () => {
  it("accepts the item batch example", () => {
    const result = parseSheetText(example("items.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors).toEqual([]);
    expect(result.items.map((item) => item.origin)).toEqual(["homebrew", "homebrew", "compendiumRef", "compendiumRef"]);
  });

  it("accepts a single item with its fields next to kind", () => {
    const result = parseSheetText(`
schemaVersion: 1
kind: item
origin: homebrew
type: action
name: Brace
actionType: 1
`);
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: "Brace", actionType: 1, traits: [] });
  });

  it("reports item field errors from a single item", () => {
    const { errors } = parseSheetText("schemaVersion: 1\nkind: item\norigin: homebrew\ntype: action\nname: Parry\nactionType: reaction\n");
    expect(errors.join("\n")).toContain("trigger is required");
  });

  it("rejects strikes and weapon strikes as world items", () => {
    const { errors } = parseSheetText(`
schemaVersion: 1
kind: itemBatch
items:
  - { origin: homebrew, type: melee, name: Jaws, attackBonus: 5, damageRolls: [{ damage: 1d6, damageType: piercing }] }
  - { origin: equippedWeapon, lookup: { name: Dagger }, proficiency: trained }
`);
    expect(errors[0]).toMatch(/^items\.0: "Jaws" is a strike/);
    expect(errors[1]).toMatch(/^items\.1: equippedWeapon/);
  });

  it("accepts the item patch example", () => {
    const result = parseSheetText(example("item-patch.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.itemPatches).toHaveLength(1);
  });

  it("rejects unknown item patch fields", () => {
    const { errors } = parseSheetText("schemaVersion: 1\nkind: itemPatch\nset: { colour: red }\n");
    expect(errors.join("\n")).toContain("colour");
  });
});

describe("buildItemPatchChanges", () => {
  it("rewrites an action's trigger, description and traits", () => {
    const doc = parseSheetText(example("item-patch.yaml")).itemPatches[0];
    const { update, changes, errors } = buildItemPatchChanges(doc, holdTheLine());
    expect(errors).toEqual([]);
    expect(update["system.description.value"]).toContain("<strong>Trigger</strong> An ally within 15 feet");
    expect(update["system.traits.value"]).toEqual(["flourish"]);
    expect(changes).toContain("traits: none → flourish");
    expect(changes).toContain("trigger and description rewritten");
  });

  it("renames actions and reslugs them", () => {
    const { update, changes } = buildItemPatchChanges(itemPatch("set: { name: Hold Fast, actionType: 2 }"), holdTheLine());
    expect(update).toMatchObject({ name: "Hold Fast", "system.slug": "hold-fast", "system.actionType.value": "action", "system.actions.value": 2 });
    expect(changes).toEqual(["name: Hold the Line → Hold Fast", "actions: reaction → 2"]);
  });

  it("keeps compendium slugs on rename and sets weapon runes", () => {
    const sword: ItemSource = { name: "Longsword", type: "weapon", system: { slug: "longsword", runes: { potency: 0, striking: 0 } } };
    const { update, changes, errors } = buildItemPatchChanges(itemPatch("set: { name: Warden Blade, runes: { potency: 1 } }"), sword);
    expect(errors).toEqual([]);
    expect(update).toEqual({ name: "Warden Blade", "system.runes.potency": 1 });
    expect(changes).toEqual(["name: Longsword → Warden Blade", "potency: 0 → 1"]);
  });

  it("rejects fields that don't fit the item type", () => {
    const spell: ItemSource = { name: "Daze", type: "spell", system: {} };
    const text = buildItemPatchChanges(itemPatch("set: { actionType: 1, runes: { striking: 1 }, attackBonus: 3, proficiency: master }"), spell).errors.join("\n");
    expect(text).toContain("proficiency only apply to npc strikes");
    expect(text).toContain("runes need a weapon");
    expect(text).toContain("actionType need an action");
    expect(text).toContain("attackBonus need a strike");
  });

  it("needs description alongside trigger, and something to change", () => {
    expect(buildItemPatchChanges(itemPatch("set: { trigger: x }"), holdTheLine()).errors).toEqual(["set: trigger needs description in the same set"]);
    expect(buildItemPatchChanges(itemPatch("set: {}"), holdTheLine()).errors).toEqual(["set: nothing to change"]);
  });
});
