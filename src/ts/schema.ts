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

const TRADITIONS = ["arcane", "divine", "occult", "primal"] as const;
const tradition = z.enum(TRADITIONS);

// spell casting time: action count, reaction/free, or text like "1 minute"
const spellActions = z.union([z.enum(["reaction", "free"]), z.literal(1), z.literal(2), z.literal(3), z.string().min(1)]);

const spellDamage = z.object({
  formula: z.string().min(1),
  type: z.string().min(1),
  category: z.enum(["persistent", "splash"]).nullable().default(null),
});

const homebrewSpell = z
  .object({
    origin: z.literal("homebrew"),
    type: z.literal("spell"),
    name: z.string().min(1),
    // base rank; cantrips are rank 1 in pf2e
    rank: z.number().int().min(1).max(10).default(1),
    cantrip: z.boolean().default(false),
    focus: z.boolean().default(false),
    traditions: z.array(tradition).default([]),
    traits: z.array(z.string()).default([]),
    rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
    actions: spellActions.default(2),
    trigger: z.string().min(1).optional(),
    requirements: z.string().default(""),
    // a bare number means feet
    range: z.union([z.string(), z.number().int().positive().transform((feet) => `${feet} feet`)]).default(""),
    area: z.object({ type: z.string().min(1), value: z.number().int().positive() }).nullable().default(null),
    targets: z.string().default(""),
    duration: z.string().default(""),
    sustained: z.boolean().default(false),
    // ac means a spell attack roll against ac
    defense: z
      .object({ save: z.enum(["fortitude", "reflex", "will", "ac"]), basic: z.boolean().default(false) })
      .nullable()
      .default(null),
    damage: z.array(spellDamage).default([]),
    // interval heightening: every n ranks add each formula to the damage at the same index
    heightening: z.object({ every: z.number().int().min(1).default(1), damage: z.array(z.string().min(1)).min(1) }).optional(),
    description: z.string().default(""),
  })
  .superRefine((item, ctx) => {
    if (item.actions === "reaction" && !item.trigger) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trigger"], message: "trigger is required when actions is reaction" });
    }
    if (item.heightening && item.heightening.damage.length > item.damage.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["heightening", "damage"], message: "heightening has more entries than damage" });
    }
  });

export type CompendiumRefItem = z.infer<typeof compendiumRef>;
export type EquippedWeaponItem = z.infer<typeof equippedWeapon>;
export type HomebrewActionItem = z.infer<typeof homebrewAction>;
export type HomebrewStrikeItem = z.infer<typeof homebrewStrike>;
export type HomebrewSpellItem = z.infer<typeof homebrewSpell>;
export type SheetItem = CompendiumRefItem | EquippedWeaponItem | HomebrewActionItem | HomebrewStrikeItem | HomebrewSpellItem;

export function isHomebrewSpell(item: SheetItem): item is HomebrewSpellItem {
  return item.origin === "homebrew" && item.type === "spell";
}

