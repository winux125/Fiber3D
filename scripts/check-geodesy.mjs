import {
  alignedGeodeticToLocal,
  alignedLocalToGeodetic,
  ecefToGeodetic,
  geodeticToEcef,
  geodeticToLocal,
  localToGeodetic,
} from "../src/geodesy.ts";

const origin = {
  lat: 43.241649231,
  lon: 76.89869176,
  alt: 874.623,
};

const ecefRoundTrip = ecefToGeodetic(
  geodeticToEcef(origin.lat, origin.lon, origin.alt),
);
const directions = [
  { name: "east", x: 1_000, z: 0 },
  { name: "west", x: -1_000, z: 0 },
  { name: "south", x: 0, z: 1_000 },
  { name: "north", x: 0, z: -1_000 },
];

const errors = directions.map((direction) => {
  const geographic = localToGeodetic(direction.x, direction.z, origin);
  const local = geodeticToLocal(geographic.lat, geographic.lon, origin);
  return {
    direction: direction.name,
    errorMeters: Math.hypot(local.x - direction.x, local.z - direction.z),
    lat: geographic.lat,
    lon: geographic.lon,
  };
});
const maxError = Math.max(...errors.map((result) => result.errorMeters));
const alignment = { eastM: 18, southM: -12, rotationDeg: 2.75 };
const alignedGeographic = alignedLocalToGeodetic(240, -85, origin, alignment);
const alignedLocal = alignedGeodeticToLocal(
  alignedGeographic.lat,
  alignedGeographic.lon,
  origin,
  alignment,
);
const alignmentError = Math.hypot(alignedLocal.x - 240, alignedLocal.z + 85);
const clockwisePoint = alignedLocalToGeodetic(
  100,
  0,
  origin,
  { eastM: 0, southM: 0, rotationDeg: 10 },
);
const clockwiseLocal = geodeticToLocal(
  clockwisePoint.lat,
  clockwisePoint.lon,
  origin,
);
const rotationDirectionIsCorrect = clockwiseLocal.x > 0 && clockwiseLocal.z > 0;
const sceneAngle = (alignment.rotationDeg * Math.PI) / 180;
const sceneRotated = {
  x: Math.cos(sceneAngle) * 240 - Math.sin(sceneAngle) * -85,
  z: Math.sin(sceneAngle) * 240 + Math.cos(sceneAngle) * -85,
};
const alignedMapLocal = geodeticToLocal(
  alignedGeographic.lat,
  alignedGeographic.lon,
  origin,
);
const sceneMapRotationError = Math.hypot(
  alignedMapLocal.x - alignment.eastM - sceneRotated.x,
  alignedMapLocal.z - alignment.southM - sceneRotated.z,
);
const originError = Math.hypot(
  (ecefRoundTrip.lat - origin.lat) * 111_320,
  (ecefRoundTrip.lon - origin.lon) *
    111_320 *
    Math.cos((origin.lat * Math.PI) / 180),
  ecefRoundTrip.alt - origin.alt,
);

console.table(errors);
console.log({
  originErrorMeters: originError,
  maximumDirectionErrorMeters: maxError,
  alignmentRoundTripErrorMeters: alignmentError,
  rotationDirectionIsCorrect,
  sceneMapRotationErrorMeters: sceneMapRotationError,
});
if (
  originError > 0.001 ||
  maxError > 0.2 ||
  alignmentError > 0.2 ||
  sceneMapRotationError > 0.001 ||
  !rotationDirectionIsCorrect
) {
  throw new Error("WGS84/local coordinate round-trip exceeded tolerance");
}
