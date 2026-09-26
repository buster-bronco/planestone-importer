import CONSTANTS from "../constants";
import { exportActor, exportItem, exportYaml } from "../export";
import { vocabulary } from "../importer";
import { executePatch, type PatchResult } from "../patch/apply";
import { executeItemPatch, prepareItemPatchText, type ItemPatchPlan, type ItemPatchResult } from "../patch/item";
import { preparePatchText, type PatchPlan } from "../patch/prepare";
import { localize } from "../utils";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type Stage = "edit" | "preview" | "done";

// one dialog per npc or world item, opened from its sheet header
export default class PatchDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [`${CONSTANTS.MODULE_ID}`],
    tag: "div",
    window: { title: `${CONSTANTS.MODULE_ID}.patch.title`, icon: "fa-solid fa-file-pen", resizable: true },
    position: { width: 560, height: 520 },
    actions: {
      preview: PatchDialog.onPreview,
      apply: PatchDialog.onApply,
      back: PatchDialog.onBack,
      copySheet: PatchDialog.onCopySheet,
    },
  };

  static PARTS = {
    body: { template: `modules/${CONSTANTS.MODULE_ID}/templates/patch-dialog.hbs` },
  };

  private stage: Stage = "edit";
  private text = "";
  private plan: PatchPlan | ItemPatchPlan | null = null;
  private result: PatchResult | ItemPatchResult | null = null;
  private busy = false;

  constructor(private document: any, options: Record<string, unknown> = {}) {
    super({ id: PatchDialog.idFor(document), ...options });
  }

  // actors and items can share an id, so the document type is part of it
  static idFor(document: any): string {
    return `${CONSTANTS.MODULE_ID}-patch-${document.documentName.toLowerCase()}-${document.id}`;
  }

  private get isItem(): boolean {
    return this.document.documentName === "Item";
  }

  get title() {
    return `${localize(this.isItem ? "patch.itemTitle" : "patch.title")}: ${this.document.name}`;
  }


  async _prepareContext() {
    const plan = this.plan;
    return {
      isEdit: this.stage === "edit",
      isPreview: this.stage === "preview",
      isDone: this.stage === "done",
      busy: this.busy,
      text: this.text,
      hint: localize(this.isItem ? "patch.itemHint" : "patch.hint"),
      placeholder: this.isItem ? "schemaVersion: 1\nkind: itemPatch\nset:\n  traits: [concentrate]" : "schemaVersion: 1\nkind: actorPatch\nset:\n  core.ac: 23",
      errors: plan?.errors ?? [],
      warnings: plan?.warnings ?? [],
      changes: plan?.patch?.changes.changes ?? [],
      canApply: !!plan?.patch && !plan.errors.length && !this.busy,
      result: this.result,
    };
  }

  async _onRender(context: unknown, options: unknown) {
    await super._onRender(context, options);
    const textarea = this.element.querySelector("textarea[name=patchText]") as HTMLTextAreaElement | null;
    textarea?.addEventListener("input", () => (this.text = textarea.value));
    const input = this.element.querySelector("input[type=file]") as HTMLInputElement | null;
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.text = await file.text();
      await this.render();
    });
  }

  static async onPreview(this: PatchDialog) {
    if (this.busy || !this.text.trim()) return;
    this.busy = true;
    await this.render();
    try {
      this.plan = this.isItem
        ? await prepareItemPatchText(this.document, this.text)
        : await preparePatchText(this.document, this.text, vocabulary());
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.plan = { patch: null, errors: [(err as Error).message], warnings: [] };
    }
    this.busy = false;
    this.stage = "preview";
    await this.render();
  }

  static async onApply(this: PatchDialog) {
    const patch = this.plan?.patch;
    if (!patch || this.busy || this.plan?.errors.length) return;
    this.busy = true;
    await this.render();
    this.result = "item" in patch ? await executeItemPatch(patch) : await executePatch(patch);
    this.busy = false;
    this.stage = "done";
    if (this.result.ok) ui.notifications.info(`${localize(this.isItem ? "notify.itemPatched" : "notify.patched")}: ${this.document.name}`);
    else ui.notifications.error(`${localize("notify.patchFailed")}: ${this.result.error}`);
    await this.render();
  }

  // current document as a planestone sheet, as a starting point for a patch
  static async onCopySheet(this: PatchDialog) {
    const source = this.document.toObject();
    // compendium index entries are loaded at startup, so this stays sync
    const sourceName = (uuid: string) => {
      try {
        return fromUuidSync(uuid)?.name;
      } catch {
        return undefined;
      }
    };
    const text = exportYaml(this.isItem ? exportItem(source, sourceName) : exportActor(source, sourceName));
    await game.clipboard.copyPlainText(text);
    ui.notifications.info(`${localize("notify.copied")}: ${this.document.name}`);
  }

  // keeps the text so a failed patch can be fixed and retried
  static async onBack(this: PatchDialog) {
    this.stage = "edit";
    this.plan = null;
    this.result = null;
    await this.render();
  }
}
