export interface Cartesian {
  x: number;
  y: number;
  z: number;
}

export interface Geodetic {
  lat: number;
  lon: number;
  alt: number;
}

export interface LocalFrame {
  origin: Cartesian;
  east: Cartesian;
  up: Cartesian;
  south: Cartesian;
}

export interface MapAlignment {
  eastM: number;
  southM: number;
  rotationDeg: number;
}

const WGS84_A = 6_378_137;
const WGS84_E2 = 6.69437999014e-3;

export function geodeticToEcef(latDegrees: number, lonDegrees: number, alt: number): Cartesian {
  const lat = (latDegrees * Math.PI) / 180;
  const lon = (lonDegrees * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const primeVertical = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (primeVertical + alt) * cosLat * Math.cos(lon),
    y: (primeVertical + alt) * cosLat * Math.sin(lon),
    z: (primeVertical * (1 - WGS84_E2) + alt) * sinLat,
  };
}

export function ecefToGeodetic(point: Cartesian): Geodetic {
  const lon = Math.atan2(point.y, point.x);
  const horizontal = Math.hypot(point.x, point.y);
  let lat = Math.atan2(point.z, horizontal * (1 - WGS84_E2));
  let alt = 0;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sinLat = Math.sin(lat);
    const primeVertical = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    alt = horizontal / Math.max(Math.cos(lat), 1e-12) - primeVertical;
    lat = Math.atan2(
      point.z,
      horizontal * (1 - (WGS84_E2 * primeVertical) / (primeVertical + alt)),
    );
  }
  return {
    lat: (lat * 180) / Math.PI,
    lon: (lon * 180) / Math.PI,
    alt,
  };
}

export function makeLocalFrame(lat: number, lon: number, alt: number): LocalFrame {
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lon * Math.PI) / 180;
  const east = {
    x: -Math.sin(longitude),
    y: Math.cos(longitude),
    z: 0,
  };
  const up = {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude),
  };
  const north = {
    x: -Math.sin(latitude) * Math.cos(longitude),
    y: -Math.sin(latitude) * Math.sin(longitude),
    z: Math.cos(latitude),
  };
  return {
    origin: geodeticToEcef(lat, lon, alt),
    east,
    up,
    south: {
      x: -north.x,
      y: -north.y,
      z: -north.z,
    },
  };
}

export function localToGeodetic(
  x: number,
  z: number,
  origin: Geodetic,
): Geodetic {
  const frame = makeLocalFrame(origin.lat, origin.lon, origin.alt);
  return ecefToGeodetic({
    x: frame.origin.x + frame.east.x * x + frame.south.x * z,
    y: frame.origin.y + frame.east.y * x + frame.south.y * z,
    z: frame.origin.z + frame.east.z * x + frame.south.z * z,
  });
}

export function geodeticToLocal(
  lat: number,
  lon: number,
  origin: Geodetic,
): { x: number; z: number } {
  const frame = makeLocalFrame(origin.lat, origin.lon, origin.alt);
  const point = geodeticToEcef(lat, lon, origin.alt);
  const delta = {
    x: point.x - frame.origin.x,
    y: point.y - frame.origin.y,
    z: point.z - frame.origin.z,
  };
  return {
    x: delta.x * frame.east.x + delta.y * frame.east.y + delta.z * frame.east.z,
    z: delta.x * frame.south.x + delta.y * frame.south.y + delta.z * frame.south.z,
  };
}

export function alignedLocalToGeodetic(
  x: number,
  z: number,
  origin: Geodetic,
  alignment: MapAlignment,
): Geodetic {
  const angle = (alignment.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotatedX = cosine * x - sine * z;
  const rotatedZ = sine * x + cosine * z;
  return localToGeodetic(
    rotatedX + alignment.eastM,
    rotatedZ + alignment.southM,
    origin,
  );
}

export function alignedGeodeticToLocal(
  lat: number,
  lon: number,
  origin: Geodetic,
  alignment: MapAlignment,
): { x: number; z: number } {
  const local = geodeticToLocal(lat, lon, origin);
  const translatedX = local.x - alignment.eastM;
  const translatedZ = local.z - alignment.southM;
  const angle = (alignment.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * translatedX + sine * translatedZ,
    z: -sine * translatedX + cosine * translatedZ,
  };
}
