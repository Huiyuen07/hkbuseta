// Logic behind the visual editor: finding stops and changing the card config.
// Every config helper returns a new config, because HA may freeze the one it hands over.

const version = new URL(import.meta.url).search;
const {
  CTB_API,
  KMB_API,
  OPERATORS,
  displayName,
  getData,
  matchesRule,
  routeName,
  servesStop,
  stopUrls,
} = await import(`./buseta.js${version}`);

const BOUNDS = { O: "outbound", I: "inbound" };
const METRES_PER_DEGREE = 111320;

function distanceInMetres(home, stop) {
  const latitude = Number(stop.lat) - home.latitude;
  const longitude =
    (Number(stop.long) - home.longitude) * Math.cos((home.latitude * Math.PI) / 180);
  return Math.round(Math.hypot(latitude, longitude) * METRES_PER_DEGREE);
}

export function nearestStop(stops, home) {
  if (!home || stops.length === 0) return undefined;
  const ranked = stops.map((stop) => ({ ...stop, distance: distanceInMetres(home, stop) }));
  return ranked.reduce((best, stop) => (stop.distance < best.distance ? stop : best));
}

// KMB has refused its big lists after many downloads, so fetch each one at most once.
function loadOnce(url) {
  let list;
  return (fetchFn) => {
    list ??= getData(fetchFn, url).catch((error) => {
      list = undefined;
      throw error;
    });
    return list;
  };
}
const loadKmbRoutes = loadOnce(`${KMB_API}/route/`);
const loadKmbStops = loadOnce(`${KMB_API}/stop`);

const inRouteOrder = (stops) => [...stops].sort((a, b) => a.seq - b.seq).map(({ stop }) => stop);

// Combine the stop lists of a route's variants. A stop only one variant uses goes right
// after the stop before it, and a stop visited twice is listed once.
function mergeStopIds(lists) {
  const merged = [];
  for (const ids of lists) {
    let next = 0;
    for (const id of ids) {
      const found = merged.indexOf(id);
      if (found === -1) merged.splice(next, 0, id);
      next = (found === -1 ? next : found) + 1;
    }
  }
  return merged;
}

async function ctbDirection(fetchFn, route, dir, destination) {
  const stops = await getData(fetchFn, `${CTB_API}/route-stop/ctb/${route}/${BOUNDS[dir]}`);
  return { label: `往 ${destination}`, dir, stopIds: mergeStopIds([inRouteOrder(stops)]) };
}

// The whole Citybus route list takes up to 15 seconds, so look up one route instead.
async function loadCtbRoute(input, fetchFn) {
  const route = encodeURIComponent(input);
  const info = await getData(fetchFn, `${CTB_API}/route/ctb/${route}`);
  if (!info.route) return null;
  const all = await Promise.all([
    ctbDirection(fetchFn, route, "O", info.dest_tc),
    ctbDirection(fetchFn, route, "I", info.orig_tc),
  ]);
  const directions = all.filter(({ stopIds }) => stopIds.length);
  return directions.length ? { route: info.route, directions } : null;
}

// KMB lists a route once per service_type. Variants going to one place are one direction
// to a rider, but the ETA API reports each bus under every variant it could be, so a bound
// with several destinations needs service_type to tell them apart.
async function kmbDirection(fetchFn, variants, splitBound) {
  const [{ route, bound, dest_tc: destination }] = variants;
  const lists = await Promise.all(
    variants.map(async ({ service_type }) => ({
      service_type,
      stopIds: inRouteOrder(
        await getData(fetchFn, `${KMB_API}/route-stop/${route}/${BOUNDS[bound]}/${service_type}`),
      ),
    })),
  );
  return {
    label: `往 ${destination}`,
    origin: variants[0].orig_tc,
    dir: bound,
    stopIds: mergeStopIds(lists.map(({ stopIds }) => stopIds)),
    ...(splitBound && { variants: lists.filter(({ stopIds }) => stopIds.length) }),
  };
}

