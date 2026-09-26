import CONSTANTS from "./constants";
import { exportActor, exportItem, exportYaml } from "./export";

export class GameError extends Error {
  constructor(message: string) {
    super(`${CONSTANTS.MODULE_ID} | ${message}`);
    this.name = "GameError";
  }
}

export function getGame(): any {
  if (!game) throw new GameError("game instance not available");
  return game;
}

export function isCurrentUserGM(): boolean {
  return !!getGame().user?.isGM;
}

export function localize(key: string): string {
  return getGame().i18n.localize(`${CONSTANTS.MODULE_ID}.${key}`);
}

// compendium index entries are loaded at startup, so this stays sync
function compendiumName(uuid: string): string | undefined {
  try {
    return fromUuidSync(uuid)?.name;
  } catch {
    return undefined;
  }
}

// an npc or world item as planestone sheet yaml
export function documentYaml(document: any): string {
  const source = document.toObject();
  return exportYaml(document.documentName === "Item" ? exportItem(source, compendiumName) : exportActor(source, compendiumName));
}
