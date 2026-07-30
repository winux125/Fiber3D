import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { ecefToGeodetic, makeLocalFrame } from "./geodesy";
import type {
  CableRoute,
  CableStatus,
  CableTypeId,
  InteractionMode,
  ModelBounds,
  ModelFootprintPoint,
  NetworkNode,
  NodeKind,
  NodePlacementMode,
  NodeState,
  Vector3Data,
} from "./types";
import type { ZipImportProgress } from "./zip-tileset";
import { NetworkStore } from "./store";

interface SceneCallbacks {
  onConnection: (from: string, to: string) => void;
  onNodePlacement: (position: Vector3Data) => void;
  onCableSelected: (id: string) => void;
  onCableBranch: (id: string, position: Vector3Data) => void;
  onHint: (message: string) => void;
  onViewChanged: (
    x: number,
    z: number,
    distance: number,
    headingRad: number,
  ) => void;
}

interface FlowParticle {
  mesh: THREE.Mesh;
  curve: THREE.Curve<THREE.Vector3>;
  speed: number;
  offset: number;
}

interface SceneViewState {
  x: number;
  z: number;
  distance: number;
  headingRad: number;
}

export interface ZipLoadResult {
  tileCount: number;
  lodDepth: number;
  sourceBytes: number;
  origin: {
    lat: number;
    lon: number;
    alt: number;
  } | null;
  bounds: ModelBounds;
  footprint: ModelFootprintPoint[];
}

export interface ModelLoadResult {
  bounds: ModelBounds;
  footprint: ModelFootprintPoint[];
}

const NODE_COLORS: Record<NodeKind, number> = {
  hub: 0x00a6ff,
  pole: 0x18d5ff,
  house: 0xffb000,
  splice: 0xff4ecd,
};

const NODE_STATE_COLORS: Record<NodeState, number> = {
  online: 0x42be65,
  planned: 0xf1c21b,
  warning: 0xfa4d56,
};

const CAMERA_CONTROL_CODES = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyI",
  "KeyK",
  "KeyR",
  "KeyF",
  "Equal",
  "Minus",
  "NumpadAdd",
  "NumpadSubtract",
  "ShiftLeft",
  "ShiftRight",
]);

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      const maybeMap = (material as THREE.MeshStandardMaterial).map;
      maybeMap?.dispose();
      material.dispose();
    }
  });
}

function makeLabel(text: string, accent: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const scale = 2;
  canvas.width = 300 * scale;
  canvas.height = 70 * scale;
  context.scale(scale, scale);
  context.font = "600 20px IBM Plex Sans, Arial, sans-serif";
  const textWidth = context.measureText(text).width;
  const width = Math.min(284, Math.max(104, textWidth + 42));
  context.fillStyle = "rgba(22, 22, 22, .92)";
  context.beginPath();
  context.roundRect((300 - width) / 2, 8, width, 45, 14);
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#f4fbf8";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 150, 31);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(42, 10, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function projectedConvexHull(root: THREE.Object3D): ModelFootprintPoint[] {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.geometry instanceof THREE.BufferGeometry &&
      object.geometry.getAttribute("position")
    ) {
      meshes.push(object);
    }
  });
  if (!meshes.length) return [];

  const maximumSamples = 80_000;
  const samplesPerMesh = Math.max(48, Math.floor(maximumSamples / meshes.length));
  const samples = new Map<string, ModelFootprintPoint>();
  const vertex = new THREE.Vector3();

  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const stride = Math.max(1, Math.ceil(position.count / samplesPerMesh));
    for (let index = 0; index < position.count; index += stride) {
      vertex
        .set(position.getX(index), position.getY(index), position.getZ(index))
        .applyMatrix4(mesh.matrixWorld);
      const point = { x: vertex.x, z: vertex.z };
      samples.set(`${point.x.toFixed(2)}:${point.z.toFixed(2)}`, point);
    }
  }

  const points = [...samples.values()].sort((left, right) => left.x - right.x || left.z - right.z);
  if (points.length < 3) return points;
  const cross = (
    origin: ModelFootprintPoint,
    first: ModelFootprintPoint,
    second: ModelFootprintPoint,
  ): number =>
    (first.x - origin.x) * (second.z - origin.z) -
    (first.z - origin.z) * (second.x - origin.x);
  const lower: ModelFootprintPoint[] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: ModelFootprintPoint[] = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length <= 96) return hull;
  return Array.from({ length: 96 }, (_, index) =>
    hull[Math.floor((index * hull.length) / 96)],
  );
}

function makeEcefLocalization(
  center: THREE.Vector3,
  origin: { lat: number; lon: number; alt: number },
): THREE.Matrix4 {
  const frame = makeLocalFrame(origin.lat, origin.lon, origin.alt);
  const east = new THREE.Vector3(frame.east.x, frame.east.y, frame.east.z);
  const up = new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z);
  const south = new THREE.Vector3(frame.south.x, frame.south.y, frame.south.z);
  const rotation = new THREE.Matrix4().set(
    east.x, east.y, east.z, 0,
    up.x, up.y, up.z, 0,
    south.x, south.y, south.z, 0,
    0, 0, 0, 1,
  );
  return rotation.multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}

