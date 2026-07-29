const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

const { NetworkStore } = await import("../src/store.ts");
const store = new NetworkStore();
const original = store.state.cables.find((cable) => cable.id === "cab-2");
if (!original) throw new Error("Demo cable cab-2 is missing");
const from = store.getNode(original.from);
const to = store.getNode(original.to);
if (!from || !to) throw new Error("Demo cable endpoints are missing");

const originalTotal = original.lengthM + original.reserveM;
const junction = store.splitCableAt(original.id, {
  x: (from.position.x + to.position.x) / 2,
  z: (from.position.z + to.position.z) / 2,
});
if (!junction) throw new Error("Cable split did not create a junction");
if (!junction.virtual) throw new Error("Cable branch junction must stay hidden");
const segments = store.state.cables.filter(
  (cable) => cable.from === junction.id || cable.to === junction.id,
);
if (segments.length !== 2) throw new Error(`Expected 2 cable segments, got ${segments.length}`);
const splitTotal = segments.reduce(
  (sum, cable) => sum + cable.lengthM + cable.reserveM,
  0,
);
if (Math.abs(splitTotal - originalTotal) > 0.11) {
  throw new Error(`Cable total changed after split: ${originalTotal} -> ${splitTotal}`);
}

const counted = store.toggleCableInPlan(segments[0].id);
if (counted !== false || segments[0].countInPlan !== false) {
  throw new Error("Cable counting toggle failed");
}

console.log({
  junction: junction.name,
  segmentLengths: segments.map((cable) => cable.lengthM),
  segmentReserves: segments.map((cable) => cable.reserveM),
  originalTotal,
  splitTotal,
  firstSegmentCounted: segments[0].countInPlan,
});
