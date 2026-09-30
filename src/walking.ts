import { distance, validCoordinate } from './geo.ts';
import type { Coordinate, LocationFix, WalkingEvidence } from './types.ts';

export const WALK_RULES = {
  maxAccuracy: 25,
  maxAgeMs: 10_000,
  maxGapMs: 15_000,
  maxSpeed: 3.2,
  minDistance: 40,
  minDisplacement: 50,
  minDurationMs: 30_000,
  minSegments: 3,
  pickupRadius: 35,
  arrivalDurationMs: 8_000,
  arrivalSamples: 3,
  minimumDestination: 120,
} as const;

export function accurateFix(fix: LocationFix | null, now: number): boolean {
  return (
    !!fix &&
    validCoordinate(fix.coordinate) &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    fix.accuracy <= WALK_RULES.maxAccuracy &&
    Number.isFinite(fix.timestamp) &&
    now >= fix.timestamp &&
    now - fix.timestamp <= WALK_RULES.maxAgeMs
  );
}

export function startEvidence(fix: LocationFix): WalkingEvidence {
  return {
    origin: [...fix.coordinate],
    startedAt: fix.timestamp,
    anchor: fix,
    last: fix,
    totalDistance: 0,
    continuousDistance: 0,
    segments: 0,
    arrivalSince: null,
    arrivalSamples: 0,
    interrupted: false,
  };
}

function resetContinuity(evidence: WalkingEvidence, fix: LocationFix): WalkingEvidence {
  return {
    ...evidence,
    anchor: fix,
    last: fix,
    continuousDistance: 0,
    segments: 0,
    arrivalSince: null,
    arrivalSamples: 0,
    interrupted: false,
  };
}

export function hasWalked(evidence: WalkingEvidence, fix: LocationFix): boolean {
  return (
    evidence.continuousDistance >= WALK_RULES.minDistance &&
    evidence.segments >= WALK_RULES.minSegments &&
    fix.timestamp - evidence.startedAt >= WALK_RULES.minDurationMs &&
    distance(evidence.origin, fix.coordinate) >= WALK_RULES.minDisplacement
  );
}

export function advanceEvidence(
  evidence: WalkingEvidence,
  fix: LocationFix,
  target: Coordinate,
  now: number,
): WalkingEvidence {
  if (!accurateFix(fix, now))
    return { ...evidence, arrivalSince: null, arrivalSamples: 0, interrupted: true };
  if (fix.timestamp <= evidence.last.timestamp) return evidence;
  const gap = fix.timestamp - evidence.last.timestamp;
  const movedSinceLast = distance(evidence.last.coordinate, fix.coordinate);
  const uncertainty = evidence.last.accuracy + fix.accuracy;
  const certainSpeed = Math.max(0, movedSinceLast - uncertainty) / (gap / 1000);
  const tooFast =
    certainSpeed > WALK_RULES.maxSpeed || (fix.speed !== null && fix.speed > WALK_RULES.maxSpeed);
  if (evidence.interrupted || gap > WALK_RULES.maxGapMs || tooFast)
    return resetContinuity(evidence, fix);

  const next = { ...evidence, last: fix };
  const segment = distance(evidence.anchor.coordinate, fix.coordinate);
  const segmentThreshold = Math.max(8, evidence.anchor.accuracy + fix.accuracy);
  if (segment >= segmentThreshold) {
    // 精度の範囲内の揺れを距離に含めない。
    const verified = Math.max(0, segment - segmentThreshold / 2);
    next.totalDistance += verified;
    next.continuousDistance += verified;
    next.segments++;
    next.anchor = fix;
  }
  const close = distance(fix.coordinate, target) + fix.accuracy <= WALK_RULES.pickupRadius;
  const stopped = fix.speed === null ? certainSpeed <= 1.2 : fix.speed <= 1.2;
  if (hasWalked(next, fix) && close && stopped) {
    next.arrivalSince ??= fix.timestamp;
    next.arrivalSamples++;
  } else {
    next.arrivalSince = null;
    next.arrivalSamples = 0;
  }
  return next;
}

export type PickupState = 'position' | 'walking' | 'far' | 'settling' | 'ready';
export function pickupState(
  evidence: WalkingEvidence,
  fix: LocationFix | null,
  target: Coordinate,
  now: number,
): PickupState {
  if (
    !fix ||
    !accurateFix(fix, now) ||
    evidence.interrupted ||
    fix.timestamp !== evidence.last.timestamp
  )
    return 'position';
  if (!hasWalked(evidence, fix)) return 'walking';
  if (distance(fix.coordinate, target) + fix.accuracy > WALK_RULES.pickupRadius) return 'far';
  if (
    evidence.arrivalSince === null ||
    fix.timestamp - evidence.arrivalSince < WALK_RULES.arrivalDurationMs ||
    evidence.arrivalSamples < WALK_RULES.arrivalSamples ||
    (fix.speed !== null && fix.speed > 1.2)
  )
    return 'settling';
  return 'ready';
}