export function isSpellItem(item: SheetItem): boolean {
  return isHomebrewSpell(item) || (item.origin === "compendiumRef" && item.refType === "spell");
}

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
    z.object({ origin: z.literal("homebrew"), type: z.enum(["action", "passive", "melee", "ranged", "spell"]) }).passthrough(),
  ])
  .transform((value, ctx): SheetItem => {
    if (value.origin !== "homebrew") return value;
    const isStrike = value.type === "melee" || value.type === "ranged";
    const parsed = (value.type === "spell" ? homebrewSpell : isStrike ? homebrewStrike : homebrewAction).safeParse(value);
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

// ---------------------------------------------------------------------------
// spellcasting (§5)
// ---------------------------------------------------------------------------

export const SPELL_RANK_KEYS = ["cantrips", ...Array.from({ length: 10 }, (_, i) => `rank${i + 1}`)] as const;
export type SpellRankKey = (typeof SPELL_RANK_KEYS)[number];

// innate spells: uses per day, or pf2e's at will / constant name suffix
const spellUses = z.union([z.number().int().min(1), z.enum(["at-will", "constant"])]);

// a bare string is a compendium spell name
const spellRef = z
  .union([
    z.string().min(1).transform((name) => ({ origin: "compendiumRef" as const, lookup: { name } })),
    z.object({}).passthrough(),
  ])
  .transform((value, ctx) => {
    const { uses, ...fields } = value as Record<string, unknown>;
    // { name, pack } without an origin is a compendium spell too
    const { name, pack, ...rest } = fields;
    const shorthand = fields.origin === undefined ? { ...rest, origin: "compendiumRef", lookup: { name, pack } } : fields;
    const withRef = shorthand.origin === "compendiumRef" ? { refType: "spell", ...shorthand } : shorthand;
    const item = sheetItem.safeParse(withRef);
    const usesParsed = spellUses.optional().safeParse(uses);
    if (!item.success) for (const issue of item.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    if (!usesParsed.success) for (const issue of usesParsed.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["uses"], message: issue.message });
    if (!item.success || !usesParsed.success) return z.NEVER;
    if (!isSpellItem(item.data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["origin"], message: "spell lists take spell names, compendiumRef spells or homebrew spells" });
      return z.NEVER;
    }
    return { item: item.data as CompendiumRefItem | HomebrewSpellItem, uses: usesParsed.data };
  });

export type SpellRef = z.infer<typeof spellRef>;

const rankRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(SPELL_RANK_KEYS.map((key) => [key, value.optional()])) as Record<SpellRankKey, z.ZodOptional<T>>).strict();

const castingType = z.enum(["prepared", "spontaneous", "innate", "focus"]);

const spellcastingFields = z.object({
  name: z.string().min(1).optional(),
  tradition,
  type: castingType,
  ability: abilityKey.default("cha"),
  dc: z.number().int(),
  attack: z.number().int().optional(),
  focusPoints: z.number().int().min(1).max(3).optional(),
  // slots per rank; prepared defaults to the number of spells listed
  slots: rankRecord(z.number().int().min(0)).optional(),
  spells: rankRecord(z.array(spellRef)).default({}),
});

type SpellcastingFields = z.infer<typeof spellcastingFields>;

// cross-field rules shared by inline entries and spell lists
function checkSpellcastingFields(entry: SpellcastingFields, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (entry.type === "spontaneous" && !entry.slots) issue(["slots"], "spontaneous spellcasting needs slots per rank");
  if (entry.slots && (entry.type === "innate" || entry.type === "focus")) issue(["slots"], `${entry.type} spellcasting has no slots`);
  if (entry.focusPoints !== undefined && entry.type !== "focus") issue(["focusPoints"], "focusPoints only applies to focus spellcasting");
  for (const key of SPELL_RANK_KEYS) {
    entry.spells[key]?.forEach((ref, index) => {
      // a ref that failed to parse already has its own issue
      if (!ref?.item) return;
      if (ref.uses !== undefined && entry.type !== "innate") issue(["spells", key, index, "uses"], "uses only applies to innate spells");
      if (key !== "cantrips" && isHomebrewSpell(ref.item) && ref.item.cantrip) issue(["spells", key, index], `"${ref.item.name}" is a cantrip; list it under cantrips`);
    });
  }
}

export const spellcastingEntry = spellcastingFields.superRefine(checkSpellcastingFields);
export type SpellcastingEntry = z.infer<typeof spellcastingEntry>;

