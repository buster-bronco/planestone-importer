import { describe, expect, it } from "vitest";
import { applyInventory, buildHomebrewGear, coins } from "../src/ts/build/gearData";
import { parseSheetText } from "../src/ts/parse";
import type { HomebrewGearItem } from "../src/ts/schema";

function gear(fields: string): HomebrewGearItem {
  const result = parseSheetText(`schemaVersion: 1\nkind: item\norigin: homebrew\n${fields}`);
  expect(result.errors).toEqual([]);
  return result.items[0] as HomebrewGearItem;
}

const actor = (items: string) => `
schemaVersion: 1
kind: actor
meta: { name: Carrier, level: 1 }
core:
  abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
  perception: { mod: 0 }
  ac: 10
  saves: { fortitude: 0, reflex: 0, will: 0 }
  hp: { value: 5 }
  speed: { value: 25 }
items:
${items}`;

describe("coins", () => {
  it("splits fractional gp and keeps explicit coins", () => {
    expect(coins({ gp: 2.35 })).toEqual({ gp: 2, sp: 3, cp: 5 });
    expect(coins({ gp: 0 })).toEqual({});
    expect(coins({ pp: 1, sp: 4 })).toEqual({ pp: 1, sp: 4 });
  });
});

describe("buildHomebrewGear", () => {
  it("builds equipment with a default usage and light bulk", () => {
    const data = buildHomebrewGear(gear("type: equipment\nname: Grappling Hook\nprice: 1\ntraits: [Tool]")) as any;
    expect(data.type).toBe("equipment");
    expect(data.system).toMatchObject({
      slug: "grappling-hook",
      level: { value: 0 },
      traits: { value: ["tool"], rarity: "common" },
      quantity: 1,
      price: { value: { gp: 1 } },
      bulk: { value: 0.1 },
      usage: { value: "held-in-one-hand" },
    });
  });

  it("builds consumables with a category, uses and the consumable trait", () => {
    const data = buildHomebrewGear(gear("type: consumable\nname: Tonic\ncategory: potion\nuses: 2\nbulk: '-'")) as any;
    expect(data.system.category).toBe("potion");
    expect(data.system.uses).toEqual({ value: 2, max: 2, autoDestroy: true });
    expect(data.system.traits.value).toEqual(["consumable"]);
    expect(data.system.bulk.value).toBe(0);
  });

  it("builds treasure without usage and backpacks with capacity", () => {
    const treasure = buildHomebrewGear(gear("type: treasure\nname: Ruby\nprice: { gp: 50 }")) as any;
    expect(treasure.system.usage).toBeUndefined();
    expect(treasure.system.bulk.value).toBe(0);
    const pack = buildHomebrewGear(gear("type: backpack\nname: Satchel\ncapacity: 2\nignored: 1\nbulk: 1")) as any;
    expect(pack.system.bulk).toEqual({ value: 1, heldOrStowed: 1, capacity: 2, ignored: 1 });
    expect(pack.system.usage.value).toBe("worn");
  });
});

