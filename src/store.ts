import type {
  CableRoute,
  CableStatus,
  CableType,
  CableTypeId,
  NetworkNode,
  NetworkState,
  NodeKind,
  NodeState,
  Vector3Data,
} from "./types";

export const CABLE_TYPES: CableType[] = [
  {
    id: "adss-24",
    name: "ADSS 24",
    description: "Магистраль · воздушная",
    color: 0x58e6a9,
    cssColor: "#58e6a9",
    cores: 24,
    install: "aerial",
  },
  {
    id: "drop-2",
    name: "Drop 2",
    description: "Абонентская линия",
    color: 0xffbc62,
    cssColor: "#ffbc62",
    cores: 2,
    install: "drop",
  },
  {
    id: "duct-48",
    name: "ОК 48",
    description: "Магистраль · в грунте",
    color: 0x6ca8ff,
    cssColor: "#6ca8ff",
    cores: 48,
    install: "underground",
  },
];

const STORAGE_KEY = "fiberplan-3d/network/v1";

const demoState: NetworkState = {
  mapAlignment: {
    eastM: 0,
    southM: 0,
    rotationDeg: 0,
  },
  village: {
    name: "Демо-территория",
    district: "Учебная модель без геопривязки",
    lat: 43.24225,
    lon: 76.90127,
    alt: 0,
  },
  nodes: [
    { id: "hub-1", name: "Узел связи", kind: "hub", state: "online", position: { x: -74, y: 5, z: 8 } },
    { id: "pole-1", name: "Опора 01", kind: "pole", state: "online", position: { x: -42, y: 8, z: 6 } },
    { id: "pole-2", name: "Опора 02", kind: "pole", state: "online", position: { x: -6, y: 8, z: 4 } },
    { id: "pole-3", name: "Опора 03", kind: "pole", state: "online", position: { x: 31, y: 8, z: 7 } },
    { id: "pole-4", name: "Опора 04", kind: "pole", state: "planned", position: { x: 65, y: 8, z: 12 } },
    { id: "house-1", name: "Дом №12", kind: "house", state: "online", position: { x: -29, y: 4, z: -35 } },
    { id: "house-2", name: "Дом №18", kind: "house", state: "online", position: { x: 13, y: 4, z: -42 } },
    { id: "house-3", name: "Школа", kind: "house", state: "online", position: { x: 49, y: 5, z: -28 } },
    { id: "house-4", name: "Дом №27", kind: "house", state: "planned", position: { x: 72, y: 4, z: 42 } },
  ],
  cables: [
    { id: "cab-1", from: "hub-1", to: "pole-1", type: "duct-48", lengthM: 34.1, reserveM: 3, status: "active" },
    { id: "cab-2", from: "pole-1", to: "pole-2", type: "adss-24", lengthM: 36.5, reserveM: 4, status: "active" },
    { id: "cab-3", from: "pole-2", to: "pole-3", type: "adss-24", lengthM: 37.9, reserveM: 4, status: "active" },
    { id: "cab-4", from: "pole-3", to: "pole-4", type: "adss-24", lengthM: 35.2, reserveM: 4, status: "planned" },
    { id: "cab-5", from: "pole-1", to: "house-1", type: "drop-2", lengthM: 43.8, reserveM: 2, status: "active" },
    { id: "cab-6", from: "pole-2", to: "house-2", type: "drop-2", lengthM: 49.2, reserveM: 2, status: "active" },
    { id: "cab-7", from: "pole-3", to: "house-3", type: "drop-2", lengthM: 40.5, reserveM: 2, status: "active" },
  ],
};

function copyState(state: NetworkState): NetworkState {
  return structuredClone(state);
}

function loadState(): NetworkState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = raw ? (JSON.parse(raw) as NetworkState) : copyState(demoState);
    state.mapAlignment ??= { eastM: 0, southM: 0, rotationDeg: 0 };
    state.mapAlignment.rotationDeg ??= 0;
    for (const cable of state.cables) cable.countInPlan ??= true;
    if (state.village.name === "Ақбұлақ") {
      state.village.name = "Демо-территория";
      state.village.district = "Название будет определено после импорта 3D Tiles";
    }
    return state;
  } catch {
    return copyState(demoState);
  }
}

export class NetworkStore extends EventTarget {
  private value = loadState();

  get state(): NetworkState {
    return this.value;
  }

  getCableType(id: CableTypeId): CableType {
    return CABLE_TYPES.find((type) => type.id === id) ?? CABLE_TYPES[0];
  }

  getNode(id: string): NetworkNode | undefined {
    return this.value.nodes.find((node) => node.id === id);
  }

  addNode(
    name: string,
    kind: NodeKind,
    position: Vector3Data,
    state: NodeState = "planned",
  ): NetworkNode {
    const node: NetworkNode = {
      id: crypto.randomUUID(),
      name,
      kind,
      state,
      position,
    };
    this.value.nodes.push(node);
    this.commit();
    return node;
  }

  addCable(from: string, to: string, type: CableTypeId): CableRoute | null {
    if (from === to) return null;
    const a = this.getNode(from);
    const b = this.getNode(to);
    if (!a || !b) return null;

    const existing = this.value.cables.find(
      (cable) =>
        (cable.from === from && cable.to === to) ||
        (cable.from === to && cable.to === from),
    );
    if (existing) return existing;

    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const dz = b.position.z - a.position.z;
    const direct = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const install = this.getCableType(type).install;
    const routingFactor = install === "underground" ? 1.08 : 1.04;
    const lengthM = Math.round(direct * routingFactor * 10) / 10;
    const cable: CableRoute = {
      id: crypto.randomUUID(),
      from,
      to,
      type,
      lengthM,
      reserveM: Math.max(2, Math.ceil(lengthM * 0.08)),
      status: "planned",
      countInPlan: true,
    };
    this.value.cables.push(cable);
    this.commit();
    return cable;
  }

