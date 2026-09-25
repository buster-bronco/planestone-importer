import { z } from "zod";

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const abilityKey = z.enum(ABILITY_KEYS);
export type AbilityKey = z.infer<typeof abilityKey>;

const lookup = z.object({
  name: z.string().min(1),
  pack: z.string().min(1).optional(),
});

const damageRoll = z.object({
  damage: z.string().min(1),
  damageType: z.string().min(1),
});

// ---------------------------------------------------------------------------
// items (§3)
// ---------------------------------------------------------------------------

const compendiumRef = z.object({
  origin: z.literal("compendiumRef"),
  refType: z.enum(["action", "equipment", "spell"]),
  lookup,
});

const equippedWeapon = z.object({
  origin: z.literal("equippedWeapon"),
  lookup,
  proficiency: z.enum(["trained", "expert", "master", "legendary"]),
  runes: z
    .object({
      potency: z.number().int().min(0).max(4).default(0),
      striking: z.number().int().min(0).max(3).default(0),
    })
    .default({}),
  abilityOverride: abilityKey.nullable().default(null),
  damageAbilityOverride: abilityKey.nullable().default(null),
  keepInInventory: z.boolean().default(true),
});

const homebrewAction = z
  .object({
    origin: z.literal("homebrew"),
    type: z.enum(["action", "passive"]),
    name: z.string().min(1),
    actionType: z.union([z.enum(["passive", "free", "reaction"]), z.literal(1), z.literal(2), z.literal(3)]).optional(),
    category: z.enum(["offensive", "defensive", "interaction"]).optional(),
    trigger: z.string().min(1).optional(),
    traits: z.array(z.string()).default([]),
    description: z.string().default(""),
  })
  .transform((item) => ({ ...item, actionType: item.actionType ?? (item.type === "passive" ? "passive" : 1) }))
  .superRefine((item, ctx) => {
    if (item.actionType === "reaction" && !item.trigger) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trigger"], message: "trigger is required when actionType is reaction" });
    }
  });

const homebrewStrike = z.object({
  origin: z.literal("homebrew"),
  type: z.enum(["melee", "ranged"]),
  name: z.string().min(1),
  attackBonus: z.number().int(),
  damageRolls: z.array(damageRoll).min(1),
  traits: z.array(z.string()).default([]),
  range: z.number().int().positive().nullable().default(null),
  attackEffects: z.array(z.string()).default([]),
  description: z.string().default(""),
});

export type CompendiumRefItem = z.infer<typeof compendiumRef>;
export type EquippedWeaponItem = z.infer<typeof equippedWeapon>;
export type HomebrewActionItem = z.infer<typeof homebrewAction>;
export type HomebrewStrikeItem = z.infer<typeof homebrewStrike>;
export type SheetItem = CompendiumRefItem | EquippedWeaponItem | HomebrewActionItem | HomebrewStrikeItem;

export function isHomebrewStrike(item: SheetItem): item is HomebrewStrikeItem {
  return item.origin === "homebrew" && (item.type === "melee" || item.type === "ranged");
}

export function isHomebrewAction(item: SheetItem): item is HomebrewActionItem {
  return item.origin === "homebrew" && (item.type === "action" || item.type === "passive");
}

// homebrew splits on "type" too, so it's parsed in a second step
const item = z
  .discriminatedUnion("origin", [
    compendiumRef,
    equippedWeapon,
    z.object({ origin: z.literal("homebrew"), type: z.enum(["action", "passive", "melee", "ranged"]) }).passthrough(),
  ])
  .transform((value, ctx): SheetItem => {
    if (value.origin !== "homebrew") return value;
    const isStrike = value.type === "melee" || value.type === "ranged";
    const parsed = (isStrike ? homebrewStrike : homebrewAction).safeParse(value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    return z.NEVER;
  });

// ---------------------------------------------------------------------------
// actor (§2)
// ---------------------------------------------------------------------------

const core = z.object({
  traits: z.array(z.string()).default([]),
  rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
  size: z.string().default("medium"),
  alignment: z.string().optional(),
  ancestry: z.string().optional(),
  languages: z.array(z.string()).default([]),
  abilities: z.object({
    str: z.number().int(),
    dex: z.number().int(),
    con: z.number().int(),
    int: z.number().int(),
    wis: z.number().int(),
    cha: z.number().int(),
  }),
  perception: z.object({
    mod: z.number().int(),
    senses: z.array(z.string()).default([]),
  }),
  ac: z.number().int(),
  saves: z.object({
    fortitude: z.number().int(),
    reflex: z.number().int(),
    will: z.number().int(),
  }),
  hp: z.object({
    value: z.number().int().positive(),
    notes: z.string().optional(),
  }),
  speed: z.object({
    value: z.number().int().min(0),
    other: z.array(z.object({ type: z.string(), value: z.number().int().min(0) })).default([]),
  }),
  skills: z
    .object({
      named: z.record(z.string(), z.number().int()).default({}),
      lore: z.array(z.object({ name: z.string().min(1), mod: z.number().int() })).default([]),
    })
    .default({}),
  resistances: z
    .array(z.object({ type: z.string(), value: z.number().int(), exceptions: z.array(z.string()).default([]) }))
    .default([]),
  weaknesses: z.array(z.object({ type: z.string(), value: z.number().int() })).default([]),
  immunities: z.array(z.object({ type: z.string() })).default([]),
});

const actorBody = z.object({
  meta: z.object({
    name: z.string().min(1),
    actorType: z.literal("npc").default("npc"),
    level: z.number().int().min(-1).max(30),
    freeArchetype: z.boolean().default(false),
    source: z.string().optional(),
  }),
  core,
  items: z.array(item).default([]),
  // spellcasting is reserved for a later version
  spellcasting: z.unknown().optional(),
});

export type ActorDoc = z.infer<typeof actorBody>;
export type CoreData = ActorDoc["core"];

// ---------------------------------------------------------------------------
// spell list (§5, reserved)
// ---------------------------------------------------------------------------

const spellListBody = z.object({
  id: z.string().min(1),
  tradition: z.enum(["arcane", "divine", "occult", "primal"]),
  basis: z.enum(["spellDC", "spellAttack"]),
  dcOrAttack: z.number().int(),
  slots: z.record(z.string(), z.array(z.unknown())).default({}),
});

export type SpellListDoc = z.infer<typeof spellListBody>;

// ---------------------------------------------------------------------------
// envelope (§1)
// ---------------------------------------------------------------------------

const envelope = { schemaVersion: z.literal(1) };

export const sheetFile = z.discriminatedUnion("kind", [
  actorBody.extend({ ...envelope, kind: z.literal("actor") }),
  spellListBody.extend({ ...envelope, kind: z.literal("spellList") }),
  z.object({
    ...envelope,
    kind: z.literal("actorBatch"),
    actors: z.array(actorBody.extend({ kind: z.literal("actor").optional() })).min(1),
    spellLists: z.array(spellListBody.extend({ kind: z.literal("spellList").optional() })).default([]),
  }),
]);

export type SheetFile = z.infer<typeof sheetFile>;
