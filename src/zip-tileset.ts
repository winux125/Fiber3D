import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";

export interface ZipImportProgress {
  phase: "index" | "tileset" | "extract";
  current: number;
  total: number;
  detail: string;
}

export interface SelectedTile {
  path: string;
  transform: number[];
}

export interface TilePayload {
  glb: Blob;
  rtcCenter: [number, number, number] | null;
}

export interface TilesetArchive {
  tiles: SelectedTile[];
  lodDepth: number;
  sourceBytes: number;
  gltfUpAxis: string;
  readTile: (tile: SelectedTile) => Promise<TilePayload>;
  close: () => Promise<void>;
}

type ProgressCallback = (progress: ZipImportProgress) => void;

interface ZipEntryLike {
  filename: string;
  directory?: boolean;
  uncompressedSize: number;
  getData?: (writer: unknown, options?: unknown) => Promise<unknown>;
}

interface TilesetDocument {
  asset?: {
    gltfUpAxis?: string;
  };
  root?: TileNode;
}

interface TileNode {
  transform?: number[];
  refine?: string;
  content?: {
    uri?: string;
    url?: string;
  };
  children?: TileNode[];
}

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const DEFAULT_TILE_BUDGET = 24 * 1024 * 1024;

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const rawPart of value.replaceAll("\\", "/").split("/")) {
    let part = rawPart;
    try {
      part = decodeURIComponent(rawPart);
    } catch {
      // Keep the original filename when it contains a literal "%" character.
    }
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function resolvePath(documentPath: string, uri: string): string {
  const cleanUri = uri.split(/[?#]/, 1)[0];
  const base = documentPath.split("/").slice(0, -1).join("/");
  return normalizePath(`${base}/${cleanUri}`);
}

function multiplyMatrices(left: number[], right: number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] +=
          left[index * 4 + row] * right[column * 4 + index];
      }
    }
  }
  return result;
}

function contentUri(node: TileNode): string | null {
  return node.content?.uri ?? node.content?.url ?? null;
}

function isTilesetPath(path: string): boolean {
  return path.toLowerCase().endsWith(".json");
}

function isRenderablePath(path: string): boolean {
  return /\.(b3dm|glb)$/i.test(path);
}

function selectionSignature(tiles: SelectedTile[]): string {
  return tiles
    .map((tile) => `${tile.path}:${tile.transform.map((value) => value.toPrecision(8)).join(",")}`)
    .sort()
    .join("|");
}

