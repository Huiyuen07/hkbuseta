// Logic behind the visual editor: finding stops and changing the card config.
// Every config helper returns a new config, because HA may freeze the one it hands over.

const version = new URL(import.meta.url).search;
const {
  CTB_API,
  KMB_API,
  OPERATORS,
  compareRoutes,
  displayName,
  getData,
  mapLimited,
  matchesRule,
  routeName,
  servesStop,
  stopUrls,
} = await import(`./buseta.js${version}`);
const { DEFAULT_LANGUAGE, localText, strings } = await import(`./buseta-i18n.js${version}`);

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

async function ctbDirection(fetchFn, route, dir, label) {
  const stops = await getData(fetchFn, `${CTB_API}/route-stop/ctb/${route}/${BOUNDS[dir]}`);
  return { label, dir, stopIds: mergeStopIds([inRouteOrder(stops)]) };
}

// The whole Citybus route list takes up to 15 seconds, so look up one route instead.
async function loadCtbRoute(input, fetchFn, language) {
  const route = encodeURIComponent(input);
  const info = await getData(fetchFn, `${CTB_API}/route/ctb/${route}`);
  if (!info.route) return null;
  const { towards } = strings(language);
  const all = await Promise.all([
    ctbDirection(fetchFn, route, "O", towards(localText(info, "dest", language))),
    ctbDirection(fetchFn, route, "I", towards(localText(info, "orig", language))),
  ]);
  const directions = all.filter(({ stopIds }) => stopIds.length);
  return directions.length ? { route: info.route, directions } : null;
}

// KMB lists a route once per service_type. Variants going to one place are one direction
// to a rider, but the ETA API reports each bus under every variant it could be, so a bound
// with several destinations needs service_type to tell them apart.
async function kmbDirection(fetchFn, variants, splitBound, language) {
  const [first] = variants;
  const { route, bound } = first;
  const lists = await Promise.all(
    variants.map(async ({ service_type }) => ({
      service_type,
      stopIds: inRouteOrder(
        await getData(fetchFn, `${KMB_API}/route-stop/${route}/${BOUNDS[bound]}/${service_type}`),
      ),
    })),
  );
  return {
    label: strings(language).towards(localText(first, "dest", language)),
    origin: localText(first, "orig", language),
    dir: bound,
    stopIds: mergeStopIds(lists.map(({ stopIds }) => stopIds)),
    ...(splitBound && { variants: lists.filter(({ stopIds }) => stopIds.length) }),
  };
}

