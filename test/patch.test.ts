import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildActorSystem } from "../src/ts/build/actorData";
import { buildHomebrewAction, buildHomebrewStrike } from "../src/ts/build/homebrew";
import { computeStrike } from "../src/ts/build/strikeMath";
import { buildPatchChanges } from "../src/ts/patch/changes";
import { normalizeOps, type ActorSource } from "../src/ts/patch/paths";
import { parseSheetText } from "../src/ts/parse";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf-8");
const [warden] = parseSheetText(example("actor.yaml")).actors;

const strikeFlag = (weapon: string, extra: object) => ({
  "planestone-importer": { strike: { weapon, abilityOverride: null, damageAbilityOverride: null, ...extra } },
});

// what actor.toObject() looks like for actor.yaml after import
function wardenSource(): ActorSource {
  const { system, loreItems } = buildActorSystem(warden);
  const homebrew = warden.items.filter((item) => item.origin === "homebrew");
  const built = homebrew.map((item: any, i) =>
    item.type === "melee" ? buildHomebrewStrike(item, () => {}) : { ...buildHomebrewAction(item), _id: `hb${i}` },
  );
  return JSON.parse(
    JSON.stringify({
      _id: "warden",
      name: warden.meta.name,
      system: { ...system, attributes: { ...(system as any).attributes, hp: { value: 60, max: 60, temp: 0, details: "" } } },
      items: [
        { ...loreItems[0], _id: "lore1" },
        { _id: "act1", name: "Reactive Strike", type: "action", system: { slug: "reactive-strike" } },
        { _id: "wpn1", name: "Longsword", type: "weapon", system: { runes: { potency: 1, striking: 1 } } },
        {
          _id: "stk1",
          name: "Longsword",
          type: "melee",
          system: { bonus: { value: 13 }, traits: { value: ["versatile-p"] }, damageRolls: { r1: { damage: "2d8+4", damageType: "slashing", category: null } } },
          flags: strikeFlag("Longsword", { proficiency: "expert", potency: 1, striking: 1, die: "d8" }),
        },
        {
          _id: "stk2",
          name: "Shortbow",
          type: "melee",
          system: { bonus: { value: 8 }, traits: { value: ["deadly-d10", "range-increment-60"] }, damageRolls: { r2: { damage: "1d6", damageType: "piercing", category: null } } },
          flags: strikeFlag("Shortbow", { proficiency: "trained", potency: 0, striking: 0, die: "d6" }),
        },
        ...built.map((data: any, i) => ({ _id: data._id ?? `hbs${i}`, ...data })),
      ],
    }),
  );
}

const patch = (yaml: string) => {
  const parsed = parseSheetText(`schemaVersion: 1\nkind: actorPatch\ntarget: { name: Dranura Border Warden }\n${yaml}`);
  expect(parsed.errors).toEqual([]);
  return parsed.patches[0];
};

describe("patch parsing", () => {
  it("accepts the patch example", () => {
    const result = parseSheetText(example("patch.yaml"));
    expect(result.errors).toEqual([]);
    expect(result.patches).toHaveLength(1);
  });

  it("flattens nested set objects into paths", () => {
    const ops = normalizeOps({ set: { core: { saves: { will: 3 }, "abilities.str": 5 } }, add: {}, remove: {} });
    expect(ops.errors).toEqual([]);
    expect(ops.sets.map((op) => op.path)).toEqual(["core.saves.will", "core.abilities.str"]);
  });

  it("reports unknown paths, bad values and bad targets", () => {
    const { errors } = parseSheetText(`
schemaVersion: 1
kind: actorPatch
target: { name: X, uuid: Actor.y }
set: { core.acc: 3, core.ac: high, core.size: colossal }
add: { core.ac: [1], core.skills.named: [x] }
`);
    const text = errors.join("\n");
    expect(text).toContain("a name or a uuid, not both");
    // target errors stop parsing before path checks
    const second = parseSheetText(`
schemaVersion: 1
kind: actorPatch
target: { name: X }
set: { core.acc: 3, core.ac: high, core.size: colossal }
add: { core.ac: [1], core.skills.named: [x] }
`).errors.join("\n");
    expect(second).toContain("set.core.acc: unknown path");
    expect(second).toContain("set.core.ac: Expected number");
    expect(second).toContain("set.core.size: unknown size");
    expect(second).toContain("add.core.ac: not a list");
    expect(second).toContain("use set.core.skills.named.<skill>");
  });

  it("doesn't need a target", () => {
    const result = parseSheetText("schemaVersion: 1\nkind: actorPatch\nset: { core.ac: 20 }\n");
    expect(result.errors).toEqual([]);
    expect(result.patches[0].target).toBeUndefined();
  });

  it("keeps patches out of batches", () => {
    const result = parseSheetText("schemaVersion: 1\nkind: actorBatch\npatches: [{ set: { core.ac: 20 } }]\n");
    expect(result.patches).toEqual([]);
    expect(result.errors.join("\n")).toContain("actors");
  });
});

