import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { alignedGeodeticToLocal, alignedLocalToGeodetic } from "./geodesy";
import { NetworkStore } from "./store";
import type {
  CableStatus,
  CableTypeId,
  InteractionMode,
  ModelBounds,
  ModelFootprintPoint,
  NodeKind,
} from "./types";

interface VillageMapCallbacks {
  onNodeSelected: (id: string) => void;
  onNodePlacement: (x: number, z: number) => void;
  onCableSelected: (id: string) => void;
  onCableBranch: (id: string, x: number, z: number) => void;
  onViewChanged: (x: number, z: number, zoom: number) => void;
}

export class VillageMap {
  private readonly map: L.Map;
  private readonly streetLayer: L.TileLayer;
  private readonly satelliteLayer: L.TileLayer;
  private readonly networkLayer = L.layerGroup();
  private readonly modelAreaLayer = L.layerGroup();
  private mode: InteractionMode = "explore";
  private basemap: "streets" | "satellite";
  private modelBounds: L.LatLngBounds | null = null;
  private localModelBounds: ModelBounds | null = null;
  private localModelFootprint: ModelFootprintPoint[] = [];
  private visibleCableTypes = new Set<CableTypeId>(["adss-24", "drop-2", "duct-48"]);
  private visibleCableStatuses = new Set<CableStatus>(["active", "planned", "maintenance"]);
  private visibleNodeKinds = new Set<NodeKind>(["splice", "pole", "house", "hub"]);
  private syncingFromScene = false;
  private userControllingView = false;
  private pointerDown: { x: number; y: number } | null = null;

