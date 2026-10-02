import * as maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Map as MapType, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Coordinate, Place } from './types.ts';
import { itemById } from './items.ts';
import { STRUCTURE_ASSETS, structureFeatures, type Structure } from './structures.ts';
import { itemArt } from './art.ts';
import { icon, escapeHtml } from './icons.ts';

maplibregl.setWorkerUrl(workerUrl);

async function loadArt(url: string, size = 384): Promise<ImageData> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size);
}
const runeWater = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><g fill="none" stroke="#72eff2" stroke-width="1" opacity=".35"><path d="M-32 32C0-12 32 76 64 32S128-12 160 32M-32 96C0 52 32 140 64 96S128 52 160 96M-32 44C0 0 32 88 64 44S128 0 160 44M-32 108C0 64 32 152 64 108S128 64 160 108"/><circle cx="32" cy="70" r="15"/><circle cx="32" cy="70" r="10"/><path d="M28 70a4 4 0 1 1 4 4M91 4l5 8-5 8-5-8z"/></g></svg>`;
const spellCircle = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><g fill="none" stroke="#73f2f7"><circle cx="128" cy="128" r="106" stroke-width="2"/><circle cx="128" cy="128" r="97"/><circle cx="128" cy="128" r="76" stroke-dasharray="5 9" stroke-width="6"/><path d="M128 28 215 178H41zM128 228 41 78h174z" stroke-width="2"/><circle cx="128" cy="128" r="27"/><path d="M112 130c-8-33 51-38 40 0-11 29-34 13-27 1s17-5 11 2" stroke-width="3"/></g></svg>`;
export function fantasyStyle(base: StyleSpecification): StyleSpecification {
  const style = structuredClone(base);
  style.name = 'まよいみち / Celtic world';
  for (const layer of style.layers) {
    if (layer.type === 'background') layer.paint = { 'background-color': '#778254' };
    if (
      layer.type === 'raster' ||
      layer.type === 'symbol' ||
      layer.type === 'fill-extrusion' ||
      layer.id.startsWith('boundary')
    )
      layer.layout = { ...layer.layout, visibility: 'none' };
    if (layer.type === 'fill') {
      if (layer['source-layer'] === 'building') layer.maxzoom = 24;
      let color = '#84935f';
      if (layer.id.includes('wood')) color = '#3e6646';
      else if (layer.id.includes('park') || layer.id.includes('grass')) color = '#61814c';
      else if (layer.id.includes('water')) color = '#126e79';
      else if (layer.id.includes('sand')) color = '#ae9766';
      else if (layer.id.includes('building')) color = '#9c936e';
      layer.paint = {
        ...layer.paint,
        'fill-color': color,
        'fill-opacity': 1,
        'fill-outline-color': layer.id.includes('water') ? '#5fdce0' : color,
      };
    }
    if (layer.type === 'line') {
      const water = layer.id.includes('water');
      const outline = layer.id.includes('casing');
      const rail = layer.id.includes('rail');
      layer.paint = {
        ...layer.paint,
        'line-color': water ? '#52cde0' : rail ? '#636a50' : outline ? '#605b43' : '#d8c48e',
      };
      if (layer.id.includes('park')) layer.paint['line-color'] = '#76904e';
    }
  }
  // 建物の土台→イラスト→道路の順に描き、道の形を常に読めるようにする。
  const building = style.layers.find((l) => l.id === 'building');
  if (building) {
    style.layers = style.layers.filter((l) => l !== building);
    const at = style.layers.findIndex(
      (l) => l.type === 'line' && l['source-layer'] === 'transportation',
    );
    style.layers.splice(at, 0, building);
  }
  return style;
}