async function loadKmbRoute(route, fetchFn, language) {
  const all = (await loadKmbRoutes(fetchFn)).filter((item) => item.route === route);
  const groups = new Map();
  for (const item of all) {
    const key = `${item.bound}|${item.dest_tc}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const groupsInBound = ([{ bound }]) =>
    [...groups.values()].filter(([other]) => other.bound === bound).length;
  const loaded = await Promise.all(
    [...groups.values()].map((group) =>
      kmbDirection(fetchFn, group, groupsInBound(group) > 1, language),
    ),
  );
  const found = loaded.filter(({ stopIds }) => stopIds.length);
  const directions = found.map(({ origin, ...direction }) => {
    const shared = found.filter(({ label }) => label === direction.label).length > 1;
    const label = `${direction.label}${strings(language).from(origin)}`;
    return shared ? { ...direction, label } : direction;
  });
  return directions.length ? { route, directions } : null;
}

// Gives { route, directions: [{ label, dir, stopIds }] }, or null if there is no such route.
// Labels are in `language`, and are saved with a route as it is added.
export function loadRoute(
  operator,
  input,
  { fetchFn = fetch, language = DEFAULT_LANGUAGE } = {},
) {
  const route = input.trim().toUpperCase();
  const load = operator === "kmb" ? loadKmbRoute : loadCtbRoute;
  return load(route, fetchFn, language);
}

const stopChoice = (stop_id, stop, language) => ({
  stop_id,
  name: displayName(localText(stop, "name", language)),
  lat: stop.lat,
  long: stop.long,
});

export async function loadRouteStops(
  operator,
  stopIds,
  { fetchFn = fetch, language = DEFAULT_LANGUAGE } = {},
) {
  if (operator === "kmb") {
    const stops = new Map((await loadKmbStops(fetchFn)).map((stop) => [stop.stop, stop]));
    return stopIds
      .filter((id) => stops.has(id))
      .map((id) => stopChoice(id, stops.get(id), language));
  }
  // Each Citybus stop is its own request, so one failure only leaves that stop out.
  const failures = [];
  const stops = await mapLimited(stopIds, (id) =>
    getData(fetchFn, `${CTB_API}/stop/${id}`)
      .then((stop) => stopChoice(id, stop, language))
      .catch((error) => void failures.push(error)),
  );
  const found = stops.filter(Boolean);
  if (found.length === 0 && failures.length > 0) throw failures[0];
  return found;
}

export function routeEntry(route, { label, dir, variants }, stopId) {
  const variant = variants?.find(({ stopIds }) => stopIds.includes(stopId));
  return { route, dir, ...(variant && { service_type: variant.service_type }), label };
}

// A label is saved in the language in use when the route was added.
const directionLabel = (entry, language) =>
  entry.label ?? entry.dir ?? strings(language).allDirections;

export const routeLabel = (entry, language = DEFAULT_LANGUAGE) =>
  `${routeName(entry)} ${directionLabel(entry, language)}`;

// `index` and `routeIndex` give the row's place in the config, as removeRoute takes them.
function addedRows({ operator, name: stop, routes }, index, language) {
  if (!routes) {
    return [{ operator, route: strings(language).allRoutes, direction: "", stop, index }];
  }
  return routes.map((entry, routeIndex) => ({
    operator,
    route: routeName(entry),
    direction: directionLabel(entry, language),
    stop,
    index,
    routeIndex,
  }));
}

// What the editor lists as added, by operator, with rows in route, direction, stop order.
export function addedRoutes(stops, language = DEFAULT_LANGUAGE) {
  const rows = stops
    .flatMap((stop, index) => addedRows(stop, index, language))
    .sort(
      (a, b) =>
        compareRoutes(a.route, b.route) ||
        a.direction.localeCompare(b.direction) ||
        a.stop.localeCompare(b.stop),
    );
  return OPERATORS.map((operator) => ({
    operator,
    rows: rows.filter((row) => row.operator === operator),
  })).filter((group) => group.rows.length);
}

// The routes a stop serves, read from its ETA records. Rules already hiding a route at
// this stop stay listed, so they can be turned off while the API has no data for them.
// `destination` is the Traditional Chinese text rules match on, and `name` is for display.
export function stopOptions(stop, records, exclude = [], language = DEFAULT_LANGUAGE) {
  const options = new Map();
  const add = (route, dir, destination, name, serviceType) => {
    const key = `${route}|${destination}`;
    if (options.has(key)) return;
    const variant = serviceType === undefined ? {} : { service_type: serviceType };
    options.set(key, { route, dir, destination, name, ...variant });
  };
  for (const record of records) {
    const { route, dir, dest_tc: destination, service_type: serviceType } = record;
    const name = localText(record, "dest", language);
    if (destination) add(route, dir, destination, name, serviceType);
  }
  for (const rule of exclude) {
    const listed = rule.stop_id === stop.stop_id && rule.route !== undefined && rule.destination;
    if (listed) {
      add(String(rule.route), rule.dir, rule.destination, rule.destination, rule.service_type);
    }
  }
  return [...options.values()].sort(
    (a, b) => compareRoutes(a.route, b.route) || a.name.localeCompare(b.name),
  );
}

export async function loadStopOptions(
  stop,
  exclude,
  { fetchFn = fetch, language = DEFAULT_LANGUAGE } = {},
) {
  const records = await Promise.all(stopUrls(stop).map((url) => getData(fetchFn, url)));
  const served = records.flat().filter((raw) => servesStop(raw, stop));
  return stopOptions(stop, served, exclude, language);
}

const optionRow = (option, stop) => ({
  operator: stop.operator,
  stopId: stop.stop_id,
  route: option.route,
  dir: option.dir,
  serviceType: option.service_type,
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
