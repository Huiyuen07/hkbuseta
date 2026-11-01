import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  axisTicks,
  displayName,
  fetchRows,
  getData,
  groupRows,
  mapLimited,
  matchesRule,
  selectRows,
  staggerDepartures,
  toRow,
  validateConfig,
} from "../dist/buseta.js";

const NOW = new Date("2026-01-01T12:00:00+08:00");
const inMinutes = (minutes) => new Date(NOW.getTime() + minutes * 60000).toISOString();

const KMB_STOP = { operator: "kmb", stop_id: "KMB1" };
const CTB_STOP = { operator: "ctb", stop_id: "CTB1", routes: ["1", "2"] };

function fakeFetch(routes) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (!(url in routes)) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ data: routes[url] }) };
  };
  return { fetchFn, calls };
}

test("toRow rounds remaining minutes up", () => {
  const raw = { route: "1", dir: "O", dest_tc: "East", eta: inMinutes(4.2) };
  assert.equal(toRow(raw, KMB_STOP, NOW).remainingMinutes, 5);
});

test("toRow drops records with no ETA or an ETA in the past", () => {
  assert.equal(toRow({ route: "1", eta: "" }, KMB_STOP, NOW), null);
  assert.equal(toRow({ route: "1", eta: null }, KMB_STOP, NOW), null);
  assert.equal(toRow({ route: "1", eta: inMinutes(-1) }, KMB_STOP, NOW), null);
  assert.equal(toRow({ route: "1", eta: inMinutes(0) }, KMB_STOP, NOW), null);
});

test("selectRows keeps the max_minutes boundary and sorts soonest first", () => {
  const rows = [
    { stopName: "A", route: "1", remainingMinutes: 31 },
    { stopName: "A", route: "2", remainingMinutes: 30 },
    { stopName: "A", route: "3", remainingMinutes: 2 },
  ];
  const selected = selectRows(rows, { max_minutes: 30, exclude: [] });
  assert.deepEqual(selected.map((row) => row.route), ["3", "2"]);
});

test("an exclude rule only matches when all of its fields match", () => {
  const rows = [
    { operator: "kmb", stopId: "A", route: "1", dir: "O", destination: "X", remainingMinutes: 1 },
    { operator: "kmb", stopId: "A", route: "1", dir: "O", destination: "Y", remainingMinutes: 2 },
    { operator: "kmb", stopId: "B", stopName: "B", route: "1", dir: "O", destination: "X", remainingMinutes: 3 },
    { operator: "ctb", stopId: "A", route: "1", dir: "O", destination: "X", remainingMinutes: 4 },
  ];
  const exclude = [{ operator: "kmb", stop_id: "A", route: "1", destination: "X" }];
  const selected = selectRows(rows, { max_minutes: 30, exclude });
  assert.deepEqual(selected.map((row) => row.remainingMinutes), [2, 3, 4]);
});

test("an exclude rule can filter Citybus by direction", () => {
  const rows = [
    { operator: "ctb", stopName: "A", route: "1", dir: "O", destination: "X", remainingMinutes: 1 },
    { operator: "ctb", stopName: "A", route: "1", dir: "I", destination: "Y", remainingMinutes: 2 },
  ];
  const exclude = [{ operator: "ctb", route: "1", dir: "O" }];
  const selected = selectRows(rows, { max_minutes: 30, exclude });
  assert.deepEqual(selected.map((row) => row.dir), ["I"]);
});

test("an exclude rule written with an unquoted YAML number still matches", () => {
  const rows = [{ route: "238", remainingMinutes: 1 }];
  assert.deepEqual(selectRows(rows, { max_minutes: 30, exclude: [{ route: 238 }] }), []);
});