export class VillageScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly timer = new THREE.Timer();
  private readonly networkRoot = new THREE.Group();
  private readonly importedRoot = new THREE.Group();
  private readonly demoRoot = new THREE.Group();
  private readonly pickSurfaces: THREE.Object3D[] = [];
  private readonly flows: FlowParticle[] = [];
  private readonly nodeMarkers = new Map<string, THREE.Group>();
  private readonly pressedKeys = new Set<string>();
  private readonly northArrow = document.querySelector<HTMLElement>(".north-indicator i");
  private readonly activeSurfaceBox = new THREE.Box3(
    new THREE.Vector3(-420, 0, -420),
    new THREE.Vector3(420, 20, 420),
  );
  private mode: InteractionMode = "explore";
  private nodePlacementMode: NodePlacementMode = "surface";
  private visibleCableTypes = new Set<CableTypeId>(["adss-24", "drop-2", "duct-48"]);
  private visibleCableStatuses = new Set<CableStatus>(["active", "planned", "maintenance"]);
  private visibleNodeKinds = new Set<NodeKind>(["splice", "pole", "house", "hub"]);
  private connectionStart: string | null = null;
  private visible = true;
  private introStart = performance.now();
  private introActive = true;
  private lastViewSyncAt = 0;
  private lastSynchronizedView: SceneViewState | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: NetworkStore,
    private readonly callbacks: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio <= 2,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "scene-canvas";
    container.append(this.renderer.domElement);
    this.timer.connect(document);

    this.scene.background = new THREE.Color(0x101318);
    this.camera.position.set(190, 150, 205);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 750;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 0, 0);

    this.addLighting();
    this.buildDemoVillage();
    this.scene.add(this.demoRoot, this.importedRoot, this.networkRoot);
    this.renderNetwork();

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);

    const resizeObserver = new ResizeObserver(() => this.resize());
    resizeObserver.observe(container);
    document.addEventListener("visibilitychange", () => {
      this.visible = !document.hidden;
    });
    this.animate();
  }

  setMode(mode: InteractionMode): void {
    this.mode = mode;
    this.connectionStart = null;
    this.highlightNode(null);
    this.renderer.domElement.dataset.mode = mode;
    const hints: Record<InteractionMode, string> = {
      explore: "WASD/стрелки — движение · Q/E — поворот · R/F — высота",
      connect: "Выберите узел или любую точку существующего кабеля",
      "add-node": "Кликните по поверхности модели или по карте",
    };
    this.callbacks.onHint(hints[mode]);
  }

  setNodePlacementMode(mode: NodePlacementMode): void {
    this.nodePlacementMode = mode;
  }

  setVisibilityFilters(
    cableTypes: ReadonlySet<CableTypeId>,
    cableStatuses: ReadonlySet<CableStatus>,
    nodeKinds: ReadonlySet<NodeKind>,
  ): void {
    this.visibleCableTypes = new Set(cableTypes);
    this.visibleCableStatuses = new Set(cableStatuses);
    this.visibleNodeKinds = new Set(nodeKinds);
    this.renderNetwork();
  }

  renderNetwork(): void {
    this.applyGeographicRotation();
    disposeObject(this.networkRoot);
    this.networkRoot.clear();
    this.flows.length = 0;
    this.nodeMarkers.clear();

    for (const cable of this.store.state.cables) {
      if (
        this.visibleCableTypes.has(cable.type) &&
        this.visibleCableStatuses.has(cable.status)
      ) {
        this.addCable(cable);
      }
    }
    for (const node of this.store.state.nodes) {
      if (!node.virtual && this.visibleNodeKinds.has(node.kind)) this.addNodeMarker(node);
    }
  }

  focusNode(id: string): void {
    const node = this.store.getNode(id);
    if (!node) return;
    const point = this.networkRoot.localToWorld(
      new THREE.Vector3(node.position.x, node.position.y, node.position.z),
    );
    const direction = new THREE.Vector3(1, 0.72, 1).normalize().multiplyScalar(42);
    this.flyCamera(point.clone().add(direction), point, 700);
  }

  focusCable(id: string): void {
    const cable = this.store.state.cables.find((item) => item.id === id);
    if (!cable) return;
    const from = this.store.getNode(cable.from);
    const to = this.store.getNode(cable.to);
    if (!from || !to) return;
    const center = this.networkRoot.localToWorld(new THREE.Vector3(
      (from.position.x + to.position.x) / 2,
      (from.position.y + to.position.y) / 2,
      (from.position.z + to.position.z) / 2,
    ));
    this.flyCamera(center.clone().add(new THREE.Vector3(35, 28, 38)), center, 650);
  }

  selectNodeFromMap(id: string): void {
    if (this.mode === "connect") this.handleConnectionNode(id);
    else this.focusNode(id);
  }

  positionFromMap(x: number, z: number): Vector3Data {
    return this.resolveNodePosition(x, z);
  }

  setViewFromMap(x: number, z: number, zoom: number): void {
    this.introActive = false;
    this.networkRoot.updateMatrixWorld(true);
    const currentTargetLocal = this.networkRoot.worldToLocal(
      this.controls.target.clone(),
    );
    currentTargetLocal.x = x;
    currentTargetLocal.z = z;
    const nextTarget = this.networkRoot.localToWorld(currentTargetLocal);
    const translation = nextTarget.clone().sub(this.controls.target);
    this.controls.target.copy(nextTarget);
    this.camera.position.add(translation);

    const offset = this.camera.position.clone().sub(this.controls.target);
    const desiredDistance = THREE.MathUtils.clamp(
      20 * 2 ** (20 - zoom),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    if (offset.lengthSq() < 0.0001) offset.set(1, 0.72, 1);
    offset.setLength(desiredDistance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.lastSynchronizedView = null;
  }

  private surfaceHeightAt(x: number, z: number): number | null {
    const modelRoot = this.activeModelRoot();
    modelRoot.updateMatrixWorld(true);
    const rayOrigin = modelRoot.localToWorld(new THREE.Vector3(
      x,
      Math.max(this.activeSurfaceBox.max.y + 100, 200),
      z,
    ));
    this.raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    const hit = this.raycaster.intersectObjects(this.pickSurfaces, true)[0];
    return hit ? modelRoot.worldToLocal(hit.point.clone()).y : null;
  }

  private estimateGroundHeight(x: number, z: number, surfaceY: number): number {
    const fallback = Math.max(0, this.activeSurfaceBox.min.y);
    const heights: number[] = [];
    const centerHeight = this.surfaceHeightAt(x, z);
    if (centerHeight !== null) heights.push(centerHeight);

    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [Math.SQRT1_2, Math.SQRT1_2],
      [-Math.SQRT1_2, Math.SQRT1_2],
      [Math.SQRT1_2, -Math.SQRT1_2],
      [-Math.SQRT1_2, -Math.SQRT1_2],
    ] as const;

    for (const radius of [8, 18, 32, 48]) {
      for (const [dx, dz] of directions) {
        const height = this.surfaceHeightAt(x + dx * radius, z + dz * radius);
        if (height !== null && Number.isFinite(height)) heights.push(height);
      }

      const nearbyGround = heights
        .filter((height) => height < surfaceY - 2)
        .sort((left, right) => left - right);
      if (nearbyGround.length >= 3) {
        return nearbyGround[Math.floor(nearbyGround.length / 2)];
      }
    }

    if (!heights.length) return fallback;
    heights.sort((left, right) => left - right);
    const lowerBand = heights.slice(0, Math.max(1, Math.ceil(heights.length / 3)));
    return lowerBand[Math.floor(lowerBand.length / 2)] ?? fallback;
  }

  private resolveNodePosition(x: number, z: number, clickedSurfaceY?: number): Vector3Data {
    const surfaceY =
      clickedSurfaceY ??
      this.surfaceHeightAt(x, z) ??
      Math.max(0, this.activeSurfaceBox.min.y);
    const groundY =
      this.nodePlacementMode === "ground"
        ? this.estimateGroundHeight(x, z, surfaceY)
        : surfaceY;
    const y = this.nodePlacementMode === "surface" ? surfaceY : groundY;
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round((y + 1.4) * 10) / 10,
      z: Math.round(z * 10) / 10,
    };
  }

  async loadGlb(file: File): Promise<ModelLoadResult> {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const objectUrl = URL.createObjectURL(file);
    try {
      const gltf = await loader.loadAsync(objectUrl);
      return this.presentImportedModel(gltf.scene);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async loadZip(
    file: File,
    onProgress?: (progress: ZipImportProgress) => void,
  ): Promise<ZipLoadResult> {
    const [{ openTilesetArchive }, { GLTFLoader }, { DRACOLoader, DRACO_GLTF_CONFIG }] =
      await Promise.all([
      import("./zip-tileset"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/loaders/DRACOLoader.js"),
      ]);
    const archive = await openTilesetArchive(file, onProgress);
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_GLTF_CONFIG);
    dracoLoader.setWorkerLimit(2);
    dracoLoader.preload();
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    const tiledModel = new THREE.Group();
    const axisFix =
      archive.gltfUpAxis === "Z"
        ? new THREE.Matrix4()
        : new THREE.Matrix4().set(
            1, 0, 0, 0,
            0, 0, 1, 0,
            0, -1, 0, 0,
            0, 0, 0, 1,
          );
    let loadedTiles = 0;

    try {
      for (let start = 0; start < archive.tiles.length; start += 2) {
        const batch = archive.tiles.slice(start, start + 2);
        const scenes = await Promise.all(
          batch.map(async (tile) => {
            const payload = await archive.readTile(tile);
            const objectUrl = URL.createObjectURL(payload.glb);
            try {
              const gltf = await loader.loadAsync(objectUrl);
              const tileMatrix = new THREE.Matrix4().fromArray(tile.transform);
              if (payload.rtcCenter) {
                tileMatrix.multiply(
                  new THREE.Matrix4().makeTranslation(
                    payload.rtcCenter[0],
                    payload.rtcCenter[1],
                    payload.rtcCenter[2],
                  ),
                );
              }
              tileMatrix.multiply(axisFix);
              gltf.scene.matrixAutoUpdate = false;
              gltf.scene.matrix.copy(tileMatrix);
              loadedTiles += 1;
              onProgress?.({
                phase: "extract",
                current: loadedTiles,
                total: archive.tiles.length,
                detail: `Загружаем тайлы ${loadedTiles} / ${archive.tiles.length}`,
              });
              return gltf.scene;
            } finally {
              URL.revokeObjectURL(objectUrl);
            }
          }),
        );
        tiledModel.add(...scenes);
      }

      tiledModel.updateMatrixWorld(true);
      const sourceBox = new THREE.Box3().setFromObject(tiledModel, true);
      if (sourceBox.isEmpty()) throw new Error("В тайлах не найдена геометрия");
      const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
      const isEcef = sourceCenter.length() > 1_000_000;
      const origin = isEcef ? ecefToGeodetic(sourceCenter) : null;
      const localized = new THREE.Group();
      localized.matrixAutoUpdate = false;
      localized.matrix.copy(
        origin
          ? makeEcefLocalization(sourceCenter, origin)
          : archive.gltfUpAxis === "Z"
            ? new THREE.Matrix4()
                .set(
                  1, 0, 0, 0,
                  0, 0, -1, 0,
                  0, 1, 0, 0,
                  0, 0, 0, 1,
                )
                .multiply(
                  new THREE.Matrix4().makeTranslation(
                    -sourceCenter.x,
                    -sourceCenter.y,
                    -sourceCenter.z,
                  ),
                )
            : new THREE.Matrix4().makeTranslation(
                -sourceCenter.x,
                -sourceCenter.y,
                -sourceCenter.z,
              ),
      );
      localized.add(tiledModel);
      const modelArea = this.presentImportedModel(localized, true);

      return {
        tileCount: archive.tiles.length,
        lodDepth: archive.lodDepth,
        sourceBytes: archive.sourceBytes,
        origin,
        ...modelArea,
      };
    } catch (error) {
      disposeObject(tiledModel);
      throw error;
    } finally {
      dracoLoader.dispose();
      await archive.close();
    }
  }

  private presentImportedModel(
    content: THREE.Object3D,
    preserveScale = false,
  ): ModelLoadResult {
    const model = new THREE.Group();
    model.add(content);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    if (box.isEmpty()) throw new Error("В модели не найдена геометрия");
    const size = box.getSize(new THREE.Vector3());
    const maxSide = Math.max(size.x, size.y, size.z);
    const scale = preserveScale
      ? 1
      : maxSide > 850
        ? 650 / maxSide
        : maxSide < 70
          ? 220 / Math.max(maxSide, 1)
          : 1;
    model.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = scaledBox.getCenter(new THREE.Vector3());
    if (!preserveScale) {
      model.position.x -= center.x;
      model.position.z -= center.z;
    }
    model.position.y -= scaledBox.min.y;
    model.updateMatrixWorld(true);
    const footprint = projectedConvexHull(model);

    let meshCount = 0;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount += 1;
      object.castShadow = meshCount < 120;
      object.receiveShadow = true;
      object.frustumCulled = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = Math.max(material.roughness, 0.68);
          material.envMapIntensity = 0.45;
        }
      }
    });

    disposeObject(this.importedRoot);
    this.importedRoot.clear();
    this.importedRoot.add(model);
    this.demoRoot.visible = false;
    this.pickSurfaces.length = 0;
    this.pickSurfaces.push(model);

    const finalBox = new THREE.Box3().setFromObject(model, true);
    this.activeSurfaceBox.copy(finalBox);
    const finalSize = finalBox.getSize(new THREE.Vector3());
    const radius = Math.max(finalSize.x, finalSize.z, 80);
    const target = finalBox.getCenter(new THREE.Vector3());
    this.camera.near = Math.max(0.1, radius / 2000);
    this.camera.far = Math.max(5000, radius * 8);
    this.controls.maxDistance = Math.max(750, radius * 3.2);
    this.camera.updateProjectionMatrix();
    this.flyCamera(
      target.clone().add(new THREE.Vector3(radius * 0.64, radius * 0.45, radius * 0.72)),
      target,
      1100,
    );
    return {
      bounds: {
        minX: finalBox.min.x,
        minZ: finalBox.min.z,
        maxX: finalBox.max.x,
        maxZ: finalBox.max.z,
      },
      footprint,
    };
  }

  restoreDemo(): void {
    disposeObject(this.importedRoot);
    this.importedRoot.clear();
    this.demoRoot.visible = true;
    this.pickSurfaces.length = 0;
    const ground = this.demoRoot.getObjectByName("pick-ground");
    if (ground) this.pickSurfaces.push(ground);
    this.activeSurfaceBox.set(
      new THREE.Vector3(-420, 0, -420),
      new THREE.Vector3(420, 20, 420),
    );
    this.controls.maxDistance = 750;
    this.flyCamera(new THREE.Vector3(190, 150, 205), new THREE.Vector3(0, 0, 0), 950);
  }

  private addLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xdde8ff, 0x161616, 2.35);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xffffff, 3.25);
    sun.position.set(-120, 190, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -230;
    sun.shadow.camera.right = 230;
    sun.shadow.camera.top = 230;
    sun.shadow.camera.bottom = -230;
    sun.shadow.bias = -0.00035;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x4589ff, 1.25);
    rim.position.set(120, 60, -160);
    this.scene.add(rim);
  }

  private buildDemoVillage(): void {
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x20242b,
      roughness: 0.96,
      metalness: 0,
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(420, 96), groundMaterial);
    ground.name = "pick-ground";
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.demoRoot.add(ground);
    this.pickSurfaces.push(ground);

    const grid = new THREE.GridHelper(560, 28, 0x0f62fe, 0x343a46);
    grid.position.y = 0.035;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.34;
    this.demoRoot.add(grid);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x454951, roughness: 0.97 });
    const roadCurves = [
      [new THREE.Vector3(-150, 0.15, 8), new THREE.Vector3(10, 0.15, 4), new THREE.Vector3(150, 0.15, 22)],
      [new THREE.Vector3(-20, 0.16, -120), new THREE.Vector3(-6, 0.16, 4), new THREE.Vector3(16, 0.16, 125)],
    ];
    for (const points of roadCurves) {
      const curve = new THREE.CatmullRomCurve3(points);
      const road = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 5.5, 8, false), roadMaterial);
      road.receiveShadow = true;
      this.demoRoot.add(road);
    }

    const housePositions = [
      [-29, -35, 0.2], [13, -42, -0.15], [49, -28, 0.35], [72, 42, -0.2],
      [-88, -38, 0.1], [-104, 48, 0.2], [26, 62, -0.25], [108, -45, 0.15],
      [118, 54, -0.1], [-55, 74, 0.25], [-18, 98, -0.2], [84, 92, 0.12],
    ] as const;
    const bodyGeometry = new THREE.BoxGeometry(16, 8, 12);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc6c6c6, roughness: 0.86 });
    const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, housePositions.length);
    const roofGeometry = new THREE.ConeGeometry(11, 5.2, 4);
    roofGeometry.rotateY(Math.PI / 4);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6f6f, roughness: 0.9 });
    const roofs = new THREE.InstancedMesh(roofGeometry, roofMaterial, housePositions.length);
    const matrix = new THREE.Matrix4();
    housePositions.forEach(([x, z, rotation], index) => {
      matrix.makeRotationY(rotation);
      matrix.setPosition(x, 4.25, z);
      bodies.setMatrixAt(index, matrix);
      matrix.makeRotationY(rotation);
      matrix.setPosition(x, 10.6, z);
      roofs.setMatrixAt(index, matrix);
    });
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    roofs.castShadow = true;
    this.demoRoot.add(bodies, roofs);

    const treeCount = 70;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.45, 0.65, 4.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x4d535b, roughness: 1 }),
      treeCount,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(2.8, 0),
      new THREE.MeshStandardMaterial({ color: 0x247648, roughness: 0.92 }),
      treeCount,
    );
    for (let index = 0; index < treeCount; index += 1) {
      const angle = index * 2.39996;
      const radius = 78 + (index % 9) * 13;
      const x = Math.cos(angle) * radius + Math.sin(index * 1.7) * 22;
      const z = Math.sin(angle) * radius + Math.cos(index * 1.31) * 17;
      matrix.makeTranslation(x, 2.25, z);
      trunk.setMatrixAt(index, matrix);
      const crownScale = 0.85 + (index % 5) * 0.08;
      matrix.compose(
        new THREE.Vector3(x, 5.35, z),
        new THREE.Quaternion(),
        new THREE.Vector3(crownScale, crownScale, crownScale),
      );
      crowns.setMatrixAt(index, matrix);
    }
    trunk.castShadow = true;
    crowns.castShadow = true;
    this.demoRoot.add(trunk, crowns);

    const horizon = new THREE.Mesh(
      new THREE.RingGeometry(260, 420, 96),
      new THREE.MeshBasicMaterial({ color: 0x0b0e13, side: THREE.DoubleSide }),
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -0.1;
    this.demoRoot.add(horizon);
  }

  private addNodeMarker(node: NetworkNode): void {
    const group = new THREE.Group();
    group.position.set(node.position.x, node.position.y, node.position.z);
    group.userData.nodeId = node.id;

    const color = NODE_COLORS[node.kind];
    const stateColor = NODE_STATE_COLORS[node.state];
    const material = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const radius = node.kind === "hub" ? 2.7 : node.kind === "house" ? 2 : 2.2;
    const outline = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.28, 18, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    outline.renderOrder = 14;
    group.add(outline);
    const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), material);
    core.userData.nodeId = node.id;
    core.renderOrder = 15;
    group.add(core);

    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.4, 0),
        new THREE.Vector3(0, 0, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    stem.renderOrder = 15;
    group.add(stem);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 2.1, 16, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: node.state === "planned" ? 0.24 : 0.32,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.renderOrder = 13;
    group.add(halo);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.85, 0.12, 8, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.userData.pulseRing = true;
    ring.renderOrder = 16;
    group.add(ring);

    const stateDot = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.38, 12, 8),
      new THREE.MeshBasicMaterial({
        color: stateColor,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    stateDot.position.set(radius * 0.82, radius * 0.82, radius * 0.35);
    stateDot.renderOrder = 17;
    group.add(stateDot);

    const label = makeLabel(node.name, `#${color.toString(16).padStart(6, "0")}`);
    label.position.y = radius * 3.4 + 4;
    group.add(label);

    this.nodeMarkers.set(node.id, group);
    this.networkRoot.add(group);
  }

  private addCable(cable: CableRoute): void {
    const from = this.store.getNode(cable.from);
    const to = this.store.getNode(cable.to);
    if (!from || !to) return;
    const cableType = this.store.getCableType(cable.type);
    const start = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
    const end = new THREE.Vector3(to.position.x, to.position.y, to.position.z);
    let curve: THREE.Curve<THREE.Vector3>;

    if (cableType.install === "underground") {
      const a = start.clone();
      const b = end.clone();
      a.y = Math.max(0.18, a.y - 1.18);
      b.y = Math.max(0.18, b.y - 1.18);
      curve = new THREE.CatmullRomCurve3([
        a,
        a.clone().lerp(b, 0.34).add(new THREE.Vector3(0, 0.04, 1.5)),
        a.clone().lerp(b, 0.68).add(new THREE.Vector3(0, 0.04, -1.5)),
        b,
      ]);
    } else {
      const distance = start.distanceTo(end);
      const sag = Math.min(3.2, distance * 0.045);
      curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().lerp(end, 0.28).add(new THREE.Vector3(0, -sag, 0)),
        start.clone().lerp(end, 0.72).add(new THREE.Vector3(0, -sag, 0)),
        end,
      ]);
    }

    const coreRadius =
      cableType.install === "drop" ? 0.52 : cableType.install === "underground" ? 0.9 : 0.76;
    const geometry = new THREE.TubeGeometry(
      curve,
      40,
      coreRadius,
      8,
      false,
    );
    const outline = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, coreRadius * 1.72, 8, false),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: cable.countInPlan === false ? 0.3 : 0.56,
        depthTest: false,
        depthWrite: false,
      }),
    );
    outline.userData.cableId = cable.id;
    outline.renderOrder = 8;
    this.networkRoot.add(outline);
    const material = new THREE.MeshStandardMaterial({
      color: cableType.color,
      emissive: cableType.color,
      emissiveIntensity: cable.status === "active" ? 1.8 : 0.9,
      roughness: 0.38,
      metalness: 0.08,
      transparent: true,
      opacity:
        cable.countInPlan === false
          ? 0.58
          : cable.status === "planned"
            ? 0.82
            : 1,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.cableId = cable.id;
    mesh.renderOrder = 9;
    this.networkRoot.add(mesh);

    if (cableType.install === "underground") {
      const guideGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
      const guide = new THREE.Line(
        guideGeometry,
        new THREE.LineDashedMaterial({
          color: 0xffffff,
          dashSize: 2.4,
          gapSize: 1.5,
          transparent: true,
          opacity: 0.78,
          depthTest: false,
        }),
      );
      guide.computeLineDistances();
      guide.userData.cableId = cable.id;
      guide.renderOrder = 7;
      this.networkRoot.add(guide);
    }

    if (cable.status !== "maintenance") {
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(cableType.install === "drop" ? 0.72 : 0.9, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: cable.status === "active" ? 0.92 : 0.48,
          depthWrite: false,
        }),
      );
      bead.renderOrder = 8;
      bead.userData.cableId = cable.id;
      this.networkRoot.add(bead);
      this.flows.push({
        mesh: bead,
        curve,
        speed: cable.status === "active" ? 0.14 : 0.07,
        offset: Math.random(),
      });
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const networkHits = this.raycaster.intersectObjects(this.networkRoot.children, true);
    const hitObject = networkHits[0]?.object;
    if (hitObject) {
      const nodeId = this.findUserData(hitObject, "nodeId");
      const cableId = this.findUserData(hitObject, "cableId");
      if (typeof nodeId === "string") {
        if (this.mode === "connect") this.handleConnectionNode(nodeId);
        else this.focusNode(nodeId);
        return;
      }
      if (typeof cableId === "string") {
        if (this.mode === "connect") {
          const localPoint = this.networkRoot.worldToLocal(networkHits[0].point.clone());
          this.callbacks.onCableBranch(cableId, {
            x: localPoint.x,
            y: localPoint.y,
            z: localPoint.z,
          });
        } else if (this.mode === "explore") {
          this.callbacks.onCableSelected(cableId);
        }
        return;
      }
    }

    if (this.mode === "add-node") {
      const surfaceHits = this.raycaster.intersectObjects(this.pickSurfaces, true);
      const point = surfaceHits[0]?.point;
      if (point) {
        const localPoint = this.activeModelRoot().worldToLocal(point.clone());
        this.callbacks.onNodePlacement(
          this.resolveNodePosition(localPoint.x, localPoint.z, localPoint.y),
        );
      } else {
        this.callbacks.onHint("Поверхность не найдена — приблизьте модель и попробуйте снова");
      }
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const networkHit = this.raycaster.intersectObjects(this.networkRoot.children, true)[0];
    const interactive = Boolean(
      networkHit &&
        (this.findUserData(networkHit.object, "nodeId") || this.findUserData(networkHit.object, "cableId")),
    );
    this.renderer.domElement.classList.toggle("is-hovering", interactive);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (CAMERA_CONTROL_CODES.has(event.code)) {
      event.preventDefault();
      this.introActive = false;
      this.pressedKeys.add(event.code);
      return;
    }
    if (event.key === "Escape") {
      this.connectionStart = null;
      this.highlightNode(null);
      this.callbacks.onHint("Действие отменено");
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private handleWindowBlur = (): void => {
    this.pressedKeys.clear();
  };

  private updateKeyboardMovement(delta: number): void {
    if (!this.pressedKeys.size) return;
    const pressed = (...codes: string[]): boolean =>
      codes.some((code) => this.pressedKeys.has(code));
    const boost = pressed("ShiftLeft", "ShiftRight") ? 3 : 1;
    const viewDistance = this.camera.position.distanceTo(this.controls.target);
    const speed = THREE.MathUtils.clamp(viewDistance * 0.55, 16, 320) * boost;
    const forward = this.controls.target.clone().sub(this.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const right = forward.clone().cross(this.camera.up).normalize();
    const movement = new THREE.Vector3();
    if (pressed("ArrowUp", "KeyW")) movement.add(forward);
    if (pressed("ArrowDown", "KeyS")) movement.sub(forward);
    if (pressed("ArrowRight", "KeyD")) movement.add(right);
    if (pressed("ArrowLeft", "KeyA")) movement.sub(right);
    if (pressed("KeyR")) movement.y += 1;
    if (pressed("KeyF")) movement.y -= 1;
    if (movement.lengthSq()) {
      movement.normalize().multiplyScalar(speed * delta);
      this.camera.position.add(movement);
      this.controls.target.add(movement);
    }

    const yaw = (pressed("KeyE") ? 1 : 0) - (pressed("KeyQ") ? 1 : 0);
    const pitch = (pressed("KeyK") ? 1 : 0) - (pressed("KeyI") ? 1 : 0);
    const zoom =
      (pressed("Minus", "NumpadSubtract") ? 1 : 0) -
      (pressed("Equal", "NumpadAdd") ? 1 : 0);
    if (!yaw && !pitch && !zoom) return;

    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += yaw * delta * 1.15 * boost;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + pitch * delta * 0.85 * boost,
      0.08,
      this.controls.maxPolarAngle,
    );
    spherical.radius = THREE.MathUtils.clamp(
      spherical.radius * Math.exp(zoom * delta * 1.5),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  private handleConnectionNode(nodeId: string): void {
    if (!this.connectionStart) {
      this.connectionStart = nodeId;
      this.highlightNode(nodeId);
      const node = this.store.getNode(nodeId);
      this.callbacks.onHint(
        node?.virtual
          ? "Кабель выбран · теперь укажите конечный узел"
          : `${node?.name ?? "Узел"} выбран · теперь укажите конечный узел`,
      );
      return;
    }
    if (this.connectionStart === nodeId) {
      this.callbacks.onHint("Выберите другой конечный узел");
      return;
    }
    const from = this.connectionStart;
    this.connectionStart = null;
    this.highlightNode(null);
    this.callbacks.onConnection(from, nodeId);
  }

  private highlightNode(id: string | null): void {
    for (const [nodeId, marker] of this.nodeMarkers) {
      marker.scale.setScalar(nodeId === id ? 1.38 : 1);
    }
  }

  private findUserData(object: THREE.Object3D, key: string): unknown {
    let current: THREE.Object3D | null = object;
    while (current && current !== this.networkRoot) {
      if (current.userData[key] !== undefined) return current.userData[key];
      current = current.parent;
    }
    return undefined;
  }

  private activeModelRoot(): THREE.Group {
    return this.demoRoot.visible ? this.demoRoot : this.importedRoot;
  }

  private applyGeographicRotation(): void {
    const yaw = THREE.MathUtils.degToRad(-this.store.state.mapAlignment.rotationDeg);
    this.importedRoot.rotation.y = yaw;
    this.demoRoot.rotation.y = yaw;
    this.networkRoot.rotation.y = yaw;
    this.importedRoot.updateMatrixWorld(true);
    this.demoRoot.updateMatrixWorld(true);
    this.networkRoot.updateMatrixWorld(true);
  }

  private setPointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private flyCamera(position: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startedAt = performance.now();
    const animateFly = (now: number) => {
      const raw = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      this.camera.position.lerpVectors(startPosition, position, eased);
      this.controls.target.lerpVectors(startTarget, target, eased);
      if (raw < 1) requestAnimationFrame(animateFly);
    };
    requestAnimationFrame(animateFly);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  }

  private synchronizeView(now: number): void {
    if (now - this.lastViewSyncAt < 70) return;
    this.networkRoot.updateMatrixWorld(true);
    const target = this.networkRoot.worldToLocal(this.controls.target.clone());
    const camera = this.networkRoot.worldToLocal(this.camera.position.clone());
    const direction = target.clone().sub(camera);
    direction.y = 0;
    const localHeading =
      direction.lengthSq() > 0.0001
        ? Math.atan2(direction.x, -direction.z)
        : 0;
    const headingRad =
      localHeading +
      THREE.MathUtils.degToRad(this.store.state.mapAlignment.rotationDeg);
    const view: SceneViewState = {
      x: target.x,
      z: target.z,
      distance: this.camera.position.distanceTo(this.controls.target),
      headingRad,
    };
    const previous = this.lastSynchronizedView;
    const headingDelta = previous
      ? Math.atan2(
          Math.sin(view.headingRad - previous.headingRad),
          Math.cos(view.headingRad - previous.headingRad),
        )
      : Number.POSITIVE_INFINITY;
    if (
      previous &&
      Math.hypot(view.x - previous.x, view.z - previous.z) < 0.08 &&
      Math.abs(view.distance - previous.distance) < 0.12 &&
      Math.abs(headingDelta) < 0.002
    ) {
      return;
    }
    this.lastViewSyncAt = now;
    this.lastSynchronizedView = view;
    this.callbacks.onViewChanged(
      view.x,
      view.z,
      view.distance,
      view.headingRad,
    );
  }

  private animate = (now = performance.now()): void => {
    requestAnimationFrame(this.animate);
    if (!this.visible) return;
    this.timer.update(now);
    const delta = Math.min(this.timer.getDelta(), 0.05);
    const elapsed = this.timer.getElapsed();

    if (this.introActive) {
      const progress = Math.min(1, (performance.now() - this.introStart) / 1600);
      const eased = 1 - Math.pow(1 - progress, 4);
      this.camera.position.lerpVectors(
        new THREE.Vector3(310, 245, 330),
        new THREE.Vector3(190, 150, 205),
        eased,
      );
      if (progress >= 1) this.introActive = false;
    }

    for (const flow of this.flows) {
      const position = (elapsed * flow.speed + flow.offset) % 1;
      flow.mesh.position.copy(flow.curve.getPointAt(position));
    }
    for (const marker of this.nodeMarkers.values()) {
      const ring = marker.children.find((child) => child.userData.pulseRing);
      if (ring) {
        const pulse = 1 + Math.sin(elapsed * 2.2 + marker.position.x) * 0.09;
        ring.scale.setScalar(pulse);
        ring.rotation.z += delta * 0.35;
      }
    }

    this.updateKeyboardMovement(delta);
    if (this.northArrow) {
      const forward = this.controls.target.clone().sub(this.camera.position);
      forward.y = 0;
      if (forward.lengthSq() > 0.0001) {
        forward.normalize();
        const heading = Math.atan2(forward.x, -forward.z);
        this.northArrow.style.transform = `rotate(${-heading}rad)`;
      }
    }
    this.controls.update();
    this.synchronizeView(performance.now());
    this.renderer.render(this.scene, this.camera);
  };
}
