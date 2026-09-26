# Planestone Importer

A Foundry VTT module that imports **Planestone sheet** files (YAML or JSON) as pf2e NPC actors, vehicles, hazards and world items. Built for my own game.

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
2. Actors or Items sidebar → **Import Sheet** → pick a `.yaml`, `.yml`, or `.json` file, or paste a sheet and hit **Load text**. Both buttons open the same dialog, and it accepts NPCs, vehicles, hazards and world items.
3. Check the preview (actors, item counts, world items, warnings), pick destination folders (they default to the sidebar roots) → **Import**.
4. To change an existing NPC or world item later, use **Patch** in its sheet header (see [Patches](#patches-actorpatch) and [Item patches](#item-patches-itempatch)).

Each imported actor is flagged with `flags.planestone-importer.{schemaVersion, source, freeArchetype}`, and each world item with `flags.planestone-importer.schemaVersion`.

Macro API:

```js
const api = game.modules.get("planestone-importer").api;
api.openDialog();
const { plan, results } = await api.importText(yamlString, { folderId: null, itemFolderId: null }); // folders optional, null = root
// every prepare also takes { lint, rejectFixes }; plan.fixes and plan.suggestions list what the translator changed or couldn't find
api.openPatchDialog(actorOrItem);
const { plan, result } = await api.applyPatch(actor, patchYaml); // actor document or uuid
const { plan, result } = await api.applyItemPatch(item, itemPatchYaml); // world item document or uuid
const { plan, text, notes } = await api.promptPatch(actorOrItem, "make it level 6"); // ai patch, prepared but not applied
const { plan, text, notes } = await api.promptSheet("a level 3 kobold trapmaster"); // ai sheet, prepared but not imported
```

## AI prompting (optional)

Set **AI provider** (Claude, OpenAI or OpenRouter) and **AI API key** in the module settings. Until both are set, none of the AI buttons show. The provider, key and model are client settings: they stay in your browser and are never saved to the world.

- **Prompt Patch** (Patch dialog): describe a change. The AI gets the document's current sheet (the same YAML as **Copy sheet**) and replies with a patch. Each change is a checkbox; untick the ones you don't want, and the change list below updates to show what **Apply** will do. **Send correction** continues the conversation and tells the AI which changes you rejected. **Redo** asks the same thing again. **Edit YAML** opens the patch in the normal editor.
- **Prompt Sheet** (Import dialog): describe something new. The AI writes a full sheet, and it goes through the normal import preview. **Refine** sends a follow-up, and **Redo** asks again.
- **World context** (module settings → **Edit world context**): setting notes sent with every prompt, e.g. "humans don't exist; kobolds are the dominant species". Type them in the text box, add `.md`/`.txt` files from the Foundry data folder, or both. Files are read fresh on every prompt, so you can keep editing them in another editor, and a missing file stops the prompt with an error. The notes and the file list are client settings, so they stay in your browser and players never receive them. (Foundry sends world and user settings to every client, so neither is private.) The files themselves are served by Foundry to anyone who knows their path, so keep secret notes in an out-of-the-way folder.

Every prompt also includes the sheet format section of this readme. If a reply doesn't validate, the errors are sent back to the AI once automatically. Everything in a prompt is sent to the provider you picked: the sheet, your request and the world context.

## Planestone sheet format (v1)

See [`examples/`](examples) for complete files: `actor.yaml`, `vehicle.yaml`, `hazard.yaml`, `batch.yaml`, `items.yaml`, `patch.yaml`, `item-patch.yaml` and `broken.yaml` (every validation error on purpose).

### Envelope

```yaml
schemaVersion: 1
kind: actor | vehicle | hazard | spellList | actorBatch | item | itemBatch | actorPatch | itemPatch
```

`actorBatch` holds `actors: [...]` and `spellLists: [...]`. Actors inside a batch don't need `schemaVersion`/`kind`. A batch can mix NPCs, vehicles and hazards: give a vehicle or hazard entry `meta.actorType: vehicle` or `meta.actorType: hazard`.

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
spellcasting: [...]             # see Spellcasting
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

Only `ac`, `saves.fortitude`, `hp.value`, `meta.name` and `meta.level` are required. Vehicle `items` take homebrew `action`/`passive` entries, homebrew gear, and `compendiumRef` actions or equipment. Strikes, `equippedWeapon` and spells are errors, because pf2e vehicle sheets have no strikes; write mounted weapons as homebrew actions. Vehicles can't be patched or copied yet.

### Hazard

A pf2e hazard actor: traps, haunts, environmental dangers. Use `kind: hazard`, or `kind: actor` with `meta.actorType: hazard`. See [`examples/hazard.yaml`](examples/hazard.yaml).

```yaml
meta: { name, actorType: hazard, level, source }
core:
  traits: [mechanical, trap]    # hazard trait slugs (CONFIG.PF2E.hazardTraits)
  rarity: common
  complex: false                # complex hazards roll initiative and use routine
  stealth: { mod: 12, notes: "(trained)" }   # required; DC is mod + 10
  description: "…"              # html, or plain text (wrapped in <p>)
  disable: "@Check[thievery|dc:21] (trained) to jam the mechanism"
  routine: "(1 action) …"       # complex hazards only
  reset: "…"
  ac: 21                        # optional
  saves: { fortitude: 13, reflex: 9 }   # any of the three; missing ones stay blank
  hardness: 8
  hp: { value: 32, notes: "…" } # optional; without hp the hazard can't be damaged
  emitsSound: encounter         # true | false | encounter
  resistances: [{ type, value, exceptions: [] }]
  weaknesses: [{ type, value }]
  immunities: [{ type }]
items: [...]
```

Only `stealth.mod`, `meta.name` and `meta.level` are required. `[[...]]` link marks work in `description`, `disable`, `routine`, `reset` and `stealth.notes`. Hazard `items` take homebrew actions, passives and `melee`/`ranged` strikes (with the same `attackEffects` rules as NPCs), plus homebrew gear and `compendiumRef` actions or equipment. `equippedWeapon` is an error because weapon strike math needs NPC attributes, and so are spells. A `routine` on a hazard that isn't `complex` gives a warning. Hazards can't be patched or copied yet.

### Items

**compendiumRef**: an existing pf2e item, found by name.

```yaml
- origin: compendiumRef
  refType: action | equipment | spell | feat | effect
  lookup: { name: "Reactive Strike", pack: "actionspf2e" }   # pack optional
```

Without a `pack` hint, the importer searches these packs in order and uses the first exact match (case-insensitive). If several items match, you get a warning. If nothing matches, or the `pack` hint names a pack that doesn't exist, that item is skipped with a warning and the rest of the sheet still imports.

A miss says why: `no weapon named "Daggor" in pf2e.equipment-srd; did you mean Dagger (0.83)?`, or `"Shield Block" is a feat, use refType: feat` when the name exists under another `refType`. Pre-remaster names resolve to their remaster item with a warning (`Magic Missile` → `Force Barrage`, `Flat-Footed` → `Off-Guard`).

| refType | packs |
|---|---|
| action | bestiary-ability-glossary-srd → actionspf2e → bestiary-family-ability-glossary → adventure-specific-actions |
| equipment | equipment-srd |
| spell | spells-srd (world items and `spellcasting` lists only; an actor's `items` rejects spells) |
| feat | feats-srd (not on vehicles or hazards) |
| effect | spell-effects → equipment-effects → feat-effects → other-effects |

**equippedWeapon**: a pf2e weapon turned into an NPC strike.

```yaml
- origin: equippedWeapon
  lookup: { name: "Longsword" }
  proficiency: trained | expert | master | legendary
  runes: { potency: 1, striking: 1 }
  abilityOverride: null         # any of str/dex/con/int/wis/cha, for the attack roll
  damageAbilityOverride: null   # any attribute, for damage
  keepInInventory: true
  equipped: held                # inventory fields, see below; need keepInInventory: true
```

The weapon is added to the NPC and pf2e's own `toNPCAttacks()` generates the strike. That covers traits, reach, range, thrown/reload, property-rune damage and the weapon link. The importer then replaces the numbers with PC-style math:

- **attack** = level + proficiency (2/4/6/8) + attribute + potency. The attribute is STR, or the higher of STR and DEX for finesse, or DEX for ranged and thrown attacks.
- **damage** = (1 + striking) × weapon die + modifier. Melee and thrown attacks add STR, propulsive adds half of a positive STR, and other ranged attacks add nothing.

Weapon specialization isn't added. With `keepInInventory: false` the weapon is removed afterwards, and the strike loses its weapon category and group.

**Inventory fields**: `compendiumRef` equipment, `equippedWeapon` and homebrew gear also take:

```yaml
  quantity: 3                   # overrides the compendium's own quantity
  equipped: true                # true | false | held | worn | dropped
  hands: 2                      # 1 | 2, with held or true
  invested: true                # items with the invested trait only
```

- `equipped: true` works it out from the item. Weapons, shields and items with a `held-in-…` usage are held, in two hands if the usage says two hands. Armor and items with a `worn…` usage are worn in their slot. Anything else gets a warning and stays carried.
- `held` and `worn` force that carry type. `false` (the default) means carried, not held and not in a slot.
- `invested` on an item without the invested trait is ignored with a warning.
- Coins are compendium treasure: `{ origin: compendiumRef, refType: equipment, lookup: { name: Gold Pieces }, quantity: 15 }`.
- Using these fields on actions, spells or an `equippedWeapon` with `keepInInventory: false` is an error.

**homebrew**: custom abilities, strikes, spells (see [Spellcasting](#spellcasting)) and gear.

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

```yaml
- origin: homebrew
  type: spell
  name: Border Ward
  rank: 1                      # base rank, 1–10; cantrips are rank 1
  cantrip: false               # adds the cantrip trait
  focus: false                 # adds the focus trait
  traditions: [primal]
  traits: [earth]
  rarity: common
  actions: 2                   # 1 | 2 | 3 | reaction | free | text like "1 minute"
  trigger: "…"                 # required for reactions
  requirements: ""
  range: 30                    # number → "30 feet", or text
  area: { type: burst, value: 10 }
  targets: "1 creature"
  duration: ""
  sustained: false
  defense: { save: reflex, basic: true }   # fortitude | reflex | will | ac (spell attack, adds the attack trait)
  damage: [{ formula: 2d6, type: bludgeoning, category: null }]   # category: persistent | splash
  heightening: { every: 1, damage: [1d6] }  # adds each formula to the damage at the same index
  description: "…"
```

```yaml
- origin: homebrew
  type: equipment              # equipment | consumable | treasure | backpack (pf2e item types)
  name: Wardstone Amulet
  level: 3                     # item level, default 0
  rarity: uncommon
  traits: [invested, magical]
  price: 60                    # gp, fractions allowed (0.5 = 5 sp); or { pp, gp, sp, cp }
  bulk: L                      # number, L or -; defaults to L (treasure: -)
  usage: wornamulet            # pf2e usage slug; defaults to held-in-one-hand (backpack: worn, treasure: none)
  description: "…"
  category: potion             # consumables: ammo, elixir, oil, poison, potion, scroll, talisman, wand, … (default other)
  uses: 1                      # consumables: charges, default 1
  capacity: 4                  # backpacks: bulk it holds, default 10
  ignored: 2                   # backpacks: bulk ignored, default 0
  quantity: 1                  # plus the inventory fields above
```

Homebrew spells go in a `spellcasting` list or in world items (`item`/`itemBatch`). An actor's `items` rejects them.

`attackEffects` entries must be slugs of action items on the same actor. The one exception is pf2e's built-in effects (`grab`, `improved-grab`, `constrict`, `greater-constrict`, `knockdown`, `improved-knockdown`, `push`, `improved-push`, `trip`): they only produce a warning when the actor has no matching item.

### Links in descriptions

Mark a term with `[[...]]` to link it:

```html
<p>The target becomes [[stupefied 1]] and [[off-guard]].</p>
```

Marks are looked up in `conditionitems`, then `actionspf2e`, and become `@UUID[...]{Stupefied 1}`. Unknown terms are left as plain text with a warning. Foundry inline rolls are left alone: `[[/r 1d6]]`, `[[/gmr …]]`, `[[2d6]]`, and any mark followed by `{label}`. Unmarked text is never linked.

### Automatic rolls

Bare dice in descriptions become clickable rolls on import and patch:

| Written | Becomes |
| --- | --- |
| `2d6 fire damage` | `@Damage[2d6[fire]] damage` |
| `1d6 persistent bleed damage` | `@Damage[1d6[persistent,bleed]] damage` |
| `1d8+4 slashing damage` | `@Damage[(1d8+4)[slashing]] damage` |
| `2d6+4 damage` | `@Damage[2d6+4] damage` |
| `1d4 rounds` | `[[/r 1d4]] rounds` |

Dice already inside `[[...]]`, `@Damage[...]`, `@Check[...]` or an html tag are left alone. Write `\2d6` to keep dice as plain text (`\\2d6` inside a double-quoted YAML string). This works in item descriptions, hazard text fields and vehicle descriptions. Legacy `positive`/`negative` damage becomes `vitality`/`void`.

### Condition lint

With **Lint conditions** ticked (a checkbox in the import and patch previews, saved per user), the text also gets:

| Written | Becomes |
| --- | --- |
| `frightened 2` | `[[frightened 2]]` |
| `confused` | `[[confused]]` |
| `flat-footed` or `[[flat-footed]]` | `[[off-guard]]` |
| `[[stupified 1]]` | `[[stupefied 1]]` |

Only the first plain mention of each condition in a text is marked, and only if it isn't linked there already. Conditions that are usually ordinary words (`hostile`, `friendly`, `broken`, `observed`, …) are skipped. Every automatic change, dice included, is listed under **Automatic text fixes** in the preview; untick one to keep that text as written.

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

- homebrew `action`/`passive`/`spell`, homebrew gear and `compendiumRef` of any `refType` work. Spells import as plain world spells, with no spellcasting entry needed.
- `quantity` works on world items. `equipped`, `hands` and `invested` are errors, because nobody is carrying the item.
- homebrew `melee`/`ranged` strikes and `equippedWeapon` are errors because strikes only exist on actors. For a plain world weapon, use `compendiumRef` with `refType: equipment`.
- `[[...]]` link marks work the same as on actors.

A file holds either actors or items, not both. Top-level keys are strict, so an `items:` list in an `actorBatch` (or `actors:` in an `itemBatch` or `item`) is an error instead of being dropped, as is any other unknown top-level key. Each item is created on its own, so one failure doesn't stop the rest.

### Spellcasting

An NPC's `spellcasting` is a list of entries. Each entry becomes a pf2e spellcasting entry holding its spells. An entry is either written inline or given as the `id` of a spell list in the same `actorBatch`. A single entry or id doesn't need a list around it.

```yaml
spellcasting:
  - armada-occult                   # id of an actorBatch spellLists entry
  - name: Warden Innate Spells      # optional; defaults to "<Tradition> <Type> Spells"
    tradition: primal               # arcane | divine | occult | primal
    type: innate                    # prepared | spontaneous | innate | focus
    ability: wis                    # defaults to cha
    dc: 21
    attack: 13                      # defaults to dc - 10
    focusPoints: 1                  # focus only, defaults to 1; the actor's pool is the total, max 3
    slots: { rank1: 3, rank2: 2 }   # spontaneous (required) or prepared; innate/focus have none
    spells:
      cantrips: [Know the Way]      # bare string = spells-srd name
      rank1:
        - { name: Pass Without Trace, uses: constant }
        - { origin: compendiumRef, lookup: { name: Heal, pack: spells-srd }, uses: 2 }
      rank2:
        - { origin: homebrew, type: spell, name: Border Ward, rank: 1, … }
```

- `spells` keys are `cantrips` and `rank1`–`rank10`. A spell is a name, `{ name, pack }`, a `compendiumRef` (`refType` can be left out), or a homebrew spell.
- A spell listed above its own rank is heightened to that rank. For prepared entries the slot handles the heightening. A spell listed below its own rank, a cantrip under a rank, or a non-cantrip under `cantrips` gets a warning and moves to where it belongs.
- Prepared spells fill their slots in order, and a repeated name prepares it twice. Without `slots`, each rank gets as many slots as it has spells.
- `uses` (innate only) is uses per day, or `at-will` / `constant`, which add pf2e's `(At Will)` / `(Constant)` name suffix.
- A spell that isn't found gets a warning and is dropped, and its entry and actor still import. Its prepared slot is dropped with it.

Spell lists share one entry between actors. They take the same fields plus an `id` and live under `actorBatch` → `spellLists`:

```yaml
spellLists:
  - id: armada-occult
    tradition: occult
    type: prepared
    ability: int
    dc: 20
    spells: { cantrips: [Daze, Shield], rank1: [Fear, Fear] }
```

A `kind: spellList` file on its own validates but imports nothing. Patches can't add or replace spells yet, and **Copy sheet** lists spells as not exported.

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

- Compendium items become `compendiumRef` entries that use the compendium entry's name and pack. Imported weapon strikes are grouped back into `equippedWeapon` entries. Physical items keep their `quantity` (when it isn't 1) and carry state (`equipped: held` with `hands`, `worn`, `dropped`, `invested`).
- Actions, strikes, and equipment/consumable/treasure/backpack items with no compendium source become `homebrew` entries. A reaction's trigger is split back out of its description.
- Descriptions are exported as stored HTML, so resolved links stay as `@UUID[...]` and don't turn back into `[[...]]` marks.
- Items with no sheet form, like NPC spells, effects, or hand-made weapons and armor, are listed as `# not exported:` comments at the top.

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
- any item: raw `system.*` paths and `rules` (below)

**Raw paths** reach any field of any item type. **Copy sheet** on a world item lists the item's paths as comments.

```yaml
set:
  system.level.value: 3
  system.price.value.gp: 40
  rules:                          # replaces the item's whole rule element list
    - { key: FlatModifier, selector: ac, type: item, value: 1 }
```

- A path must already exist on the item, or be a new key next to real ones (`price.value.gp` when only `sp` is set). A typo gets a suggestion: `no system.levle.value; did you mean system.level.value?`
- The value's type has to match what's there (number, string, boolean, array, object); `null` clears it.
- Paths with their own field are errors pointing at it: `system.description` → `description`, `system.traits.value` → `traits`, and likewise `rules`, `runes`, `actionType`, `category`, `attackBonus`, `damageRolls`, `attackEffects` and the slug.
- Each rule needs a `key`; in Foundry it's checked against pf2e's rule elements.
- In an actor patch's `items.update`, a `set` with only raw fields matches any item type; typed fields still only match actions and strikes.

Renaming an action changes its slug too. Renaming a compendium item (weapon, spell, equipment) keeps its slug so rule elements that point at it keep working. The whole patch is a single `item.update()`, so a failure leaves the item unchanged.

## Batch behaviour

The whole file is validated first. If anything is invalid (bad fields, missing required values, broken `attackEffects`), nothing is created. Compendium lookups are the exception: a `compendiumRef` or `equippedWeapon` that doesn't resolve is skipped with a warning, and its actor imports without it. World items work the same way. Once validation passes, each actor is created on its own. If one fails partway through (for example while generating a weapon strike), it's deleted and reported, and the others still import.