export class WorldMap {
  map: MapType | null = null;
  private base: StyleSpecification | null = null;
  private markers: maplibregl.Marker[] = [];
  private player: maplibregl.Marker | null = null;
  private places: Place[] = [];
  private selected = '';
  private collected = new Set<string>();
  private theme = true;
  private playerPosition: Coordinate | null = null;
  private following = true;
  private initializing = false;
  private art = new Map<string, ImageData>();
  private route: Coordinate[] | null = null;
  private structures = new Map<string, Structure>();
  private ready = false;
  private styleReady = false;
  private loadFailed = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private select: (id: string) => void,
    private status: (state: 'loading' | 'ready' | 'error') => void,
  ) {}

  async init(coordinate: Coordinate): Promise<void> {
    this.playerPosition = coordinate;
    if (this.map || this.initializing) return;
    this.initializing = true;
    this.status('loading');
    try {
      const response = await fetch('/reality-style.json');
      if (!response.ok) throw new Error('地図の定義を読み込めません');
      this.base = await response.json();
      const assets = await Promise.all(
        Object.entries({ ...STRUCTURE_ASSETS, terrain: '/fantasy/terrain.webp' }).map(
          async ([name, url]) =>
            [name, await loadArt(url, name === 'terrain' ? 256 : 384)] as const,
        ),
      );
      assets.forEach(([name, data]) => this.art.set('fantasy-' + name, data));
      this.art.set(
        'fantasy-rune-water',
        await loadArt(`data:image/svg+xml,${encodeURIComponent(runeWater)}`, 128),
      );
      this.art.set(
        'fantasy-spell-circle',
        await loadArt(`data:image/svg+xml,${encodeURIComponent(spellCircle)}`, 256),
      );
      this.map = new maplibregl.Map({
        container: 'world-map',
        style: this.theme ? fantasyStyle(this.base!) : this.base!,
        center: coordinate,
        zoom: 16.8,
        pitch: 0,
        bearing: 0,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        renderWorldCopies: false,
      });
      this.updatePadding();
      this.map.on('resize', () => this.updatePadding());
      this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      this.map.on('dragstart', () => {
        this.following = false;
      });
      this.map.on('style.load', () => {
        this.styleReady = true;
        this.decorate();
        this.drawRoute();
      });
      this.map.on('load', () => {
        this.ready = !this.loadFailed;
        clearTimeout(this.timeout);
        this.status(this.loadFailed ? 'error' : 'ready');
        this.renderPlaces();
        this.setPlayer(this.playerPosition!);
        const destination = this.places.find((p) => p.id === this.selected);
        if (destination) this.frameDestination(destination.coordinate);
      });
      this.map.on('error', () => {
        if (!this.ready) {
          this.loadFailed = true;
          this.status('error');
        }
      });
      this.timeout = setTimeout(() => {
        if (!this.ready) this.status('error');
      }, 20000);
      const element = document.createElement('div');
      element.className = 'traveler-marker';
      element.innerHTML =
        '<span class="traveler-radius"></span><span class="traveler-person"><span></span></span>';
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', 'あなたの位置');
      this.player = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat(this.playerPosition!)
        .addTo(this.map);
      this.renderPlaces();
    } catch {
      this.status('error');
    } finally {
      this.initializing = false;
    }
  }

  private decorate(): void {
    if (!this.map || !this.theme || !this.art.size) return;
    const map = this.map;
    for (const [name, data] of this.art)
      if (!map.hasImage(name))
        map.addImage(name, data, { pixelRatio: name === 'fantasy-terrain' ? 1 : 2 });
    const background = map.getStyle().layers.find((l) => l.type === 'background');
    if (background) map.setPaintProperty(background.id, 'background-pattern', 'fantasy-terrain');
    map.setPaintProperty('building', 'fill-pattern', 'fantasy-terrain');
    map.setPaintProperty('building', 'fill-outline-color', '#5d7250');
    const before = map
      .getStyle()
      .layers.find((l) => l.type === 'line' && l.id.includes('water'))?.id;
    for (const source of ['landcover', 'landuse', 'park']) {
      map.addLayer(
        {
          id: `painted-${source}`,
          type: 'fill',
          source: 'openmaptiles',
          'source-layer': source,
          minzoom: 12,
          paint: {
            'fill-pattern': 'fantasy-terrain',
            'fill-opacity': source === 'park' ? 0.85 : 0.55,
          },
        },
        before,
      );
    }
    map.addLayer(
      {
        id: 'enchanted-water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        minzoom: 12,
        paint: { 'fill-pattern': 'fantasy-rune-water', 'fill-opacity': 0.85 },
      },
      before,
    );
    const road = map
      .getStyle()
      .layers.find((l) => l.type === 'line' && l['source-layer'] === 'transportation')?.id;
    map.addSource('fantasy-points', {
      type: 'geojson',
      data: structureFeatures(this.structures.values()),
    });
    map.addLayer(
      {
        id: 'fantasy-buildings',
        type: 'symbol',
        source: 'fantasy-points',
        minzoom: 3,
        layout: {
          'icon-image': ['get', 'art'],
          'icon-size': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            3,
            ['*', ['get', 'size16'], 2 ** -13],
            19,
            ['*', ['get', 'size16'], 8],
          ],
          'icon-padding': 3,
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'map',
          'icon-rotation-alignment': 'map',
        },
        paint: { 'icon-opacity': 1 },
      },
      road,
    );
    map.addLayer(
      {
        id: 'lake-spells',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water',
        minzoom: 13,
        layout: { 'icon-image': 'fantasy-spell-circle', 'icon-size': 0.8, 'icon-padding': 80 },
        paint: { 'icon-opacity': 0.7 },
      },
      road,
    );
  }
  setStructures(structures: Structure[]): void {
    for (const structure of structures)
      if (!this.structures.has(structure.id)) this.structures.set(structure.id, structure);
    // カメラの拡大縮小では更新しない。完全なOSM形状を読み込んだときだけ追加。
    if (this.styleReady && this.theme) {
      const source = this.map?.getSource('fantasy-points') as maplibregl.GeoJSONSource | undefined;
      source?.setData(structureFeatures(this.structures.values()));
    }
  }

  setRoute(coordinates: Coordinate[] | null): void {
    this.route = coordinates;
    document
      .querySelector('#world-map')
      ?.setAttribute('aria-description', coordinates ? '徒歩ルートを表示中' : '周辺の地図');
    this.drawRoute();
  }
  private drawRoute(): void {
    const map = this.map;
    if (!map) return;
    if (!this.styleReady) return;
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features:
        this.route && this.route.length > 1
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: this.route },
              },
            ]
          : [],
    };
    const source = map.getSource('walking-route') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource('walking-route', { type: 'geojson', data });
    map.addLayer({
      id: 'route-shadow',
      type: 'line',
      source: 'walking-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#263c31', 'line-width': 10, 'line-opacity': 0.65, 'line-blur': 2 },
    });
    map.addLayer({
      id: 'route-path',
      type: 'line',
      source: 'walking-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffcf73', 'line-width': 5 },
    });
    map.addLayer({
      id: 'route-center',
      type: 'line',
      source: 'walking-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff5cf', 'line-width': 2, 'line-dasharray': [2, 3] },
    });
  }

  setPlaces(places: Place[], selected: string, collected: Set<string>): void {
    this.places = places;
    this.selected = selected;
    this.collected = collected;
    this.renderPlaces();
  }

  private renderPlaces(): void {
    if (!this.map) return;
    this.markers.forEach((marker) => marker.remove());
    this.markers = this.places
      .filter((place) => !this.collected.has(place.id))
      .map((place, index) => {
        const element = document.createElement('button');
        element.className = `drop-marker${place.id === this.selected ? ' selected' : ''}`;
        element.setAttribute('aria-label', `${place.name}を目的地にする`);
        element.title = place.name;
        element.innerHTML = `<span class="drop-symbol">${itemArt(itemById(place.itemId).art)}</span>`;
        element.addEventListener('click', () => this.select(place.id));
        return new maplibregl.Marker({ element, anchor: 'bottom' })
          .setLngLat(place.coordinate)
          .addTo(this.map!);
      });
  }

  private padding(): { top: number; bottom: number; left: number; right: number } {
    if (!this.map) return { top: 100, bottom: 180, left: 45, right: 55 };
    const rect = this.map.getContainer().getBoundingClientRect();
    const card = document.querySelector('#quest-card')?.getBoundingClientRect();
    return {
      top: 110,
      bottom: card && card.height > 0 ? Math.max(100, rect.bottom - card.top + 32) : 130,
      left: 48,
      right: 62,
    };
  }
  private updatePadding(): void {
    this.map?.setPadding(this.padding());
  }
  setPlayer(coordinate: Coordinate, follow = true): void {
    this.playerPosition = coordinate;
    this.player?.setLngLat(coordinate);
    if (follow && this.following) this.map?.easeTo({ center: coordinate, duration: 650 });
  }
  center(): void {
    this.following = true;
    this.updatePadding();
    if (this.playerPosition) this.map?.easeTo({ center: this.playerPosition, duration: 600 });
  }
  frameDestination(target: Coordinate): void {
    if (!this.map || !this.playerPosition) return;
    this.following = true;
    const padding = this.padding();
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const points = this.route?.length
      ? [this.playerPosition, ...this.route]
      : [this.playerPosition, target];
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((p) => bounds.extend(p));
    this.map.fitBounds(bounds, { padding, maxZoom: 17, pitch: 0, duration: 600 });
  }

  zoom(amount: number): void {
    this.map?.zoomTo((this.map.getZoom() ?? 16) + amount, { duration: 350 });
  }
  north(): void {
    this.map?.easeTo({ bearing: 0, pitch: 0, duration: 650 });
  }
  resize(): void {
    this.map?.resize();
  }

  setTheme(fantasy: boolean): void {
    if (!this.map || !this.base) return;
    this.theme = fantasy;
    this.styleReady = false;
    this.map.setStyle(fantasy ? fantasyStyle(this.base) : this.base, { diff: false });
  }

  retry(): void {
    this.player?.remove();
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    this.map?.remove();
    this.map = null;
    this.ready = false;
    this.styleReady = false;
    this.loadFailed = false;
    clearTimeout(this.timeout);
    if (this.playerPosition) void this.init(this.playerPosition);
  }
}
