import { describe, expect, it } from "vitest";
import { computeStrike, dieFromDamage, type StrikeInput } from "../src/ts/build/strikeMath";

const abilities = { str: 4, dex: 2, con: 3, int: 0, wis: 2, cha: 1 };

function strike(overrides: Partial<StrikeInput>) {
  return computeStrike({ level: 4, proficiency: "trained", abilities, potency: 0, striking: 0, traits: [], die: "d8", ...overrides });
}

describe("computeStrike", () => {
  it("longsword: level + expert + str + potency, striking adds a die", () => {
    expect(strike({ proficiency: "expert", potency: 1, striking: 1, traits: ["versatile-p"] })).toEqual({ attackBonus: 13, damage: "2d8+4" });
  });

  it("finesse uses the higher of str and dex for attack, str for damage", () => {
    const nimble = { ...abilities, str: 1, dex: 4 };
    expect(strike({ level: 2, abilities: nimble, traits: ["deadly-d8", "finesse"], die: "d6" })).toEqual({ attackBonus: 8, damage: "1d6+1" });
    expect(strike({ traits: ["finesse"] }).attackBonus).toBe(10);
  });

  it("ranged uses dex and adds no str to damage", () => {
    expect(strike({ level: 1, traits: ["deadly-d10", "range-increment-60"], die: "d6" })).toEqual({ attackBonus: 5, damage: "1d6" });
  });

  it("propulsive adds half positive str, full negative str", () => {
    const traits = ["propulsive", "range-increment-50"];
    expect(strike({ traits, die: "d6", abilities: { ...abilities, str: 3 } }).damage).toBe("1d6+1");
    expect(strike({ traits, die: "d6", abilities: { ...abilities, str: -1 } }).damage).toBe("1d6-1");
  });

  it("thrown attacks roll dex but deal str damage", () => {
    expect(strike({ traits: ["agile", "thrown-10"], die: "d4" })).toEqual({ attackBonus: 8, damage: "1d4+4" });
  });

  it("overrides accept any attribute", () => {
    const caster = { ...abilities, int: 5 };
    const result = strike({ abilities: caster, die: "d4", abilityOverride: "int", damageAbilityOverride: "int" });
    expect(result).toEqual({ attackBonus: 11, damage: "1d4+5" });
    expect(strike({ abilities: caster, abilityOverride: "cha" }).damage).toBe("1d8+4");
  });

  it("zero modifier leaves no trailing sign", () => {
    expect(strike({ abilities: { ...abilities, str: 0 } }).damage).toBe("1d8");
  });
});

describe("dieFromDamage", () => {
  it("reads the die size", () => {
    expect(dieFromDamage("2d8+4")).toBe("d8");
    expect(dieFromDamage("1d12")).toBe("d12");
    expect(dieFromDamage("5")).toBeNull();
  });
});
