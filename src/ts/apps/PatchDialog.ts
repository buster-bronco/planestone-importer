import yaml from "js-yaml";
import CONSTANTS from "../constants";
import { describeActorPatch, describeItemPatch, dumpPatch } from "../ai/describe";
import { splitReply } from "../ai/extract";
import { describeHunks, joinPatch, splitPatch, type Hunk, type HunkView, type RawDoc } from "../ai/hunks";
import { patchSystemPrompt } from "../ai/prompt";
import { AiSession } from "../ai/session";
import { vocabulary } from "../importer";
import { executePatch, type PatchResult } from "../patch/apply";
import { executeItemPatch, prepareItemPatchText, type ItemPatchPlan, type ItemPatchResult } from "../patch/item";
import { preparePatchText, type PatchPlan } from "../patch/prepare";
import { aiEnabled, aiSend, worldContext } from "../settings";
import { documentYaml, localize } from "../utils";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type Stage = "edit" | "preview" | "done" | "prompt" | "review";

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
      prompt: PatchDialog.onPrompt,
      send: PatchDialog.onSend,
      redo: PatchDialog.onRedo,
      correct: PatchDialog.onCorrect,
      editYaml: PatchDialog.onEditYaml,
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
  // busy waiting on the ai, not applying
  private thinking = false;

  // ai prompting; raw is the ai's patch before any hunk is rejected
  private request = "";
  private correction = "";
  private session: AiSession | null = null;
  private raw: RawDoc | null = null;
  private hunks: Hunk[] = [];
  private hunkViews: HunkView[] = [];
  private selected = new Set<string>();
  private notes = "";
  private aiError = "";

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
      isPrompt: this.stage === "prompt",
      isReview: this.stage === "review",
      showPlan: this.stage === "preview" || this.stage === "review",
      aiEnabled: aiEnabled(),
      busy: this.busy,
      applying: this.busy && !this.thinking,
      text: this.text,
      hint: localize(this.isItem ? "patch.itemHint" : "patch.hint"),
      placeholder: this.isItem ? "schemaVersion: 1\nkind: itemPatch\nset:\n  traits: [concentrate]" : "schemaVersion: 1\nkind: actorPatch\nset:\n  core.ac: 23",
      request: this.request,
      correction: this.correction,
      notes: this.notes,
      aiError: this.aiError,
      hunks: this.hunkViews.map((hunk) => ({ ...hunk, checked: this.selected.has(hunk.id) })),
      errors: plan?.errors ?? [],
      warnings: plan?.warnings ?? [],
      changes: plan?.patch?.changes.changes ?? [],
      canApply: !!plan?.patch && !plan.errors.length && !this.busy,
      result: this.result,
    };
  }

  async _onRender(context: unknown, options: unknown) {
    await super._onRender(context, options);
    const bind = (name: string, set: (value: string) => void) => {
      const textarea = this.element.querySelector(`textarea[name=${name}]`) as HTMLTextAreaElement | null;
      textarea?.addEventListener("input", () => set(textarea.value));
    };
    bind("patchText", (value) => (this.text = value));
    bind("request", (value) => (this.request = value));
    bind("correction", (value) => (this.correction = value));

    const input = this.element.querySelector("input[type=file]") as HTMLInputElement | null;
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.text = await file.text();
      await this.render();
    });

    for (const box of this.element.querySelectorAll("input[data-hunk]") as NodeListOf<HTMLInputElement>) {
      box.addEventListener("change", () => this.toggleHunk(box.dataset.hunk!, box.checked));
    }
  }

  private prepare(text: string): Promise<PatchPlan | ItemPatchPlan> {
    return this.isItem ? prepareItemPatchText(this.document, text) : preparePatchText(this.document, text, vocabulary());
  }

  static async onPreview(this: PatchDialog) {
    if (this.busy || !this.text.trim()) return;
    this.busy = true;
    await this.render();
    try {
      this.plan = await this.prepare(this.text);
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
    if (this.result.ok) {
      ui.notifications.info(`${localize(this.isItem ? "notify.itemPatched" : "notify.patched")}: ${this.document.name}`);
      // the ai saw the old sheet
      this.clearSession();
    } else ui.notifications.error(`${localize("notify.patchFailed")}: ${this.result.error}`);
    await this.render();
  }

  // current document as a planestone sheet, as a starting point for a patch
  static async onCopySheet(this: PatchDialog) {
    await game.clipboard.copyPlainText(documentYaml(this.document));
    ui.notifications.info(`${localize("notify.copied")}: ${this.document.name}`);
  }

  // keeps the text so a failed patch can be fixed and retried
  static async onBack(this: PatchDialog) {
    this.stage = "edit";
    this.plan = null;
    this.result = null;
    await this.render();
  }

  // --- ai prompting -----------------------------------------------------------

  private clearSession() {
    this.session = null;
    this.raw = null;
    this.hunks = [];
    this.hunkViews = [];
    this.selected.clear();
    this.notes = "";
    this.correction = "";
  }

  // a fresh prompt; the request text is kept for tweaking
  static async onPrompt(this: PatchDialog) {
    if (this.busy) return;
    this.clearSession();
    this.aiError = "";
    this.plan = null;
    this.result = null;
    this.stage = "prompt";
    await this.render();
  }

  static async onSend(this: PatchDialog) {
    if (this.busy || !this.request.trim()) return;
    const request = this.request;
    const start = async () => {
      const kind = this.isItem ? "itemPatch" : "actorPatch";
      const system = patchSystemPrompt({ kind, sheet: documentYaml(this.document), context: await worldContext() });
      return new AiSession(system, aiSend(), async (reply) => (await this.prepare(splitReply(reply).yaml)).errors);
    };
    await this.runAi(start, (session) => session.ask(request));
  }

  static async onRedo(this: PatchDialog) {
    const session = this.session;
    if (this.busy || !session) return;
    await this.runAi(async () => session, (session) => session.redo());
  }

  // follow-up turn; unchecked hunks are named so the ai drops them
  static async onCorrect(this: PatchDialog) {
    const session = this.session;
    const rejected = this.hunkViews.filter((hunk) => !this.selected.has(hunk.id)).map((hunk) => hunk.label);
    if (this.busy || !session || (!this.correction.trim() && !rejected.length)) return;
    const correction = this.correction;
    await this.runAi(async () => session, (session) => session.correct(correction, rejected));
  }

  // the joined patch goes to the plain yaml editor
  static async onEditYaml(this: PatchDialog) {
    if (this.busy) return;
    this.stage = "edit";
    this.plan = null;
    await this.render();
  }

  // start builds or reuses the session; world context files are read inside it
  private async runAi(start: () => Promise<AiSession>, call: (session: AiSession) => Promise<string>) {
    this.busy = this.thinking = true;
    this.aiError = "";
    await this.render();
    try {
      const session = await start();
      const reply = await call(session);
      this.session = session;
      this.correction = "";
      await this.loadReply(reply);
      this.stage = "review";
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.aiError = (err as Error).message;
    }
    this.busy = this.thinking = false;
    await this.render();
  }

  private async loadReply(reply: string) {
    const { yaml: text, notes } = splitReply(reply);
    this.notes = notes;
    let raw: unknown;
    try {
      raw = yaml.load(text);
    } catch {
      raw = null;
    }
    this.raw = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as RawDoc) : null;
    this.hunks = this.raw ? splitPatch(this.raw) : [];
    this.selected = new Set(this.hunks.map((hunk) => hunk.id));
    const source = this.document.toObject();
    const describe = this.isItem ? describeItemPatch(source) : describeActorPatch(source, vocabulary());
    this.hunkViews = this.raw ? describeHunks(this.raw, this.hunks, describe) : [];
    // unparseable replies still land in the editor as text
    if (!this.raw) this.text = text;
    await this.refreshPlan();
  }

  // the checked hunks → patch text → the same preview the editor uses
  private async refreshPlan() {
    if (this.raw) this.text = dumpPatch(joinPatch(this.raw, this.hunks, this.selected));
    try {
      this.plan = await this.prepare(this.text);
    } catch (err) {
      console.error(CONSTANTS.DEBUG_PREFIX, err);
      this.plan = { patch: null, errors: [(err as Error).message], warnings: [] };
    }
  }

  private async toggleHunk(id: string, checked: boolean) {
    if (this.busy) return;
    if (checked) this.selected.add(id);
    else this.selected.delete(id);
    this.busy = true;
    await this.refreshPlan();
    this.busy = false;
    await this.render();
  }
}
