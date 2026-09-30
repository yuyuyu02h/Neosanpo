import type { Coordinate, Place } from './types.ts';

export function distance(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.max(0, Math.round(meters))} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function validCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

export function nearestPlaces(
  places: Place[],
  position: Coordinate,
  excluded: Set<string>,
): Place[] {
  return places
    .filter((p) => !excluded.has(p.id))
    .sort((a, b) => distance(position, a.coordinate) - distance(position, b.coordinate));
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