const actorBody = z.object({
  meta: metaSchema,
  core: coreSchema,
  items: z.array(sheetItem).default([]),
  // entries inline, or ids of spell lists in the same batch; a single one is wrapped
  spellcasting: z
    .preprocess((value) => (value === undefined || Array.isArray(value) ? value : [value]), z.array(z.union([z.string().min(1), spellcastingEntry])))
    .default([]),
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

// ---------------------------------------------------------------------------
// hazard (§2c)
// ---------------------------------------------------------------------------

export const hazardMetaSchema = z.object({
  name: z.string().min(1),
  actorType: z.literal("hazard").default("hazard"),
  level: z.number().int().min(-1).max(30),
  source: z.string().optional(),
});

export const hazardCoreSchema = z.object({
  traits: z.array(z.string()).default([]),
  rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
  size: z.string().default("medium"),
  // complex hazards roll initiative and follow a routine
  complex: z.boolean().default(false),
  // stealth dc is mod + 10; notes hold the proficiency needed to notice it
  stealth: z.object({ mod: z.number().int(), notes: z.string().optional() }),
  description: z.string().default(""),
  disable: z.string().default(""),
  routine: z.string().default(""),
  reset: z.string().default(""),
  ac: z.number().int().optional(),
  // missing saves stay blank on the sheet
  saves: z
    .object({ fortitude: z.number().int().optional(), reflex: z.number().int().optional(), will: z.number().int().optional() })
    .strict()
    .default({}),
  hardness: z.number().int().min(0).default(0),
  // no hp means the hazard can't be damaged (pf2e hasHealth)
  hp: z.object({ value: z.number().int().positive(), notes: z.string().optional() }).optional(),
  emitsSound: z.union([z.boolean(), z.literal("encounter")]).default("encounter"),
  resistances: z.array(resistanceEntry).default([]),
  weaknesses: z.array(weaknessEntry).default([]),
  immunities: z.array(immunityEntry).default([]),
});

const hazardBody = z.object({
  meta: hazardMetaSchema,
  core: hazardCoreSchema,
  items: z.array(sheetItem).default([]),
});

export type HazardDoc = z.infer<typeof hazardBody>;
export type HazardCoreData = HazardDoc["core"];

export type AnyActorDoc = ActorDoc | VehicleDoc | HazardDoc;

export function isVehicleDoc(doc: AnyActorDoc): doc is VehicleDoc {
  return doc.meta.actorType === "vehicle";
}

export function isHazardDoc(doc: AnyActorDoc): doc is HazardDoc {
  return doc.meta.actorType === "hazard";
}

const bodyByType = { npc: actorBody, vehicle: vehicleBody, hazard: hazardBody };

// batch entries split on meta.actorType (or kind), parsed in a second step like homebrew items
const batchActor = z
  .object({
    kind: z.enum(["actor", "vehicle", "hazard"]).optional(),
    meta: z.object({ actorType: z.enum(["npc", "vehicle", "hazard"]).optional() }).passthrough(),
  })
  .passthrough()
  .transform((value, ctx): AnyActorDoc => {
    const { kind, ...fields } = value;
    const type = kind && kind !== "actor" ? kind : (value.meta.actorType ?? "npc");
    const parsed = bodyByType[type].safeParse(fields);
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
// spell list (§5)
// ---------------------------------------------------------------------------

// a spellcasting entry actors point at by id
const spellListFields = spellcastingFields.extend({ id: z.string().min(1) });

export type SpellListDoc = z.infer<typeof spellListFields>;

// ---------------------------------------------------------------------------
// envelope (§1)
// ---------------------------------------------------------------------------

const envelope = { schemaVersion: z.literal(1) };

// top-level keys are strict; a stray actors or items list is an error, not dropped
// a discriminated union only takes plain objects, so the spell list check runs after it
export const sheetFile = z
  .discriminatedUnion("kind", [
  actorBody.extend({ ...envelope, kind: z.literal("actor") }).strict(),
  vehicleBody.extend({ ...envelope, kind: z.literal("vehicle") }).strict(),
  hazardBody.extend({ ...envelope, kind: z.literal("hazard") }).strict(),
  spellListFields.extend({ ...envelope, kind: z.literal("spellList") }).strict(),
  actorPatchBody.extend({ ...envelope, kind: z.literal("actorPatch") }).strict(),
  itemPatchBody.extend({ ...envelope, kind: z.literal("itemPatch") }).strict(),
  // item fields sit next to kind; parse.ts runs them through sheetItem
  z.object({ ...envelope, kind: z.literal("item") }).passthrough(),
  z.object({ ...envelope, kind: z.literal("itemBatch"), items: z.array(sheetItem).min(1) }).strict(),
  z.object({
    ...envelope,
    kind: z.literal("actorBatch"),
    actors: z.array(batchActor).min(1),
    spellLists: z.array(spellListFields.extend({ kind: z.literal("spellList").optional() }).superRefine(checkSpellcastingFields)).default([]),
  })
    .strict(),
  ])
  .superRefine((doc, ctx) => {
    if (doc.kind === "spellList") checkSpellcastingFields(doc, ctx);
  });

export type SheetFile = z.infer<typeof sheetFile>;