test("fetchRows combines KMB stops and every Citybus route", async () => {
  const { fetchFn, calls } = fakeFetch({
    "https://data.etabus.gov.hk/v1/transport/kmb/stop/KMB1": { name_tc: "Stop A (AB123)" },
    "https://rt.data.gov.hk/v2/transport/citybus/stop/CTB1": { name_tc: "Stop B" },
    "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/KMB1/": [
      { route: "K1", dir: "O", dest_tc: "Kowloon", eta: inMinutes(9) },
    ],
    "https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/CTB1/1": [
      { route: "1", dir: "I", dest_tc: "East", eta: inMinutes(3) },
    ],
    "https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/CTB1/2": [
      { route: "2", dir: "O", dest_tc: "Island", eta: inMinutes(6) },
    ],
  });
  const config = validateConfig({ stops: [KMB_STOP, CTB_STOP] });
  const { rows } = await fetchRows(config, { fetchFn, now: () => NOW });

  assert.equal(calls.length, 5); // two stop names, then three lots of arrivals
  assert.deepEqual(
    rows.map((row) => [row.stopName, row.route, row.destination, row.remainingMinutes]),
    [
      ["Stop B", "1", "East", 3],
      ["Stop B", "2", "Island", 6],
      ["Stop A", "K1", "Kowloon", 9],
    ],
  );
});

const CTB_ETA_42 = "https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/CTB1/42";
const KMB_ETA = "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/KMB1/";
const BOTH_WAYS = [
  { route: "42", dir: "I", dest_tc: "East", eta: inMinutes(3) },
  { route: "42", dir: "O", dest_tc: "West", eta: inMinutes(6) },
];
const load = (stop, routes) => {
  const { fetchFn, calls } = fakeFetch(routes);
  const config = validateConfig({ stops: [stop] });
  return { calls, rows: fetchRows(config, { fetchFn, now: () => NOW }).then(({ rows }) => rows) };
};
const destinations = async (rows) => (await rows).map((row) => row.destination);

test("a route saved with a direction shows only that direction at a shared stop", async () => {
  const stop = { ...CTB_STOP, routes: [{ route: "42", dir: "I" }] };
  const { rows } = load(stop, { [CTB_ETA_42]: BOTH_WAYS });
  assert.deepEqual(await destinations(rows), ["East"]);
});

test("a route saved without a direction still shows both directions", async () => {
  for (const route of ["42", 42, { route: "42" }]) {
    const { rows } = load({ ...CTB_STOP, routes: [route] }, { [CTB_ETA_42]: BOTH_WAYS });
    assert.deepEqual(await destinations(rows), ["East", "West"]);
  }
});

test("both directions of one route are fetched once and each row appears once", async () => {
  const routes = [
    { route: "42", dir: "I" },
    { route: "42", dir: "O" },
  ];
  const { rows, calls } = load({ ...CTB_STOP, routes }, { [CTB_ETA_42]: BOTH_WAYS });
  assert.equal((await rows).length, 2);
  assert.equal(calls.length, 1);
});

test("a KMB stop with routes shows only those routes", async () => {
  const stop = { ...KMB_STOP, routes: [{ route: "239E", dir: "O" }] };
  const { rows } = load(stop, {
    [KMB_ETA]: [
      { route: "239E", dir: "O", dest_tc: "North", eta: inMinutes(3) },
      { route: "239E", dir: "I", dest_tc: "South", eta: inMinutes(4) },
      { route: "235", dir: "O", dest_tc: "Uptown", eta: inMinutes(5) },
    ],
  });
  assert.deepEqual(await destinations(rows), ["North"]);
});

test("a KMB stop without routes still shows every route", async () => {
  const { rows } = load(KMB_STOP, {
    [KMB_ETA]: [
      { route: "1", dir: "O", dest_tc: "X", eta: inMinutes(3) },
      { route: "2", dir: "I", dest_tc: "Y", eta: inMinutes(4) },
    ],
  });
  assert.equal((await rows).length, 2);
});

