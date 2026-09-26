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

const proficiency = z.enum(["trained", "expert", "master", "legendary"]);
const actionType = z.union([z.enum(["passive", "free", "reaction"]), z.literal(1), z.literal(2), z.literal(3)]);
const actionCategory = z.enum(["offensive", "defensive", "interaction"]);
const runes = z.object({
  potency: z.number().int().min(0).max(4).default(0),
  striking: z.number().int().min(0).max(3).default(0),
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
  proficiency,
  runes: runes.default({}),
  abilityOverride: abilityKey.nullable().default(null),
  damageAbilityOverride: abilityKey.nullable().default(null),
  keepInInventory: z.boolean().default(true),
});

const homebrewAction = z
  .object({
    origin: z.literal("homebrew"),
    type: z.enum(["action", "passive"]),
    name: z.string().min(1),
    actionType: actionType.optional(),
    category: actionCategory.optional(),
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
export const sheetItem = z
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

export const resistanceEntry = z.object({ type: z.string(), value: z.number().int(), exceptions: z.array(z.string()).default([]) });
export const weaknessEntry = z.object({ type: z.string(), value: z.number().int() });
export const immunityEntry = z.object({ type: z.string() });
export const otherSpeedEntry = z.object({ type: z.string(), value: z.number().int().min(0) });
export const loreEntry = z.object({ name: z.string().min(1), mod: z.number().int() });

export const coreSchema = z.object({
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
    other: z.array(otherSpeedEntry).default([]),
  }),
  skills: z
    .object({
      named: z.record(z.string(), z.number().int()).default({}),
      lore: z.array(loreEntry).default([]),
    })
    .default({}),
  resistances: z.array(resistanceEntry).default([]),
  weaknesses: z.array(weaknessEntry).default([]),
  immunities: z.array(immunityEntry).default([]),
});

export const metaSchema = z.object({
  name: z.string().min(1),
  actorType: z.literal("npc").default("npc"),
  level: z.number().int().min(-1).max(30),
  freeArchetype: z.boolean().default(false),
  source: z.string().optional(),
});

const actorBody = z.object({
  meta: metaSchema,
  core: coreSchema,
  items: z.array(sheetItem).default([]),
  // spellcasting is reserved for a later version
  spellcasting: z.unknown().optional(),
});

export type ActorDoc = z.infer<typeof actorBody>;
export type CoreData = ActorDoc["core"];

// ---------------------------------------------------------------------------
// vehicle (§2b)
// ---------------------------------------------------------------------------

export const vehicleMetaSchema = z.object({
  name: z.string().min(1),
  actorType: z.literal("vehicle").default("vehicle"),
  level: z.number().int().min(-1).max(30),
  source: z.string().optional(),
});

// vehicle speed is free text in pf2e; a bare number means feet
const vehicleSpeed = z.union([z.string(), z.number().int().min(0).transform((feet) => `${feet} feet`)]);

export const vehicleCoreSchema = z.object({
  traits: z.array(z.string()).default([]),
  rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
  size: z.string().default("large"),
  description: z.string().default(""),
  // gp
  price: z.number().min(0).default(0),
  // feet
  space: z
    .object({
      long: z.number().min(0).default(0),
      wide: z.number().min(0).default(0),
      high: z.number().min(0).default(0),
    })
    .default({}),
  crew: z.string().default(""),
  passengers: z.union([z.string(), z.number().int().min(0).transform(String)]).default(""),
  pilotingCheck: z.string().default(""),
  ac: z.number().int(),
  // vehicles only roll fortitude
  saves: z.object({ fortitude: z.number().int() }).strict(),
  hardness: z.number().int().min(0).default(0),
  hp: z.object({
    value: z.number().int().positive(),
    notes: z.string().optional(),
  }),
  speed: vehicleSpeed.default(""),
  collision: z.object({ dc: z.number().int(), damage: z.string().min(1) }).optional(),
  emitsSound: z.union([z.boolean(), z.literal("encounter")]).default("encounter"),
  resistances: z.array(resistanceEntry).default([]),
  weaknesses: z.array(weaknessEntry).default([]),
  // every pf2e vehicle carries object immunities
  immunities: z.array(immunityEntry).default([{ type: "object-immunities" }]),
});

