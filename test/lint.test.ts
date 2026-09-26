import { describe, expect, it } from "vitest";
import { formatRanked, rank, similarity } from "../src/ts/fuzzy";
import { linkHtml } from "../src/ts/items";
import { lintConditions } from "../src/ts/lint";
import { accepter, newReview, repairErrors } from "../src/ts/review";

const condition = (name: string, id: string) => [name.toLowerCase(), { uuid: `Compendium.pf2e.conditionitems.Item.${id}`, name }] as const;
const targets = new Map([
  condition("Frightened", "fri"),
  condition("Confused", "con"),
  condition("Off-Guard", "off"),
  condition("Prone", "pro"),
  condition("Stupefied", "stu"),
  condition("Hostile", "hos"),
  ["demoralize", { uuid: "Compendium.pf2e.actionspf2e.Item.dem", name: "Demoralize" }],
]);

const lint = (html: string) => lintConditions(html, targets, () => true);

describe("fuzzy", () => {
  it("scores near names high and unrelated names low", () => {
    expect(similarity("Daggor", "Dagger")).toBeGreaterThan(0.8);
    expect(similarity("Dagger (Returning)", "dagger")).toBe(1);
    expect(similarity("Daggor", "Greatsword")).toBeLessThan(0.6);
  });

  it("ranks the closest names first", () => {
    const ranked = rank("Daggor", [{ name: "Greatsword" }, { name: "Dagger" }, { name: "Dogslicer" }]);
    expect(ranked[0].name).toBe("Dagger");
    expect(formatRanked(ranked)).toMatch(/^Dagger \(0\.\d\d\)/);
  });
});

describe("lintConditions", () => {
  it("marks the first plain mention of a condition, with its value", () => {
    expect(lint("<p>It is frightened 2 and frightened again.</p>")).toBe("<p>It is [[frightened 2]] and frightened again.</p>");
  });

  it("keeps a number after a condition that takes no value", () => {
    expect(lint("knocked prone 2 times")).toBe("knocked [[prone]] 2 times");
  });

  it("swaps legacy names for remaster ones", () => {
    expect(lint("the target is flat-footed")).toBe("the target is [[off-guard]]");
    expect(lint("the target is [[flat-footed]]")).toBe("the target is [[off-guard]]");
  });

  it("fixes misspelled marks", () => {
    expect(lint("becomes [[stupified 1]]")).toBe("becomes [[stupefied 1]]");
  });

  it("leaves linked conditions, enrichers, tags and prose-only conditions alone", () => {
    for (const text of [
      "[[confused]] then confused",
      "@UUID[Compendium.pf2e.conditionitems.Item.con]{Confused} and confused",
      '<span class="confused">x</span>',
      "the guards turn hostile",
      "an unconfused mind",
    ]) {
      expect(lint(text)).toBe(text);
    }
  });

  it("is idempotent", () => {
    const once = lint("confused and frightened 1");
    expect(lint(once)).toBe(once);
  });
});

describe("review fixes", () => {
  it("records fixes with stable ids and skips rejected ones", () => {
    const html = "<p>confused, takes 2d6 fire damage</p>";
    const first = newReview({ lint: true });
    linkHtml(html, "Slam", targets, () => {}, first);
    expect(first.fixes.map((fix) => fix.kind)).toEqual(["condition", "roll"]);

    const rejected = first.fixes.find((fix) => fix.kind === "condition")!.id;
    const second = newReview({ lint: true, rejectFixes: [rejected] });
    const out = linkHtml(html, "Slam", targets, () => {}, second);
    expect(out).toBe("<p>confused, takes @Damage[2d6[fire]] damage</p>");
    expect(second.fixes.map((fix) => fix.id)).toEqual(first.fixes.map((fix) => fix.id));
    expect(second.fixes.find((fix) => fix.id === rejected)?.applied).toBe(false);
  });

  it("skips condition lint when it's off", () => {
    const review = newReview({ lint: false });
    expect(linkHtml("confused", "Slam", targets, () => {}, review)).toBe("confused");
    expect(review.fixes).toEqual([]);
  });

  it("numbers repeated fixes", () => {
    const review = newReview();
    const accept = accepter(review, "x");
    accept("roll", "1d4", "[[/r 1d4]]");
    accept("roll", "1d4", "[[/r 1d4]]");
    expect(review.fixes.map((fix) => fix.id)).toEqual(["x|roll|1d4|1", "x|roll|1d4|2"]);
  });

  it("hints at the closest term for an unresolved mark", () => {
    const warnings: string[] = [];
    linkHtml("[[demoralise]]", "Shout", targets, (message) => warnings.push(message));
    expect(warnings[0]).toContain("did you mean demoralize?");
  });

  it("turns warned-only misses into repair errors", () => {
    const candidates = [{ name: "Dagger", score: 0.83 }];
    const plan = { errors: [], suggestions: [{ where: "Warden: Daggor", name: "Daggor", refType: "equipment", candidates }] };
    expect(repairErrors(plan)).toEqual(['Warden: Daggor: no equipment named "Daggor"; did you mean Dagger (0.83)?']);
  });
});