async function loadKmbRoute(route, fetchFn) {
  const all = (await loadKmbRoutes(fetchFn)).filter((item) => item.route === route);
  const groups = new Map();
  for (const item of all) {
    const key = `${item.bound}|${item.dest_tc}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const groupsInBound = ([{ bound }]) =>
    [...groups.values()].filter(([other]) => other.bound === bound).length;
  const loaded = await Promise.all(
    [...groups.values()].map((group) => kmbDirection(fetchFn, group, groupsInBound(group) > 1)),
  );
  const found = loaded.filter(({ stopIds }) => stopIds.length);
  const directions = found.map(({ origin, ...direction }) => {
    const shared = found.filter(({ label }) => label === direction.label).length > 1;
    return shared ? { ...direction, label: `${direction.label}（由 ${origin} 開出）` } : direction;
  });
  return directions.length ? { route, directions } : null;
}

// Gives { route, directions: [{ label, dir, stopIds }] }, or null if there is no such route.
export function loadRoute(operator, input, { fetchFn = fetch } = {}) {
  const route = input.trim().toUpperCase();
  return operator === "kmb" ? loadKmbRoute(route, fetchFn) : loadCtbRoute(route, fetchFn);
}

const stopChoice = (stop_id, { name_tc: name, lat, long }) => ({
  stop_id,
  name: displayName(name),
  lat,
  long,
});

export async function loadRouteStops(operator, stopIds, { fetchFn = fetch } = {}) {
  if (operator === "kmb") {
    const stops = new Map((await loadKmbStops(fetchFn)).map((stop) => [stop.stop, stop]));
    return stopIds.filter((id) => stops.has(id)).map((id) => stopChoice(id, stops.get(id)));
  }
  return Promise.all(
    stopIds.map(async (id) => stopChoice(id, await getData(fetchFn, `${CTB_API}/stop/${id}`))),
  );
}

export function routeEntry(route, { label, dir, variants }, stopId) {
  const variant = variants?.find(({ stopIds }) => stopIds.includes(stopId));
  return { route, dir, ...(variant && { service_type: variant.service_type }), label };
}

const directionLabel = (entry) => entry.label ?? entry.dir ?? "全部方向";

export const routeLabel = (entry) => `${routeName(entry)} ${directionLabel(entry)}`;

const compareRoutes = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// `index` and `routeIndex` give the row's place in the config, as removeRoute takes them.
function addedRows({ operator, name: stop, routes }, index) {
  if (!routes) return [{ operator, route: "全部路線", direction: "", stop, index }];
  return routes.map((entry, routeIndex) => ({
    operator,
    route: routeName(entry),
    direction: directionLabel(entry),
    stop,
    index,
    routeIndex,
  }));
}

// What the editor lists as added, by operator, with rows in route, direction, stop order.
export function addedRoutes(stops) {
  const rows = stops
    .flatMap(addedRows)
    .sort(
      (a, b) =>
        compareRoutes(a.route, b.route) ||
        a.direction.localeCompare(b.direction) ||
        a.stop.localeCompare(b.stop),
    );
  return Object.keys(OPERATORS)
    .map((operator) => ({ operator, rows: rows.filter((row) => row.operator === operator) }))
    .filter((group) => group.rows.length);
}

// The routes a stop serves, read from its ETA records. Rules already hiding a route at
// this stop stay listed, so they can be turned off while the API has no data for them.
export function stopOptions(stop, records, exclude = []) {
  const options = new Map();
  const add = (route, dir, destination) => {
    const key = `${route}|${destination}`;
    if (!options.has(key)) options.set(key, { route, dir, destination });
  };
  for (const { route, dir, dest_tc: destination } of records) {
    if (destination) add(route, dir, destination);
  }
  for (const rule of exclude) {
    const listed = rule.stop_id === stop.stop_id && rule.route !== undefined && rule.destination;
    if (listed) add(String(rule.route), rule.dir, rule.destination);
  }
  return [...options.values()].sort(
    (a, b) =>
      compareRoutes(a.route, b.route) || a.destination.localeCompare(b.destination),
  );
}

export async function loadStopOptions(stop, exclude, { fetchFn = fetch } = {}) {
  const records = await Promise.all(stopUrls(stop).map((url) => getData(fetchFn, url)));
  return stopOptions(stop, records.flat().filter((raw) => servesStop(raw, stop)), exclude);
}

const optionRow = (option, stop) => ({
  operator: stop.operator,
  stopId: stop.stop_id,
  route: option.route,
  dir: option.dir,
  destination: option.destination,
});

export const isHidden = (option, stop, exclude) =>
  exclude.some((rule) => matchesRule(optionRow(option, stop), rule));

export function setHidden(config, stop, option, hidden) {
  const exclude = hidden
    ? [
        ...config.exclude,
        {
          operator: stop.operator,
          stop_id: stop.stop_id,
          route: option.route,
          destination: option.destination,
        },
      ]
    : config.exclude.filter((rule) => !matchesRule(optionRow(option, stop), rule));
  return { ...config, exclude };
}

const sameStop = ({ operator, stop_id: id }) => (item) =>
  item.operator === operator && item.stop_id === id;

const sameRoute = (a, b) =>
  routeName(a) === routeName(b) &&
  a.dir === b.dir &&
  String(a.service_type) === String(b.service_type);

export function hasRoute(config, stop) {
  const existing = config.stops.find(sameStop(stop));
  if (!existing) return false;
  if (!existing.routes) return true;
  return stop.routes.every((entry) => existing.routes.some((item) => sameRoute(item, entry)));
}

// A stop with no `routes` already shows every route, so there is nothing to add to it.
// A route with no direction gives way to the direction just chosen.
export function addStop(config, stop) {
  const existing = config.stops.find(sameStop(stop));
  if (!existing) return { ...config, stops: [...config.stops, stop] };
  if (!existing.routes) return config;
  const replaced = (item) =>
    stop.routes.some(
      (entry) =>
        sameRoute(item, entry) || (item.dir === undefined && routeName(item) === routeName(entry)),
    );
  const routes = [...existing.routes.filter((item) => !replaced(item)), ...stop.routes];
  return {
    ...config,
    stops: config.stops.map((item) => (item === existing ? { ...item, routes } : item)),
  };
}

export function removeStop(config, index) {
  const { stop_id: id } = config.stops[index];
  return {
    ...config,
    stops: config.stops.filter((_, i) => i !== index),
    exclude: config.exclude.filter((rule) => rule.stop_id !== id),
  };
}

export function removeRoute(config, index, routeIndex) {
  const stop = config.stops[index];
  const routes = stop.routes.filter((_, i) => i !== routeIndex);
  if (routes.length === 0) return removeStop(config, index);
  return {
    ...config,
    stops: config.stops.map((item, i) => (i === index ? { ...item, routes } : item)),
  };
}
