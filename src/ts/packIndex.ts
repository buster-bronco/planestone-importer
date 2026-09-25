import CONSTANTS from "./constants";
import type { LinkTarget } from "./linkMarks";

interface IndexEntry {
  _id: string;
  name: string;
  type: string;
  uuid: string;
}

export interface LookupHit {
  uuid: string;
  pack: string;
  alternatives: string[];
}

// "equipment-srd" → "pf2e.equipment-srd"
export function normalizePackId(pack: string): string {
  return pack.includes(".") ? pack : `pf2e.${pack}`;
}

// caches compendium indexes for one import run
export class PackIndex {
  private indexes = new Map<string, IndexEntry[]>();

  async entries(packId: string): Promise<IndexEntry[] | null> {
    const cached = this.indexes.get(packId);
    if (cached) return cached;
    const pack = game.packs.get(packId);
    if (!pack) return null;
    // index entries carry their own uuid
    const entries: IndexEntry[] = [...(await pack.getIndex())];
    this.indexes.set(packId, entries);
    return entries;
  }

  // exact case-insensitive name match across packs in priority order
  async find(packIds: readonly string[], name: string, types?: string[]): Promise<LookupHit | null> {
    const wanted = name.trim().toLowerCase();
    const hits: { uuid: string; pack: string }[] = [];
    for (const packId of packIds) {
      const entries = await this.entries(packId);
      for (const entry of entries ?? []) {
        if (entry.name.toLowerCase() !== wanted) continue;
        if (types && !types.includes(entry.type)) continue;
        hits.push({ uuid: entry.uuid, pack: packId });
      }
    }
    if (!hits.length) return null;
    return { ...hits[0], alternatives: hits.slice(1).map((hit) => hit.uuid) };
  }

  // name → link target map for [[term]] marks, first pack wins
  async linkTargets(): Promise<Map<string, LinkTarget>> {
    const targets = new Map<string, LinkTarget>();
    for (const packId of CONSTANTS.LINK_PACKS) {
      for (const entry of (await this.entries(packId)) ?? []) {
        const key = entry.name.toLowerCase();
        if (!targets.has(key)) targets.set(key, { uuid: entry.uuid, name: entry.name });
      }
    }
    return targets;
  }
}