describe("buildPatchChanges", () => {
  it("maps scalar paths to foundry paths", () => {
    const changes = buildPatchChanges(
      patch("set: { core.ac: 23, meta.level: 4, core.saves.will: 13, core.abilities.dex: 3, core.size: large, meta.source: null }"),
      wardenSource(),
    );
    expect(changes.errors).toEqual([]);
    expect(changes.actorUpdate).toMatchObject({
      "system.attributes.ac.value": 23,
      "system.details.level.value": 4,
      "system.saves.will.value": 13,
      "system.abilities.dex.mod": 3,
      "system.traits.size.value": "lg",
      "system.details.publication.title": "",
    });
    expect(changes.changes).toContain("AC: 21 → 23");
    // unchanged level makes no preview line
    expect(changes.changes.some((line) => line.startsWith("level"))).toBe(false);
  });

  it("keeps a full-health npc at full health", () => {
    const source = wardenSource();
    expect(buildPatchChanges(patch("set: { core.hp.value: 80 }"), source).actorUpdate).toEqual({
      "system.attributes.hp.max": 80,
      "system.attributes.hp.value": 80,
    });
    source.system.attributes.hp.value = 30;
    expect(buildPatchChanges(patch("set: { core.hp.value: 20 }"), source).actorUpdate["system.attributes.hp.value"]).toBe(20);
  });

  it("merges list adds and removes by key", () => {
    const changes = buildPatchChanges(
      patch(`
add: { core.resistances: [{ type: Fire, value: 10 }, { type: cold, value: 5 }], core.languages: [elvish] }
remove: { core.languages: [draconic, "dranuran cant"], core.perception.senses: ["scent"] }
`),
      wardenSource(),
    );
    expect(changes.actorUpdate["system.attributes.resistances"]).toEqual([
      { type: "fire", value: 10, exceptions: [] },
      { type: "cold", value: 5, exceptions: [] },
    ]);
    expect(changes.actorUpdate["system.details.languages.value"]).toEqual(["common", "elvish"]);
    expect(changes.actorUpdate["system.details.languages.details"]).toBe("");
    expect(changes.actorUpdate["system.perception.senses"]).toEqual([{ type: "low-light-vision" }]);
    expect(changes.changes).toContain("resistances: + fire 10, + cold 5, − fire 5");
  });

  it("warns when removing something that isn't there", () => {
    const changes = buildPatchChanges(patch("remove: { core.weaknesses: [fire], core.skills.named: [stealth] }"), wardenSource());
    expect(changes.warnings).toHaveLength(2);
  });

  it("sets and removes named skills", () => {
    const changes = buildPatchChanges(
      patch("set: { core.skills.named.stealth: 10, core.skills.named.athletics: null }\nremove: { core.skills.named: [survival] }"),
      wardenSource(),
    );
    expect(changes.actorUpdate).toMatchObject({
      "system.skills.stealth.base": 10,
      "system.skills.-=athletics": null,
      "system.skills.-=survival": null,
    });
    expect(buildPatchChanges(patch("set: { core.skills.named.sailing: 4 }"), wardenSource()).errors[0]).toContain("unknown skill");
  });

  it("turns lore ops into item ops", () => {
    const changes = buildPatchChanges(
      patch("add: { core.skills.lore: [{ name: Sailing, mod: 7 }, { name: Dranura Politics Lore, mod: 10 }] }"),
      wardenSource(),
    );
    expect(changes.createItems).toEqual([{ name: "Sailing Lore", type: "lore", system: { mod: { value: 7 } } }]);
    expect(changes.updateItems).toEqual([{ _id: "lore1", "system.mod.value": 10 }]);

    const cleared = buildPatchChanges(patch("set: { core.skills.lore: [] }"), wardenSource());
    expect(cleared.deleteItemIds).toEqual(["lore1"]);
  });

  it("removes, replaces and adds items by name", () => {
    const changes = buildPatchChanges(
      patch(`
items:
  remove: [shield bash, longsword]
  replace:
    - match: Knockdown Crash
      with: { origin: homebrew, type: action, name: Knockdown Crash, actionType: 2 }
  add:
    - { origin: compendiumRef, refType: action, lookup: { name: Grab } }
`),
      wardenSource(),
    );
    expect(changes.errors).toEqual([]);
    expect(changes.deleteItemIds.sort()).toEqual(["hb1", "hbs0", "stk1", "wpn1"].sort());
    expect(changes.addItems.map((item: any) => item.name ?? item.lookup.name)).toEqual(["Knockdown Crash", "Grab"]);
  });

  it("errors on missing item matches", () => {
    const changes = buildPatchChanges(
      patch("items:\n  remove: [Tail]\n  update: [{ match: Tail, set: { traits: [] } }, { match: Reactive Strike, set: { proficiency: master } }]"),
      wardenSource(),
    );
    expect(changes.errors).toHaveLength(3);
    expect(changes.errors[2]).toContain("need a strike imported from a weapon");
  });

  it("updates homebrew fields and rebuilds reaction text", () => {
    const changes = buildPatchChanges(
      patch(`
items:
  update:
    - match: hold the line
      set: { trigger: "Something happens.", description: "It reacts.", category: null }
    - match: shield bash
      set: { attackBonus: 15, damageRolls: [{ damage: 2d6, damageType: Bludgeoning }], attackEffects: [grab] }
`),
      wardenSource(),
    );
    expect(changes.errors).toEqual([]);
    expect(changes.warnings[0]).toContain("label only");
    const [reaction, bash] = changes.updateItems as any[];
    expect(reaction["system.description.value"]).toBe("<p><strong>Trigger</strong> Something happens.</p><hr /><p><strong>Effect</strong> It reacts.</p>");
    expect(reaction["system.category"]).toBeNull();
    expect(bash["system.bonus.value"]).toBe(15);
    const rollKeys = Object.keys(bash).filter((key) => key.startsWith("system.damageRolls."));
    expect(rollKeys.filter((key) => key.includes("-="))).toHaveLength(1);
    expect(rollKeys).toHaveLength(2);
  });

  it("needs description alongside trigger", () => {
    const changes = buildPatchChanges(patch("items:\n  update: [{ match: Hold the Line, set: { trigger: Now. } }]"), wardenSource());
    expect(changes.errors[0]).toContain("trigger needs description");
  });

  it("recomputes imported strikes when level or attributes change", () => {
    const changes = buildPatchChanges(patch("set: { meta.level: 5, core.abilities.str: 5 }"), wardenSource());
    const abilities = { ...warden.core.abilities, str: 5 };
    const sword = computeStrike({ level: 5, abilities, proficiency: "expert", potency: 1, striking: 1, die: "d8", traits: ["versatile-p"] });
    const bow = computeStrike({ level: 5, abilities, proficiency: "trained", potency: 0, striking: 0, die: "d6", traits: ["deadly-d10", "range-increment-60"] });
    expect(changes.updateItems).toEqual([
      { _id: "stk1", "system.bonus.value": sword.attackBonus, "system.damageRolls.r1.damage": sword.damage },
      { _id: "stk2", "system.bonus.value": bow.attackBonus, "system.damageRolls.r2.damage": bow.damage },
    ]);
    expect(changes.changes).toContain("Longsword strike: +13 → +15, 2d8+4 → 2d8+5");
    // shield bash is a flat homebrew strike
    expect(changes.warnings[0]).toContain("1 strike(s)");
  });

  it("recomputes a weapon strike when its proficiency or runes change", () => {
    const changes = buildPatchChanges(patch("items:\n  update: [{ match: Longsword, set: { proficiency: master, runes: { potency: 2 } } }]"), wardenSource());
    expect(changes.errors).toEqual([]);
    const byId = Object.fromEntries(changes.updateItems.map((u: any) => [u._id, u]));
    expect(byId.wpn1).toEqual({ _id: "wpn1", "system.runes.potency": 2 });
    expect(byId.stk1["system.bonus.value"]).toBe(4 + 6 + 4 + 2);
    expect(byId.stk1["flags.planestone-importer.strike"]).toMatchObject({ proficiency: "master", potency: 2, striking: 1 });
    expect(byId.stk2).toBeUndefined();
  });

  it("applies the whole patch example cleanly", () => {
    const changes = buildPatchChanges(parseSheetText(example("patch.yaml")).patches[0], wardenSource());
    expect(changes.errors).toEqual([]);
    expect(changes.changes.length).toBeGreaterThan(10);
  });
});
