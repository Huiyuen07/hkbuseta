// buseta — fetch and normalise Hong Kong bus ETAs.
// Pure logic lives here so it can be tested without a browser.

const KMB_STOP_ETA = (stopId) =>
  `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${stopId}/`;
const CTB_ETA = (stopId, route) =>
  `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${stopId}/${route}`;

export const DEFAULTS = { refresh_seconds: 30, max_minutes: 30 };

export function validateConfig(config) {
  if (!config || !Array.isArray(config.stops) || config.stops.length === 0) {
    throw new Error("config.json: `stops` must be a non-empty array");
  }
  for (const stop of config.stops) {
    if (!stop.stop_id || !stop.name) {
      throw new Error("config.json: every stop needs `stop_id` and `name`");
    }
    if (stop.operator !== "kmb" && stop.operator !== "ctb") {
      throw new Error(`config.json: unsupported operator "${stop.operator}"`);
    }
    if (stop.operator === "ctb" && !(stop.routes && stop.routes.length)) {
      throw new Error(`config.json: Citybus stop "${stop.name}" needs \`routes\``);
    }
  }
  return { ...DEFAULTS, exclude: [], ...config };
}

// Turn one raw ETA record into a table row, or null if it has no future ETA.
export function toRow(raw, stop, now) {
  if (!raw.eta) return null;
  const etaMs = new Date(raw.eta).getTime();
  if (etaMs <= now.getTime()) return null;
  return {
    operator: stop.operator,
    stopName: stop.name,
    route: raw.route,
    dir: raw.dir,
    destination: raw.dest_tc,
    remainingMinutes: Math.ceil((etaMs - now.getTime()) / 60000),
  };
}

// An exclude rule matches when every field it sets equals the row's value.
function matchesRule(row, rule) {
  return (
    (rule.operator === undefined || rule.operator === row.operator) &&
    (rule.stop === undefined || rule.stop === row.stopName) &&
    (rule.route === undefined || rule.route === row.route) &&
    (rule.dir === undefined || rule.dir === row.dir) &&
    (rule.destination === undefined || rule.destination === row.destination)
  );
}

export function selectRows(rows, config) {
  return rows
    .filter((row) => !config.exclude.some((rule) => matchesRule(row, rule)))
    .filter((row) => row.remainingMinutes <= config.max_minutes)
    .sort((a, b) => a.remainingMinutes - b.remainingMinutes);
}

async function getData(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()).data;
}

function stopUrls(stop) {
  return stop.operator === "kmb"
    ? [KMB_STOP_ETA(stop.stop_id)]
    : stop.routes.map((route) => CTB_ETA(stop.stop_id, route));
}

export async function fetchRows(config, { fetchFn = fetch, now = () => new Date() } = {}) {
  const requests = config.stops.flatMap((stop) =>
    stopUrls(stop).map(async (url) => ({ stop, records: await getData(fetchFn, url) })),
  );
  const results = await Promise.all(requests);
  const current = now();
  const rows = results.flatMap(({ stop, records }) =>
    records.map((raw) => toRow(raw, stop, current)).filter(Boolean),
  );
  return selectRows(rows, config);
}
