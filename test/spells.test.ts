import { describe, expect, it } from "vitest";
import { buildHomebrewSpell, buildSpellcastingEntry, entryName, fillPreparedSlots, focusPool, placeSpell } from "../src/ts/build/spellData";
import { parseSheetText } from "../src/ts/parse";
import type { HomebrewSpellItem, SpellcastingEntry } from "../src/ts/schema";

function homebrew(fields: string): HomebrewSpellItem {
  const result = parseSheetText(`schemaVersion: 1\nkind: item\norigin: homebrew\ntype: spell\n${fields}`);
  expect(result.errors).toEqual([]);
  return result.items[0] as HomebrewSpellItem;
}

function entry(fields: Partial<SpellcastingEntry>): SpellcastingEntry {
  return { tradition: "arcane", type: "innate", ability: "cha", dc: 20, spells: {}, ...fields } as SpellcastingEntry;
}

const compendiumSpell = (name: string, rank: number, traits: string[] = []) => ({ name, type: "spell", system: { level: { value: rank }, traits: { value: traits } } });

describe("buildSpellcastingEntry", () => {
  it("fills tradition, type, dc and a default attack", () => {
    const data = buildSpellcastingEntry(entry({ tradition: "occult", type: "spontaneous", dc: 22, slots: { rank1: 3, rank2: 1 } }), "abc");
    expect(data._id).toBe("abc");
    expect(data.name).toBe("Occult Spontaneous Spells");
    expect(data.system.prepared.value).toBe("spontaneous");
    expect(data.system.spelldc).toEqual({ value: 12, dc: 22 });
    expect(data.system.slots.slot1).toMatchObject({ max: 3, value: 3 });
    expect(data.system.slots.slot2).toMatchObject({ max: 1, value: 1 });
  });

  it("keeps an explicit name and attack", () => {
    const value = entry({ name: "Witch Hexes", attack: 14 });
    expect(entryName(value)).toBe("Witch Hexes");
    expect(buildSpellcastingEntry(value, "x").system.spelldc.value).toBe(14);
  });
});

describe("buildHomebrewSpell", () => {
  it("builds damage, heightening and a basic save", () => {
    const data = buildHomebrewSpell(
      homebrew(`name: Border Ward
rank: 2
traditions: [primal]
traits: [Earth]
range: 30
area: { type: burst, value: 10 }
defense: { save: reflex, basic: true }
damage: [{ formula: 2d6, type: Bludgeoning }, { formula: 1d4, type: fire, category: persistent }]
heightening: { every: 2, damage: [1d6] }
description: Stones erupt.`),
    ) as any;
    const { system } = data;
    expect(system.level.value).toBe(2);
    expect(system.traits).toEqual({ value: ["earth"], rarity: "common", traditions: ["primal"] });
    expect(system.range.value).toBe("30 feet");
    expect(system.time.value).toBe("2");
    expect(system.defense).toEqual({ save: { statistic: "reflex", basic: true } });
    const ids = Object.keys(system.damage);
    expect(Object.values(system.damage)).toEqual([
      { formula: "2d6", kinds: ["damage"], type: "bludgeoning", category: null, materials: [] },
      { formula: "1d4", kinds: ["damage"], type: "fire", category: "persistent", materials: [] },
    ]);
    expect(system.heightening).toEqual({ type: "interval", interval: 2, damage: { [ids[0]]: "1d6" } });
    expect(system.description.value).toBe("<p>Stones erupt.</p>");
  });

  it("marks spell attacks, cantrips and focus spells in traits", () => {
    const data = buildHomebrewSpell(homebrew("name: Spark\ncantrip: true\nfocus: true\ndefense: { save: ac }")) as any;
    expect(data.system.traits.value).toEqual(["cantrip", "focus", "attack"]);
    expect(data.system.defense).toEqual({ passive: { statistic: "ac" } });
    expect(data.system.heightening).toBeUndefined();
  });

  it("lays out reaction spells with their trigger", () => {
    const data = buildHomebrewSpell(homebrew("name: Snap\nactions: reaction\ntrigger: You are hit.\ndescription: Gain resistance.")) as any;
    expect(data.system.time.value).toBe("reaction");
    expect(data.system.description.value).toContain("<strong>Trigger</strong> You are hit.");
  });
});

