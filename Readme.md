# Planestone Importer

A Foundry VTT module that imports **Planestone sheet** files (YAML or JSON) as pf2e NPC actors, vehicles and world items. Built for my own game.

- Foundry **v13–v14**, pf2e **7.2.x**
- GM-only **Import Sheet** button in the Actors and Items sidebars
- Preview before anything is created: errors block the import, warnings don't

## Development

```sh
npm install
npm run dev        # watch build, copies dist/ into the Foundry modules folder
npm test           # vitest unit tests (no Foundry needed)
npm run typecheck
npm run build      # production build into dist/
```

`npm run dev` copies to the path in `.env`:

```
FOUNDRY_VTT_PATH="C:/Users/tripl/AppData/Local/FoundryVTT/Data/modules/planestone-importer"
```

Use forward slashes: dotenv turns `\n` in a double-quoted value into a newline.

Releases work like emotive-hud: publishing a GitHub release runs `.github/workflows/publish.yml`, which builds and attaches `module.json` and `module.zip`.

## Usage

1. Enable the module in a pf2e world.
2. Actors or Items sidebar → **Import Sheet** → pick a `.yaml`, `.yml`, or `.json` file, or paste a sheet and hit **Load text**. Both buttons open the same dialog, and it accepts NPCs, vehicles and world items.
3. Check the preview (actors, item counts, world items, warnings), pick destination folders (they default to the sidebar roots) → **Import**.
4. To change an existing NPC or world item later, use **Patch** in its sheet header (see [Patches](#patches-actorpatch) and [Item patches](#item-patches-itempatch)).

Each imported actor is flagged with `flags.planestone-importer.{schemaVersion, source, freeArchetype}`, and each world item with `flags.planestone-importer.schemaVersion`.

Macro API:

```js
const api = game.modules.get("planestone-importer").api;
api.openDialog();
const { plan, results } = await api.importText(yamlString, { folderId: null, itemFolderId: null }); // folders optional, null = root
api.openPatchDialog(actorOrItem);
const { plan, result } = await api.applyPatch(actor, patchYaml); // actor document or uuid
const { plan, result } = await api.applyItemPatch(item, itemPatchYaml); // world item document or uuid
```

## Planestone sheet format (v1)

See [`examples/`](examples) for complete files: `actor.yaml`, `vehicle.yaml`, `batch.yaml`, `items.yaml`, `patch.yaml`, `item-patch.yaml` and `broken.yaml` (every validation error on purpose).

### Envelope

```yaml
schemaVersion: 1
kind: actor | vehicle | spellList | actorBatch | item | itemBatch | actorPatch | itemPatch
```

`actorBatch` holds `actors: [...]` and `spellLists: [...]`. Actors inside a batch don't need `schemaVersion`/`kind`. A batch can mix NPCs and vehicles: give a vehicle entry `meta.actorType: vehicle`.

### Actor

```yaml
meta: { name, actorType: npc, level, freeArchetype: false, source }
core:
  traits: [humanoid]            # creature trait slugs; ancestry is added as a trait
  rarity: common
  size: medium                  # tiny/small/medium/large/huge/gargantuan
  languages: [common, draconic] # non-pf2e languages go to the details text
  abilities: { str, dex, con, int, wis, cha }   # modifiers
  perception: { mod, senses: ["darkvision", "scent (imprecise) 30 feet"] }
  ac: 21
  saves: { fortitude, reflex, will }
  hp: { value, notes }
  speed: { value: 25, other: [{ type: climb, value: 15 }] }
  skills:
    named: { athletics: 12 }
    lore: [{ name: "Dranura Politics", mod: 8 }]
  resistances: [{ type, value, exceptions: [] }]
  weaknesses: [{ type, value }]
  immunities: [{ type }]
items: [...]
```

Senses use `name (precise|imprecise|vague) N feet`, and the acuity and range parts are optional. `alignment` is accepted but ignored because the pf2e remaster removed it.

### Vehicle

A pf2e vehicle actor. Use `kind: vehicle`, or `kind: actor` with `meta.actorType: vehicle`. See [`examples/vehicle.yaml`](examples/vehicle.yaml).

```yaml
meta: { name, actorType: vehicle, level, source }
core:
  traits: [magical]             # vehicle trait slugs (CONFIG.PF2E.vehicleTraits)
  rarity: common
  size: huge                    # defaults to large
  description: "…"              # html, or plain text (wrapped in <p>)
  price: 750                    # gp
  space: { long: 30, wide: 20, high: 15 }   # feet
  crew: "1 pilot, 2 crew"
  passengers: 5                 # number or text
  pilotingCheck: "Sailing Lore (DC 22)"
  ac: 20
  saves: { fortitude: 14 }      # vehicles only have fortitude
  hardness: 5
  hp: { value: 90, notes: "BT 45" }
  speed: "40 feet (rowed, wind)"   # text; a bare number becomes "N feet"
  collision: { dc: 22, damage: "4d10" }   # optional
  emitsSound: encounter         # true | false | encounter
  resistances: [{ type, value, exceptions: [] }]
  weaknesses: [{ type, value }]
  immunities: [{ type }]        # defaults to [{ type: object-immunities }]
items: [...]
```

Only `ac`, `saves.fortitude`, `hp.value`, `meta.name` and `meta.level` are required. Vehicle `items` take homebrew `action`/`passive` entries and `compendiumRef` actions or equipment. Strikes, `equippedWeapon` and spells are errors, because pf2e vehicle sheets have no strikes; write mounted weapons as homebrew actions. Vehicles can't be patched or copied yet.

### Items

**compendiumRef**: an existing pf2e item, found by name.

```yaml
- origin: compendiumRef
  refType: action | equipment | spell
  lookup: { name: "Reactive Strike", pack: "actionspf2e" }   # pack optional
```

Without a `pack` hint, the importer searches these packs in order and uses the first exact match (case-insensitive). If several items match, you get a warning.

| refType | packs |
|---|---|
| action | bestiary-ability-glossary-srd → actionspf2e → bestiary-family-ability-glossary → adventure-specific-actions |
| equipment | equipment-srd |
| spell | spells-srd (skipped with a warning until spellcasting lands) |

**equippedWeapon**: a pf2e weapon turned into an NPC strike.

```yaml
- origin: equippedWeapon
  lookup: { name: "Longsword" }
  proficiency: trained | expert | master | legendary
  runes: { potency: 1, striking: 1 }
  abilityOverride: null         # any of str/dex/con/int/wis/cha, for the attack roll
  damageAbilityOverride: null   # any attribute, for damage
  keepInInventory: true
```

The weapon is added to the NPC and pf2e's own `toNPCAttacks()` generates the strike. That covers traits, reach, range, thrown/reload, property-rune damage and the weapon link. The importer then replaces the numbers with PC-style math:

- **attack** = level + proficiency (2/4/6/8) + attribute + potency. The attribute is STR, or the higher of STR and DEX for finesse, or DEX for ranged and thrown attacks.
- **damage** = (1 + striking) × weapon die + modifier. Melee and thrown attacks add STR, propulsive adds half of a positive STR, and other ranged attacks add nothing.

Weapon specialization isn't added. With `keepInInventory: false` the weapon is removed afterwards, and the strike loses its weapon category and group.

**homebrew**: custom abilities and strikes.

```yaml
- origin: homebrew
  type: action                 # or passive
  name: Hold the Line
  actionType: reaction         # passive | free | reaction | 1 | 2 | 3
  category: defensive          # offensive | defensive | interaction
  trigger: "An ally within 10 feet is hit."   # required for reactions
  traits: []
  description: "<p>…</p>"      # html, or plain text (wrapped in <p>)

- origin: homebrew
  type: melee                  # or ranged
  name: Shield Bash
  attackBonus: 13
  damageRolls: [{ damage: "1d6+4", damageType: bludgeoning }]
  traits: [agile]
  range: null                  # ranged only → range-increment-N
  attackEffects: [knockdown-crash]
```

`attackEffects` entries must be slugs of action items on the same actor. The one exception is pf2e's built-in effects (`grab`, `improved-grab`, `constrict`, `greater-constrict`, `knockdown`, `improved-knockdown`, `push`, `improved-push`, `trip`): they only produce a warning when the actor has no matching item.

### Links in descriptions

Mark a term with `[[...]]` to link it:

```html
<p>The target becomes [[stupefied 1]] and [[off-guard]].</p>
```

Marks are looked up in `conditionitems`, then `actionspf2e`, and become `@UUID[...]{Stupefied 1}`. Unknown terms are left as plain text with a warning. Foundry inline rolls are left alone: `[[/r 1d6]]`, `[[/gmr …]]`, `[[2d6]]`, and any mark followed by `{label}`. Unmarked text is never linked.

### World items (`item`, `itemBatch`)

World items land in the Items sidebar instead of on an NPC. They use the same item entries as an actor's `items`, with a few limits:

```yaml
schemaVersion: 1
kind: item                  # one item, fields next to kind
origin: homebrew
type: action
name: Brace
actionType: 1
```

```yaml
schemaVersion: 1
kind: itemBatch
items:
  - { origin: homebrew, type: passive, name: Border Sense }
  - { origin: compendiumRef, refType: equipment, lookup: { name: Longsword } }
  - { origin: compendiumRef, refType: spell, lookup: { name: Daze } }
```

- homebrew `action`/`passive` and `compendiumRef` of any `refType` work. Spells are imported too, since a world spell doesn't need a spellcasting entry.
- homebrew `melee`/`ranged` strikes and `equippedWeapon` are errors because strikes only exist on actors. For a plain world weapon, use `compendiumRef` with `refType: equipment`.
- `[[...]]` link marks work the same as on actors.

A file holds either actors or items, not both, because each envelope `kind` holds one or the other. Each item is created on its own, so one failure doesn't stop the rest.

### Spell lists (reserved)

```yaml
kind: spellList
id: armada-occult
tradition: arcane | divine | occult | primal
basis: spellDC | spellAttack
dcOrAttack: 20
slots: { cantrips: [...], rank1: [...] }
```

Spell lists are validated, and an actor's `spellcasting: <id>` must point at one. They aren't imported yet.

### Patches (`actorPatch`)

A patch changes an existing NPC, including ones this module didn't create. Open the NPC's sheet and click **Patch** in the header (GM only, world actors only). Paste the patch or load it from a file, check the preview, then **Apply**. The sidebar importer only creates actors and rejects patches. See [`examples/patch.yaml`](examples/patch.yaml).

```yaml
schemaVersion: 1
kind: actorPatch
target: { name: Dranura Border Warden }   # optional safety check
set:
  meta.level: 5
  core.ac: 23
  core: { saves: { will: 13 } }            # nested objects work too
  core.skills.named.stealth: 10            # null removes the skill
  core.traits: [humanoid, human]           # a list replaces the whole list
add:
  core.resistances: [{ type: cold, value: 5 }]
  core.skills.lore: [{ name: Sailing, mod: 7 }]
remove:
  core.weaknesses: [fire]
  core.skills.named: [survival]
items:
  remove: ["Shield Bash"]
  update:
    - match: Hold the Line
      set: { trigger: "…", description: "…" }
    - match: Longsword
      set: { proficiency: master, runes: { potency: 2 } }
  replace:
    - match: Knockdown Crash
      with: { origin: homebrew, type: action, name: Knockdown Crash, actionType: 2 }
  add:
    - { origin: compendiumRef, refType: action, lookup: { name: Grab } }
```

**Target**: the sheet you open the dialog from is always the actor that gets patched. `target` is optional. If you include it (`name` or `uuid`), the patch refuses to apply to any other sheet.

**`set` paths**: `meta.name`, `meta.level`, `meta.source`, `core.rarity`, `core.size`, `core.ac`, `core.hp.value`, `core.hp.notes`, `core.perception.mod`, `core.speed.value`, `core.saves.*`, `core.abilities.*`, `core.skills.named` and `core.skills.named.<skill>`. Every list path below can also be `set`. If an NPC is at full HP and its max HP changes, its current HP moves with it.

**List paths for `add`/`remove`**: `add` replaces any entry that has the same key. `remove` takes key strings.

| path | key |
|---|---|
| `core.traits`, `core.languages` | slug |
| `core.perception.senses` | sense type |
| `core.speed.other`, `core.resistances`, `core.weaknesses`, `core.immunities` | `type` |
| `core.skills.lore` | name, with or without "Lore" |
| `core.skills.named` (remove only) | skill slug |

When `add` rewrites an IWR list, entries you didn't name keep any extra fields, like `doubleVs`.

**Items** are matched by name (case-insensitive). `remove` and `replace` hit every item with that name, so `remove: [Longsword]` removes both the weapon and its strike. `update.set` accepts:

- any item: `name`, `description`, `traits`
- actions: `actionType`, `category`, `trigger` (needs `description` in the same `set`)
- strikes: `attackBonus`, `damageRolls`, `attackEffects`
- weapon strikes: `proficiency`, `runes`, `abilityOverride`, `damageAbilityOverride`

Weapon strikes carry `flags.planestone-importer.strike`. When a patch changes the level or an attribute, those strikes are recalculated with the PC-style math. Homebrew and hand-made strikes keep their numbers, and you get a warning. Strikes imported before this feature don't have the flag, so re-import the actor to get recalculation.

The preview lists every change before anything is written. If applying a patch fails partway, the actor is restored from a snapshot.

### Copy sheet

**Copy sheet** in the Patch dialog copies the NPC's or item's current state to the clipboard as a Planestone sheet (`kind: actor` or `kind: item`). You can use it as a reference while writing a patch, or re-import it as a copy.

- Compendium items become `compendiumRef` entries that use the compendium entry's name and pack. Imported weapon strikes are grouped back into `equippedWeapon` entries.
- Actions and strikes with no compendium source become `homebrew` entries. A reaction's trigger is split back out of its description.
- Descriptions are exported as stored HTML, so resolved links stay as `@UUID[...]` and don't turn back into `[[...]]` marks.
- Items with no sheet form, like NPC spells, effects or hand-made loot, are listed as `# not exported:` comments at the top.

### Item patches (`itemPatch`)

An item patch changes one world item. Open the item's sheet and click **Patch** in the header (GM only, world items only; items on an actor are patched through the actor's `items.update`). See [`examples/item-patch.yaml`](examples/item-patch.yaml).

```yaml
schemaVersion: 1
kind: itemPatch
target: { name: Hold the Line }   # optional safety check, name or uuid
set:
  trigger: "An ally within 15 feet is hit."
  description: "…"
  traits: [flourish]
```

`set` takes the same fields as an actor patch's `items.update.set`, checked against the item's type:

- any item: `name`, `description`, `traits`
- actions: `actionType`, `category`, `trigger` (needs `description` in the same `set`)
- weapons: `runes`
- `proficiency`, `abilityOverride` and `damageAbilityOverride` only affect NPC strikes, so they're errors here

Renaming an action changes its slug too. Renaming a compendium item (weapon, spell, equipment) keeps its slug so rule elements that point at it keep working. The whole patch is a single `item.update()`, so a failure leaves the item unchanged.

## Batch behaviour

The whole file is validated first. If anything is invalid, nothing is created. Once validation passes, each actor is created on its own. If one fails partway through (for example while generating a weapon strike), it's deleted and reported, and the others still import.
