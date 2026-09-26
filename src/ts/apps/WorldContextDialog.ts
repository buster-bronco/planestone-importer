import CONSTANTS from "../constants";
import { getGame, localize } from "../utils";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// edits the gm-only world context sent with every ai prompt
export default class WorldContextDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${CONSTANTS.MODULE_ID}-world-context`,
    classes: [`${CONSTANTS.MODULE_ID}`],
    tag: "div",
    window: { title: `${CONSTANTS.MODULE_ID}.worldContext.title`, icon: "fa-solid fa-earth-americas", resizable: true },
    position: { width: 600, height: 620 },
    actions: {
      save: WorldContextDialog.onSave,
      addFile: WorldContextDialog.onAddFile,
      removeFile: WorldContextDialog.onRemoveFile,
    },
  };

  static PARTS = {
    body: { template: `modules/${CONSTANTS.MODULE_ID}/templates/world-context.hbs` },
  };

  // null until the first render reads the settings
  private text: string | null = null;
  private files: string[] | null = null;

  async _prepareContext() {
    const settings = getGame().settings;
    this.text ??= settings.get(CONSTANTS.MODULE_ID, "aiWorldContext") as string;
    this.files ??= [...((settings.get(CONSTANTS.MODULE_ID, "aiWorldContextFiles") as string[]) ?? [])];
    return { text: this.text, files: this.files.map((path, index) => ({ path, index })) };
  }

  async _onRender(context: unknown, options: unknown) {
    await super._onRender(context, options);
    const textarea = this.element.querySelector("textarea[name=contextText]") as HTMLTextAreaElement | null;
    textarea?.addEventListener("input", () => (this.text = textarea.value));
  }

  // file picker type "text" lists .md, .txt and other text files in the data folder
  static async onAddFile(this: WorldContextDialog) {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    const picker = new FilePicker({
      type: "text",
      callback: async (path: string) => {
        if (!this.files!.includes(path)) this.files!.push(path);
        await this.render();
      },
    });
    await picker.browse();
  }

  static async onRemoveFile(this: WorldContextDialog, _event: Event, target: HTMLElement) {
    this.files!.splice(Number(target.dataset.index), 1);
    await this.render();
  }

  static async onSave(this: WorldContextDialog) {
    const settings = getGame().settings;
    await settings.set(CONSTANTS.MODULE_ID, "aiWorldContext", this.text ?? "");
    await settings.set(CONSTANTS.MODULE_ID, "aiWorldContextFiles", this.files ?? []);
    ui.notifications.info(localize("notify.contextSaved"));
    await this.close();
  }
}