function readFeatureTableJson(bytes: Uint8Array, length: number): Record<string, unknown> {
  if (!length) return {};
  const raw = new TextDecoder()
    .decode(bytes.subarray(28, 28 + length))
    .replaceAll("\0", "")
    .trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractTilePayload(bytes: Uint8Array, filename: string): TilePayload {
  const magic = new TextDecoder("ascii").decode(bytes.subarray(0, 4));
  if (magic === "glTF") {
    const glbBytes = bytes.slice();
    return {
      glb: new Blob([glbBytes.buffer], { type: "model/gltf-binary" }),
      rtcCenter: null,
    };
  }
  if (magic !== "b3dm" || bytes.byteLength < 28) {
    throw new Error(`${filename}: ожидается B3DM или GLB`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = view.getUint32(8, true);
  const featureJsonLength = view.getUint32(12, true);
  const featureBinaryLength = view.getUint32(16, true);
  const batchJsonLength = view.getUint32(20, true);
  const batchBinaryLength = view.getUint32(24, true);
  const glbOffset =
    28 + featureJsonLength + featureBinaryLength + batchJsonLength + batchBinaryLength;
  const end = Math.min(declaredLength || bytes.byteLength, bytes.byteLength);
  if (glbOffset >= end) throw new Error(`${filename}: повреждён заголовок B3DM`);

  const featureTable = readFeatureTableJson(bytes, featureJsonLength);
  const rtcValue = featureTable.RTC_CENTER;
  const rtcCenter =
    Array.isArray(rtcValue) &&
    rtcValue.length >= 3 &&
    rtcValue.slice(0, 3).every((value) => typeof value === "number")
      ? (rtcValue.slice(0, 3) as [number, number, number])
      : null;
  const glbBytes = bytes.slice(glbOffset, end);
  return {
    glb: new Blob([glbBytes.buffer], { type: "model/gltf-binary" }),
    rtcCenter,
  };
}

export async function openTilesetArchive(
  file: File,
  onProgress?: ProgressCallback,
  tileBudget = DEFAULT_TILE_BUDGET,
): Promise<TilesetArchive> {
  onProgress?.({
    phase: "index",
    current: 0,
    total: 1,
    detail: "Читаем каталог ZIP без полной распаковки",
  });

  const reader = new ZipReader(new BlobReader(file));
  let isClosed = false;
  const close = async () => {
    if (isClosed) return;
    isClosed = true;
    await reader.close();
  };

  try {
    const rawEntries = (await reader.getEntries()) as unknown as ZipEntryLike[];
    const entries = rawEntries.filter((entry) => !entry.directory && entry.getData);
    const entryMap = new Map<string, ZipEntryLike>();
    for (const entry of entries) {
      entryMap.set(normalizePath(entry.filename).toLowerCase(), entry);
    }

    const rootCandidates = entries
      .map((entry) => normalizePath(entry.filename))
      .filter((path) => path.toLowerCase().endsWith("tileset.json"))
      .sort((left, right) => {
        const depthDifference = left.split("/").length - right.split("/").length;
        return depthDifference || left.length - right.length;
      });
    const rootPath = rootCandidates[0];
    if (!rootPath) throw new Error("В ZIP не найден tileset.json");

    onProgress?.({
      phase: "tileset",
      current: 0,
      total: 1,
      detail: `Найдена структура ${rootPath}`,
    });

    const jsonCache = new Map<string, TilesetDocument>();
    const getEntry = (path: string): ZipEntryLike | undefined =>
      entryMap.get(normalizePath(path).toLowerCase());
    const readJson = async (path: string): Promise<TilesetDocument> => {
      const normalized = normalizePath(path);
      const cached = jsonCache.get(normalized.toLowerCase());
      if (cached) return cached;
      const entry = getEntry(normalized);
      if (!entry?.getData) throw new Error(`В ZIP отсутствует ${normalized}`);
      const text = (await entry.getData(new TextWriter())) as string;
      const document = JSON.parse(text) as TilesetDocument;
      jsonCache.set(normalized.toLowerCase(), document);
      return document;
    };

    const rootDocument = await readJson(rootPath);
    if (!rootDocument.root) throw new Error(`${rootPath}: отсутствует корневой tile`);

    const collectTiles = async (maximumDepth: number | null): Promise<SelectedTile[]> => {
      const walk = async (
        node: TileNode,
        documentPath: string,
        parentTransform: number[],
        depth: number,
        inheritedRefine: string,
      ): Promise<SelectedTile[]> => {
        const localTransform =
          node.transform?.length === 16 ? node.transform : IDENTITY_MATRIX;
        const worldTransform = multiplyMatrices(parentTransform, localTransform);
        const refine = (node.refine ?? inheritedRefine).toUpperCase();
        const uri = contentUri(node);
        const resolvedUri = uri ? resolvePath(documentPath, uri) : null;
        const children = node.children ?? [];

        if (resolvedUri && isTilesetPath(resolvedUri)) {
          const externalDocument = await readJson(resolvedUri);
          const externalTiles = externalDocument.root
            ? await walk(
                externalDocument.root,
                resolvedUri,
                worldTransform,
                depth,
                refine,
              )
            : [];
          const nativeChildren =
            maximumDepth === null || depth < maximumDepth
              ? (
                  await Promise.all(
                    children.map((child) =>
                      walk(child, documentPath, worldTransform, depth + 1, refine),
                    ),
                  )
                ).flat()
              : [];
          return [...externalTiles, ...nativeChildren];
        }

        const renderable =
          resolvedUri && isRenderablePath(resolvedUri)
            ? [{ path: resolvedUri, transform: worldTransform }]
            : [];

        if (refine === "ADD") {
          const descendants =
            maximumDepth === null || depth < maximumDepth
              ? (
                  await Promise.all(
                    children.map((child) =>
                      walk(child, documentPath, worldTransform, depth + 1, refine),
                    ),
                  )
                ).flat()
              : [];
          return [...renderable, ...descendants];
        }

        if (children.length && (maximumDepth === null || depth < maximumDepth)) {
          return (
            await Promise.all(
              children.map((child) =>
                walk(child, documentPath, worldTransform, depth + 1, refine),
              ),
            )
          ).flat();
        }
        if (renderable.length) return renderable;
        if (children.length) {
          return (
            await Promise.all(
              children.map((child) =>
                walk(child, documentPath, worldTransform, depth + 1, refine),
              ),
            )
          ).flat();
        }
        return [];
      };

      return walk(rootDocument.root!, rootPath, IDENTITY_MATRIX, 0, "REPLACE");
    };

    const sourceBytes = (tiles: SelectedTile[]): number =>
      tiles.reduce((sum, tile) => sum + (getEntry(tile.path)?.uncompressedSize ?? 0), 0);
    const validate = (tiles: SelectedTile[]): SelectedTile[] => {
      const missing = tiles.find((tile) => !getEntry(tile.path));
      if (missing) throw new Error(`В ZIP отсутствует ${missing.path}`);
      return tiles;
    };

    const leafTiles = validate(await collectTiles(null));
    if (!leafTiles.length) throw new Error("В tileset.json не найдены B3DM/GLB-тайлы");
    const leafSignature = selectionSignature(leafTiles);
    let selectedTiles = leafTiles;
    let lodDepth = 63;

    if (sourceBytes(leafTiles) > tileBudget) {
      let best: SelectedTile[] | null = null;
      let bestDepth = 0;
      for (let depth = 0; depth < 64; depth += 1) {
        const candidate = validate(await collectTiles(depth));
        if (sourceBytes(candidate) <= tileBudget) {
          best = candidate;
          bestDepth = depth;
        } else if (best) {
          break;
        }
        if (selectionSignature(candidate) === leafSignature) break;
      }
      selectedTiles = best ?? validate(await collectTiles(0));
      lodDepth = bestDepth;
    }

    onProgress?.({
      phase: "tileset",
      current: 1,
      total: 1,
      detail: `LOD ${lodDepth}: ${selectedTiles.length} тайлов, ${(
        sourceBytes(selectedTiles) /
        1024 /
        1024
      ).toFixed(1)} МБ`,
    });

    return {
      tiles: selectedTiles,
      lodDepth,
      sourceBytes: sourceBytes(selectedTiles),
      gltfUpAxis: rootDocument.asset?.gltfUpAxis?.toUpperCase() ?? "Y",
      async readTile(tile) {
        const entry = getEntry(tile.path);
        if (!entry?.getData) throw new Error(`В ZIP отсутствует ${tile.path}`);
        const bytes = (await entry.getData(
          new Uint8ArrayWriter(Math.max(262_144, entry.uncompressedSize)),
        )) as Uint8Array;
        return extractTilePayload(bytes, tile.path);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
