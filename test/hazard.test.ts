import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHazardSystem } from "../src/ts/build/hazardData";
import { parseSheetText } from "../src/ts/parse";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");

const minimal = (extra = "") => `
schemaVersion: 1
kind: hazard
meta: { name: Slick Deck, level: 0 }
core:
  stealth: { mod: 4 }
${extra}`;

describe("hazard sheets", () => {
  it("accepts the hazard example", () => {
    const result = parseSheetText(example("hazard.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.actors).toEqual([]);
    expect(result.hazards).toHaveLength(1);
    expect(result.hazards[0].items).toHaveLength(2);
  });

  it("splits a batch into npcs, vehicles and hazards", () => {
    const result = parseSheetText(example("batch.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors.map((a) => a.meta.name)).toEqual(["Armada Deckhand", "Armada Hexer"]);
    expect(result.vehicles.map((v) => v.meta.name)).toEqual(["Armada Longboat"]);
    expect(result.hazards.map((h) => h.meta.name)).toEqual(["Loose Rigging"]);
  });

  it("reads kind: actor with actorType: hazard as a hazard", () => {
    const text = minimal().replace("kind: hazard", "kind: actor").replace("level: 0", "level: 0, actorType: hazard");
    const result = parseSheetText(text);
    expect(result.errors).toEqual([]);
    expect(result.hazards).toHaveLength(1);
  });

  it("builds a simple hazard with no health", () => {
    const [hazard] = parseSheetText(minimal()).hazards;
    const { system, warnings } = buildHazardSystem(hazard) as any;
    expect(warnings).toEqual([]);
    expect(system.attributes.hasHealth).toBe(false);
    expect(system.attributes.ac.value).toBe(0);
    expect(system.attributes.stealth).toEqual({ value: 4, details: "" });
    expect(system.details.isComplex).toBe(false);
    expect(system.saves.will).toEqual({ value: null, saveDetail: "" });
    expect(system.traits.size).toEqual({ value: "med" });
  });

  it("builds a complex hazard", () => {
    const [hazard] = parseSheetText(example("hazard.yaml")).hazards;
    const { system, warnings } = buildHazardSystem(hazard, { hazardTraits: new Set(["mechanical", "trap"]) }) as any;
    expect(warnings).toEqual([]);
    expect(system.attributes).toMatchObject({
      ac: { value: 21 },
      hardness: 8,
      hasHealth: true,
      hp: { value: 32, max: 32, details: "to break the valve open for good" },
      stealth: { value: 12, details: "<p>(trained) to notice the loose sea cock</p>" },
    });
    expect(system.saves.fortitude.value).toBe(13);
    expect(system.saves.reflex.value).toBe(9);
    expect(system.saves.will.value).toBeNull();
    expect(system.details.isComplex).toBe(true);
    expect(system.details.routine).toMatch(/^<p>\(1 action\) Water rises/);
    expect(system.details.disable).toMatch(/^<p>@Check\[thievery/);
    expect(system.traits.value).toEqual(["mechanical", "trap"]);
  });

  it("drops unknown hazard traits", () => {
    const [hazard] = parseSheetText(minimal("  traits: [haunt, humanoid]")).hazards;
    const { system, warnings } = buildHazardSystem(hazard, { hazardTraits: new Set(["haunt"]) }) as any;
    expect(system.traits.value).toEqual(["haunt"]);
    expect(warnings[0]).toContain('unknown hazard trait "humanoid"');
  });

  it("warns about a routine on a simple hazard", () => {
    const { errors, warnings } = parseSheetText(minimal('  routine: "(1 action) It drips."'));
    expect(errors).toEqual([]);
    expect(warnings[0]).toContain("complex is false");
  });

  it("checks strike attack effects like an npc", () => {
    const strike = (effect: string) =>
      minimal(`items:
  - { origin: homebrew, type: melee, name: Jet, attackBonus: 8, damageRolls: [{ damage: 1d6, damageType: bludgeoning }], attackEffects: [${effect}] }`);
    expect(parseSheetText(strike("push")).warnings[0]).toContain("label only");
    expect(parseSheetText(strike("drown")).errors[0]).toContain("doesn't match any action");
  });

  it("rejects weapon strikes, spells and unknown saves", () => {
    const result = parseSheetText(
      minimal(`items:
  - { origin: equippedWeapon, lookup: { name: Crossbow }, proficiency: trained }
  - { origin: compendiumRef, refType: spell, lookup: { name: Daze } }`),
    );
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("can't use equippedWeapon");
    expect(result.errors[1]).toContain("can't hold spells");

    expect(parseSheetText(minimal("  saves: { perception: 3 }")).errors.join("\n")).toMatch(/core\.saves/);
    expect(parseSheetText("schemaVersion: 1\nkind: hazard\nmeta: { name: X, level: 1 }\ncore: {}\n").errors.join("\n")).toMatch(/core\.stealth/);
  });
});
