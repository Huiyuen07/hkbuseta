// buseta — fetch and normalise Hong Kong bus ETAs.
// Pure logic lives here so it can be tested without a browser.

export const KMB_API = "https://data.etabus.gov.hk/v1/transport/kmb";
export const CTB_API = "https://rt.data.gov.hk/v2/transport/citybus";
export const OPERATORS = { kmb: "九巴", ctb: "城巴" };

const KMB_STOP_ETA = (stopId) => `${KMB_API}/stop-eta/${stopId}/`;
const CTB_ETA = (stopId, route) => `${CTB_API}/eta/ctb/${stopId}/${route}`;
const STOP_URLS = {
  kmb: (stopId) => `${KMB_API}/stop/${stopId}`,
  ctb: (stopId) => `${CTB_API}/stop/${stopId}`,
};

const SCHEDULED = "原定班次";

// Long enough for KMB's full stop list, which the editor downloads.
const REQUEST_TIMEOUT_MS = 15000;
// Arrivals stop waiting for a stop name after this long. The name shows on a later update.
const NAME_WAIT_MS = 2000;
const MAX_REQUESTS = 6;

export const DEFAULTS = {
  refresh_seconds: 30,
  max_minutes: 30,
  leave_minutes: 5,
  color_scheme: "auto",
};

export const COLOR_SCHEMES = {
  auto: "跟隨主題",
  mono: "墨色",
  led: "車頭牌",
  icehouse: "冰室",
};

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (char) => ESCAPES[char]);

export function validateConfig(config) {
  const stops = config?.stops ?? [];
  if (!Array.isArray(stops)) throw new Error("buseta: `stops` must be an array");
  for (const stop of stops) {
    if (!stop.stop_id) throw new Error("buseta: every stop needs `stop_id`");
    if (typeof stop.stop_id !== "string") {
      throw new Error(`buseta: \`stop_id\` ${stop.stop_id} must be in quotes`);
    }
    if (!Object.hasOwn(OPERATORS, stop.operator)) {
      throw new Error(`buseta: unsupported operator "${stop.operator}"`);
    }
    if (stop.routes !== undefined && !Array.isArray(stop.routes)) {
      throw new Error(`buseta: \`routes\` of stop ${stop.stop_id} must be a list`);
    }
    if (stop.operator === "ctb" && !stop.routes?.length) {
      throw new Error(`buseta: Citybus stop ${stop.stop_id} needs \`routes\``);
    }
    for (const entry of stop.routes ?? []) {
      if (entry?.route === undefined && typeof entry === "object") {
        throw new Error(`buseta: every entry in \`routes\` of stop ${stop.stop_id} needs \`route\``);
      }
    }
  }
  const merged = { ...DEFAULTS, exclude: [], ...config, stops };
  if (!Object.hasOwn(COLOR_SCHEMES, merged.color_scheme)) {
    throw new Error(`buseta: unsupported color_scheme "${merged.color_scheme}"`);
  }
  if (!(merged.leave_minutes >= 0)) {
    throw new Error("buseta: `leave_minutes` must be 0 or more");
  }
  return merged;
}

// Turn one raw ETA record into a table row, or null if it has no future ETA.
export function toRow(raw, stop, now) {
  if (!raw.eta) return null;
  const etaMs = new Date(raw.eta).getTime();
  if (etaMs <= now.getTime()) return null;
  const remark = raw.rmk_tc ?? "";
  return {
    operator: stop.operator,
    stopId: stop.stop_id,
    stopName: stop.name,
    route: raw.route,
    dir: raw.dir,
    destination: raw.dest_tc,
    serviceType: raw.service_type,
    eta: raw.eta,
    remainingMinutes: Math.ceil((etaMs - now.getTime()) / 60000),
    scheduled: remark === SCHEDULED,
    remark,
  };
}

// A field left unset matches anything. String() because YAML reads an unquoted route
// such as 238 as a number, and KMB gives service_type as a number or a string by endpoint.
const same = (expected, actual) => expected === undefined || String(expected) === String(actual);

// An entry in `routes` is a route number, or an object that also names a direction.
export const routeName = (entry) => String(entry.route ?? entry);

export function servesStop(raw, stop) {
  if (!stop.routes) return true;
  return stop.routes.some(
    (entry) =>
      routeName(entry) === raw.route &&
      same(entry.dir, raw.dir) &&
      same(entry.service_type, raw.service_type),
  );
}

// An exclude rule matches when every field it sets equals the row's value.
export function matchesRule(row, rule) {
  return (
    same(rule.operator, row.operator) &&
    same(rule.stop_id, row.stopId) &&
    same(rule.route, row.route) &&
    same(rule.dir, row.dir) &&
    same(rule.service_type, row.serviceType) &&
    same(rule.destination, row.destination)
  );
}

// KMB returns a departure once per service_type, with the same ETA to the second.
// Keep the main variant (lowest service_type).
function removeDuplicates(rows) {
  const departures = new Map();
  for (const row of rows) {
    const key = [row.operator, row.stopName, row.route, row.dir, row.eta].join("|");
    const kept = departures.get(key);
    if (!kept || row.serviceType < kept.serviceType) departures.set(key, row);
  }
  return [...departures.values()];
}

export function selectRows(rows, config) {
  // Exclude rules run first: they may hide one variant to keep the other.
  const kept = rows.filter((row) => !config.exclude.some((rule) => matchesRule(row, rule)));
  return removeDuplicates(kept)
    .filter((row) => row.remainingMinutes <= config.max_minutes)
    .sort((a, b) => a.remainingMinutes - b.remainingMinutes);
}