test("a saved service_type picks one destination of a KMB departure", async () => {
  const eta = inMinutes(3);
  const stop = { ...KMB_STOP, routes: [{ route: "68K", dir: "O", service_type: "2" }] };
  const { rows } = load(stop, {
    [KMB_ETA]: [
      { route: "68K", dir: "O", service_type: 1, dest_tc: "Downtown", eta },
      { route: "68K", dir: "O", service_type: 2, dest_tc: "Uptown", eta },
    ],
  });
  assert.deepEqual(await destinations(rows), ["Uptown"]);
});

test("fetchRows reports HTTP errors instead of giving up", async () => {
  const { fetchFn } = fakeFetch({});
  const config = validateConfig({ stops: [KMB_STOP] });
  const { failures, allFailed } = await fetchRows(config, { fetchFn, now: () => NOW });
  assert.match(failures[0].error.message, /HTTP 404/);
  assert.equal(allFailed, true);
});

test("validateConfig fills in defaults", () => {
  const config = validateConfig({ stops: [KMB_STOP] });
  assert.equal(config.refresh_seconds, 30);
  assert.equal(config.max_minutes, 30);
  assert.deepEqual(config.exclude, []);
});

test("validateConfig gives a five minute leaving time and the theme colours", () => {
  const config = validateConfig({ stops: [KMB_STOP] });
  assert.equal(config.leave_minutes, 5);
  assert.equal(config.color_scheme, "auto");
});

test("validateConfig rejects a colour scheme that does not exist", () => {
  assert.throws(() => validateConfig({ color_scheme: "harbour" }), /color_scheme/);
});

test("validateConfig rejects a negative leaving time", () => {
  assert.throws(() => validateConfig({ leave_minutes: -1 }), /leave_minutes/);
});

test("validateConfig accepts a leaving time of zero, which turns the marking off", () => {
  assert.equal(validateConfig({ leave_minutes: 0 }).leave_minutes, 0);
});

test("validateConfig accepts a card with no stops yet", () => {
  assert.deepEqual(validateConfig({}).stops, []);
  assert.deepEqual(validateConfig({ stops: [] }).stops, []);
});

test("validateConfig rejects incomplete configs", () => {
  assert.throws(() => validateConfig({ stops: "A" }), /array/);
  assert.throws(() => validateConfig({ stops: [{ operator: "kmb" }] }), /stop_id/);
  assert.throws(
    () => validateConfig({ stops: [{ operator: "nlb", stop_id: "1" }] }),
    /unsupported operator/,
  );
  assert.throws(
    () => validateConfig({ stops: [{ operator: "ctb", stop_id: "1" }] }),
    /needs `routes`/,
  );
});

test("validateConfig accepts a stop with no name", () => {
  assert.deepEqual(validateConfig({ stops: [KMB_STOP] }).stops, [KMB_STOP]);
});

test("validateConfig rejects routes it cannot read", () => {
  const stop = { operator: "ctb", stop_id: "1" };
  assert.throws(() => validateConfig({ stops: [{ ...stop, routes: "42" }] }), /`routes`.*list/);
  assert.throws(() => validateConfig({ stops: [{ ...stop, routes: [{ dir: "I" }] }] }), /`route`/);
});

test("validateConfig rejects a stop_id that YAML turned into a number", () => {
  assert.throws(
    () => validateConfig({ stops: [{ operator: "ctb", stop_id: 2403, routes: ["1"] }] }),
    /stop_id.*quotes/,
  );
});

test("KMB's stop code is dropped from a stop name", () => {
  assert.equal(displayName("範例總站 (WT916)"), "範例總站");
  assert.equal(displayName("範例邨 (KT512a)"), "範例邨");
});

test("brackets that belong to a stop name stay", () => {
  for (const name of ["範例新城(西翼)", "範例站(C1)", "範例站(V City)", "範例總站 (轉車站)"]) {
    assert.equal(displayName(name), name);
  }
});

const nameOnBoard = async (stop, routes) => {
  const { fetchFn, calls } = fakeFetch(routes);
  const { rows } = await fetchRows(validateConfig({ stops: [stop] }), { fetchFn, now: () => NOW });
  return { name: rows[0]?.stopName, calls };
};
const ETAS = (url) => ({ [url]: [{ route: "1", dir: "O", dest_tc: "X", eta: inMinutes(5) }] });

