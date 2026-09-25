import "../styles/style.scss";
import CONSTANTS from "./constants";
import ImportDialog from "./apps/ImportDialog";
import { executeImport, prepareImport, type ImportOptions } from "./importer";
import { getGame, isCurrentUserGM, localize } from "./utils";

function openDialog() {
  return new ImportDialog().render({ force: true });
}

// text → created actors, for macros
async function importText(text: string, options: ImportOptions = {}) {
  const plan = await prepareImport(text);
  if (plan.errors.length) return { plan, results: [] };
  return { plan, results: await executeImport(plan, options) };
}

Hooks.once("init", () => {
  getGame().modules.get(CONSTANTS.MODULE_ID).api = { openDialog, prepareImport, executeImport, importText };
});

// adds the import button to the actors sidebar header
Hooks.on("renderActorDirectory", (_app: unknown, html: HTMLElement) => {
  if (!isCurrentUserGM() || getGame().system.id !== "pf2e") return;
  if (html.querySelector(`.${CONSTANTS.MODULE_ID}-open`)) return;
  const actions = html.querySelector(".header-actions");
  if (!actions) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${CONSTANTS.MODULE_ID}-open`;
  button.innerHTML = `<i class="fa-solid fa-file-import"></i> ${localize("sidebar.button")}`;
  button.addEventListener("click", () => openDialog());
  actions.append(button);
});
