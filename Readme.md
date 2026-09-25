# NPC Sheet Importer

A Foundry VTT module that imports **Planestone sheet** files (YAML or JSON) as pf2e NPC actors. Built for my own game.

- Foundry **v13–v14**, pf2e **7.2.x**
- GM-only **Import Sheet** button in the Actors sidebar
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
FOUNDRY_VTT_PATH="C:/Users/tripl/AppData/Local/FoundryVTT/Data/modules/npc-sheet-importer"
```

Use forward slashes: dotenv turns `\n` in a double-quoted value into a newline.

Releases work like emotive-hud: publishing a GitHub release runs `.github/workflows/publish.yml`, which builds and attaches `module.json` and `module.zip`.

## Usage

1. Enable the module in a pf2e world.
2. Actors sidebar → **Import Sheet** → pick a `.yaml`, `.yml`, or `.json` file, or paste a sheet and hit **Load text**.
3. Check the preview (actors, item counts, warnings), pick a destination folder (defaults to the Actors root) → **Import**.
4. To change an existing NPC later, use **Patch** in its sheet header (see [Patches](#patches-actorpatch)).

Each imported actor is flagged with `flags.npc-sheet-importer.{schemaVersion, source, freeArchetype}`.

Macro API:

```js
const api = game.modules.get("npc-sheet-importer").api;
api.openDialog();
const { plan, results } = await api.importText(yamlString, { folderId: null }); // folderId optional, null = root
api.openPatchDialog(actor);
const { plan, result } = await api.applyPatch(actor, patchYaml); // actor document or uuid
```

## Planestone sheet format (v1)

See [`examples/`](examples) for complete files: `actor.yaml`, `batch.yaml` and `broken.yaml` (every validation error on purpose).

### Envelope

```yaml
schemaVersion: 1
kind: actor | spellList | actorBatch
```

`actorBatch` holds `actors: [...]` and `spellLists: [...]`. Actors inside a batch don't need `schemaVersion`/`kind`.

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

Weapon strikes carry `flags.npc-sheet-importer.strike`. When a patch changes the level or an attribute, those strikes are recalculated with the PC-style math. Homebrew and hand-made strikes keep their numbers, and you get a warning. Strikes imported before this feature don't have the flag, so re-import the actor to get recalculation.

The preview lists every change before anything is written. If applying a patch fails partway, the actor is restored from a snapshot.

## Batch behaviour

The whole file is validated first. If anything is invalid, nothing is created. Once validation passes, each actor is created on its own. If one fails partway through (for example while generating a weapon strike), it's deleted and reported, and the others still import.
