import rawPaths from './demo-paths.json' with { type: 'json' };
import rawPoints from './demo-points.json' with { type: 'json' };
import type { Coordinate } from './types.ts';
import { distance } from './geo.ts';

interface PathNode {
  coordinate: Coordinate;
  neighbors: string[];
}
const paths = rawPaths as unknown as Record<string, PathNode>;
export const demoPoints = rawPoints as Coordinate[];

export function demoRoute(from: Coordinate, to: Coordinate): Coordinate[] {
  const nearest = (point: Coordinate) =>
    Object.keys(paths).reduce((a, b) =>
      distance(point, paths[a].coordinate) < distance(point, paths[b].coordinate) ? a : b,
    );
  const start = nearest(from),
    end = nearest(to);
  const costs = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const pending = new Set([start]);
  while (pending.size) {
    let current = [...pending].reduce((a, b) => (costs.get(a)! < costs.get(b)! ? a : b));
    pending.delete(current);
    if (current === end) {
      const route: Coordinate[] = [paths[current].coordinate];
      while (previous.has(current)) {
        current = previous.get(current)!;
        route.unshift(paths[current].coordinate);
      }
      return route;
    }
    for (const neighbor of paths[current].neighbors) {
      const cost =
        costs.get(current)! + distance(paths[current].coordinate, paths[neighbor].coordinate);
      if (cost < (costs.get(neighbor) ?? Infinity)) {
        costs.set(neighbor, cost);
        previous.set(neighbor, current);
        pending.add(neighbor);
      }
    }
  }
  return [];
}
