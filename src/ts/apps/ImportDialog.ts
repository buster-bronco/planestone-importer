import CONSTANTS from "../constants";
import { executeImport, folderOptions, prepareImport, type ImportPlan, type ImportResult } from "../importer";
import { localize } from "../utils";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type Stage = "pick" | "preview" | "results";

export default class ImportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${CONSTANTS.MODULE_ID}-dialog`,
    classes: [`${CONSTANTS.MODULE_ID}`],
    tag: "div",
    window: { title: `${CONSTANTS.MODULE_ID}.dialog.title`, icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 560, height: 520 },
    actions: {
      import: ImportDialog.onImport,
      reset: ImportDialog.onReset,
      loadText: ImportDialog.onLoadText,
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
  // pasted text survives re-renders and going back
  private pasted = "";
  // empty string is the sidebar root
  private folderId = "";
  private itemFolderId = "";
  // folder document hooks, registered while the dialog is open
  private folderHooks: [string, number][] = [];

  async _prepareContext() {
    const plan = this.plan;
    return {
      folders: folderOptions("Actor").map((folder) => ({ ...folder, selected: folder.id === this.folderId })),
      itemFolders: folderOptions("Item").map((folder) => ({ ...folder, selected: folder.id === this.itemFolderId })),
      stage: this.stage,
      isPick: this.stage === "pick",
      isPreview: this.stage === "preview",
      isResults: this.stage === "results",
      busy: this.busy,
      fileName: this.fileName,
      pasted: this.pasted,
      errors: plan?.errors ?? [],
      warnings: plan?.warnings ?? [],
      hasActors: !!plan && plan.actors.length + plan.vehicles.length + plan.hazards.length > 0,
      canImport: !!plan && !plan.errors.length && plan.actors.length + plan.vehicles.length + plan.hazards.length + plan.items.length > 0 && !this.busy,
      actors: (plan?.actors ?? []).map((actor) => ({
        name: actor.doc.meta.name,
        level: actor.doc.meta.level,
        itemCount: actor.items.length + actor.weapons.length,
        weaponCount: actor.weapons.length,
      })),
      vehicles: (plan?.vehicles ?? []).map((vehicle) => ({
        name: vehicle.doc.meta.name,
        level: vehicle.doc.meta.level,
        itemCount: vehicle.items.length,
      })),
      hazards: (plan?.hazards ?? []).map((hazard) => ({
        name: hazard.doc.meta.name,
        level: hazard.doc.meta.level,
        complex: hazard.doc.core.complex,
        itemCount: hazard.items.length,
      })),
      items: (plan?.items ?? []).map((item) => ({ name: item.data.name, type: item.data.type })),
      results: await Promise.all(this.results.map(async (result) => ({ ...result, link: await this.resultLink(result) }))),
    };
  }

  // document.toAnchor() renders foundry's own content-link markup
  private async resultLink(result: ImportResult): Promise<string | null> {
    const uuid = result.actorUuid ?? result.itemUuid;
    if (!uuid) return null;
    const document = await fromUuid(uuid);
    return document ? document.toAnchor().outerHTML : result.name;
  }

  async _onRender(context: unknown, options: unknown) {
    await super._onRender(context, options);
    const input = this.element.querySelector("input[type=file]") as HTMLInputElement | null;
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.loadFile(file);
    });
    const textarea = this.element.querySelector("textarea[name=sheetText]") as HTMLTextAreaElement | null;
    textarea?.addEventListener("input", () => (this.pasted = textarea.value));
    const folderSelect = this.element.querySelector("select[name=folder]") as HTMLSelectElement | null;
    folderSelect?.addEventListener("change", () => (this.folderId = folderSelect.value));
    const itemFolderSelect = this.element.querySelector("select[name=itemFolder]") as HTMLSelectElement | null;
    itemFolderSelect?.addEventListener("change", () => (this.itemFolderId = itemFolderSelect.value));
  }

  async _onFirstRender(context: unknown, options: unknown) {
    await super._onFirstRender(context, options);
    const refresh = (folder: any) => {
      if (folder.type === "Actor" || folder.type === "Item") this.refreshFolderSelects();
    };
    this.folderHooks = ["createFolder", "updateFolder", "deleteFolder"].map((hook) => [hook, Hooks.on(hook, refresh)]);
  }

  _onClose(options: unknown) {
    super._onClose(options);
    for (const [hook, id] of this.folderHooks) Hooks.off(hook, id);
    this.folderHooks = [];
  }

  // rebuilds the dropdowns in place; a deleted selection falls back to root
  private refreshFolderSelects() {
    this.folderId = this.refreshFolderSelect("folder", "Actor", this.folderId);
    this.itemFolderId = this.refreshFolderSelect("itemFolder", "Item", this.itemFolderId);
  }

  private refreshFolderSelect(name: string, type: "Actor" | "Item", selected: string): string {
    const folders = folderOptions(type);
    if (selected && !folders.some((folder) => folder.id === selected)) selected = "";

    const select = this.element?.querySelector(`select[name=${name}]`) as HTMLSelectElement | null;
    if (!select) return selected;
    const root = select.options[0];
    select.replaceChildren(root, ...folders.map((folder) => new Option(folder.label, folder.id)));
    select.value = selected;
    return selected;
  }

  private async loadFile(file: File) {
    await this.load(file.name, () => file.text());
  }

  private async load(name: string, read: () => Promise<string>) {
    this.fileName = name;
    this.busy = true;
    await this.render();
    try {
      this.plan = await prepareImport(await read());
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.plan = { actors: [], vehicles: [], hazards: [], items: [], errors: [(err as Error).message], warnings: [] };
    }
    this.busy = false;
    this.stage = "preview";
    await this.render();
  }

  static async onImport(this: ImportDialog) {
    if (!this.plan || this.busy) return;
    this.busy = true;
    await this.render();
    this.results = await executeImport(this.plan, { folderId: this.folderId || null, itemFolderId: this.itemFolderId || null });
    this.busy = false;
    this.stage = "results";
    const created = this.results.filter((result) => result.ok).length;
    ui.notifications.info(`${localize("notify.imported")}: ${created}/${this.results.length}`);
    await this.render();
  }

  static async onLoadText(this: ImportDialog) {
    if (this.busy || !this.pasted.trim()) return;
    const text = this.pasted;
    await this.load(localize("dialog.pastedText"), async () => text);
  }

  static async onReset(this: ImportDialog) {
    this.stage = "pick";
    this.plan = null;
    this.results = [];
    this.fileName = "";
    await this.render();
  }
}