export const compareRoutes = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// Groups by name because KMB and Citybus give one physical stop different IDs.
// A name that failed to load is blank, so it falls back to the ID.
const groupKey = (row) => row.stopName || `${row.operator}:${row.stopId}`;

function compareLanes(a, b) {
  return compareRoutes(a.route, b.route) || a.destination.localeCompare(b.destination);
}

function laneDepartures(rows, leaveMinutes) {
  let passed = false;
  return [...rows]
    .sort((a, b) => a.remainingMinutes - b.remainingMinutes)
    .map(({ remainingMinutes: minutes, scheduled }) => {
      const status = minutes <= leaveMinutes ? "miss" : passed ? "later" : "next";
      passed ||= status === "next";
      return { minutes, scheduled, status };
    });
}

const laneNotes = (rows) => [
  ...new Set(rows.map(({ remark }) => remark).filter((remark) => remark && remark !== SCHEDULED)),
];

// The order of stops and lanes ignores arrival time, so nothing on a wall panel moves
// about between refreshes.
export function groupRows(rows, { stops, leave_minutes: leaveMinutes }) {
  const configOrder = (row) =>
    stops.findIndex((stop) => stop.operator === row.operator && stop.stop_id === row.stopId);
  const groups = new Map();
  for (const row of [...rows].sort((a, b) => configOrder(a) - configOrder(b))) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, { name: row.stopName, lanes: new Map() });
    const { lanes } = groups.get(key);
    const laneKey = [row.operator, row.route, row.destination].join("|");
    if (!lanes.has(laneKey)) {
      const { operator, route, destination } = row;
      lanes.set(laneKey, { operator, route, destination, rows: [] });
    }
    lanes.get(laneKey).rows.push(row);
  }
  return [...groups.values()].map(({ name, lanes }) => ({
    name,
    lanes: [...lanes.values()]
      .map(({ rows: laneRows, ...lane }) => ({
        ...lane,
        departures: laneDepartures(laneRows, leaveMinutes),
        notes: laneNotes(laneRows),
      }))
      .sort(compareLanes),
  }));
}

// Departures closer than `gap` minutes would cover each other's numbers, so each run of
// them alternates above and below the rail.
export function staggerDepartures(departures, gap) {
  const near = (a, b) => b && Math.abs(a.minutes - b.minutes) < gap;
  let row = "up";
  return departures.map((departure, index) => {
    const joinsLast = near(departure, departures[index - 1]);
    if (!joinsLast) row = "up";
    if (!joinsLast && !near(departure, departures[index + 1])) return departure;
    const placed = { ...departure, row };
    row = row === "up" ? "down" : "up";
    return placed;
  });
}

const AXIS_STEPS = [5, 10, 15, 20, 30, 60];

export function axisTicks(maxMinutes) {
  const step = AXIS_STEPS.find((size) => maxMinutes / size <= 4) ?? Math.ceil(maxMinutes / 4);
  const ticks = [];
  for (let minute = step; minute <= maxMinutes; minute += step) ticks.push(minute);
  return ticks;
}

export async function getData(fetchFn, url) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()).data;
}

// Gives the results in the order of `items`, running at most `limit` workers at once.
export async function mapLimited(items, worker, limit = MAX_REQUESTS) {
  const results = [];
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function withinTime(promise, milliseconds, fallback) {
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(resolve, milliseconds, fallback);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// KMB ends most stop names with its own stop code, such as 「(WT916)」.
export const displayName = (name) => name.replace(/\s*\([A-Z]{2}\d{3}[a-z]?\)$/, "");

async function fetchStopName({ operator, stop_id: stopId }, fetchFn) {
  const { name_tc: name } = await getData(fetchFn, STOP_URLS[operator](stopId));
  return displayName(name);
}

const stopNames = new Map();

// Names come from the operator, so the config holds no copy that can go out of date.
// A failed lookup gives "" and is tried again next time: arrivals matter more than the name.
function loadStopName(stop, fetchFn) {
  const key = `${stop.operator}:${stop.stop_id}`;
  if (!stopNames.has(key)) {
    const name = fetchStopName(stop, fetchFn).catch((error) => {
      console.error("buseta:", error);
      stopNames.delete(key);
      return "";
    });
    stopNames.set(key, name);
  }
  return stopNames.get(key);
}

export const withNames = (stops, fetchFn = fetch) =>
  Promise.all(stops.map(async (stop) => ({ ...stop, name: await loadStopName(stop, fetchFn) })));

export function stopUrls(stop) {
  return stop.operator === "kmb"
    ? [KMB_STOP_ETA(stop.stop_id)]
    : [...new Set(stop.routes.map(routeName))].map((route) => CTB_ETA(stop.stop_id, route));
}

export async function fetchRows(config, { fetchFn = fetch, now = () => new Date() } = {}) {
  const named = Promise.all(
    config.stops.map(async (stop) => ({
      ...stop,
      name: await withinTime(loadStopName(stop, fetchFn), NAME_WAIT_MS, ""),
    })),
  );
  const requests = config.stops.flatMap((stop, index) =>
    stopUrls(stop).map((url) => ({ index, url })),
  );
  const results = await mapLimited(requests, async ({ index, url }) => ({
    index,
    records: await getData(fetchFn, url),
  }));
  const stops = await named;
  const current = now();
  const rows = results.flatMap(({ index, records }) =>
    records
      .filter((raw) => servesStop(raw, stops[index]))
      .map((raw) => toRow(raw, stops[index], current))
      .filter(Boolean),
  );
  return selectRows(rows, config);
}
