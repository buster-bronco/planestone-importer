import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildActorSystem } from "../src/ts/build/actorData";
import { applyInventory, buildHomebrewGear } from "../src/ts/build/gearData";
import { buildHomebrewAction, buildHomebrewStrike } from "../src/ts/build/homebrew";
import { isHomebrewGear } from "../src/ts/schema";
import { exportActor, exportItem, exportYaml } from "../src/ts/export";
import { parseSheetText } from "../src/ts/parse";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");
const [warden] = parseSheetText(example("actor.yaml")).actors;

const flag = (weapon: string, extra: object) => ({
  "planestone-importer": { strike: { weapon, abilityOverride: null, damageAbilityOverride: null, ...extra } },
});

// actor.yaml after import, as actor.toObject() returns it
function wardenSource() {
  const { system, loreItems } = buildActorSystem(warden);
  const homebrew = warden.items
    .filter((item) => item.origin === "homebrew")
    .map((item: any) => {
      if (!isHomebrewGear(item)) return item.type === "melee" ? buildHomebrewStrike(item, () => {}) : buildHomebrewAction(item);
      const data = buildHomebrewGear(item);
      applyInventory(data, item, () => {});
      return data;
    });
  return JSON.parse(
    JSON.stringify({
      name: warden.meta.name,
      flags: { "planestone-importer": { freeArchetype: false } },
      system,
      items: [
        ...loreItems,
        { name: "Reactive Strike", type: "action", system: {}, _stats: { compendiumSource: "Compendium.pf2e.actionspf2e.Item.abc" } },
        {
          name: "Longsword",
          type: "weapon",
          system: { quantity: 1, equipped: { carryType: "held", handsHeld: 1 } },
          _stats: { compendiumSource: "Compendium.pf2e.equipment-srd.Item.def" },
        },
        {
          name: "Healing Potion (Minor)",
          type: "consumable",
          system: { quantity: 2, equipped: { carryType: "worn" } },
          _stats: { compendiumSource: "Compendium.pf2e.equipment-srd.Item.ghi" },
        },
        { name: "Longsword", type: "melee", system: {}, flags: flag("Longsword", { proficiency: "expert", potency: 1, striking: 1, die: "d8" }) },
        { name: "Shortbow", type: "melee", system: {}, flags: flag("Shortbow", { proficiency: "trained", potency: 0, striking: 0, die: "d6" }) },
        { name: "Bless", type: "spell", system: {} },
        ...homebrew,
      ],
    }),
  );
}

describe("exportActor", () => {
  const text = exportYaml(exportActor(wardenSource()));
  const parsed = parseSheetText(text);

  it("produces a sheet the importer accepts", () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.actors).toHaveLength(1);
  });

  it("rebuilds the same actor data", () => {
    const { meta } = parsed.actors[0];
    expect(meta).toMatchObject({ name: warden.meta.name, level: 4, source: "Dev" });
    const again = buildActorSystem(parsed.actors[0]);
    const original = buildActorSystem(warden);
    expect(again.system).toEqual(original.system);
    expect(again.loreItems).toEqual(original.loreItems);
  });

  it("regroups weapon strikes and keeps homebrew items", () => {
    const items = parsed.actors[0].items;
    expect(items.map((item) => (item.origin === "homebrew" ? item.name : item.lookup.name))).toEqual([
      "Reactive Strike",
      "Longsword",
      "Healing Potion (Minor)",
      "Shield Bash",
      "Knockdown Crash",
      "Hold the Line",
      "Warden's Seal",
      "Border Flare",
      "Shortbow",
    ]);
    expect(items[0]).toMatchObject({ origin: "compendiumRef", lookup: { pack: "actionspf2e" } });
    expect(items[1]).toMatchObject({ origin: "equippedWeapon", proficiency: "expert", runes: { potency: 1, striking: 1 }, keepInInventory: true });
    expect(items[8]).toMatchObject({ origin: "equippedWeapon", keepInInventory: false });
  });

  it("keeps quantity, carry state and homebrew gear", () => {
    const items = parsed.actors[0].items as any[];
    expect(items[1]).toMatchObject({ equipped: "held", hands: 1 });
    expect(items[1].quantity).toBeUndefined();
    expect(items[2]).toMatchObject({ origin: "compendiumRef", refType: "equipment", quantity: 2 });
    expect(items[2].equipped).toBeUndefined();
    const original = warden.items.filter(isHomebrewGear);
    const again = items.filter(isHomebrewGear);
    expect(again.map((item) => buildHomebrewGear(item))).toEqual(original.map((item) => buildHomebrewGear(item)));
    expect(again[1]).toMatchObject({ type: "consumable", quantity: 3, bulk: 0.1, price: { gp: 6 } });
  });

  it("splits reaction triggers back out", () => {
    const hold = parsed.actors[0].items.find((item) => item.origin === "homebrew" && item.name === "Hold the Line");
    expect(hold).toMatchObject({ actionType: "reaction", trigger: "An ally within 10 feet is hit by a melee attack." });
    expect((hold as any).description.startsWith("<p>The warden steps in")).toBe(true);
  });

  it("notes items it can't express", () => {
    expect(text).toMatch(/^# not exported: Bless \(spell/);
  });
});

describe("exportItem", () => {
  it("exports a homebrew action as kind: item", () => {
    const [item] = parseSheetText(example("items.yaml")).items;
    const parsed = parseSheetText(exportYaml(exportItem(buildHomebrewAction(item as any) as any)));
    expect(parsed.errors).toEqual([]);
    expect(buildHomebrewAction(parsed.items[0] as any)).toEqual(buildHomebrewAction(item as any));
  });

  it("uses the compendium name and pack for compendium items", () => {
    const source = { name: "Warden Blade", type: "weapon", system: {}, _stats: { compendiumSource: "Compendium.pf2e.equipment-srd.Item.x" } };
    const { sheet } = exportItem(source, () => "Longsword");
    expect(sheet).toMatchObject({ kind: "item", origin: "compendiumRef", refType: "equipment", lookup: { name: "Longsword", pack: "equipment-srd" } });
  });
});
