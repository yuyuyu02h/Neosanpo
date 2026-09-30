export type Coordinate = [number, number];
export type Mode = 'live';
export type View = 'map' | 'collection' | 'journal';

export interface Item {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  note: string;
  art: string;
  color: string;
}

export interface Place {
  id: string;
  coordinate: Coordinate;
  name: string;
  realName: string;
  hint: string;
  itemId: string;
}

export interface Find {
  id: string;
  itemId: string;
  placeId: string;
  placeName: string;
  foundAt: string;
  mode: Mode;
}

export interface Walk {
  id: string;
  findId: string;
  startedAt: string;
  endedAt: string;
  distance: number;
  mode: Mode;
}

export interface SaveData {
  version: 2;
  finds: Find[];
  walks: Walk[];
  sound: boolean;
}

export interface Session {
  place: Place;
  startedAt: string;
  evidence: WalkingEvidence;
}

export interface LocationFix {
  coordinate: Coordinate;
  accuracy: number;
  timestamp: number;
  speed: number | null;
}

export interface WalkingEvidence {
  origin: Coordinate;
  startedAt: number;
  anchor: LocationFix;
  last: LocationFix;
  totalDistance: number;
  continuousDistance: number;
  segments: number;
  arrivalSince: number | null;
  arrivalSamples: number;
  interrupted: boolean;
}
