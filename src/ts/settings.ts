import CONSTANTS from "./constants";
import WorldContextDialog from "./apps/WorldContextDialog";
import { sendChat, type AiConfig, type ChatMessage, type Provider } from "./ai/client";
import { joinContext } from "./ai/prompt";
import { getGame, isCurrentUserGM } from "./utils";

const ID = CONSTANTS.MODULE_ID;
const key = (name: string) => `${ID}.settings.${name}`;

export function registerSettings() {
  const settings = getGame().settings;
  // client scope lives in this browser only, never in the world database
  settings.register(ID, "aiProvider", {
    name: key("aiProvider.name"),
    hint: key("aiProvider.hint"),
    scope: "client",
    config: true,
    type: String,
    choices: { none: key("aiProvider.none"), anthropic: key("aiProvider.anthropic"), openai: key("aiProvider.openai") },
    default: "none",
  });
  settings.register(ID, "aiApiKey", {
    name: key("aiApiKey.name"),
    hint: key("aiApiKey.hint"),
    scope: "client",
    config: true,
    type: String,
    default: "",
  });
  settings.register(ID, "aiModel", {
    name: key("aiModel.name"),
    hint: key("aiModel.hint"),
    scope: "client",
    config: true,
    type: String,
    default: "",
  });
  // world and user settings reach every client, so gm-only context stays client scope
  settings.register(ID, "aiWorldContext", { scope: "client", config: false, type: String, default: "" });
  // data folder paths, read fresh on every prompt
  settings.register(ID, "aiWorldContextFiles", { scope: "client", config: false, type: Array, default: [] });
  settings.registerMenu(ID, "aiWorldContextMenu", {
    name: key("aiWorldContext.name"),
    label: key("aiWorldContext.label"),
    hint: key("aiWorldContext.hint"),
    icon: "fa-solid fa-earth-americas",
    type: WorldContextDialog,
    restricted: true,
  });
}

// masks the api key field in the settings window
export function maskApiKey(_app: unknown, html: any) {
  const root: HTMLElement | undefined = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelector(`input[name="${ID}.aiApiKey"]`)?.setAttribute("type", "password");
}

export function aiConfig(): AiConfig | null {
  const settings = getGame().settings;
  const provider = settings.get(ID, "aiProvider") as Provider | "none";
  const apiKey = (settings.get(ID, "aiApiKey") as string).trim();
  if (provider === "none" || !apiKey) return null;
  return { provider, apiKey, model: (settings.get(ID, "aiModel") as string).trim() };
}

export function aiEnabled(): boolean {
  return isCurrentUserGM() && !!aiConfig();
}

function worldContextText(): string {
  return getGame().settings.get(ID, "aiWorldContext") as string;
}

function worldContextFiles(): string[] {
  return (getGame().settings.get(ID, "aiWorldContextFiles") as string[]) ?? [];
}

// the text box plus every listed file; a missing file fails the prompt
export async function worldContext(): Promise<string> {
  const files = await Promise.all(
    worldContextFiles().map(async (path) => {
      const response = await fetch(foundry.utils.getRoute(path)).catch(() => null);
      if (!response?.ok) throw new Error(`world context file not readable: ${path}`);
      return { path, content: await response.text() };
    }),
  );
  return joinContext(worldContextText(), files);
}

// chat sender bound to the current settings
export function aiSend(): (system: string, messages: ChatMessage[]) => Promise<string> {
  return (system, messages) => {
    const config = aiConfig();
    if (!config) throw new Error("no ai provider or api key set");
    return sendChat(config, system, messages);
  };
}
