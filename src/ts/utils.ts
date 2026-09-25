import CONSTANTS from "./constants";

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
