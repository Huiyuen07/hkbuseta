import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COLUMNS,
  displayName,
  fetchRows,
  selectRows,
  toRow,
  validateConfig,
} from "../www/buseta.js";

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
  const rows = await fetchRows(config, { fetchFn, now: () => NOW });

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

const CTB_ETA_56 = "https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/CTB1/42";
const KMB_ETA = "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/KMB1/";
const BOTH_WAYS = [
  { route: "42", dir: "I", dest_tc: "East", eta: inMinutes(3) },
  { route: "42", dir: "O", dest_tc: "West", eta: inMinutes(6) },
];
const load = (stop, routes) => {
  const { fetchFn, calls } = fakeFetch(routes);
  const config = validateConfig({ stops: [stop] });
  return { calls, rows: fetchRows(config, { fetchFn, now: () => NOW }) };
};
const destinations = async (rows) => (await rows).map((row) => row.destination);

test("a route saved with a direction shows only that direction at a shared stop", async () => {
  const stop = { ...CTB_STOP, routes: [{ route: "42", dir: "I" }] };
  const { rows } = load(stop, { [CTB_ETA_56]: BOTH_WAYS });
  assert.deepEqual(await destinations(rows), ["East"]);
});

test("a route saved without a direction still shows both directions", async () => {
  for (const route of ["42", 42, { route: "42" }]) {
    const { rows } = load({ ...CTB_STOP, routes: [route] }, { [CTB_ETA_56]: BOTH_WAYS });
    assert.deepEqual(await destinations(rows), ["East", "West"]);
  }
});

test("both directions of one route are fetched once and each row appears once", async () => {
  const routes = [
    { route: "42", dir: "I" },
    { route: "42", dir: "O" },
  ];
  const { rows, calls } = load({ ...CTB_STOP, routes }, { [CTB_ETA_56]: BOTH_WAYS });
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

test("fetchRows rejects on HTTP errors", async () => {
  const { fetchFn } = fakeFetch({});
  const config = validateConfig({ stops: [KMB_STOP] });
  await assert.rejects(fetchRows(config, { fetchFn, now: () => NOW }), /HTTP 404/);
});

test("validateConfig fills in defaults", () => {
  const config = validateConfig({ stops: [KMB_STOP] });
  assert.equal(config.refresh_seconds, 30);
  assert.equal(config.max_minutes, 30);
  assert.deepEqual(config.exclude, []);
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
  const rows = await fetchRows(validateConfig({ stops: [stop] }), { fetchFn, now: () => NOW });
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

test("the table headers say minutes and destination", () => {
  assert.deepEqual(COLUMNS.map((column) => column.label), ["站頭", "路線", "目的地", "分鐘"]);
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
