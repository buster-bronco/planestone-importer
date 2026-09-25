import CONSTANTS from "../constants";
import { executeImport, prepareImport, type ImportPlan, type ImportResult } from "../importer";
import { localize } from "../utils";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type Stage = "pick" | "preview" | "results";

export default class ImportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${CONSTANTS.MODULE_ID}-dialog`,
    classes: [`${CONSTANTS.MODULE_ID}`],
    tag: "div",
    window: { title: `${CONSTANTS.MODULE_ID}.dialog.title`, icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      import: ImportDialog.onImport,
      reset: ImportDialog.onReset,
    },
  };

  static PARTS = {
    body: { template: `modules/${CONSTANTS.MODULE_ID}/templates/import-dialog.hbs` },
  };

  private stage: Stage = "pick";
  private fileName = "";
  private plan: ImportPlan | null = null;
  private results: ImportResult[] = [];
  private busy = false;

  async _prepareContext() {
    const plan = this.plan;
    return {
      stage: this.stage,
      isPick: this.stage === "pick",
      isPreview: this.stage === "preview",
      isResults: this.stage === "results",
      busy: this.busy,
      fileName: this.fileName,
      errors: plan?.errors ?? [],
      warnings: plan?.warnings ?? [],
      canImport: !!plan && !plan.errors.length && plan.actors.length > 0 && !this.busy,
      actors: (plan?.actors ?? []).map((actor) => ({
        name: actor.doc.meta.name,
        level: actor.doc.meta.level,
        itemCount: actor.items.length + actor.weapons.length,
        weaponCount: actor.weapons.length,
      })),
      results: this.results,
    };
  }

  _onRender(context: unknown, options: unknown) {
    super._onRender(context, options);
    const input = this.element.querySelector("input[type=file]") as HTMLInputElement | null;
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.loadFile(file);
    });
  }

  private async loadFile(file: File) {
    this.fileName = file.name;
    this.busy = true;
    await this.render();
    try {
      this.plan = await prepareImport(await file.text());
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.plan = { actors: [], errors: [(err as Error).message], warnings: [] };
    }
    this.busy = false;
    this.stage = "preview";
    await this.render();
  }

  static async onImport(this: ImportDialog) {
    if (!this.plan || this.busy) return;
    this.busy = true;
    await this.render();
    this.results = await executeImport(this.plan);
    this.busy = false;
    this.stage = "results";
    const created = this.results.filter((result) => result.ok).length;
    ui.notifications.info(`${localize("notify.created")}: ${created}/${this.results.length}`);
    await this.render();
  }

  static async onReset(this: ImportDialog) {
    this.stage = "pick";
    this.plan = null;
    this.results = [];
    this.fileName = "";
    await this.render();
  }
}