test("the board uses the operator's name over a copy left in the config", async () => {
  const stop = { operator: "kmb", stop_id: "OLD", name: "Hand-typed" };
  const { name } = await nameOnBoard(stop, {
    ...ETAS("https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/OLD/"),
    "https://data.etabus.gov.hk/v1/transport/kmb/stop/OLD": { name_tc: "Official" },
  });
  assert.equal(name, "Official");
});

test("a stop name is fetched once, not on every refresh", async () => {
  const stop = { operator: "kmb", stop_id: "ONCE" };
  const routes = {
    ...ETAS("https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/ONCE/"),
    "https://data.etabus.gov.hk/v1/transport/kmb/stop/ONCE": { name_tc: "Once" },
  };
  await nameOnBoard(stop, routes);
  const { name, calls } = await nameOnBoard(stop, routes);
  assert.equal(name, "Once");
  assert.equal(calls.length, 1);
});

test("arrivals still appear when a stop name can't be loaded, and it is tried again", async (t) => {
  t.mock.method(console, "error", () => {});
  const stop = { operator: "kmb", stop_id: "DOWN" };
  const etas = ETAS("https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/DOWN/");
  assert.equal((await nameOnBoard(stop, etas)).name, "");
  const { name } = await nameOnBoard(stop, {
    ...etas,
    "https://data.etabus.gov.hk/v1/transport/kmb/stop/DOWN": { name_tc: "Back" },
  });
  assert.equal(name, "Back");
});

// KMB returns a departure once per service_type, with the same ETA to the second.
const departure = (fields) => ({
  operator: "kmb",
  stopName: "A",
  route: "1",
  dir: "O",
  destination: "X",
  eta: "2026-01-01T12:05:00+08:00",
  remainingMinutes: 5,
  ...fields,
});

test("toRow keeps the fields needed to spot duplicate departures", () => {
  const eta = inMinutes(5);
  const row = toRow({ route: "1", dir: "O", dest_tc: "X", service_type: 2, eta }, KMB_STOP, NOW);
  assert.equal(row.eta, eta);
  assert.equal(row.serviceType, 2);
});

test("a departure reported under two service types appears once", () => {
  const rows = [departure({ serviceType: 1 }), departure({ serviceType: 2 })];
  assert.equal(selectRows(rows, { max_minutes: 30, exclude: [] }).length, 1);
});

test("duplicates with different destinations keep the main service type", () => {
  const rows = [
    departure({ serviceType: 2, destination: "Short trip" }),
    departure({ serviceType: 1, destination: "Full route" }),
  ];
  const selected = selectRows(rows, { max_minutes: 30, exclude: [] });
  assert.deepEqual(selected.map((row) => row.destination), ["Full route"]);
});

test("exclude rules run first, so hiding one variant keeps the other", () => {
  const rows = [
    departure({ serviceType: 1, destination: "Full route" }),
    departure({ serviceType: 2, destination: "Short trip" }),
  ];
  const exclude = [{ destination: "Full route" }];
  const selected = selectRows(rows, { max_minutes: 30, exclude });
  assert.deepEqual(selected.map((row) => row.destination), ["Short trip"]);
});

test("different departures are not treated as duplicates", () => {
  const rows = [
    departure({ serviceType: 1 }),
    departure({ serviceType: 1, eta: "2026-01-01T12:25:00+08:00", remainingMinutes: 25 }),
    departure({ serviceType: 1, dir: "I" }),
    departure({ serviceType: 1, stopName: "B" }),
    departure({ serviceType: 1, route: "2" }),
    departure({ serviceType: 1, operator: "ctb" }),
  ];
  assert.equal(selectRows(rows, { max_minutes: 30, exclude: [] }).length, 6);
});

test("toRow marks a departure the operator reports as scheduled", () => {
  const raw = { route: "1", dest_tc: "X", eta: inMinutes(5), rmk_tc: "原定班次" };
  assert.equal(toRow(raw, KMB_STOP, NOW).scheduled, true);
});

