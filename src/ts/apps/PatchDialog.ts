import CONSTANTS from "../constants";
import { vocabulary } from "../importer";
import { executePatch, type PatchResult } from "../patch/apply";
import { preparePatchText, type PatchPlan } from "../patch/prepare";
import { localize } from "../utils";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type Stage = "edit" | "preview" | "done";

// one dialog per npc, opened from its sheet header
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
    },
  };

  static PARTS = {
    body: { template: `modules/${CONSTANTS.MODULE_ID}/templates/patch-dialog.hbs` },
  };

  private stage: Stage = "edit";
  private text = "";
  private plan: PatchPlan | null = null;
  private result: PatchResult | null = null;
  private busy = false;

  constructor(private actor: any, options: Record<string, unknown> = {}) {
    super({ id: `${CONSTANTS.MODULE_ID}-patch-${actor.id}`, ...options });
  }

  get title() {
    return `${localize("patch.title")}: ${this.actor.name}`;
  }

  async _prepareContext() {
    const plan = this.plan;
    return {
      isEdit: this.stage === "edit",
      isPreview: this.stage === "preview",
      isDone: this.stage === "done",
      busy: this.busy,
      text: this.text,
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
      this.plan = await preparePatchText(this.actor, this.text, vocabulary());
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
    this.result = await executePatch(patch);
    this.busy = false;
    this.stage = "done";
    if (this.result.ok) ui.notifications.info(`${localize("notify.patched")}: ${this.actor.name}`);
    else ui.notifications.error(`${localize("notify.patchFailed")}: ${this.result.error}`);
    await this.render();
  }

  // keeps the text so a failed patch can be fixed and retried
  static async onBack(this: PatchDialog) {
    this.stage = "edit";
    this.plan = null;
    this.result = null;
    await this.render();
  }
}