describe("placeSpell", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  it("heightens innate spells listed above their rank and sets uses", () => {
    const placed = placeSpell(compendiumSpell("Fear", 1), entry({}), "entry", "rank3", 2, warn);
    expect(placed.slot).toBe(3);
    expect(placed.data.system.location).toEqual({ value: "entry", heightenedLevel: 3, uses: { value: 2, max: 2 } });
    expect(placed.data._id).toHaveLength(16);
  });

  it("names at will and constant spells like pf2e bestiaries", () => {
    expect(placeSpell(compendiumSpell("Translocate", 5), entry({}), "e", "rank5", "at-will", warn).data.name).toBe("Translocate (At Will)");
    expect(placeSpell(compendiumSpell("Tongues", 5), entry({}), "e", "rank5", "constant", warn).data.name).toBe("Tongues (Constant)");
  });

  it("lets prepared slots do the heightening", () => {
    const placed = placeSpell(compendiumSpell("Fear", 1), entry({ type: "prepared" }), "e", "rank3", undefined, warn);
    expect(placed.data.system.location).toEqual({ value: "e" });
  });

  it("fixes spells listed at the wrong rank with a warning", () => {
    warnings.length = 0;
    expect(placeSpell(compendiumSpell("Fireball", 3), entry({}), "e", "rank1", undefined, warn).slot).toBe(3);
    expect(placeSpell(compendiumSpell("Daze", 1, ["cantrip"]), entry({}), "e", "rank2", undefined, warn).slot).toBe(0);
    expect(placeSpell(compendiumSpell("Fear", 1), entry({}), "e", "cantrips", undefined, warn).slot).toBe(1);
    expect(warnings).toHaveLength(3);
  });

  it("doesn't touch the source data", () => {
    const source = compendiumSpell("Fear", 1);
    placeSpell(source, entry({}), "e", "rank1", "at-will", warn);
    expect(source.name).toBe("Fear");
    expect((source.system as any).location).toBeUndefined();
  });
});

describe("fillPreparedSlots", () => {
  it("prepares only the spells that were placed", () => {
    const prepared = entry({ type: "prepared", slots: { rank2: 3 } });
    const data = buildSpellcastingEntry(prepared, "e");
    const placed = [
      placeSpell(compendiumSpell("Daze", 1, ["cantrip"]), prepared, "e", "cantrips", undefined, () => {}),
      placeSpell(compendiumSpell("Fear", 1), prepared, "e", "rank1", undefined, () => {}),
      placeSpell(compendiumSpell("Fear", 1), prepared, "e", "rank1", undefined, () => {}),
      placeSpell(compendiumSpell("Blur", 2), prepared, "e", "rank2", undefined, () => {}),
    ];
    fillPreparedSlots(data, prepared, placed);
    expect(data.system.slots.slot0).toMatchObject({ max: 1, value: 1 });
    expect(data.system.slots.slot1.prepared.map((slot) => slot.id)).toEqual([placed[1].data._id, placed[2].data._id]);
    expect(data.system.slots.slot1).toMatchObject({ max: 2, value: 2 });
    expect(data.system.slots.slot2).toMatchObject({ max: 3, value: 3 });
    expect(data.system.slots.slot3).toMatchObject({ max: 0, prepared: [] });
  });

  it("leaves other casting types alone", () => {
    const innate = entry({});
    const data = buildSpellcastingEntry(innate, "e");
    fillPreparedSlots(data, innate, [placeSpell(compendiumSpell("Fear", 1), innate, "e", "rank1", undefined, () => {})]);
    expect(data.system.slots.slot1.prepared).toEqual([]);
  });
});

describe("focusPool", () => {
  it("sums focus entries and caps at 3", () => {
    expect(focusPool([entry({ type: "focus", focusPoints: 2 }), entry({ type: "focus" })])).toBe(3);
    expect(focusPool([entry({ type: "focus" }), entry({})])).toBe(1);
    expect(focusPool([entry({})])).toBe(0);
  });
});