test("toRow treats a blank or other remark as a live departure", () => {
  const blank = { route: "1", dest_tc: "X", eta: inMinutes(5), rmk_tc: "" };
  const other = { ...blank, rmk_tc: "服務只限於星期一至五 (公眾假期除外)" };
  const missing = { route: "1", dest_tc: "X", eta: inMinutes(5) };
  assert.equal(toRow(blank, KMB_STOP, NOW).scheduled, false);
  assert.equal(toRow(other, KMB_STOP, NOW).scheduled, false);
  assert.equal(toRow(missing, KMB_STOP, NOW).scheduled, false);
});

const STOPS = [
  { operator: "kmb", stop_id: "S1" },
  { operator: "kmb", stop_id: "S2" },
];
const bus = (fields) => ({
  operator: "kmb",
  stopId: "S1",
  stopName: "One",
  route: "1",
  destination: "X",
  remainingMinutes: 10,
  scheduled: false,
  ...fields,
});
const group = (rows, leave = 5, stops = STOPS) => groupRows(rows, { stops, leave_minutes: leave });

test("departures of a route share a lane in arrival order", () => {
  const rows = [bus({ remainingMinutes: 3 }), bus({ remainingMinutes: 9 })];
  const [{ lanes }] = group(rows);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0].departures.map((item) => item.minutes), [3, 9]);
});

test("a route splits into two lanes when destinations differ", () => {
  const rows = [bus({ destination: "X" }), bus({ destination: "Y" })];
  assert.deepEqual(group(rows)[0].lanes.map((lane) => lane.destination), ["X", "Y"]);
});

test("departures inside the leaving time may be missed, and the first after it is next", () => {
  const rows = [3, 5, 6, 9].map((remainingMinutes) => bus({ remainingMinutes }));
  const { departures } = group(rows)[0].lanes[0];
  assert.deepEqual(departures.map((item) => item.status), ["miss", "miss", "next", "later"]);
});

test("a leaving time of zero marks nothing as missed", () => {
  const { departures } = group([bus({ remainingMinutes: 1 })], 0)[0].lanes[0];
  assert.equal(departures[0].status, "next");
});

test("a scheduled departure stays marked in its lane", () => {
  assert.equal(group([bus({ scheduled: true })])[0].lanes[0].departures[0].scheduled, true);
});

test("stops keep the config order whichever bus comes first", () => {
  const rows = [
    bus({ stopId: "S2", stopName: "Two", remainingMinutes: 1 }),
    bus({ stopId: "S1", stopName: "One", remainingMinutes: 9 }),
  ];
  assert.deepEqual(group(rows).map((item) => item.name), ["One", "Two"]);
});

test("lanes are ordered by route number, not by who arrives first", () => {
  const rows = ["68X", "10", "2"].map((route, index) => bus({ route, remainingMinutes: index + 6 }));
  assert.deepEqual(group(rows)[0].lanes.map((lane) => lane.route), ["2", "10", "68X"]);
});

test("stops with the same name appear as one group", () => {
  const rows = [
    bus({ stopId: "S1", route: "1" }),
    bus({ stopId: "S2", route: "2", stopName: "One" }),
  ];
  const groups = group(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].lanes.map((lane) => lane.route), ["1", "2"]);
});

test("stops whose names failed to load are not merged", () => {
  const rows = [bus({ stopId: "S1", stopName: "" }), bus({ stopId: "S2", stopName: "" })];
  assert.equal(group(rows).length, 2);
});

test("the axis labels sit on round minutes", () => {
  assert.deepEqual(axisTicks(30), [10, 20, 30]);
  assert.deepEqual(axisTicks(45), [15, 30, 45]);
  assert.deepEqual(axisTicks(20), [5, 10, 15, 20]);
  assert.deepEqual(axisTicks(25), [10, 20]);
});