  removeCable(id: string): void {
    this.value.cables = this.value.cables.filter((cable) => cable.id !== id);
    this.commit();
  }

  setCableStatus(id: string, status: CableStatus): boolean {
    const cable = this.value.cables.find((item) => item.id === id);
    if (!cable) return false;
    cable.status = status;
    this.commit();
    return true;
  }

  toggleCableInPlan(id: string): boolean | null {
    const cable = this.value.cables.find((item) => item.id === id);
    if (!cable) return null;
    cable.countInPlan = cable.countInPlan === false;
    this.commit();
    return cable.countInPlan;
  }

  splitCableAt(
    cableId: string,
    point: { x: number; z: number; y?: number },
  ): NetworkNode | null {
    const cableIndex = this.value.cables.findIndex((item) => item.id === cableId);
    const cable = this.value.cables[cableIndex];
    if (!cable) return null;
    const from = this.getNode(cable.from);
    const to = this.getNode(cable.to);
    if (!from || !to) return null;

    const dx = to.position.x - from.position.x;
    const dz = to.position.z - from.position.z;
    const horizontalLengthSquared = dx * dx + dz * dz;
    if (horizontalLengthSquared < 0.01) return from;
    const rawT =
      ((point.x - from.position.x) * dx + (point.z - from.position.z) * dz) /
      horizontalLengthSquared;
    if (rawT <= 0.04) return from;
    if (rawT >= 0.96) return to;
    const t = Math.min(0.96, Math.max(0.04, rawT));
    const position = {
      x: Math.round((from.position.x + dx * t) * 10) / 10,
      y:
        Math.round(
          (point.y ??
            from.position.y + (to.position.y - from.position.y) * t) *
            10,
        ) / 10,
      z: Math.round((from.position.z + dz * t) * 10) / 10,
    };
    const junction: NetworkNode = {
      id: crypto.randomUUID(),
      name: `Ответвление ${
        this.value.nodes.filter((node) => node.virtual).length + 1
      }`,
      kind: "splice",
      state: cable.status === "active" ? "online" : "planned",
      position,
      virtual: true,
    };
    const firstLength = Math.max(0.1, Math.round(cable.lengthM * t * 10) / 10);
    const secondLength = Math.max(0.1, Math.round((cable.lengthM - firstLength) * 10) / 10);
    const firstReserve = Math.round(cable.reserveM * t);
    const counted = cable.countInPlan !== false;
    const firstSegment: CableRoute = {
      ...cable,
      id: crypto.randomUUID(),
      to: junction.id,
      lengthM: firstLength,
      reserveM: firstReserve,
      countInPlan: counted,
    };
    const secondSegment: CableRoute = {
      ...cable,
      id: crypto.randomUUID(),
      from: junction.id,
      lengthM: secondLength,
      reserveM: Math.max(0, cable.reserveM - firstReserve),
      countInPlan: counted,
    };
    this.value.nodes.push(junction);
    this.value.cables.splice(cableIndex, 1, firstSegment, secondSegment);
    this.commit();
    return junction;
  }

  clearForImportedModel(location?: { lat: number; lon: number; alt?: number }): void {
    this.value.nodes = [];
    this.value.cables = [];
    this.value.mapAlignment = { eastM: 0, southM: 0, rotationDeg: 0 };
    if (location) {
      this.value.village.lat = location.lat;
      this.value.village.lon = location.lon;
      this.value.village.alt = location.alt;
      this.value.village.name = `Модель ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
      this.value.village.district = "Определяем название территории…";
    }
    this.commit();
  }

  adjustMapAlignment(eastDeltaM: number, southDeltaM: number): void {
    this.value.mapAlignment.eastM =
      Math.round((this.value.mapAlignment.eastM + eastDeltaM) * 10) / 10;
    this.value.mapAlignment.southM =
      Math.round((this.value.mapAlignment.southM + southDeltaM) * 10) / 10;
    this.commit();
  }

  adjustMapRotation(deltaDegrees: number): void {
    const rawRotation = this.value.mapAlignment.rotationDeg + deltaDegrees;
    const normalizedRotation = ((rawRotation + 180) % 360 + 360) % 360 - 180;
    this.value.mapAlignment.rotationDeg = Math.round(normalizedRotation * 1000) / 1000;
    this.commit();
  }

  resetMapAlignment(): void {
    this.value.mapAlignment = { eastM: 0, southM: 0, rotationDeg: 0 };
    this.commit();
  }

  setVillageDetails(details: {
    name: string;
    district: string;
    lat?: number;
    lon?: number;
    alt?: number;
  }): void {
    this.value.village.name = details.name;
    this.value.village.district = details.district;
    if (details.lat !== undefined) this.value.village.lat = details.lat;
    if (details.lon !== undefined) this.value.village.lon = details.lon;
    if (details.alt !== undefined) this.value.village.alt = details.alt;
    this.commit();
  }

  restoreDemo(): void {
    this.value = copyState(demoState);
    this.commit();
  }

  exportJson(): string {
    return JSON.stringify(this.value, null, 2);
  }

  private commit(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    this.dispatchEvent(new Event("change"));
  }
}