  constructor(
    container: HTMLElement,
    private readonly store: NetworkStore,
    private readonly callbacks: VillageMapCallbacks,
  ) {
    const { lat, lon } = store.state.village;
    this.map = L.map(container, {
      center: [lat, lon],
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
    });
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    this.streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "© OpenStreetMap contributors",
    });
    this.satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        crossOrigin: true,
        attribution:
          "Tiles © Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
      },
    );
    this.basemap =
      localStorage.getItem("fiberplan-3d/basemap") === "streets" ? "streets" : "satellite";
    this.applyBasemap();
    this.modelAreaLayer.addTo(this.map);
    this.networkLayer.addTo(this.map);
    this.map.on("movestart", () => {
      if (!this.syncingFromScene) this.userControllingView = true;
    });
    this.map.on("moveend", () => {
      window.requestAnimationFrame(() => {
        this.userControllingView = false;
      });
    });
    this.map.on("move", () => {
      if (this.syncingFromScene) return;
      const point = this.fromLatLng(this.map.getCenter());
      this.callbacks.onViewChanged(point.x, point.z, this.map.getZoom());
    });
    container.addEventListener("pointerdown", this.handlePointerDown, true);
    container.addEventListener("pointerup", this.handlePointerUp, true);
    container.addEventListener("pointercancel", this.handlePointerCancel, true);
    this.render();
  }

  setViewFromScene(
    x: number,
    z: number,
    distance: number,
    _headingRad: number,
  ): void {
    const center = this.toLatLng(x, z);
    // Keep the OpenStreetMap surface stable while the user places or connects
    // network objects. Camera fly animations would otherwise move Leaflet
    // between pointerdown and click and Leaflet would correctly cancel the click.
    if (this.mode !== "explore" || this.userControllingView) return;

    const zoom = Math.max(
      this.map.getMinZoom(),
      Math.min(
        this.map.getMaxZoom(),
        20 - Math.log2(Math.max(distance, 1) / 20),
      ),
    );
    const centerShift = this.map.distance(this.map.getCenter(), center);
    if (centerShift < 0.12 && Math.abs(this.map.getZoom() - zoom) < 0.04) return;

    this.syncingFromScene = true;
    this.map.setView(center, zoom, { animate: false });
    window.requestAnimationFrame(() => {
      this.syncingFromScene = false;
    });
  }

  setMode(mode: InteractionMode): void {
    this.mode = mode;
    const container = this.map.getContainer();
    container.classList.toggle("map-mode-add-node", mode === "add-node");
    container.classList.toggle("map-mode-connect", mode === "connect");
  }

  toggleBasemap(): { mode: "streets" | "satellite"; label: string } {
    this.basemap = this.basemap === "streets" ? "satellite" : "streets";
    localStorage.setItem("fiberplan-3d/basemap", this.basemap);
    this.applyBasemap();
    return {
      mode: this.basemap,
      label: this.basemap === "satellite" ? "Спутник Esri" : "Схема OpenStreetMap",
    };
  }

  getBasemapMode(): "streets" | "satellite" {
    return this.basemap;
  }

  setVisibilityFilters(
    cableTypes: ReadonlySet<CableTypeId>,
    cableStatuses: ReadonlySet<CableStatus>,
    nodeKinds: ReadonlySet<NodeKind>,
  ): void {
    this.visibleCableTypes = new Set(cableTypes);
    this.visibleCableStatuses = new Set(cableStatuses);
    this.visibleNodeKinds = new Set(nodeKinds);
    this.render();
  }

  setModelBounds(
    bounds: ModelBounds | null,
    footprint: ModelFootprintPoint[] = [],
  ): void {
    this.localModelBounds = bounds;
    this.localModelFootprint = footprint;
    this.renderModelArea();
  }

  private renderModelArea(): void {
    this.modelAreaLayer.clearLayers();
    this.modelBounds = null;
    const bounds = this.localModelBounds;
    if (!bounds) return;
    const localPoints =
      this.localModelFootprint.length >= 3
        ? this.localModelFootprint
        : [
            { x: bounds.minX, z: bounds.minZ },
            { x: bounds.maxX, z: bounds.minZ },
            { x: bounds.maxX, z: bounds.maxZ },
            { x: bounds.minX, z: bounds.maxZ },
          ];
    const geographicPoints = localPoints.map((point) =>
      this.toLatLng(point.x, point.z),
    ) as L.LatLngExpression[];
    const area = L.polygon(geographicPoints, {
      color: "#0f62fe",
      weight: 2,
      opacity: 0.9,
      fillColor: "#0f62fe",
      fillOpacity: 0.08,
      dashArray: "8 5",
      interactive: false,
    }).addTo(this.modelAreaLayer);
    area.bindTooltip("Область 3D-модели", {
      permanent: true,
      direction: "center",
      className: "model-area-label",
    });
    this.modelBounds = area.getBounds();
  }

  render(): void {
    this.renderModelArea();
    this.networkLayer.clearLayers();
    const state = this.store.state;
    const nodes = new Map(state.nodes.map((node) => [node.id, node]));

    for (const cable of state.cables) {
      if (
        !this.visibleCableTypes.has(cable.type) ||
        !this.visibleCableStatuses.has(cable.status)
      ) {
        continue;
      }
      const from = nodes.get(cable.from);
      const to = nodes.get(cable.to);
      if (!from || !to) continue;
      const cableType = this.store.getCableType(cable.type);
      const geographicRoute = [
        this.toLatLng(from.position.x, from.position.z),
        this.toLatLng(to.position.x, to.position.z),
      ] as L.LatLngExpression[];
      const coreWeight =
        cable.type === "drop-2" ? 4.5 : cableType.install === "underground" ? 8 : 7;
      const dashArray =
        cableType.install === "underground"
          ? "4 6"
          : cable.status === "planned"
            ? "9 7"
            : undefined;
      L.polyline(geographicRoute, {
        color: "#ffffff",
        weight: coreWeight + 5,
        opacity: cable.countInPlan === false ? 0.45 : 0.9,
        dashArray,
        lineCap: "round",
        interactive: false,
      }).addTo(this.networkLayer);
      const line = L.polyline(
        geographicRoute,
        {
          color: cableType.cssColor,
          weight: coreWeight,
          opacity:
            cable.countInPlan === false
              ? 0.56
              : cable.status === "planned"
                ? 0.76
                : 1,
          dashArray,
          lineCap: "round",
        },
      );
      line.bindTooltip(
        `${cableType.name} · ${cable.lengthM.toFixed(1)} м` +
          `${cableType.install === "underground" ? " · в грунте" : ""}` +
          `${cable.countInPlan === false ? " · не в расчёте" : ""}`,
        {
          direction: "top",
        },
      );
      line.addTo(this.networkLayer);
    }

    for (const node of state.nodes) {
      if (node.virtual || !this.visibleNodeKinds.has(node.kind)) continue;
      const color =
        node.kind === "hub"
          ? "#00a6ff"
          : node.kind === "pole"
            ? "#18d5ff"
            : node.kind === "house"
              ? "#ffb000"
              : "#ff4ecd";
      const stateColor =
        node.state === "online"
          ? "#42be65"
          : node.state === "warning"
            ? "#fa4d56"
            : "#f1c21b";
      const position = this.toLatLng(node.position.x, node.position.z);
      L.circleMarker(position, {
        radius: node.kind === "hub" ? 13 : 11,
        color: "#ffffff",
        weight: 3,
        opacity: 0.98,
        fillColor: color,
        fillOpacity: 1,
        interactive: false,
      }).addTo(this.networkLayer);
      const marker = L.circleMarker(position, {
        radius: node.kind === "hub" ? 8 : 7,
        color: "#161616",
        weight: 2.5,
        fillColor: color,
        fillOpacity: 1,
      });
      const stateLabel =
        node.state === "online"
          ? "Активен"
          : node.state === "warning"
            ? "Требует внимания"
            : "План";
      marker.bindTooltip(`${node.name} · ${stateLabel}`, {
        direction: "top",
        offset: [0, -4],
      });
      marker.addTo(this.networkLayer);
      L.circleMarker(position, {
        radius: 2.2,
        stroke: false,
        fillColor: stateColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(this.networkLayer);
    }
  }

  invalidateSize(): void {
    window.setTimeout(() => this.map.invalidateSize({ animate: false }), 30);
  }

  focusVillage(): void {
    if (this.modelBounds) {
      this.map.flyToBounds(this.modelBounds, {
        padding: [32, 32],
        maxZoom: 18,
        duration: 0.75,
      });
      return;
    }
    const { lat, lon } = this.store.state.village;
    this.map.flyTo([lat, lon], 17, { duration: 0.75 });
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || event.button !== 0) return;
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7 ||
      (event.target as HTMLElement).closest(".leaflet-control")
    ) {
      return;
    }

    const rect = this.map.getContainer().getBoundingClientRect();
    const screenPoint = L.point(event.clientX - rect.left, event.clientY - rect.top);
    const latLng = this.map.containerPointToLatLng(screenPoint);
    const local = this.fromLatLng(latLng);

    if (this.mode === "add-node") {
      this.callbacks.onNodePlacement(local.x, local.z);
      return;
    }

    const nodeId = this.closestNodeAt(screenPoint, 18);
    if (nodeId) {
      this.callbacks.onNodeSelected(nodeId);
      return;
    }

    const cableId = this.closestCableAt(screenPoint, 14);
    if (!cableId) return;
    if (this.mode === "connect") {
      this.callbacks.onCableBranch(cableId, local.x, local.z);
    } else {
      this.callbacks.onCableSelected(cableId);
    }
  };

  private handlePointerCancel = (): void => {
    this.pointerDown = null;
  };

  private closestNodeAt(point: L.Point, maximumDistance: number): string | null {
    let closestId: string | null = null;
    let closestDistance = maximumDistance;
    for (const node of this.store.state.nodes) {
      if (node.virtual || !this.visibleNodeKinds.has(node.kind)) continue;
      const markerPoint = this.map.latLngToContainerPoint(
        this.toLatLng(node.position.x, node.position.z),
      );
      const distance = point.distanceTo(markerPoint);
      if (distance <= closestDistance) {
        closestDistance = distance;
        closestId = node.id;
      }
    }
    return closestId;
  }

  private closestCableAt(point: L.Point, maximumDistance: number): string | null {
    const nodes = new Map(this.store.state.nodes.map((node) => [node.id, node]));
    let closestId: string | null = null;
    let closestDistance = maximumDistance;
    for (const cable of this.store.state.cables) {
      if (
        !this.visibleCableTypes.has(cable.type) ||
        !this.visibleCableStatuses.has(cable.status)
      ) {
        continue;
      }
      const from = nodes.get(cable.from);
      const to = nodes.get(cable.to);
      if (!from || !to) continue;
      const start = this.map.latLngToContainerPoint(
        this.toLatLng(from.position.x, from.position.z),
      );
      const end = this.map.latLngToContainerPoint(
        this.toLatLng(to.position.x, to.position.z),
      );
      const distance = this.distanceToSegment(point, start, end);
      if (distance <= closestDistance) {
        closestDistance = distance;
        closestId = cable.id;
      }
    }
    return closestId;
  }

  private distanceToSegment(point: L.Point, start: L.Point, end: L.Point): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 0.0001) return point.distanceTo(start);
    const projection = Math.max(
      0,
      Math.min(
        1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) /
          lengthSquared,
      ),
    );
    return Math.hypot(
      point.x - (start.x + dx * projection),
      point.y - (start.y + dy * projection),
    );
  }

  private applyBasemap(): void {
    const active = this.basemap === "satellite" ? this.satelliteLayer : this.streetLayer;
    const inactive = this.basemap === "satellite" ? this.streetLayer : this.satelliteLayer;
    inactive.removeFrom(this.map);
    active.addTo(this.map);
    this.map.getContainer().classList.toggle("is-satellite", this.basemap === "satellite");
  }

  private toLatLng(xMeters: number, zMeters: number): L.LatLng {
    const { lat, lon, alt = 0 } = this.store.state.village;
    const geodetic = alignedLocalToGeodetic(
      xMeters,
      zMeters,
      { lat, lon, alt },
      this.store.state.mapAlignment,
    );
    return L.latLng(geodetic.lat, geodetic.lon);
  }

  private fromLatLng(latLng: L.LatLng): { x: number; z: number } {
    const { lat, lon, alt = 0 } = this.store.state.village;
    return alignedGeodeticToLocal(
      latLng.lat,
      latLng.lng,
      { lat, lon, alt },
      this.store.state.mapAlignment,
    );
  }
}