test("the next bus in a lane is the soonest, even across stops that share a name", () => {
  const rows = [
    bus({ stopId: "S2", remainingMinutes: 8 }),
    bus({ stopId: "S1", remainingMinutes: 20 }),
  ];
  const { departures } = group(rows)[0].lanes[0];
  assert.deepEqual(departures.map((item) => item.minutes), [8, 20]);
  assert.deepEqual(departures.map((item) => item.status), ["next", "later"]);
});

test("toRow keeps the operator's remark", () => {
  const raw = { route: "1", dest_tc: "X", eta: inMinutes(5), rmk_tc: "只限星期一" };
  assert.equal(toRow(raw, KMB_STOP, NOW).remark, "只限星期一");
});

test("a lane lists each remark once and leaves out the scheduled mark", () => {
  const rows = [
    bus({ remainingMinutes: 6, remark: "只限星期一" }),
    bus({ remainingMinutes: 9, remark: "只限星期一" }),
    bus({ remainingMinutes: 12, remark: "特別班次" }),
    bus({ remainingMinutes: 15, remark: "原定班次" }),
    bus({ remainingMinutes: 18, remark: "" }),
  ];
  assert.deepEqual(group(rows)[0].lanes[0].notes, ["只限星期一", "特別班次"]);
});

test("a lane with no remarks has no notes", () => {
  assert.deepEqual(group([bus()])[0].lanes[0].notes, []);
});

const rowsOf = (minutes, gap) =>
  staggerDepartures(minutes.map((value) => ({ minutes: value })), gap).map((item) => item.row);

test("departures far enough apart stay on the rail", () => {
  assert.deepEqual(rowsOf([5, 20], 3), [undefined, undefined]);
});

test("departures exactly the gap apart stay on the rail", () => {
  assert.deepEqual(rowsOf([5, 8], 3), [undefined, undefined]);
});

test("close departures alternate above and below the rail", () => {
  assert.deepEqual(rowsOf([5, 6, 7], 3), ["up", "down", "up"]);
});

test("each run of close departures starts above the rail", () => {
  assert.deepEqual(rowsOf([1, 2, 3, 20, 21], 3), ["up", "down", "up", "up", "down"]);
});

test("a departure on its own stays on the rail between two runs", () => {
  assert.deepEqual(rowsOf([1, 2, 10, 20, 21], 3), ["up", "down", undefined, "up", "down"]);
});

test("departures keep their other fields when staggered", () => {
  const [first] = staggerDepartures([{ minutes: 5, status: "next" }], 3);
  assert.equal(first.status, "next");
});

test("mapLimited never runs more than the limit at once and keeps the order", async () => {
  let running = 0;
  let peak = 0;
  const worker = async (value) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return value * 2;
  };
  assert.deepEqual(await mapLimited([1, 2, 3, 4, 5], worker, 2), [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test("mapLimited handles an empty list", async () => {
  assert.deepEqual(await mapLimited([], async (value) => value, 2), []);
});

test("mapLimited passes on a failure", async () => {
  const worker = async () => {
    throw new Error("broken");
  };
  await assert.rejects(mapLimited([1], worker, 2), /broken/);
});

test("a Citybus stop with many routes does not request them all at once", async () => {
  const routes = Array.from({ length: 20 }, (_, index) => String(index + 1));
  let running = 0;
  let peak = 0;
  const requested = new Set();
  const fetchFn = async (url) => {
    if (url.includes("/stop/")) return { ok: true, json: async () => ({ data: { name_tc: "X" } }) };
    requested.add(url);
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return { ok: true, json: async () => ({ data: [] }) };
  };
  const config = validateConfig({ stops: [{ operator: "ctb", stop_id: "MANY", routes }] });
  await fetchRows(config, { fetchFn, now: () => NOW });
  assert.equal(requested.size, 20);
  assert.ok(peak <= 6, `peak was ${peak}`);
});

test("a request gives up when its time limit passes", async () => {
  const limit = new AbortController();
  const timeout = mock.method(AbortSignal, "timeout", () => limit.signal);
  const fetchFn = (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("gave up"))));
  const request = getData(fetchFn, "https://example.test/slow");
  limit.abort();
  await assert.rejects(request, /gave up/);
  assert.ok(timeout.mock.calls[0].arguments[0] > 0);
  timeout.mock.restore();
});

const etaOnly = (records) => ({ ok: true, json: async () => ({ data: records }) });

test("a stop name that never answers does not hold back the arrivals", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const eta = new Date(Date.now() + 300000).toISOString();
  const etaRequests = [];
  const fetchFn = (url) => {
    if (!url.includes("/stop-eta/")) return new Promise(() => {});
    etaRequests.push(url);
    return Promise.resolve(etaOnly([{ route: "1", dir: "O", dest_tc: "X", eta }]));
  };
  const config = validateConfig({ stops: [{ operator: "kmb", stop_id: "SILENT" }] });
  const rows = fetchRows(config, { fetchFn });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(etaRequests.length, 1);
  mock.timers.tick(60000);
  const { rows: [row] } = await rows;
  mock.timers.reset();
  assert.equal(row.route, "1");
  assert.equal(row.stopName, "");
});

