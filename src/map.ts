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
    this.map.on("click", ({ latlng }) => {
      if (this.mode !== "add-node") return;
      const point = this.fromLatLng(latlng);
      this.callbacks.onNodePlacement(point.x, point.z);
    });
    this.render();
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
      line.on("click", (event) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        if (this.mode === "connect") {
          const local = this.fromLatLng(event.latlng);
          this.callbacks.onCableBranch(cable.id, local.x, local.z);
        } else {
          this.callbacks.onCableSelected(cable.id);
        }
      });
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
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        this.callbacks.onNodeSelected(node.id);
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

  private applyBasemap(): void {
    const active = this.basemap === "satellite" ? this.satelliteLayer : this.streetLayer;
    const inactive = this.basemap === "satellite" ? this.streetLayer : this.satelliteLayer;
    inactive.removeFrom(this.map);
    active.addTo(this.map);
    this.map.getContainer().classList.toggle("is-satellite", this.basemap === "satellite");
  }

  private toLatLng(xMeters: number, zMeters: number): L.LatLngExpression {
    const { lat, lon, alt = 0 } = this.store.state.village;
    const geodetic = alignedLocalToGeodetic(
      xMeters,
      zMeters,
      { lat, lon, alt },
      this.store.state.mapAlignment,
    );
    return [geodetic.lat, geodetic.lon];
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