const vehicleBody = z.object({
  meta: vehicleMetaSchema,
  core: vehicleCoreSchema,
  items: z.array(sheetItem).default([]),
});

export type VehicleDoc = z.infer<typeof vehicleBody>;
export type VehicleCoreData = VehicleDoc["core"];

export function isVehicleDoc(doc: ActorDoc | VehicleDoc): doc is VehicleDoc {
  return doc.meta.actorType === "vehicle";
}

// batch entries split on meta.actorType (or kind), parsed in a second step like homebrew items
const batchActor = z
  .object({
    kind: z.enum(["actor", "vehicle"]).optional(),
    meta: z.object({ actorType: z.enum(["npc", "vehicle"]).optional() }).passthrough(),
  })
  .passthrough()
  .transform((value, ctx): ActorDoc | VehicleDoc => {
    const { kind, ...fields } = value;
    const isVehicle = kind === "vehicle" || value.meta.actorType === "vehicle";
    const parsed = (isVehicle ? vehicleBody : actorBody).safeParse(fields);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    return z.NEVER;
  });

// ---------------------------------------------------------------------------
// actor patch (§6)
// ---------------------------------------------------------------------------

const patchTarget = z
  .object({ name: z.string().min(1).optional(), uuid: z.string().min(1).optional() })
  .strict()
  .refine((target) => !(target.name && target.uuid), "target takes a name or a uuid, not both");

// every field items.update can touch; which ones apply depends on the matched item
export const itemPatchFields = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    trigger: z.string().min(1),
    traits: z.array(z.string()),
    actionType,
    category: actionCategory.nullable(),
    attackBonus: z.number().int(),
    damageRolls: z.array(damageRoll).min(1),
    attackEffects: z.array(z.string()),
    proficiency,
    runes: runes.partial(),
    abilityOverride: abilityKey.nullable(),
    damageAbilityOverride: abilityKey.nullable(),
  })
  .partial()
  .strict();

export type ItemPatchFields = z.infer<typeof itemPatchFields>;

// set/add/remove keys are dotted sheet paths, checked in patch/paths.ts
// target is optional; the sheet it's applied from is the real target
const actorPatchBody = z.object({
  target: patchTarget.optional(),
  set: z.record(z.string(), z.unknown()).default({}),
  add: z.record(z.string(), z.array(z.unknown())).default({}),
  remove: z.record(z.string(), z.array(z.string().min(1))).default({}),
  items: z
    .object({
      add: z.array(sheetItem).default([]),
      remove: z.array(z.string().min(1)).default([]),
      update: z.array(z.object({ match: z.string().min(1), set: itemPatchFields })).default([]),
      replace: z.array(z.object({ match: z.string().min(1), with: sheetItem })).default([]),
    })
    .strict()
    .default({}),
});

export type ActorPatchDoc = z.infer<typeof actorPatchBody>;

// ---------------------------------------------------------------------------
// item patch (§7)
// ---------------------------------------------------------------------------

// patches one world item; target works like actorPatch's
const itemPatchBody = z.object({
  target: patchTarget.optional(),
  set: itemPatchFields,
});

export type ItemPatchDoc = z.infer<typeof itemPatchBody>;

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
  vehicleBody.extend({ ...envelope, kind: z.literal("vehicle") }),
  spellListBody.extend({ ...envelope, kind: z.literal("spellList") }),
  actorPatchBody.extend({ ...envelope, kind: z.literal("actorPatch") }),
  itemPatchBody.extend({ ...envelope, kind: z.literal("itemPatch") }),
  // item fields sit next to kind; parse.ts runs them through sheetItem
  z.object({ ...envelope, kind: z.literal("item") }).passthrough(),
  z.object({ ...envelope, kind: z.literal("itemBatch"), items: z.array(sheetItem).min(1) }),
  z.object({
    ...envelope,
    kind: z.literal("actorBatch"),
    actors: z.array(batchActor).min(1),
    spellLists: z.array(spellListBody.extend({ kind: z.literal("spellList").optional() })).default([]),
  }),
]);

export type SheetFile = z.infer<typeof sheetFile>;