test("a stop name that arrives late shows on the next update", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const eta = new Date(Date.now() + 300000).toISOString();
  let answerName;
  const fetchFn = (url) => {
    if (url.includes("/stop-eta/")) {
      return Promise.resolve(etaOnly([{ route: "1", dir: "O", dest_tc: "X", eta }]));
    }
    return new Promise((resolve) => (answerName = () => resolve(etaOnly({ name_tc: "Late" }))));
  };
  const config = validateConfig({ stops: [{ operator: "kmb", stop_id: "LATE" }] });
  const first = fetchRows(config, { fetchFn });
  await new Promise((resolve) => setImmediate(resolve));
  mock.timers.tick(60000);
  await first;
  answerName();
  const { rows: [row] } = await fetchRows(config, { fetchFn });
  mock.timers.reset();
  assert.equal(row.stopName, "Late");
});

test("an exclude rule can name a service_type, whatever the destination says", () => {
  const rule = { route: "238", service_type: 2 };
  const row = { operator: "kmb", stopId: "S1", route: "238", dir: "O", destination: "New text" };
  assert.equal(matchesRule({ ...row, serviceType: 2 }, rule), true);
  assert.equal(matchesRule({ ...row, serviceType: "2" }, rule), true);
  assert.equal(matchesRule({ ...row, serviceType: 1 }, rule), false);
});

test("an exclude rule by service_type can keep the other destination of a departure", () => {
  const eta = inMinutes(5);
  const base = { operator: "kmb", stopId: "S1", stopName: "S", route: "68K", dir: "O", eta, remainingMinutes: 5 };
  const rows = [
    { ...base, serviceType: 1, destination: "Downtown" },
    { ...base, serviceType: 2, destination: "Uptown" },
  ];
  const kept = selectRows(rows, { exclude: [{ route: "68K", service_type: 1 }], max_minutes: 30 });
  assert.deepEqual(kept.map((row) => row.destination), ["Uptown"]);
});

for (const value of [0, 9, -5, "30", "abc", null, NaN, Infinity]) {
  test(`validateConfig rejects a refresh of ${JSON.stringify(value) ?? value}`, () => {
    assert.throws(() => validateConfig({ refresh_seconds: value }), /refresh_seconds/);
  });
}

test("validateConfig accepts the shortest refresh the editor allows", () => {
  assert.equal(validateConfig({ refresh_seconds: 10 }).refresh_seconds, 10);
});

for (const value of [0, -5, "30", "abc", null, NaN]) {
  test(`validateConfig rejects a time axis of ${JSON.stringify(value) ?? value}`, () => {
    assert.throws(() => validateConfig({ max_minutes: value }), /max_minutes/);
  });
}

test("validateConfig accepts a one minute time axis", () => {
  assert.equal(validateConfig({ max_minutes: 1 }).max_minutes, 1);
});

