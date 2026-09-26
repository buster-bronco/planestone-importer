import "../styles/style.scss";
import CONSTANTS from "./constants";
import ImportDialog from "./apps/ImportDialog";
import PatchDialog from "./apps/PatchDialog";
import { executeImport, prepareImport, vocabulary, type ImportOptions } from "./importer";
import { executePatch } from "./patch/apply";
import { executeItemPatch, prepareItemPatchText } from "./patch/item";
import { preparePatchText } from "./patch/prepare";
import { splitReply } from "./ai/extract";
import { patchSystemPrompt, sheetSystemPrompt } from "./ai/prompt";
import { AiSession } from "./ai/session";
import { repairErrors, type ReviewOptions } from "./review";
import { aiSend, maskApiKey, registerSettings, worldContext } from "./settings";
import { documentYaml, getGame, isCurrentUserGM, localize } from "./utils";

function openDialog() {
  return new ImportDialog().render({ force: true });
}

// text → created actors, for macros
async function importText(text: string, options: ImportOptions & ReviewOptions = {}) {
  const plan = await prepareImport(text, options);
  if (plan.errors.length) return { plan, results: [] };
  return { plan, results: await executeImport(plan, options) };
}

// one dialog per document; a second click brings the open one forward
function openPatchDialog(document: any) {
  const open = foundry.applications.instances?.get(PatchDialog.idFor(document));
  return (open ?? new PatchDialog(document)).render({ force: true });
}

// patch text → one npc, for macros; actor is a document or uuid
async function applyPatch(actorOrUuid: any, text: string) {
  const actor = typeof actorOrUuid === "string" ? await fromUuid(actorOrUuid) : actorOrUuid;
  if (actor?.type !== "npc") throw new Error("applyPatch needs an npc actor");
  const plan = await preparePatchText(actor, text, vocabulary());
  if (plan.errors.length || !plan.patch) return { plan, result: null };
  return { plan, result: await executePatch(plan.patch) };
}

// patch text → one world item, for macros; item is a document or uuid
async function applyItemPatch(itemOrUuid: any, text: string) {
  const item = typeof itemOrUuid === "string" ? await fromUuid(itemOrUuid) : itemOrUuid;
  if (item?.documentName !== "Item" || item.parent || item.pack) throw new Error("applyItemPatch needs a world item");
  const plan = await prepareItemPatchText(item, text);
  if (plan.errors.length || !plan.patch) return { plan, result: null };
  return { plan, result: await executeItemPatch(plan.patch) };
}

// request → ai patch for one npc or world item, prepared but not applied
async function promptPatch(documentOrUuid: any, request: string) {
  const document = typeof documentOrUuid === "string" ? await fromUuid(documentOrUuid) : documentOrUuid;
  const isItem = document?.documentName === "Item";
  if (!isItem && document?.type !== "npc") throw new Error("promptPatch needs an npc actor or a world item");
  const prepare = (text: string) => (isItem ? prepareItemPatchText(document, text) : preparePatchText(document, text, vocabulary()));
  const system = patchSystemPrompt({ kind: isItem ? "itemPatch" : "actorPatch", sheet: documentYaml(document), context: await worldContext() });
  const session = new AiSession(system, aiSend(), async (reply) => repairErrors(await prepare(splitReply(reply).yaml)));
  const { yaml, notes } = splitReply(await session.ask(request));
  return { plan: await prepare(yaml), text: yaml, notes };
}

// request → ai sheet, prepared but not imported
async function promptSheet(request: string) {
  const session = new AiSession(sheetSystemPrompt({ context: await worldContext() }), aiSend(), async (reply) => repairErrors(await prepareImport(splitReply(reply).yaml)));
  const { yaml, notes } = splitReply(await session.ask(request));
  return { plan: await prepareImport(yaml), text: yaml, notes };
}

Hooks.once("init", () => {
  registerSettings();
  getGame().modules.get(CONSTANTS.MODULE_ID).api = {
    openDialog,
    prepareImport,
    executeImport,
    importText,
    openPatchDialog,
    applyPatch,
    applyItemPatch,
    promptPatch,
    promptSheet,
  };
});

Hooks.on("renderSettingsConfig", maskApiKey);

// adds the import button to the actors and items sidebar headers
function addImportButton(_app: unknown, html: HTMLElement) {
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
}

Hooks.on("renderActorDirectory", addImportButton);
Hooks.on("renderItemDirectory", addImportButton);

// adds a patch button to world npc sheet headers (pf2e sheets are appv1)
Hooks.on("getActorSheetHeaderButtons", (sheet: any, buttons: any[]) => {
  const actor = sheet.actor;
  if (!isCurrentUserGM() || actor?.type !== "npc" || actor.pack) return;
  buttons.unshift({
    label: localize("sheet.patch"),
    class: `${CONSTANTS.MODULE_ID}-patch`,
    icon: "fa-solid fa-file-pen",
    onclick: () => openPatchDialog(actor),
  });
});

// same for world item sheets; embedded items are patched through their actor
Hooks.on("getItemSheetHeaderButtons", (sheet: any, buttons: any[]) => {
  const item = sheet.item;
  if (!isCurrentUserGM() || !item || item.parent || item.pack) return;
  buttons.unshift({
    label: localize("sheet.patch"),
    class: `${CONSTANTS.MODULE_ID}-patch`,
    icon: "fa-solid fa-file-pen",
    onclick: () => openPatchDialog(item),
  });
});
