import { describe, expect, it } from "vitest";
import { applyAutoRolls } from "../src/ts/autoRolls";
import { linkHtml } from "../src/ts/items";

describe("applyAutoRolls", () => {
  it.each([
    ["deals 2d6 fire damage", "deals @Damage[2d6[fire]] damage"],
    ["takes 1d6 persistent bleed damage", "takes @Damage[1d6[persistent,bleed]] damage"],
    ["2d6+4 damage", "@Damage[2d6+4] damage"],
    ["2d6 + 1d4 Fire damage", "@Damage[(2d6+1d4)[fire]] damage"],
    ["1d8+4 slashing damage", "@Damage[(1d8+4)[slashing]] damage"],
  ])("turns %s into a damage roll", (input, expected) => {
    expect(applyAutoRolls(input)).toBe(expected);
  });

  it("turns other dice into plain rolls", () => {
    expect(applyAutoRolls("<p>stunned for 1d4 rounds, roll a d20</p>")).toBe("<p>stunned for [[/r 1d4]] rounds, roll a [[/r d20]]</p>");
  });

  it.each([
    "Roll [[/r 1d6]] or [[2d6]]{2d6 rounds}.",
    "@Damage[2d6[fire]] damage and @Damage[(1d8+4)[slashing]]{1d8+4 slashing}",
    "@Check[reflex|dc:20] save",
    '<span data-formula="1d6">text</span>',
  ])("leaves %s alone", (text) => {
    expect(applyAutoRolls(text)).toBe(text);
  });

  it("drops the backslash on escaped dice", () => {
    expect(applyAutoRolls(String.raw`a \2d6 table and \1d6 fire damage`)).toBe("a 2d6 table and 1d6 fire damage");
  });

  it("ignores things that only look like dice", () => {
    const text = "add20 and 3d glasses, 10 feet away";
    expect(applyAutoRolls(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = applyAutoRolls("<p>2d6 fire damage, then 1d4 rounds</p>");
    expect(applyAutoRolls(once)).toBe(once);
  });
});

describe("linkHtml", () => {
  it("links marks and converts dice together", () => {
    const targets = new Map([["prone", { uuid: "Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60", name: "Prone" }]]);
    const html = linkHtml("<p>1d6 bludgeoning damage and [[prone]]</p>", "Slam", targets, () => {});
    expect(html).toBe("<p>@Damage[1d6[bludgeoning]] damage and @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}</p>");
  });
});
