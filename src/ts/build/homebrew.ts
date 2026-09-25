import type { HomebrewActionItem, HomebrewStrikeItem } from "../schema";
import { randomID, sluggify } from "../slug";

// plain text becomes a paragraph; html passes through
export function toHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("<") ? trimmed : `<p>${trimmed}</p>`;
}

// pf2e reaction layout: trigger, rule, effect
function reactionHtml(trigger: string, description: string): string {
  const body = toHtml(description);
  const effect = body.startsWith("<p>") ? body.replace("<p>", "<p><strong>Effect</strong> ") : body;
  return `<p><strong>Trigger</strong> ${trigger}</p><hr />${effect}`;
}

export function buildHomebrewAction(item: HomebrewActionItem) {
  const { actionType } = item;
  const isCounted = typeof actionType === "number";
  const description = item.trigger ? reactionHtml(item.trigger, item.description) : toHtml(item.description);

  return {
    name: item.name,
    type: "action",
    system: {
      slug: sluggify(item.name),
      actionType: { value: isCounted ? "action" : actionType },
      actions: { value: isCounted ? actionType : null },
      category: item.category ?? null,
      description: { value: description },
      traits: { value: item.traits.map(sluggify), rarity: "common" },
      rules: [],
    },
  };
}

export function buildHomebrewStrike(item: HomebrewStrikeItem, warn: (message: string) => void) {
  const traits = item.traits.map(sluggify);
  if (item.range) {
    if (item.type === "ranged" && !traits.some((t) => /^(?:range|thrown)-/.test(t))) traits.push(`range-increment-${item.range}`);
    else if (item.type === "melee") warn(`"${item.name}" is melee; use a reach-N or thrown-N trait for range`);
  }

  const damageRolls = Object.fromEntries(
    item.damageRolls.map((roll) => [randomID(), { damage: roll.damage, damageType: sluggify(roll.damageType), category: null }]),
  );

  return {
    name: item.name,
    type: "melee",
    system: {
      slug: sluggify(item.name),
      bonus: { value: item.attackBonus },
      damageRolls,
      attackEffects: { value: item.attackEffects.map(sluggify), custom: "" },
      traits: { value: traits, rarity: "common" },
      weaponType: { value: item.type },
      description: { value: toHtml(item.description) },
      rules: [],
    },
  };
}
