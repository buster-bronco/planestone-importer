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
    expect(actor.items).toHaveLength(11);
    const bow = actor.items[2];
    expect(bow.origin === "equippedWeapon" && bow.keepInInventory).toBe(false);
  });

  it("accepts the batch example and swaps spell list ids for entries", () => {
    const result = parseSheetText(example("batch.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors.map((a) => a.meta.name)).toEqual(["Armada Deckhand", "Armada Hexer"]);
    expect(result.spellLists).toHaveLength(1);
    const [entry] = result.actors[1].spellcasting as any[];
    expect(entry).toMatchObject({ tradition: "occult", type: "prepared", dc: 20 });
    expect(entry.id).toBeUndefined();
    expect(entry.spells.cantrips.map((ref: any) => ref.item.lookup.name)).toEqual(["Daze", "Shield"]);
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
    expect(text).toContain("spontaneous spellcasting needs slots");
  });

  it("accepts json", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      kind: "spellList",
      id: "x",
      tradition: "arcane",
      type: "innate",
      dc: 19,
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

  describe("mixed actors and items", () => {
    const hazard = "  - meta: { name: Raft, actorType: hazard, level: 0 }\n    core: { stealth: { mod: 1 } }\n";
    const passive = "  - { origin: homebrew, type: passive, name: Loose }\n";

    it("rejects world items in an actorBatch", () => {
      const result = parseSheetText(`schemaVersion: 1\nkind: actorBatch\nactors:\n${hazard}items:\n${passive}`);
      expect(result.hazards).toEqual([]);
      expect(result.errors).toEqual([`(root): unknown key(s) "items"; kind: actorBatch can't hold that list, put it in its own file`]);
    });

    it("rejects actors in an itemBatch", () => {
      const result = parseSheetText(`schemaVersion: 1\nkind: itemBatch\nitems:\n${passive}actors:\n${hazard}`);
      expect(result.items).toEqual([]);
      expect(result.errors[0]).toContain(`"actors"; kind: itemBatch can't hold that list`);
    });

    it("rejects actors next to a single item", () => {
      const result = parseSheetText(`schemaVersion: 1\nkind: item\norigin: homebrew\ntype: passive\nname: Loose\nactors:\n${hazard}`);
      expect(result.items).toEqual([]);
      expect(result.errors[0]).toContain("kind: item can't hold that list");
    });

    it("rejects other unknown top-level keys without the hint", () => {
      const result = parseSheetText(example("vehicle.yaml").replace("kind: vehicle", "kind: vehicle\nfolder: Ships"));
      expect(result.errors).toEqual([`(root): unknown key(s) "folder"`]);
    });
  });

  describe("spellcasting", () => {
    const actor = (extra: string) => `
schemaVersion: 1
kind: actor
meta: { name: Caster, level: 3 }
core:
  abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 3 }
  perception: { mod: 5 }
  ac: 17
  saves: { fortitude: 5, reflex: 5, will: 8 }
  hp: { value: 30 }
  speed: { value: 25 }
${extra}`;
    const brine = "{ origin: homebrew, type: spell, name: Brine, damage: [{ formula: 2d6, type: bludgeoning }] }";

    it("reads names, compendium refs and homebrew spells", () => {
      const result = parseSheetText(
        actor(`spellcasting:
  tradition: occult
  type: innate
  dc: 20
  spells:
    cantrips: [Daze]
    rank1: [{ name: Fear, uses: 2 }, { origin: compendiumRef, lookup: { name: Charm } }, ${brine}]
    rank2: [{ name: Invisibility, uses: at-will }]`),
      );
      expect(result.errors).toEqual([]);
      const [entry] = result.actors[0].spellcasting as any[];
      expect(entry.ability).toBe("cha");
      expect(entry.spells.rank1.map((ref: any) => [ref.item.origin, ref.item.refType, ref.uses])).toEqual([
        ["compendiumRef", "spell", 2],
        ["compendiumRef", "spell", undefined],
        ["homebrew", undefined, undefined],
      ]);
      expect(entry.spells.rank2[0].uses).toBe("at-will");
    });

    it("rejects an unknown spell list id", () => {
      expect(parseSheetText(actor("spellcasting: nope")).errors[0]).toContain('unknown spell list "nope"');
    });

    it("rejects cross-field mistakes", () => {
      const text = parseSheetText(
        actor(`spellcasting:
  - { tradition: arcane, type: innate, dc: 18, slots: { rank1: 2 }, focusPoints: 1 }
  - tradition: arcane
    type: prepared
    dc: 18
    spells:
      rank1: [{ name: Fear, uses: 1 }, { origin: homebrew, type: spell, name: Spark, cantrip: true }]
      rank2: [{ origin: compendiumRef, refType: action, lookup: { name: Grab } }]`),
      ).errors.join("\n");
      expect(text).toContain("innate spellcasting has no slots");
      expect(text).toContain("focusPoints only applies");
      expect(text).toContain("uses only applies to innate");
      expect(text).toContain('"Spark" is a cantrip');
      expect(text).toContain("spell lists take spell names");
    });

    it("keeps spells out of items and patches", () => {
      expect(parseSheetText(actor(`items: [${brine}]`)).errors[0]).toContain("spells go under spellcasting");
      const patch = parseSheetText(`schemaVersion: 1
kind: actorPatch
items:
  add: [${brine}]`);
      expect(patch.errors[0]).toContain("patching spells isn't supported");
    });

    it("needs a trigger on reaction spells", () => {
      const result = parseSheetText(`schemaVersion: 1
kind: item
origin: homebrew
type: spell
name: Snap
actions: reaction`);
      expect(result.errors[0]).toContain("trigger is required");
    });
  });
});
