import { openAsBlob } from "node:fs";
import { openTilesetArchive } from "../src/zip-tileset.ts";

const source = process.argv[2];
if (!source) throw new Error("Usage: node --experimental-strip-types scripts/check-zip.mjs file.zip");

const blob = await openAsBlob(source);
const archive = await openTilesetArchive(blob, (progress) => {
  if (progress.phase !== "index") console.log(progress.detail);
});

console.log({
  tiles: archive.tiles.length,
  lod: archive.lodDepth,
  megabytes: (archive.sourceBytes / 1024 / 1024).toFixed(2),
  axis: archive.gltfUpAxis,
  first: archive.tiles[0]?.path,
  firstWorldTranslation: archive.tiles[0]?.transform.slice(12, 15),
});
const firstPayload = await archive.readTile(archive.tiles[0]);
const magic = new TextDecoder("ascii").decode(
  new Uint8Array(await firstPayload.glb.slice(0, 4).arrayBuffer()),
);
console.log({
  firstGlbMagic: magic,
  firstGlbKilobytes: (firstPayload.glb.size / 1024).toFixed(1),
  rtcCenter: firstPayload.rtcCenter,
});
await archive.close();