describe("applyInventory", () => {
  const item = (type: string, usage?: string, traits: string[] = []) => ({
    name: "Thing",
    type,
    system: { quantity: 1, equipped: { carryType: "worn" }, traits: { value: traits }, ...(usage ? { usage: { value: usage } } : {}) },
  });

  it("sets quantity", () => {
    const data = item("consumable", "held-in-one-hand");
    applyInventory(data, { quantity: 4 }, () => {});
    expect(data.system.quantity).toBe(4);
  });

  it("picks held or worn from usage for equipped: true", () => {
    const sword = item("weapon", "held-in-two-hands");
    applyInventory(sword, { equipped: true }, () => {});
    expect(sword.system.equipped).toEqual({ carryType: "held", inSlot: false, handsHeld: 2 });

    const armor = item("armor");
    applyInventory(armor, { equipped: true }, () => {});
    expect(armor.system.equipped).toEqual({ carryType: "worn", inSlot: true, handsHeld: 0 });

    const shield = item("shield");
    applyInventory(shield, { equipped: true }, () => {});
    expect(shield.system.equipped).toMatchObject({ carryType: "held", handsHeld: 1 });
  });

  it("warns when equipped: true has nowhere to go", () => {
    const warnings: string[] = [];
    const gem = item("treasure");
    applyInventory(gem, { equipped: true }, (message) => warnings.push(message));
    expect(gem.system.equipped).toEqual({ carryType: "worn", inSlot: false, handsHeld: 0 });
    expect(warnings[0]).toContain("left carried");
  });

  it("honours explicit carry types and hands", () => {
    const staff = item("weapon", "held-in-one-plus-hands");
    applyInventory(staff, { equipped: "held", hands: 2 }, () => {});
    expect(staff.system.equipped).toMatchObject({ carryType: "held", handsHeld: 2 });

    const amulet = item("equipment", "wornamulet");
    applyInventory(amulet, { equipped: "worn" }, () => {});
    expect(amulet.system.equipped).toMatchObject({ carryType: "worn", inSlot: true });

    const rope = item("equipment", "held-in-two-hands");
    applyInventory(rope, { equipped: "dropped" }, () => {});
    expect(rope.system.equipped.carryType).toBe("dropped");
  });

  it("invests only items with the invested trait", () => {
    const warnings: string[] = [];
    const ring = item("equipment", "worn", ["invested", "magical"]);
    applyInventory(ring, { equipped: "worn", invested: true }, () => {});
    expect(ring.system.equipped).toMatchObject({ inSlot: true, invested: true });

    const rope = item("equipment", "held-in-one-hand");
    applyInventory(rope, { invested: true }, (message) => warnings.push(message));
    expect((rope.system.equipped as any).invested).toBeUndefined();
    expect(warnings[0]).toContain("invested trait");
  });
});

describe("inventory parsing", () => {
  it("accepts inventory fields on equipment, weapons and homebrew gear", () => {
    const result = parseSheetText(
      actor(`  - { origin: compendiumRef, refType: equipment, lookup: { name: Rope }, quantity: 2, equipped: held, hands: 2 }
  - { origin: equippedWeapon, lookup: { name: Dagger }, proficiency: trained, quantity: 3, equipped: true }
  - { origin: homebrew, type: treasure, name: Coin Purse, quantity: 1, equipped: false }`),
    );
    expect(result.errors).toEqual([]);
    expect(result.actors[0].items[0]).toMatchObject({ quantity: 2, equipped: "held", hands: 2 });
  });

  it("rejects inventory fields where they don't apply", () => {
    const text = parseSheetText(
      actor(`  - { origin: compendiumRef, refType: action, lookup: { name: Grab }, quantity: 2 }
  - { origin: equippedWeapon, lookup: { name: Dagger }, proficiency: trained, keepInInventory: false, equipped: held }
  - { origin: compendiumRef, refType: equipment, lookup: { name: Rope }, equipped: worn, hands: 1 }
  - { origin: homebrew, type: equipment, name: Box, uses: 2, capacity: 3 }`),
    ).errors.join("\n");
    expect(text).toContain("quantity only applies to equipment");
    expect(text).toContain("equipped needs keepInInventory: true");
    expect(text).toContain("hands needs equipped: held or true");
    expect(text).toContain("uses only applies to consumables");
    expect(text).toContain("capacity only applies to backpacks");
  });

  it("allows quantity but not carry state on world items", () => {
    const ok = parseSheetText("schemaVersion: 1\nkind: item\norigin: compendiumRef\nrefType: equipment\nlookup: { name: Rope }\nquantity: 5");
    expect(ok.errors).toEqual([]);
    const bad = parseSheetText("schemaVersion: 1\nkind: item\norigin: homebrew\ntype: equipment\nname: Box\nequipped: true");
    expect(bad.errors[0]).toContain("world items aren't carried");
  });
});
