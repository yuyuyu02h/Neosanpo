import type { SaveData } from './types.ts';
import { items } from './items.ts';

export const STORAGE_KEY = 'mayoimichi:v2';
export const LEGACY_STORAGE_KEY = 'mayoimichi:v1';
export const emptySave = (): SaveData => ({ version: 2, finds: [], walks: [], sound: false });

export function parseSave(raw: string | null): SaveData {
  if (!raw) return emptySave();
  const data = JSON.parse(raw);
  if (![1, 2].includes(data?.version) || !Array.isArray(data.finds) || !Array.isArray(data.walks))
    throw new Error('未対応の保存形式');
  const known = new Set(items.map((i) => i.id));
  const validDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const finds = data.finds.filter(
    (f: Record<string, unknown>) =>
      f &&
      typeof f.id === 'string' &&
      known.has(String(f.itemId)) &&
      typeof f.placeId === 'string' &&
      typeof f.placeName === 'string' &&
      validDate(f.foundAt) &&
      f.mode === 'live',
  );
  const ids = new Set(finds.map((f: { id: string }) => f.id));
  const walks = data.walks.filter(
    (w: Record<string, unknown>) =>
      w &&
      typeof w.id === 'string' &&
      ids.has(w.findId) &&
      validDate(w.startedAt) &&
      validDate(w.endedAt) &&
      typeof w.distance === 'number' &&
      Number.isFinite(w.distance) &&
      w.distance >= 0 &&
      w.mode === 'live',
  );
  return { version: 2, finds, walks, sound: data.sound === true };
}

export function loadSave(): { data: SaveData; error: boolean } {
  try {
    return {
      data: parseSave(
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY),
      ),
      error: false,
    };
  } catch {
    return { data: emptySave(), error: true };
  }
}

export function persist(data: SaveData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
