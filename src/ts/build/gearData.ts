import type { HomebrewGearItem, InventoryFields } from "../schema";
import { sluggify } from "../slug";
import { toHtml } from "./homebrew";

// pf2e usage slug per homebrew type when the sheet leaves it out
const DEFAULT_USAGE: Record<HomebrewGearItem["type"], string | null> = {
  equipment: "held-in-one-hand",
  consumable: "held-in-one-hand",
  backpack: "worn",
  treasure: null,
};

// pf2e price coins; fractional gp splits into sp and cp
export function coins(price: HomebrewGearItem["price"]): Record<string, number> {
  const { pp = 0, gp = 0, sp = 0, cp = 0 } = price as Record<string, number>;
  const whole = Math.floor(gp);
  const change = Math.round((gp - whole) * 100);
  const out = { pp, gp: whole, sp: sp + Math.floor(change / 10), cp: cp + (change % 10) };
  return Object.fromEntries(Object.entries(out).filter(([, count]) => count));
}

export function buildHomebrewGear(item: HomebrewGearItem) {
  const usage = item.usage ?? DEFAULT_USAGE[item.type];
  const bulkValue = item.bulk ?? (item.type === "treasure" ? 0 : 0.1);
  const system: Record<string, any> = {
    slug: sluggify(item.name),
    level: { value: item.level },
    traits: { value: item.traits.map(sluggify), rarity: item.rarity },
    quantity: 1,
    price: { value: coins(item.price) },
    bulk: { value: bulkValue },
    equipped: { carryType: "worn" },
    description: { value: toHtml(item.description) },
    rules: [],
  };
  if (usage) system.usage = { value: usage };

  if (item.type === "consumable") {
    system.category = item.category ?? "other";
    if (!system.traits.value.includes("consumable")) system.traits.value.push("consumable");
    const uses = item.uses ?? 1;
    system.uses = { value: uses, max: uses, autoDestroy: true };
  } else if (item.type === "backpack") {
    system.bulk = { value: bulkValue, heldOrStowed: bulkValue, capacity: item.capacity ?? 10, ignored: item.ignored ?? 0 };
  }

  return { name: item.name, type: item.type, system };
}

// sheet equipped value → pf2e equipped state for this item
function carryState(data: any, fields: InventoryFields, warn: (message: string) => void): Record<string, unknown> {
  const usage: string = data.system?.usage?.value ?? "";
  const held = usage.startsWith("held") || data.type === "shield";
  // armor and worn items sit in a slot when worn
  const slotted = data.type === "armor" || usage.startsWith("worn");
  const hands = fields.hands ?? (usage.includes("two-hands") ? 2 : 1);
  const carried = { carryType: "worn", inSlot: false, handsHeld: 0 };

  switch (fields.equipped) {
    case true:
      if (held) return { carryType: "held", inSlot: false, handsHeld: hands };
      if (slotted) return { carryType: "worn", inSlot: true, handsHeld: 0 };
      warn(`"${data.name}" isn't held or worn; left carried`);
      return carried;
    case "held":
      return { carryType: "held", inSlot: false, handsHeld: hands };
    case "worn":
      return { carryType: "worn", inSlot: slotted, handsHeld: 0 };
    case "dropped":
      return { carryType: "dropped", inSlot: false, handsHeld: 0 };
    default:
      return carried;
  }
}

// quantity, carry state and investment onto physical item data
export function applyInventory(data: any, fields: InventoryFields, warn: (message: string) => void): void {
  const system = (data.system ??= {});
  if (fields.quantity !== undefined) system.quantity = fields.quantity;
  if (fields.equipped !== undefined) system.equipped = { ...system.equipped, ...carryState(data, fields, warn) };
  if (fields.invested !== undefined) {
    const traits: string[] = system.traits?.value ?? [];
    if (!traits.includes("invested")) warn(`"${data.name}" doesn't have the invested trait; invested ignored`);
    else system.equipped = { ...system.equipped, invested: fields.invested };
  }
}
