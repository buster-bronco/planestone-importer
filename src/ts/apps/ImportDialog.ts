import CONSTANTS from "../constants";
import { splitReply } from "../ai/extract";
import { sheetSystemPrompt } from "../ai/prompt";
import { AiSession } from "../ai/session";
import { executeImport, folderOptions, prepareImport, type ImportPlan, type ImportResult } from "../importer";
import { repairErrors } from "../review";
import { aiEnabled, aiSend, worldContext } from "../settings";
import { conditionLintEnabled, localize, setConditionLint } from "../utils";
import { bindFixControls, fixContext, replaceLookupName } from "./fixView";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type Stage = "pick" | "prompt" | "preview" | "results";

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
      prompt: ImportDialog.onPrompt,
      send: ImportDialog.onSend,
      redo: ImportDialog.onRedo,
      refine: ImportDialog.onRefine,
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
  // ai prompting; the session lives until the gm goes back or imports
  private request = "";
  private refinement = "";
  private session: AiSession | null = null;
  private notes = "";
  private aiError = "";
  // busy waiting on the ai, not importing
  private thinking = false;
  // sheet text behind the current plan, re-prepared when fixes change
  private source = "";
  private lint = conditionLintEnabled();
  private rejectedFixes = new Set<string>();

  async _prepareContext() {
    const plan = this.plan;
    return {
      folders: folderOptions("Actor").map((folder) => ({ ...folder, selected: folder.id === this.folderId })),
      itemFolders: folderOptions("Item").map((folder) => ({ ...folder, selected: folder.id === this.itemFolderId })),
      stage: this.stage,
      isPick: this.stage === "pick",
      isPrompt: this.stage === "prompt",
      aiEnabled: aiEnabled(),
      hasSession: !!this.session,
      request: this.request,
      refinement: this.refinement,
      notes: this.notes,
      aiError: this.aiError,
      isPreview: this.stage === "preview",
      isResults: this.stage === "results",
      busy: this.busy,
      importing: this.busy && !this.thinking,
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
      review: fixContext(plan, this.lint, true),
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
    const request = this.element.querySelector("textarea[name=request]") as HTMLTextAreaElement | null;
    request?.addEventListener("input", () => (this.request = request.value));
    const refinement = this.element.querySelector("textarea[name=refinement]") as HTMLTextAreaElement | null;
    refinement?.addEventListener("input", () => (this.refinement = refinement.value));
    const folderSelect = this.element.querySelector("select[name=folder]") as HTMLSelectElement | null;
    folderSelect?.addEventListener("change", () => (this.folderId = folderSelect.value));
    const itemFolderSelect = this.element.querySelector("select[name=itemFolder]") as HTMLSelectElement | null;
    itemFolderSelect?.addEventListener("change", () => (this.itemFolderId = itemFolderSelect.value));
    bindFixControls(this.element, {
      toggleFix: (id, applied) => {
        if (applied) this.rejectedFixes.delete(id);
        else this.rejectedFixes.add(id);
        void this.reprepare();
      },
      toggleLint: async (enabled) => {
        this.lint = enabled;
        await setConditionLint(enabled);
        void this.reprepare();
      },
      pick: (name, candidate) => {
        const text = replaceLookupName(this.source, name, candidate);
        if (text === null) return ui.notifications.warn(`${localize("review.pickFailed")}: ${name}`);
        this.pasted = text;
        void this.load(this.fileName, async () => text);
      },
    });
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
      this.source = await read();
      this.plan = await this.prepare(this.source);
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.plan = { actors: [], vehicles: [], hazards: [], items: [], errors: [(err as Error).message], warnings: [], fixes: [], suggestions: [] };
    }
    this.busy = false;
    this.stage = "preview";
    await this.render();
  }

  private prepare(text: string): Promise<ImportPlan> {
    return prepareImport(text, { lint: this.lint, rejectFixes: this.rejectedFixes });
  }

  // same text, new fix choices
  private async reprepare() {
    if (this.busy || this.stage !== "preview") return;
    await this.load(this.fileName, async () => this.source);
  }

  static async onImport(this: ImportDialog) {
    if (!this.plan || this.busy) return;
    this.busy = true;
    await this.render();
    this.results = await executeImport(this.plan, { folderId: this.folderId || null, itemFolderId: this.itemFolderId || null });
    this.busy = false;
    this.stage = "results";
    this.clearSession();
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
    this.clearSession();
    this.aiError = "";
    this.stage = "pick";
    this.plan = null;
    this.results = [];
    this.fileName = "";
    this.rejectedFixes.clear();
    await this.render();
  }

  // --- ai prompting -----------------------------------------------------------

  private clearSession() {
    this.session = null;
    this.notes = "";
    this.refinement = "";
  }

  static async onPrompt(this: ImportDialog) {
    if (this.busy) return;
    this.clearSession();
    this.aiError = "";
    this.stage = "prompt";
    await this.render();
  }

  static async onSend(this: ImportDialog) {
    if (this.busy || !this.request.trim()) return;
    const validate = async (reply: string) => repairErrors(await this.prepare(splitReply(reply).yaml));
    const request = this.request;
    const start = async () => new AiSession(sheetSystemPrompt({ context: await worldContext() }), aiSend(), validate);
    await this.runAi(start, (session) => session.ask(request));
  }

  static async onRedo(this: ImportDialog) {
    const session = this.session;
    if (this.busy || !session) return;
    await this.runAi(async () => session, (session) => session.redo());
  }

  static async onRefine(this: ImportDialog) {
    const session = this.session;
    if (this.busy || !session || !this.refinement.trim()) return;
    const refinement = this.refinement;
    await this.runAi(async () => session, (session) => session.ask(refinement));
  }

  // the reply's yaml goes through the same load path as pasted text
  private async runAi(start: () => Promise<AiSession>, call: (session: AiSession) => Promise<string>) {
    this.busy = this.thinking = true;
    this.aiError = "";
    await this.render();
    let reply: string;
    let session: AiSession;
    try {
      session = await start();
      reply = await call(session);
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.aiError = (err as Error).message;
      this.busy = this.thinking = false;
      await this.render();
      return;
    }
    const { yaml, notes } = splitReply(reply);
    this.session = session;
    this.notes = notes;
    this.refinement = "";
    // back → pick shows the sheet for hand edits
    this.pasted = yaml;
    await this.load(localize("ai.generated"), async () => yaml);
    this.thinking = false;
  }
}
