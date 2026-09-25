import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSheetText } from "../src/ts/parse";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");

describe("parseSheetText", () => {
  it("accepts the single actor example", () => {
    const result = parseSheetText(example("actor.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors).toHaveLength(1);
    const [actor] = result.actors;
    expect(actor.meta.freeArchetype).toBe(false);
    expect(actor.items).toHaveLength(6);
    const bow = actor.items[2];
    expect(bow.origin === "equippedWeapon" && bow.keepInInventory).toBe(false);
  });

  it("accepts the batch example and warns about spellcasting", () => {
    const result = parseSheetText(example("batch.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors.map((a) => a.meta.name)).toEqual(["Armada Deckhand", "Armada Hexer"]);
    expect(result.spellLists).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("spellcasting"))).toBe(true);
  });

  it("reports every problem in the broken example", () => {
    const { errors, actors } = parseSheetText(example("broken.yaml"));
    expect(actors).toEqual([]);
    const text = errors.join("\n");
    expect(text).toContain("core.abilities.cha");
    expect(text).toContain("core.hp.value");
    expect(text).toContain("items.0.origin");
    expect(text).toContain("trigger is required");
    expect(text).toContain("attackBonus");
  });

  it("accepts json", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      kind: "spellList",
      id: "x",
      tradition: "arcane",
      basis: "spellAttack",
      dcOrAttack: 9,
    });
    expect(parseSheetText(json).errors).toEqual([]);
  });

  it("rejects unknown attack effects but only warns for pf2e built-ins", () => {
    const sheet = (effect: string) => `
schemaVersion: 1
kind: actor
meta: { name: Test, level: 1 }
core:
  abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
  perception: { mod: 0 }
  ac: 10
  saves: { fortitude: 0, reflex: 0, will: 0 }
  hp: { value: 5 }
  speed: { value: 25 }
items:
  - { origin: homebrew, type: melee, name: Jaws, attackBonus: 5, damageRolls: [{ damage: 1d6, damageType: piercing }], attackEffects: [${effect}] }
`;
    expect(parseSheetText(sheet("grab")).errors).toEqual([]);
    expect(parseSheetText(sheet("grab")).warnings[0]).toContain("label only");
    expect(parseSheetText(sheet("rend-soul")).errors[0]).toContain("doesn't match any action");
  });

  it("reports yaml syntax errors", () => {
    expect(parseSheetText("kind: [unclosed").errors[0]).toMatch(/could not read file/);
  });
});
