import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVehicleSystem } from "../src/ts/build/vehicleData";
import { parseSheetText } from "../src/ts/parse";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");

const minimal = (extra = "") => `
schemaVersion: 1
kind: vehicle
meta: { name: Raft, level: 0 }
core:
  ac: 10
  saves: { fortitude: 4 }
  hp: { value: 10 }
${extra}`;

describe("vehicle sheets", () => {
  it("accepts the vehicle example", () => {
    const result = parseSheetText(example("vehicle.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors).toEqual([]);
    expect(result.vehicles).toHaveLength(1);
    const [vehicle] = result.vehicles;
    expect(vehicle.meta.actorType).toBe("vehicle");
    expect(vehicle.core.passengers).toBe("6");
    expect(vehicle.items).toHaveLength(2);
  });

  it("splits a batch into npcs and vehicles", () => {
    const result = parseSheetText(example("batch.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.actors.map((a) => a.meta.name)).toEqual(["Armada Deckhand", "Armada Hexer"]);
    expect(result.vehicles.map((v) => v.meta.name)).toEqual(["Armada Longboat"]);
  });

  it("reads kind: actor with actorType: vehicle as a vehicle", () => {
    const text = minimal().replace("kind: vehicle", "kind: actor").replace("level: 0", "level: 0, actorType: vehicle");
    const result = parseSheetText(text);
    expect(result.errors).toEqual([]);
    expect(result.vehicles).toHaveLength(1);
  });

  it("fills pf2e defaults", () => {
    const [vehicle] = parseSheetText(minimal()).vehicles;
    const { system, warnings } = buildVehicleSystem(vehicle) as any;
    expect(warnings).toEqual([]);
    expect(system.traits).toEqual({ value: [], rarity: "common", size: { value: "lg" } });
    expect(system.attributes.immunities).toEqual([{ type: "object-immunities", exceptions: [] }]);
    expect(system.attributes.emitsSound).toBe("encounter");
    expect(system.attributes.collisionDC).toBeUndefined();
    expect(system.details.space).toEqual({ long: 0, wide: 0, high: 0 });
  });

  it("builds vehicle system data", () => {
    const [vehicle] = parseSheetText(example("vehicle.yaml")).vehicles;
    const { system, warnings } = buildVehicleSystem(vehicle, { vehicleTraits: new Set(["magical"]) }) as any;
    expect(warnings).toEqual([]);
    expect(system.attributes).toMatchObject({
      ac: { value: 17 },
      hardness: 5,
      hp: { value: 50, max: 50, details: "BT 25" },
      collisionDC: { value: 19 },
      collisionDamage: { value: "2d10" },
      weaknesses: [{ type: "fire", value: 5 }],
    });
    expect(system.saves).toEqual({ fortitude: { value: 9, saveDetail: "" } });
    expect(system.details).toMatchObject({
      level: { value: 3 },
      price: 120,
      crew: "1 pilot, 2 crew",
      passengers: "6",
      speed: "swim 30 feet (rowed, wind)",
      description: expect.stringMatching(/^<p>A narrow/),
    });
    expect(system.traits).toEqual({ value: ["magical"], rarity: "uncommon", size: { value: "huge" } });
  });

  it("turns a numeric speed into feet", () => {
    const [vehicle] = parseSheetText(minimal("  speed: 25")).vehicles;
    expect(vehicle.core.speed).toBe("25 feet");
  });

  it("drops unknown vehicle traits", () => {
    const [vehicle] = parseSheetText(minimal("  traits: [clockwork, humanoid]")).vehicles;
    const { system, warnings } = buildVehicleSystem(vehicle, { vehicleTraits: new Set(["clockwork"]) }) as any;
    expect(system.traits.value).toEqual(["clockwork"]);
    expect(warnings[0]).toContain('unknown vehicle trait "humanoid"');
  });

  it("rejects npc-only saves and strikes", () => {
    const saves = parseSheetText(minimal().replace("{ fortitude: 4 }", "{ fortitude: 4, reflex: 2 }"));
    expect(saves.errors.join("\n")).toMatch(/core\.saves/);

    const strikes = parseSheetText(
      minimal(`items:
  - { origin: equippedWeapon, lookup: { name: Ballista }, proficiency: trained }
  - { origin: homebrew, type: melee, name: Ram, attackBonus: 10, damageRolls: [{ damage: 2d10, damageType: bludgeoning }] }
  - { origin: compendiumRef, refType: spell, lookup: { name: Daze } }`),
    );
    expect(strikes.errors).toHaveLength(3);
    expect(strikes.errors[0]).toContain("can't hold strikes");
    expect(strikes.errors[2]).toContain("can't hold spells");
  });
});
