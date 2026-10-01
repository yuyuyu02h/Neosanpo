import type { Coordinate, Place } from './types.ts';
import { distance, stableHash } from './geo.ts';
import { items } from './items.ts';
import { WALK_RULES } from './walking.ts';
import { buildNetwork, reachable, type OSMElement, type WalkingNetwork } from './navigation.ts';
export interface NearbyResult {
  places: Place[];
  network: WalkingNetwork;
}
let cache: { position: Coordinate; timestamp: number; result: NearbyResult } | null = null;
function landmarkPoint(e: OSMElement): Coordinate | null {
  if (e.lon !== undefined && e.lat !== undefined) return [e.lon, e.lat];
  const g = e.geometry ?? e.members?.find((m) => m.geometry?.length)?.geometry;
  if (!g?.length) return null;
  return [g.reduce((s, p) => s + p.lon, 0) / g.length, g.reduce((s, p) => s + p.lat, 0) / g.length];
}
export function placesFromNetwork(network: WalkingNetwork, position: Coordinate): Place[] {
  const search = reachable(network, position);
  if (!search) return [];
  const candidates = [...network.nodes.values()].filter(
    (n) =>
      (search.costs.get(n.id) ?? Infinity) >= WALK_RULES.minimumDestination &&
      (search.costs.get(n.id) ?? Infinity) <= 1400 &&
      distance(position, n.coordinate) >= WALK_RULES.minimumDestination,
  );
  const result: Place[] = [];
  for (const node of candidates.sort(
    (a, b) => search.costs.get(a.id)! - search.costs.get(b.id)! || a.id.localeCompare(b.id),
  )) {
    if (result.some((p) => distance(p.coordinate, node.coordinate) < 130)) continue;
    let label = '道路上',
      closest = 80;
    for (const landmark of network.landmarks) {
      const point = landmarkPoint(landmark);
      if (!point) continue;
      const gap = distance(point, node.coordinate);
      if (gap < closest) {
        closest = gap;
        label = `${landmark.tags?.name ?? (landmark.tags?.shop === 'convenience' ? 'コンビニ' : landmark.tags?.shop === 'supermarket' ? 'スーパー' : '公園')}付近の道`;
      }
    }
    const item = items[stableHash(`road-${node.id}`) % items.length];
    result.push({
      id: `road-${node.id}`,
      nodeId: node.id,
      coordinate: node.coordinate,
      name: item.name,
      realName: label,
      hint: '',
      itemId: item.id,
      routeDistance: search.costs.get(node.id)!,
    });
    if (result.length >= 12) break;
  }
  return result;
}
export function placesFromOSM(elements: OSMElement[], position: Coordinate): Place[] {
  return placesFromNetwork(buildNetwork(elements, position), position);
}
export async function nearbyPlaces(
  position: Coordinate,
  signal?: AbortSignal,
): Promise<NearbyResult> {
  if (cache && Date.now() - cache.timestamp < 300000 && distance(cache.position, position) < 250)
    return {
      network: cache.result.network,
      places: placesFromNetwork(cache.result.network, position),
    };
  const [lon, lat] = position;
  const near = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  // 矩形で空間検索を先に絞り、混雑する公開APIの処理量を減らす。
  const box = (meters: number) => {
    const dy = meters / 111195,
      dx = dy / Math.cos((lat * Math.PI) / 180);
    return `${(lat - dy).toFixed(5)},${(lon - dx).toFixed(5)},${(lat + dy).toFixed(5)},${(lon + dx).toFixed(5)}`;
  };
  const access = '^(private|no|customers|permit|destination|delivery|agricultural|forestry)$';
  const amenities =
    '^(school|university|college|kindergarten|childcare|prison|research_institute)$';
  const landuse = '^(military|construction|industrial|railway|education)$';
  const query = `[out:json][timeout:20][maxsize:134217728];
    is_in(${near})->.enclosing;
    (area.enclosing["amenity"~"${amenities}"];area.enclosing["access"~"${access}"];
     area.enclosing["foot"~"${access}"];area.enclosing["military"];area.enclosing["landuse"~"${landuse}"];)->.restricted;
    (way(pivot.restricted);relation(pivot.restricted);
     way["highway"~"^(residential|living_street|pedestrian|footway|steps|path|cycleway|unclassified|tertiary|secondary|primary)$"](${box(900)});
     nwr["amenity"~"${amenities}"](${box(1400)});
     nwr["access"~"${access}"](${box(1400)});nwr["foot"~"${access}"](${box(1400)});
     nwr["landuse"~"${landuse}"](${box(1400)});nwr["military"](${box(1400)});
     way["building"](${box(950)});relation["building"](${box(950)});node["barrier"](${box(950)});
     nwr["shop"~"^(convenience|supermarket)$"](${box(950)});nwr["leisure"="park"](${box(1400)});
    );out geom;`;

  for (const endpoint of [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ]) {
    if (signal?.aborted) throw new DOMException('中断', 'AbortError');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data.elements) || data.remark) continue;
      const network = buildNetwork(data.elements, position);
      const result = { network, places: placesFromNetwork(network, position) };
      cache = { position, timestamp: Date.now(), result };
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error('道路と立入制限の情報を取得できませんでした。通信を確認して再検索してください。');
}
