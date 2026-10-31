import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { fetchRows, selectRows, toRow, validateConfig } from "../www/buseta.js";

const NOW = new Date("2026-01-01T12:00:00+08:00");
const inMinutes = (minutes) => new Date(NOW.getTime() + minutes * 60000).toISOString();

const KMB_STOP = { operator: "kmb", stop_id: "KMB1", name: "Stop A" };
const CTB_STOP = { operator: "ctb", stop_id: "CTB1", routes: ["1", "2"], name: "Stop B" };

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
    { operator: "kmb", stopName: "A", route: "1", dir: "O", destination: "X", remainingMinutes: 1 },
    { operator: "kmb", stopName: "A", route: "1", dir: "O", destination: "Y", remainingMinutes: 2 },
    { operator: "kmb", stopName: "B", route: "1", dir: "O", destination: "X", remainingMinutes: 3 },
    { operator: "ctb", stopName: "A", route: "1", dir: "O", destination: "X", remainingMinutes: 4 },
  ];
  const exclude = [{ operator: "kmb", stop: "A", route: "1", destination: "X" }];
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

test("fetchRows combines KMB stops and every Citybus route", async () => {
  const { fetchFn, calls } = fakeFetch({
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

  assert.equal(calls.length, 3);
  assert.deepEqual(
    rows.map((row) => [row.stopName, row.route, row.destination, row.remainingMinutes]),
    [
      ["Stop B", "1", "East", 3],
      ["Stop B", "2", "Island", 6],
      ["Stop A", "K1", "Kowloon", 9],
    ],
  );
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

test("validateConfig rejects incomplete configs", () => {
  assert.throws(() => validateConfig({ stops: [] }), /non-empty/);
  assert.throws(() => validateConfig({ stops: [{ operator: "kmb", name: "A" }] }), /stop_id/);
  assert.throws(
    () => validateConfig({ stops: [{ operator: "nlb", stop_id: "1", name: "A" }] }),
    /unsupported operator/,
  );
  assert.throws(
    () => validateConfig({ stops: [{ operator: "ctb", stop_id: "1", name: "A" }] }),
    /needs `routes`/,
  );
});

test("the shipped example config is valid", async () => {
  const url = new URL("../www/config.example.json", import.meta.url);
  const config = JSON.parse(await readFile(url, "utf8"));
  assert.doesNotThrow(() => validateConfig(config));
});