test("validateConfig rejects a leaving time written as text", () => {
  assert.throws(() => validateConfig({ leave_minutes: "5" }), /leave_minutes/);
});

const clock = (minutes) => new Date(NOW.getTime() + minutes * 60000);
const answer = (data) => ({ ok: true, json: async () => ({ data }) });
const twoStops = validateConfig({
  stops: [
    { operator: "kmb", stop_id: "OK1" },
    { operator: "kmb", stop_id: "OFF1" },
  ],
});
const busAt = (minutes, route = "1") => ({ route, dir: "O", dest_tc: "X", eta: inMinutes(minutes) });

// Answers each stop with its entry in `etas`: records, or null for HTTP 500.
const stopsAnswer = (etas) => async (url) => {
  const stop = Object.keys(etas).find((id) => url.includes(`/stop-eta/${id}/`));
  if (stop === undefined) return answer({ name_tc: url.includes("OK") ? "Open" : "Closed" });
  return etas[stop] ? answer(etas[stop]) : { ok: false, status: 500 };
};

test("a stop that fails does not stop the others from updating", async () => {
  const fetchFn = stopsAnswer({ OK1: [busAt(5)], OFF1: null });
  const { rows, failures, allFailed } = await fetchRows(twoStops, { fetchFn, now: () => NOW });
  assert.deepEqual(rows.map((row) => row.stopName), ["Open"]);
  assert.deepEqual(failures.map((failure) => failure.stop), ["Closed"]);
  assert.equal(allFailed, false);
});

test("a failed stop keeps its last good buses, with the minutes brought up to date", async () => {
  const memory = new Map();
  const first = stopsAnswer({ OK1: [], OFF1: [busAt(10)] });
  await fetchRows(twoStops, { fetchFn: first, now: () => NOW, memory });
  const second = stopsAnswer({ OK1: [], OFF1: null });
  const { rows } = await fetchRows(twoStops, { fetchFn: second, now: () => clock(3), memory });
  assert.deepEqual(rows.map((row) => row.remainingMinutes), [7]);
});

test("a remembered bus disappears once its time has passed", async () => {
  const memory = new Map();
  const first = stopsAnswer({ OK1: [], OFF1: [busAt(10)] });
  await fetchRows(twoStops, { fetchFn: first, now: () => NOW, memory });
  const second = stopsAnswer({ OK1: [], OFF1: null });
  const { rows } = await fetchRows(twoStops, { fetchFn: second, now: () => clock(11), memory });
  assert.deepEqual(rows, []);
});

test("a good answer replaces what was remembered", async () => {
  const memory = new Map();
  const answers = [
    { OK1: [], OFF1: [busAt(10, "OLD")] },
    { OK1: [], OFF1: [busAt(12, "NEW")] },
    { OK1: [], OFF1: null },
  ];
  let result;
  for (const etas of answers) {
    result = await fetchRows(twoStops, { fetchFn: stopsAnswer(etas), now: () => NOW, memory });
  }
  assert.deepEqual(result.rows.map((row) => row.route), ["NEW"]);
});

test("allFailed is set only when every request failed", async () => {
  const fetchFn = stopsAnswer({ OK1: null, OFF1: null });
  assert.equal((await fetchRows(twoStops, { fetchFn, now: () => NOW })).allFailed, true);
});

test("a card with no stops has not failed", async () => {
  const { allFailed } = await fetchRows(validateConfig({}), { fetchFn: stopsAnswer({}), now: () => NOW });
  assert.equal(allFailed, false);
});

test("an answer with no data counts as a failure, not as no buses", async () => {
  const fetchFn = async (url) =>
    url.includes("/stop-eta/") ? { ok: true, json: async () => ({}) } : answer({ name_tc: "Open" });
  const config = validateConfig({ stops: [{ operator: "kmb", stop_id: "OK1" }] });
  const { failures } = await fetchRows(config, { fetchFn, now: () => NOW });
  assert.equal(failures.length, 1);
});
