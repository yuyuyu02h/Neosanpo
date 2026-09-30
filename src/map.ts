import * as maplibregl from 'maplibre-gl';
import type { Map as MapType, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Coordinate, Place } from './types.ts';
import { cottage, treePattern } from './art.ts';
import { icon, escapeHtml } from './icons.ts';

maplibregl.setWorkerUrl(workerUrl);

async function imageFromSvg(svg: string): Promise<ImageData> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function fantasyStyle(base: StyleSpecification): StyleSpecification {
  const style = structuredClone(base);
  style.name = 'まよいみち / 緑の向こうがわ';
  for (const layer of style.layers) {
    if (layer.type === 'background') layer.paint = { 'background-color': '#b6c09e' };
    if (layer.type === 'raster' || layer.type === 'symbol' || layer.id.startsWith('boundary'))
      layer.layout = { ...layer.layout, visibility: 'none' };
    if (layer.type === 'fill') {
      let color = '#b6c09e';
      if (layer.id.includes('wood')) color = '#839b70';
      else if (layer.id.includes('park')) color = '#a0b286';
      else if (layer.id.includes('grass')) color = '#afbb8c';
      else if (layer.id.includes('water')) color = '#80aca1';
      else if (layer.id.includes('sand')) color = '#ded1a9';
      else if (layer.id.includes('building')) color = '#d5c6a1';
      layer.paint = {
        ...layer.paint,
        'fill-color': color,
        'fill-opacity': 1,
        'fill-outline-color': color,
      };
    }
    if (layer.type === 'line') {
      const water = layer.id.includes('water');
      const outline = layer.id.includes('casing');
      const rail = layer.id.includes('rail');
      layer.paint = {
        ...layer.paint,
        'line-color': water ? '#77a89d' : rail ? '#738371' : outline ? '#97a07d' : '#eee5c9',
      };
      if (layer.id.includes('park')) layer.paint['line-color'] = '#92a27a';
    }
    if (layer.type === 'fill-extrusion') {
      layer.paint = {
        'fill-extrusion-color': '#c1bc96',
        'fill-extrusion-height': ['min', ['coalesce', ['get', 'render_height'], 6], 16],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.8,
      };
    }
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
  private tree: ImageData | null = null;
  private house: ImageData | null = null;
  private ready = false;
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
      [this.tree, this.house] = await Promise.all([
        imageFromSvg(treePattern),
        imageFromSvg(cottage),
      ]);
      this.map = new maplibregl.Map({
        container: 'world-map',
        style: this.theme ? fantasyStyle(this.base!) : this.base!,
        center: coordinate,
        zoom: 16.8,
        pitch: 22,
        bearing: 0,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        renderWorldCopies: false,
      });
      this.updatePadding();
      this.map.on('resize', () => this.updatePadding());
      this.map.addControl(new maplibregl.AttributionControl(), 'bottom-right');
      this.map.on('dragstart', () => {
        this.following = false;
      });
      this.map.on('style.load', () => {
        this.decorate();
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
    if (!this.map || !this.theme || !this.tree || !this.house) return;
    const map = this.map;
    if (!map.hasImage('forest')) map.addImage('forest', this.tree, { pixelRatio: 1.5 });
    if (!map.hasImage('cottage')) map.addImage('cottage', this.house, { pixelRatio: 1.7 });
    const before = map.getStyle().layers.find((l) => l.id.startsWith('waterway'))?.id;
    map.addLayer(
      {
        id: 'forest-park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        minzoom: 13,
        paint: { 'fill-pattern': 'forest', 'fill-opacity': 0.75 },
      },
      before,
    );
    map.addLayer(
      {
        id: 'forest-wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        minzoom: 13,
        filter: ['match', ['get', 'class'], ['wood', 'grass'], true, false],
        paint: { 'fill-pattern': 'forest', 'fill-opacity': 0.8 },
      },
      before,
    );
    map.addLayer(
      {
        id: 'forest-gardens',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        minzoom: 13,
        filter: [
          'match',
          ['get', 'class'],
          ['park', 'forest', 'wood', 'recreation_ground', 'grass', 'garden'],
          true,
          false,
        ],
        paint: { 'fill-pattern': 'forest', 'fill-opacity': 0.8 },
      },
      before,
    );
    map.addLayer({
      id: 'storybook-houses',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 15,
      layout: {
        'icon-image': 'cottage',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.65, 18, 1.2],
        'icon-padding': 8,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': false,
      },
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
        element.innerHTML = `<span class="drop-aura"></span><span class="drop-symbol">${icon(index % 3 === 0 ? 'spark' : 'bag', 22)}</span>${place.id === this.selected ? `<span class="drop-label">${escapeHtml(place.name)}</span>` : ''}`;
        element.addEventListener('click', () => this.select(place.id));
        return new maplibregl.Marker({ element, anchor: 'bottom' })
          .setLngLat(place.coordinate)
          .addTo(this.map!);
      });
  }

  private updatePadding(): void {
    if (!this.map) return;
    const height = this.map.getContainer().clientHeight;
    this.map.setPadding({
      top: Math.min(105, height * 0.18),
      bottom: Math.min(280, height * 0.46),
      left: 20,
      right: 20,
    });
  }

  setPlayer(coordinate: Coordinate, follow = true): void {
    this.playerPosition = coordinate;
    this.player?.setLngLat(coordinate);
    if (follow && this.following) this.map?.easeTo({ center: coordinate, duration: 900 });
  }

  center(): void {
    this.following = true;
    if (this.playerPosition) this.map?.easeTo({ center: this.playerPosition, duration: 900 });
  }
  frameDestination(target: Coordinate): void {
    if (!this.map || !this.playerPosition) return;
    const height = this.map.getContainer().clientHeight;
    this.following = true;
    // fitBoundsは既存の余白も加算するため、一度解除して二重計算を避ける。
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const mapTop = this.map.getContainer().getBoundingClientRect().top;
    const cardTop =
      document.querySelector('#quest-card')?.getBoundingClientRect().top ?? mapTop + height - 260;
    const bottom = Math.min(height - 170, height - (cardTop - mapTop) + 55);
    this.map.fitBounds([this.playerPosition, target], {
      pitch: 0,
      padding: {
        top: Math.min(165, height * 0.28),
        bottom,
        left: 65,
        right: 75,
      },
      maxZoom: 16.8,
      duration: 900,
    });
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
    this.map.setStyle(fantasy ? fantasyStyle(this.base) : this.base);
  }

  retry(): void {
    this.player?.remove();
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    this.map?.remove();
    this.map = null;
    this.ready = false;
    this.loadFailed = false;
    clearTimeout(this.timeout);
    if (this.playerPosition) void this.init(this.playerPosition);
  }
}
