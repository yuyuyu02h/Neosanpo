import { distance, validCoordinate } from './geo.ts';
import type { Coordinate } from './types.ts';

export interface OSMElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}
export interface RoadNode {
  id: string;
  coordinate: Coordinate;
  edges: { to: string; meters: number }[];
}
export interface WalkingNetwork {
  nodes: Map<string, RoadNode>;
  blocked: Coordinate[][];
  landmarks: OSMElement[];
  origin: Coordinate;
}
export interface WalkingRoute {
  coordinates: Coordinate[];
  distance: number;
  destination: string;
}
const forbiddenAccess = new Set([
  'private',
  'no',
  'customers',
  'permit',
  'destination',
  'delivery',
  'agricultural',
  'forestry',
]);
const excludedAmenities = new Set([
  'school',
  'university',
  'college',
  'kindergarten',
  'childcare',
  'prison',
  'research_institute',
]);

export function ringContains(point: Coordinate, ring: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function segmentDistance(point: Coordinate, a: Coordinate, b: Coordinate): number {
  const scale = Math.cos((point[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * scale,
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * scale * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return distance(point, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
}
function crossing(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const side = (p: Coordinate, q: Coordinate, r: Coordinate) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
const regionIndexes = new WeakMap<Coordinate[][], Map<string, Coordinate[][]>>();
function nearbyRings(a: Coordinate, b: Coordinate, rings: Coordinate[][]): Coordinate[][] {
  let index = regionIndexes.get(rings);
  if (!index) {
    index = new Map();
    for (const ring of rings) {
      const xs = ring.map((p) => p[0]),
        ys = ring.map((p) => p[1]);
      const x0 = Math.floor(Math.min(...xs) * 1000) - 1,
        x1 = Math.floor(Math.max(...xs) * 1000) + 1;
      const y0 = Math.floor(Math.min(...ys) * 1000) - 1,
        y1 = Math.floor(Math.max(...ys) * 1000) + 1;
      if ((x1 - x0) * (y1 - y0) > 200000)
        throw new Error('立入制限区域が広すぎるため確認できませんでした。');
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x}:${y}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key)!.push(ring);
        }
    }
    regionIndexes.set(rings, index);
  }
  const result = new Set<Coordinate[]>();
  for (
    let x = Math.floor(Math.min(a[0], b[0]) * 1000);
    x <= Math.floor(Math.max(a[0], b[0]) * 1000);
    x++
  )
    for (
      let y = Math.floor(Math.min(a[1], b[1]) * 1000);
      y <= Math.floor(Math.max(a[1], b[1]) * 1000);
      y++
    )
      for (const ring of index.get(`${x}:${y}`) ?? []) result.add(ring);
  return [...result];
}
export function segmentBlocked(a: Coordinate, b: Coordinate, rings: Coordinate[][]): boolean {
  return nearbyRings(a, b, rings).some((ring) => {
    if (ringContains(a, ring) || ringContains(b, ring)) return true;
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i],
        d = ring[(i + 1) % ring.length];
      if (
        crossing(a, b, c, d) ||
        segmentDistance(a, c, d) < 3 ||
        segmentDistance(b, c, d) < 3 ||
        segmentDistance(c, a, b) < 3
      )
        return true;
    }
    return false;
  });
}
export function elementRings(element: OSMElement): Coordinate[][] {
  const convert = (geometry: { lat: number; lon: number }[]) => {
    const points = geometry.map((p) => [p.lon, p.lat] as Coordinate);
    if (!points.every(validCoordinate)) throw new Error('立入制限区域の座標が不完全です。');
    return points;
  };
  if (element.members?.some((m) => m.type === 'way' && m.role !== 'inner' && !m.geometry?.length))
    throw new Error('立入制限区域の境界が欠けています。');
  if (element.geometry?.length) {
    const points = convert(element.geometry);
    return points.length >= 4 && distance(points[0], points.at(-1)!) < 1 ? [points] : [];
  }
  // multipolygonの分割されたouterを連結。未知のinnerも除外側に倒す。
  const chains = (element.members ?? [])
    .filter((m) => m.geometry?.length && m.role !== 'inner')
    .map((m) => convert(m.geometry!));
  const rings: Coordinate[][] = [];
  while (chains.length) {
    let chain = chains.shift()!;
    let joined = true;
    while (joined && distance(chain[0], chain.at(-1)!) > 1) {
      joined = false;
      for (let i = 0; i < chains.length; i++) {
        let other = chains[i];
        if (distance(chain.at(-1)!, other.at(-1)!) < 1) other = [...other].reverse();
        if (distance(chain.at(-1)!, other[0]) < 1) {
          chain = [...chain, ...other.slice(1)];
          chains.splice(i, 1);
          joined = true;
          break;
        }
        if (distance(chain[0], other[0]) < 1) other = [...other].reverse();
        if (distance(chain[0], other.at(-1)!) < 1) {
          chain = [...other.slice(0, -1), ...chain];
          chains.splice(i, 1);
          joined = true;
          break;
        }
      }
    }
    if (chain.length >= 4 && distance(chain[0], chain.at(-1)!) < 1) rings.push(chain);
    else if (chain.length)
      throw new Error('立入制限区域の形を確認できませんでした。場所を変えて再検索してください。');
  }
  return rings;
}
function excluded(tags: Record<string, string>): boolean {
  return (
    excludedAmenities.has(tags.amenity) ||
    forbiddenAccess.has(tags.access) ||
    forbiddenAccess.has(tags.foot) ||
    ['military', 'construction', 'industrial', 'railway', 'education'].includes(tags.landuse) ||
    !!tags.military ||
    (!!tags.building && tags.building !== 'no')
  );
}
function walkable(tags: Record<string, string>): boolean {
  if (
    forbiddenAccess.has(tags.access) ||
    forbiddenAccess.has(tags.foot) ||
    tags['access:conditional'] ||
    tags['foot:conditional'] ||
    tags.area === 'yes' ||
    tags.indoor === 'yes' ||
    tags.tunnel === 'yes' ||
    tags.sidewalk === 'no' ||
    tags.construction
  )
    return false;
  if (['residential', 'living_street', 'pedestrian', 'footway', 'steps'].includes(tags.highway))
    return !['private', 'driveway'].includes(tags.service);
  if (
    ['path', 'cycleway', 'unclassified', 'tertiary', 'secondary', 'primary'].includes(tags.highway)
  )
    return (
      ['yes', 'designated'].includes(tags.foot) ||
      ['both', 'left', 'right', 'yes', 'separate'].includes(tags.sidewalk)
    );
  return false;
}
export function buildNetwork(elements: OSMElement[], origin: Coordinate): WalkingNetwork {
  const blocked: Coordinate[][] = [];
  const blockedNodes = new Set<number>();
  for (const e of elements) {
    if (
      e.type === 'node' &&
      (e.tags?.barrier ||
        forbiddenAccess.has(e.tags?.access ?? '') ||
        forbiddenAccess.has(e.tags?.foot ?? ''))
    ) {
      // 開放が明示されたボラード等以外はルートの接続点として使わない。
      if (!(e.tags?.barrier === 'bollard' && ['yes', 'designated'].includes(e.tags?.foot ?? '')))
        blockedNodes.add(e.id);
    }
    if (excluded(e.tags ?? {})) {
      const rings = elementRings(e);
      if (
        !rings.length &&
        e.type !== 'node' &&
        (e.tags?.building ||
          excludedAmenities.has(e.tags?.amenity ?? '') ||
          e.tags?.landuse ||
          e.tags?.area === 'yes' ||
          e.tags?.type === 'multipolygon')
      )
        throw new Error('立入制限区域の形を確認できませんでした。');
      if (rings.length) blocked.push(...rings);
      else if (e.type === 'node' && validCoordinate([e.lon, e.lat])) {
        // 敷地の輪郭が未登録の学校等は、広めに除外して候補に使わない。
        const radius = excludedAmenities.has(e.tags?.amenity ?? '') ? 250 : 30;
        blocked.push(
          Array.from(
            { length: 25 },
            (_, i) =>
              [
                e.lon! +
                  (Math.cos((i * Math.PI) / 12) * radius) /
                    (111195 * Math.cos((e.lat! * Math.PI) / 180)),
                e.lat! + (Math.sin((i * Math.PI) / 12) * radius) / 111195,
              ] as Coordinate,
          ),
        );
      }
    }
  }
  const nodes = new Map<string, RoadNode>();
  for (const way of elements.filter(
    (e) =>
      e.type === 'way' &&
      walkable(e.tags ?? {}) &&
      e.geometry &&
      e.nodes?.length === e.geometry.length,
  )) {
    for (let i = 1; i < way.geometry!.length; i++) {
      const a: Coordinate = [way.geometry![i - 1].lon, way.geometry![i - 1].lat];
      const b: Coordinate = [way.geometry![i].lon, way.geometry![i].lat];
      if (
        !validCoordinate(a) ||
        !validCoordinate(b) ||
        distance(origin, a) > 900 ||
        distance(origin, b) > 900 ||
        blockedNodes.has(way.nodes![i - 1]) ||
        blockedNodes.has(way.nodes![i]) ||
        segmentBlocked(a, b, blocked)
      )
        continue;
      const length = distance(a, b);
      if (length < 0.1 || length > 350) continue;
      // 長い道も約35mごとの固定地点を持つ。線分自体はOSMの道の形を保持する。
      const steps = Math.ceil(length / 35);
      let previous = String(way.nodes![i - 1]);
      if (!nodes.has(previous)) nodes.set(previous, { id: previous, coordinate: a, edges: [] });
      for (let k = 1; k <= steps; k++) {
        const id = k === steps ? String(way.nodes![i]) : `w${way.id}:${i}:${k}`;
        const coordinate: Coordinate = [
          a[0] + ((b[0] - a[0]) * k) / steps,
          a[1] + ((b[1] - a[1]) * k) / steps,
        ];
        if (!nodes.has(id)) nodes.set(id, { id, coordinate, edges: [] });
        nodes.get(previous)!.edges.push({ to: id, meters: length / steps });
        nodes.get(id)!.edges.push({ to: previous, meters: length / steps });
        previous = id;
      }
    }
  }
  return {
    nodes,
    blocked,
    landmarks: elements.filter(
      (e) =>
        ['convenience', 'supermarket'].includes(e.tags?.shop ?? '') || e.tags?.leisure === 'park',
    ),
    origin,
  };
}
export function nearestRoad(
  network: WalkingNetwork,
  position: Coordinate,
  maxMeters = 55,
): RoadNode | null {
  let best: RoadNode | null = null,
    minimum = maxMeters;
  for (const node of network.nodes.values()) {
    const meters = distance(position, node.coordinate);
    if (meters < minimum && !segmentBlocked(position, node.coordinate, network.blocked)) {
      minimum = meters;
      best = node;
    }
  }
  return best;
}
export function reachable(
  network: WalkingNetwork,
  position: Coordinate,
): { start: RoadNode; costs: Map<string, number>; parents: Map<string, string> } | null {
  const start = nearestRoad(network, position);
  if (!start) return null;
  const costs = new Map([[start.id, 0]]),
    parents = new Map<string, string>(),
    pending = new Set([start.id]);
  while (pending.size) {
    let id = '',
      minimum = Infinity;
    for (const candidate of pending)
      if (costs.get(candidate)! < minimum) {
        id = candidate;
        minimum = costs.get(candidate)!;
      }
    pending.delete(id);
    if (minimum > 2200) continue;
    for (const edge of network.nodes.get(id)!.edges) {
      const next = minimum + edge.meters;
      if (next < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, next);
        parents.set(edge.to, id);
        pending.add(edge.to);
      }
    }
  }
  return { start, costs, parents };
}
export function findRoute(
  network: WalkingNetwork,
  position: Coordinate,
  target: string,
): WalkingRoute | null {
  const search = reachable(network, position);
  if (!search || !search.costs.has(target)) return null;
  const coordinates: Coordinate[] = [];
  let id = target;
  while (true) {
    coordinates.unshift(network.nodes.get(id)!.coordinate);
    if (id === search.start.id) break;
    id = search.parents.get(id)!;
    if (!id) return null;
  }
  return { coordinates, distance: search.costs.get(target)!, destination: target };
}
export function routeProgress(
  route: WalkingRoute,
  position: Coordinate,
): { remaining: number; offRoute: boolean } {
  let closest = Infinity,
    remaining = route.distance,
    tail = 0;
  for (let i = route.coordinates.length - 1; i > 0; i--) {
    const a = route.coordinates[i - 1],
      b = route.coordinates[i];
    const gap = segmentDistance(position, a, b);
    if (gap < closest) {
      closest = gap;
      remaining = tail + Math.min(distance(a, b), distance(position, b));
    }
    tail += distance(a, b);
  }
  return { remaining, offRoute: closest > 45 };
}
