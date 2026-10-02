import type { FeatureCollection, Point } from 'geojson';
import { stableHash, distance } from './geo.ts';
import { elementRings, ringContains, type OSMElement } from './navigation.ts';
import type { Coordinate } from './types.ts';

// 素材を追加しても既存の割当は変えない。v1の4枠は変更しない。
export const STRUCTURE_ASSETS = {
  castle: '/fantasy/castle.webp',
  tower: '/fantasy/tower.webp',
  village: '/fantasy/village.webp',
  ruins: '/fantasy/ruins.webp',
} as const;
export type StructureArt = keyof typeof STRUCTURE_ASSETS;
const BUILDING_SLOTS_V1: readonly StructureArt[] = ['castle', 'tower', 'village', 'tower'];
const PARK_SLOTS_V1: readonly StructureArt[] = ['ruins', 'village', 'ruins', 'village'];
export interface Structure {
  id: string;
  coordinate: Coordinate;
  art: StructureArt;
  meters: number;
}
// 個別の配置・追加素材の割当はOSMのIDで指定する。既存の枠を増やさない。
export const STRUCTURE_OVERRIDES: Readonly<Record<string, Partial<Omit<Structure, 'id'>>>> = {};

function anchor(ring: Coordinate[]): Coordinate {
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  const center: Coordinate = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  if (ringContains(center, ring)) return center;
  // 凹型の地物も、全形状に対する固定の走査で内部の点を選ぶ。
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  for (let y = 1; y < 12; y++)
    for (let x = 1; x < 12; x++) {
      const p: Coordinate = [x0 + ((x1 - x0) * x) / 12, y0 + ((y1 - y0) * y) / 12];
      if (ringContains(p, ring)) return p;
    }
  return [...ring[0]];
}
export function structuresFromOSM(elements: OSMElement[]): Structure[] {
  const result = new Map<string, Structure>();
  for (const e of elements) {
    const park = e.tags?.leisure === 'park';
    if (!park && (!e.tags?.building || e.tags.building === 'no')) continue;
    if (e.type !== 'way' && e.type !== 'relation') continue;
    const id = `osm:${e.type}:${e.id}`;
    const hash = stableHash(`structures-v1:${id}`);
    const override = STRUCTURE_OVERRIDES[id];
    // 密度はIDだけで固定。ズーム・表示範囲・近隣の追加に依存しない。
    if (!park && hash % 4 !== 0 && !override) continue;
    let rings: Coordinate[][];
    try {
      rings = elementRings(e);
    } catch {
      continue;
    }
    if (!rings.length) continue;
    rings.sort((a, b) => {
      const area = (r: Coordinate[]) =>
        Math.abs(
          r.reduce((sum, p, i) => {
            const q = r[(i + 1) % r.length];
            return sum + p[0] * q[1] - q[0] * p[1];
          }, 0),
        );
      return area(b) - area(a) || JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
    const ring = rings[0],
      coordinate = anchor(ring);
    const extent = Math.max(...ring.map((p) => distance(coordinate, p))) * 2;
    result.set(id, {
      id,
      coordinate,
      art: (park ? PARK_SLOTS_V1 : BUILDING_SLOTS_V1)[(hash >>> 4) % 4],
      meters: Math.max(park ? 65 : 28, Math.min(park ? 110 : 75, extent)),
      ...override,
    });
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function structureFeatures(structures: Iterable<Structure>): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: [...structures].map((s) => ({
      type: 'Feature',
      id: s.id,
      properties: {
        art: `fantasy-${s.art}`,
        size16:
          s.meters /
          ((40075016.686 * Math.cos((s.coordinate[1] * Math.PI) / 180)) / (512 * 2 ** 16)) /
          192,
      },
      geometry: { type: 'Point', coordinates: s.coordinate },
    })),
  };
}
