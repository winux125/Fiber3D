export type NodeKind = "hub" | "pole" | "house" | "splice";
export type NodeState = "online" | "planned" | "warning";
export type CableStatus = "active" | "planned" | "maintenance";
export type InteractionMode = "explore" | "connect" | "add-node";
export type NodePlacementMode = "surface" | "ground";
export type CableTypeId = "adss-24" | "drop-2" | "duct-48";

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface ModelBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface ModelFootprintPoint {
  x: number;
  z: number;
}

export interface MapAlignment {
  eastM: number;
  southM: number;
  rotationDeg: number;
}

export interface NetworkNode {
  id: string;
  name: string;
  kind: NodeKind;
  state: NodeState;
  position: Vector3Data;
  virtual?: boolean;
}

export interface CableRoute {
  id: string;
  from: string;
  to: string;
  type: CableTypeId;
  lengthM: number;
  reserveM: number;
  status: CableStatus;
  countInPlan?: boolean;
}

export interface CableType {
  id: CableTypeId;
  name: string;
  description: string;
  color: number;
  cssColor: string;
  cores: number;
  install: "aerial" | "drop" | "underground";
}

export interface NetworkState {
  nodes: NetworkNode[];
  cables: CableRoute[];
  mapAlignment: MapAlignment;
  village: {
    name: string;
    district: string;
    lat: number;
    lon: number;
    alt?: number;
  };
}
