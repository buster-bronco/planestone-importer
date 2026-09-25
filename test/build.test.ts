import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildActorSystem, normalizeSize, parseSense } from "../src/ts/build/actorData";
import { buildHomebrewAction, buildHomebrewStrike } from "../src/ts/build/homebrew";
import { parseSheetText } from "../src/ts/parse";

const [actor] = parseSheetText(readFileSync(new URL("../examples/actor.yaml", import.meta.url), "utf-8")).actors;

describe("normalizers", () => {
  it("maps sizes to pf2e slugs", () => {
    expect(normalizeSize("Medium")).toBe("med");
    expect(normalizeSize("gargantuan")).toBe("grg");
    expect(normalizeSize("colossal")).toBeNull();
  });

  it("parses senses", () => {
    expect(parseSense("darkvision")).toEqual({ type: "darkvision" });
    expect(parseSense("low-light vision")).toEqual({ type: "low-light-vision" });
    expect(parseSense("scent (imprecise) 30 feet")).toEqual({ type: "scent", acuity: "imprecise", range: 30 });
    expect(parseSense("tremorsense (vague) 60")).toEqual({ type: "tremorsense", acuity: "vague", range: 60 });
  });
});

describe("buildActorSystem", () => {
  const vocab = {
    creatureTraits: new Set(["humanoid", "human"]),
    languages: new Set(["common", "draconic"]),
    senses: new Set(["low-light-vision", "scent", "darkvision"]),
  };
  const { system, loreItems, warnings } = buildActorSystem(actor, vocab) as any;

  it("maps core stats", () => {
    expect(system.details.level.value).toBe(4);
    expect(system.attributes.ac.value).toBe(21);
    expect(system.attributes.hp).toMatchObject({ value: 60, max: 60 });
    expect(system.saves.fortitude.value).toBe(13);
    expect(system.abilities.str).toEqual({ mod: 4 });
    expect(system.traits).toEqual({ value: ["humanoid", "human"], rarity: "common", size: { value: "med" } });
    expect(system.attributes.speed.otherSpeeds).toEqual([{ type: "climb", value: 15 }]);
    expect(system.skills).toEqual({ athletics: { base: 12 }, intimidation: { base: 9 }, survival: { base: 11 } });
  });

  it("moves unknown languages into details", () => {
    expect(system.details.languages).toEqual({ value: ["common", "draconic"], details: "Dranuran Cant" });
    expect(warnings.some((w: string) => w.includes("Dranuran Cant"))).toBe(true);
  });

  it("makes lore items", () => {
    expect(loreItems).toEqual([{ name: "Dranura Politics Lore", type: "lore", system: { mod: { value: 8 } } }]);
  });
});

describe("homebrew builders", () => {
  it("builds a reaction with trigger and effect", () => {
    const reaction = actor.items.find((i) => i.origin === "homebrew" && i.name === "Hold the Line")!;
    const data = buildHomebrewAction(reaction as any);
    expect(data.system.actionType.value).toBe("reaction");
    expect(data.system.actions.value).toBeNull();
    expect(data.system.category).toBe("defensive");
    expect(data.system.description.value).toMatch(/^<p><strong>Trigger<\/strong> An ally .*<hr \/><p><strong>Effect<\/strong> The warden/);
  });

  it("builds a one-action ability", () => {
    const action = actor.items.find((i) => i.origin === "homebrew" && i.name === "Knockdown Crash")!;
    const data = buildHomebrewAction(action as any);
    expect(data.system.actionType.value).toBe("action");
    expect(data.system.actions.value).toBe(1);
    expect(data.system.slug).toBe("knockdown-crash");
  });

  it("builds a strike with its flat bonus and range trait", () => {
    const warnings: string[] = [];
    const data = buildHomebrewStrike(
      { origin: "homebrew", type: "ranged", name: "Spine Volley", attackBonus: 11, damageRolls: [{ damage: "2d6", damageType: "Piercing" }], traits: [], range: 30, attackEffects: [], description: "" },
      (w) => warnings.push(w),
    );
    expect(data.system.bonus.value).toBe(11);
    expect(data.system.traits.value).toEqual(["range-increment-30"]);
    expect(Object.values(data.system.damageRolls)).toEqual([{ damage: "2d6", damageType: "piercing", category: null }]);
    expect(warnings).toEqual([]);
  });
});
