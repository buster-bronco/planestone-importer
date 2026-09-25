import { describe, expect, it } from "vitest";
import { applyLinkMarks, isInlineRoll, parseMarkTerm } from "../src/ts/linkMarks";

const targets = new Map([
  ["stupefied", { uuid: "Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg", name: "Stupefied" }],
  ["off-guard", { uuid: "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg", name: "Off-Guard" }],
]);
const resolve = (name: string) => targets.get(name) ?? null;

describe("isInlineRoll", () => {
  it.each(["/r 1d6", "/gmr 1d4 #Recharge", "2d6", "1d20+5", "3 + 4", "@abilities.str.mod"])("treats %s as a roll", (text) => {
    expect(isInlineRoll(text)).toBe(true);
  });

  it.each(["stupefied 1", "off-guard", "drained 2", "dazzled"])("treats %s as a term", (text) => {
    expect(isInlineRoll(text)).toBe(false);
  });
});

describe("parseMarkTerm", () => {
  it("splits a trailing value", () => {
    expect(parseMarkTerm("stupefied 1")).toEqual({ name: "stupefied", value: 1 });
    expect(parseMarkTerm("off-guard")).toEqual({ name: "off-guard", value: null });
  });
});

describe("applyLinkMarks", () => {
  it("links marked conditions with their value in the label", () => {
    const { html, unresolved } = applyLinkMarks("<p>The target becomes [[stupefied 1]] and [[off-guard]].</p>", resolve);
    expect(html).toBe(
      "<p>The target becomes @UUID[Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg]{Stupefied 1} and @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}.</p>",
    );
    expect(unresolved).toEqual([]);
  });

  it("leaves inline rolls and labelled rolls untouched", () => {
    const text = "Roll [[/r 1d6]] or [[2d6]] or [[/gmr 1d4 #Recharge]]{1d4 rounds}.";
    expect(applyLinkMarks(text, resolve).html).toBe(text);
  });

  it("unwraps unknown terms to plain text and reports them", () => {
    const { html, unresolved } = applyLinkMarks("She is [[shadowbound]].", resolve);
    expect(html).toBe("She is shadowbound.");
    expect(unresolved).toEqual(["shadowbound"]);
  });
});
