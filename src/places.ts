import type { Coordinate, Place } from './types.ts';
import { distance, stableHash, validCoordinate } from './geo.ts';
import { items } from './items.ts';
import { WALK_RULES } from './walking.ts';

interface OSMElement {
  id: number;
  type: string;
  lon: number;
  lat: number;
  tags?: Record<string, string>;
}
interface Cache {
  position: Coordinate;
  timestamp: number;
  places: Place[];
}
let cache: Cache | null = null;

export function placesFromOSM(elements: OSMElement[], position: Coordinate): Place[] {
  const accepted = elements.filter(
    (e) =>
      e.type === 'node' &&
      ['bench', 'drinking_water'].includes(e.tags?.amenity ?? '') &&
      validCoordinate([e.lon, e.lat]) &&
      !['private', 'no', 'customers'].includes(e.tags?.access ?? '') &&
      distance(position, [e.lon, e.lat]) >= WALK_RULES.minimumDestination &&
      distance(position, [e.lon, e.lat]) <= 1400,
  );
  const spaced: OSMElement[] = [];
  for (const element of accepted.sort(
    (a, b) => distance(position, [a.lon, a.lat]) - distance(position, [b.lon, b.lat]),
  )) {
    if (spaced.every((e) => distance([e.lon, e.lat], [element.lon, element.lat]) > 80))
      spaced.push(element);
    if (spaced.length >= 10) break;
  }
  const titles = [
    '木陰に残されたもの',
    '道ばたの小さな気配',
    '誰かが通ったあと',
    '風が止まるところ',
    '足もとの忘れもの',
  ];
  return spaced.map((e) => {
    const hash = stableHash(`node-${e.id}`);
    return {
      id: `osm-node-${e.id}`,
      coordinate: [e.lon, e.lat],
      name: titles[hash % titles.length],
      realName:
        e.tags?.name ??
        (e.tags?.amenity === 'drinking_water' ? '地図上の水飲み場付近' : '地図上のベンチ付近'),
      hint: 'いつもの道に、見慣れないものが落ちている。',
      itemId: items[hash % items.length].id,
    };
  });
}

export async function nearbyPlaces(position: Coordinate, signal?: AbortSignal): Promise<Place[]> {
  if (cache && Date.now() - cache.timestamp < 300000 && distance(cache.position, position) < 300)
    return cache.places;
  const [lon, lat] = position;
  const query = `[out:json][timeout:15];(node["amenity"="bench"]["access"!~"private|no|customers"](around:1200,${lat.toFixed(5)},${lon.toFixed(5)});node["amenity"="drinking_water"]["access"!~"private|no|customers"](around:1200,${lat.toFixed(5)},${lon.toFixed(5)}););out body 100;`;
  const endpoints = ['https://overpass-api.de/api/interpreter'];
  for (const endpoint of endpoints) {
    if (signal?.aborted) throw new DOMException('中断されました', 'AbortError');
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000);
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: requestSignal,
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data.elements)) continue;
      const places = placesFromOSM(data.elements, position);
      cache = { position, timestamp: Date.now(), places };
      return places;
    } catch {
      if (signal?.aborted) throw new DOMException('中断されました', 'AbortError');
    }
  }
  // Overpassが混雑している場合は、約400m四方ずつのOSM元データから候補を拾う。
  try {
    const latSpan = 0.0036;
    const lonSpan = Math.min(0.012, latSpan / Math.max(0.3, Math.cos((lat * Math.PI) / 180)));
    const bbox = [
      Math.max(-180, lon - lonSpan),
      Math.max(-90, lat - latSpan),
      Math.min(180, lon + lonSpan),
      Math.min(90, lat + latSpan),
    ]
      .map((n) => n.toFixed(5))
      .join(',');
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    const response = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {
      signal: requestSignal,
    });
    if (response.ok) {
      const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('地図データの形式を確認できません');
      const elements: OSMElement[] = [];
      xml.querySelectorAll('node').forEach((node) => {
        const tags = Object.fromEntries(
          [...node.querySelectorAll('tag')].map((tag) => [
            tag.getAttribute('k')!,
            tag.getAttribute('v')!,
          ]),
        );
        if (['bench', 'drinking_water'].includes(tags.amenity))
          elements.push({
            type: 'node',
            id: Number(node.getAttribute('id')),
            lon: Number(node.getAttribute('lon')),
            lat: Number(node.getAttribute('lat')),
            tags,
          });
      });
      const places = placesFromOSM(elements, position);
      cache = { position, timestamp: Date.now(), places };
      return places;
    }
  } catch {
    if (signal?.aborted) throw new DOMException('中断されました', 'AbortError');
  }
  throw new Error('近くの地図を読み込めませんでした。通信を確認して、もう一度探してください。');
}
