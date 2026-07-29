export interface ResolvedPlace {
  name: string;
  district: string;
}

interface NominatimResult {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

const CACHE_PREFIX = "fiberplan-3d/geocode/";

function loadJsonp(url: URL): Promise<NominatimResult> {
  return new Promise((resolve, reject) => {
    const callbackName = `fiberplanGeocode_${crypto.randomUUID().replaceAll("-", "")}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Геокодирование: превышено время ожидания"));
    }, 10_000);
    const globalScope = window as unknown as Record<string, unknown>;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      delete globalScope[callbackName];
    };
    globalScope[callbackName] = (result: NominatimResult) => {
      cleanup();
      resolve(result);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Геокодирование недоступно"));
    };
    url.searchParams.set("json_callback", callbackName);
    script.src = url.toString();
    document.head.append(script);
  });
}

function firstValue(
  address: Record<string, string | undefined>,
  keys: string[],
): string | undefined {
  return keys.map((key) => address[key]).find((value) => Boolean(value?.trim()));
}

export async function resolvePlaceName(lat: number, lon: number): Promise<ResolvedPlace> {
  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as ResolvedPlace;
    } catch {
      localStorage.removeItem(cacheKey);
    }
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  const parameters = {
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "13",
    addressdetails: "1",
    layer: "address",
    "accept-language": "ru,kk,en",
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const result = await loadJsonp(url);
  const address = result.address ?? {};
  const name =
    firstValue(address, [
      "village",
      "hamlet",
      "suburb",
      "neighbourhood",
      "town",
      "city",
      "municipality",
      "city_district",
      "county",
    ]) ??
    result.display_name?.split(",")[0]?.trim() ??
    `Территория ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const districtParts = [
    firstValue(address, ["city_district", "state_district", "county", "region"]),
    address.city,
    address.state,
    address.country,
  ].filter((value, index, values): value is string =>
    Boolean(value && value !== name && values.indexOf(value) === index),
  );
  const place = {
    name,
    district: districtParts.join(", ") || `Координаты ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
  };
  localStorage.setItem(cacheKey, JSON.stringify(place));
  return place;
}
