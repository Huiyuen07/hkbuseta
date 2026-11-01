import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addStop,
  addedRoutes,
  hasRoute,
  isHidden,
  loadRoute,
  loadRouteStops,
  loadStopOptions,
  nearestStop,
  removeRoute,
  removeStop,
  routeEntry,
  routeLabel,
  setHidden,
  stopOptions,
} from "../www/buseta-config.js";

const fakeFetch = (routes) => async (url) => {
  if (!(url in routes)) return { ok: false, status: 404 };
  return { ok: true, json: async () => ({ data: routes[url] }) };
};

const CTB_API = "https://rt.data.gov.hk/v2/transport/citybus";
const KMB_API = "https://data.etabus.gov.hk/v1/transport/kmb";
const KMB = { operator: "kmb", stop_id: "K1" };
const CTB = { operator: "ctb", stop_id: "C1", routes: ["1"] };

const HOME = { latitude: 22.3, longitude: 114.17 };

// The KMB lists are kept for the life of the module, so each test imports its own copy.
let copies = 0;
const freshConfig = () => {
  copies += 1;
  return import(`../www/buseta-config.js?copy=${copies}`);
};

const kmbRoute = (route, bound, service_type, orig_tc, dest_tc) => ({
  route,
  bound,
  service_type,
  orig_tc,
  dest_tc,
});
const seqStops = (...ids) => ids.map((stop, index) => ({ stop, seq: String(index + 1) }));
const KMB_STOPS = [
  { stop: "A", name_tc: "甲 (AB123)", lat: "22.40", long: "114.20" },
  { stop: "B", name_tc: "乙", lat: "22.30", long: "114.17" },
];

async function kmbDirections(routes, routeStops) {
  const { loadRoute: load } = await freshConfig();
  const fetchFn = fakeFetch({
    [`${KMB_API}/route/`]: routes,
    ...Object.fromEntries(
      Object.entries(routeStops).map(([path, ids]) => [
        `${KMB_API}/route-stop/${path}`,
        seqStops(...ids),
      ]),
    ),
  });
  return (await load("kmb", routes[0].route, { fetchFn })).directions;
}

test("a Citybus route gives one direction per way that has stops", async () => {
  const fetchFn = fakeFetch({
    [`${CTB_API}/route/ctb/42A`]: { route: "42A", orig_tc: "Start", dest_tc: "End" },
    [`${CTB_API}/route-stop/ctb/42A/outbound`]: [
      { stop: "S2", seq: 2 },
      { stop: "S1", seq: 1 },
    ],
    [`${CTB_API}/route-stop/ctb/42A/inbound`]: [],
  });
  assert.deepEqual(await loadRoute("ctb", "42a", { fetchFn }), {
    route: "42A",
    directions: [{ label: "往 End", dir: "O", stopIds: ["S1", "S2"] }],
  });
});

test("the two ways of a Citybus route carry their own direction", async () => {
  const fetchFn = fakeFetch({
    [`${CTB_API}/route/ctb/42`]: { route: "42", orig_tc: "Start", dest_tc: "End" },
    [`${CTB_API}/route-stop/ctb/42/outbound`]: [{ stop: "S1", seq: 1 }],
    [`${CTB_API}/route-stop/ctb/42/inbound`]: [{ stop: "S1", seq: 1 }],
  });
  const { directions } = await loadRoute("ctb", "42", { fetchFn });
  assert.deepEqual(
    directions.map(({ label, dir }) => [label, dir]),
    [
      ["往 End", "O"],
      ["往 Start", "I"],
    ],
  );
});

test("an unknown Citybus route gives nothing", async () => {
  const fetchFn = fakeFetch({
    [`${CTB_API}/route/ctb/ZZZ`]: {},
    [`${CTB_API}/route-stop/ctb/ZZZ/outbound`]: [],
    [`${CTB_API}/route-stop/ctb/ZZZ/inbound`]: [],
  });
  assert.equal(await loadRoute("ctb", "ZZZ", { fetchFn }), null);
});

test("an unknown KMB route gives nothing", async () => {
  const { loadRoute: load } = await freshConfig();
  const fetchFn = fakeFetch({ [`${KMB_API}/route/`]: [kmbRoute("1", "O", "1", "A", "B")] });
  assert.equal(await load("kmb", "ZZZ", { fetchFn }), null);
});

test("a one-way KMB route gives a single direction", async () => {
  const directions = await kmbDirections([kmbRoute("3S", "O", "1", "A", "A(循環線)")], {
    "3S/outbound/1": ["A", "B"],
  });
  assert.deepEqual(directions, [{ label: "往 A(循環線)", dir: "O", stopIds: ["A", "B"] }]);
});

test("a KMB route gives one direction per bound", async () => {
  const directions = await kmbDirections(
    [kmbRoute("239E", "O", "1", "A", "B"), kmbRoute("239E", "I", "1", "B", "A")],
    { "239E/outbound/1": ["A"], "239E/inbound/1": ["B"] },
  );
  assert.deepEqual(directions.map(({ dir }) => dir), ["O", "I"]);
});

test("KMB variants with one destination merge, keeping every stop in route order", async () => {
  const directions = await kmbDirections(
    [kmbRoute("11", "O", "1", "A", "End"), kmbRoute("11", "O", "2", "Mid", "End")],
    { "11/outbound/1": ["A", "C", "D"], "11/outbound/2": ["M", "C", "X", "D"] },
  );
  assert.deepEqual(directions, [
    { label: "往 End", dir: "O", stopIds: ["M", "A", "C", "X", "D"] },
  ]);
});

test("KMB variants with different destinations are separate directions", async () => {
  const directions = await kmbDirections(
    [kmbRoute("68K", "O", "1", "A", "Downtown"), kmbRoute("68K", "O", "2", "B", "Uptown")],
    { "68K/outbound/1": ["S1", "S2"], "68K/outbound/2": ["S2"] },
  );
  assert.deepEqual(directions.map(({ label }) => label), ["往 Downtown", "往 Uptown"]);
  assert.equal(routeEntry("68K", directions[1], "S2").service_type, "2");
});

test("a merged variant saves the service_type that really stops there", async () => {
  const [, far] = await kmbDirections(
    [
      kmbRoute("9", "O", "1", "A", "Near"),
      kmbRoute("9", "O", "2", "A", "Far"),
      kmbRoute("9", "O", "3", "B", "Far"),
    ],
    { "9/outbound/1": ["S1"], "9/outbound/2": ["S1"], "9/outbound/3": ["S9"] },
  );
  assert.equal(routeEntry("9", far, "S9").service_type, "3");
});

test("directions to the same place are told apart by where they start", async () => {
  const directions = await kmbDirections(
    [kmbRoute("87S", "O", "1", "Start", "End"), kmbRoute("87S", "I", "1", "Other", "End")],
    { "87S/outbound/1": ["A"], "87S/inbound/1": ["B"] },
  );
  assert.deepEqual(directions.map(({ label }) => label), [
    "往 End（由 Start 開出）",
    "往 End（由 Other 開出）",
  ]);
});

test("a KMB variant with no stops is not offered", async () => {
  const directions = await kmbDirections(
    [kmbRoute("1", "O", "1", "A", "B"), kmbRoute("1", "I", "1", "B", "A")],
    { "1/outbound/1": ["A"], "1/inbound/1": [] },
  );
  assert.deepEqual(directions.map(({ dir }) => dir), ["O"]);
});

test("the KMB route list is fetched once", async () => {
  const { loadRoute: load } = await freshConfig();
  let lists = 0;
  const routes = fakeFetch({
    [`${KMB_API}/route/`]: [kmbRoute("1", "O", "1", "A", "B")],
    [`${KMB_API}/route-stop/1/outbound/1`]: seqStops("A"),
  });
  const fetchFn = (url) => {
    if (url === `${KMB_API}/route/`) lists += 1;
    return routes(url);
  };
  await load("kmb", "1", { fetchFn });
  await load("kmb", "1", { fetchFn });
  assert.equal(lists, 1);
});

test("a failed KMB route list is fetched again next time", async () => {
  const { loadRoute: load } = await freshConfig();
  await assert.rejects(load("kmb", "1", { fetchFn: fakeFetch({}) }), /HTTP 404/);
  const fetchFn = fakeFetch({ [`${KMB_API}/route/`]: [] });
  assert.equal(await load("kmb", "1", { fetchFn }), null);
});

test("Citybus stops are looked up in route order", async () => {
  const fetchFn = fakeFetch({
    [`${CTB_API}/stop/S1`]: { name_tc: "First", lat: "1", long: "2" },
    [`${CTB_API}/stop/S2`]: { name_tc: "Second", lat: "3", long: "4" },
  });
  assert.deepEqual(await loadRouteStops("ctb", ["S2", "S1"], { fetchFn }), [
    { stop_id: "S2", name: "Second", lat: "3", long: "4" },
    { stop_id: "S1", name: "First", lat: "1", long: "2" },
  ]);
});

test("a Citybus stop that fails is left out and the others still load", async () => {
  const fetchFn = fakeFetch({ [`${CTB_API}/stop/S1`]: { name_tc: "First", lat: "1", long: "2" } });
  const stops = await loadRouteStops("ctb", ["GONE", "S1"], { fetchFn });
  assert.deepEqual(stops.map((stop) => stop.stop_id), ["S1"]);
});

test("Citybus stops fail as a whole only when none could be loaded", async () => {
  await assert.rejects(loadRouteStops("ctb", ["GONE"], { fetchFn: fakeFetch({}) }), /HTTP 404/);
});

test("a long Citybus route does not request every stop at once", async () => {
  let running = 0;
  let peak = 0;
  const fetchFn = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return { ok: true, json: async () => ({ data: { name_tc: "X", lat: "1", long: "2" } }) };
  };
  const ids = Array.from({ length: 40 }, (_, index) => `S${index}`);
  assert.equal((await loadRouteStops("ctb", ids, { fetchFn })).length, 40);
  assert.ok(peak <= 6, `peak was ${peak}`);
});

test("KMB stops come from the full list, once, in route order", async () => {
  const { loadRouteStops: load } = await freshConfig();
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ data: KMB_STOPS }) };
  };
  const stops = await load("kmb", ["B", "GONE", "A"], { fetchFn });
  assert.deepEqual(stops.map((stop) => stop.name), ["乙", "甲"]);
  await load("kmb", ["A"], { fetchFn });
  assert.equal(calls, 1);
});

test("the stop closest to home is found and its distance given", () => {
  const stops = [
    { stop_id: "FAR", lat: "22.40", long: "114.20" },
    { stop_id: "NEAR", lat: "22.30", long: "114.17" },
  ];
  const nearest = nearestStop(stops, HOME);
  assert.equal(nearest.stop_id, "NEAR");
  assert.equal(nearest.distance, 0);
});

test("there is no nearest stop without a home or without stops", () => {
  assert.equal(nearestStop([{ lat: "1", long: "2" }], undefined), undefined);
  assert.equal(nearestStop([], HOME), undefined);
});

test("a route entry records the direction but not a needless service_type", () => {
  const direction = { label: "往 End", dir: "I", stopIds: ["S1"] };
  assert.deepEqual(routeEntry("42", direction, "S1"), { route: "42", dir: "I", label: "往 End" });
});

test("a route label reads the same for new and old entries", () => {
  assert.equal(routeLabel({ route: "42", dir: "I", label: "往 東站" }), "42 往 東站");
  assert.equal(routeLabel({ route: "42", dir: "I" }), "42 I");
  assert.equal(routeLabel("42"), "42 全部方向");
  assert.equal(routeLabel(42), "42 全部方向");
});

test("live records become one option per route and destination, sorted by route", () => {
  const records = [
    { route: "238", dir: "O", dest_tc: "X", eta: "t1" },
    { route: "238", dir: "O", dest_tc: "X", eta: "t2" },
    { route: "238", dir: "O", dest_tc: "Y", eta: "t1" },
    { route: "68K", dir: "O", dest_tc: "Z", eta: null },
  ];
  assert.deepEqual(stopOptions(KMB, records), [
    { route: "68K", dir: "O", destination: "Z" },
    { route: "238", dir: "O", destination: "X" },
    { route: "238", dir: "O", destination: "Y" },
  ]);
});

test("an option remembers the KMB service_type it came from", () => {
  const records = [{ route: "238", dir: "O", service_type: 2, dest_tc: "X", eta: "t1" }];
  assert.deepEqual(stopOptions(KMB, records), [
    { route: "238", dir: "O", destination: "X", service_type: 2 },
  ]);
});

test("a hidden option stays listed when the API has no data for it", () => {
  const exclude = [{ stop_id: "K1", route: 238, destination: "Y" }];
  assert.deepEqual(stopOptions(KMB, [], exclude), [{ route: "238", dir: undefined, destination: "Y" }]);
});

test("a hidden option at another stop is not listed", () => {
  const exclude = [{ stop_id: "K2", route: "238", destination: "Y" }];
  assert.deepEqual(stopOptions(KMB, [], exclude), []);
});

test("loadStopOptions reads every Citybus route at the stop", async () => {
  const fetchFn = fakeFetch({
    [`${CTB_API}/eta/ctb/C1/1`]: [{ route: "1", dir: "I", dest_tc: "X" }],
    [`${CTB_API}/eta/ctb/C1/2`]: [{ route: "2", dir: "O", dest_tc: "Y" }],
  });
  const options = await loadStopOptions({ ...CTB, routes: ["1", "2"] }, [], { fetchFn });
  assert.deepEqual(options.map((option) => option.route), ["1", "2"]);
});

test("loadStopOptions reads a KMB stop", async () => {
  const fetchFn = fakeFetch({ [`${KMB_API}/stop-eta/K1/`]: [{ route: "9", dir: "O", dest_tc: "X" }] });
  assert.equal((await loadStopOptions(KMB, [], { fetchFn })).length, 1);
});

test("loadStopOptions leaves out the directions a stop has not chosen", async () => {
  const stop = { ...CTB, routes: [{ route: "1", dir: "I" }, "2"] };
  const fetchFn = fakeFetch({
    [`${CTB_API}/eta/ctb/C1/1`]: [
      { route: "1", dir: "I", dest_tc: "X" },
      { route: "1", dir: "O", dest_tc: "Y" },
    ],
    [`${CTB_API}/eta/ctb/C1/2`]: [{ route: "2", dir: "O", dest_tc: "Z" }],
  });
  const options = await loadStopOptions(stop, [], { fetchFn });
  assert.deepEqual(options.map((option) => option.destination), ["X", "Z"]);
});

const OPTION = { route: "238", dir: "O", destination: "Y" };

test("hiding an option adds a rule that hides only it", () => {
  const config = setHidden({ stops: [KMB], exclude: [] }, KMB, OPTION, true);
  assert.equal(isHidden(OPTION, KMB, config.exclude), true);
  assert.equal(isHidden({ ...OPTION, destination: "X" }, KMB, config.exclude), false);
  assert.equal(isHidden(OPTION, { ...KMB, stop_id: "K2" }, config.exclude), false);
  assert.equal(config.exclude[0].stop_id, "K1");
});

test("showing an option removes the rule that hid it and keeps the others", () => {
  const other = { route: "9" };
  const hidden = setHidden({ stops: [KMB], exclude: [other] }, KMB, OPTION, true);
  assert.deepEqual(setHidden(hidden, KMB, OPTION, false).exclude, [other]);
});

test("a hand-written rule also shows as hidden, and can be turned off", () => {
  const rule = { operator: "ctb", route: 1, dir: "O" };
  const option = { route: "1", dir: "O", destination: "X" };
  assert.equal(isHidden(option, CTB, [rule]), true);
  assert.deepEqual(setHidden({ stops: [CTB], exclude: [rule] }, CTB, option, false).exclude, []);
});

test("a hand-written service_type rule shows only that variant as hidden", () => {
  const rule = { route: "238", service_type: 2 };
  const hidden = { route: "238", dir: "O", destination: "Y", service_type: 2 };
  const shown = { route: "238", dir: "O", destination: "X", service_type: 1 };
  assert.equal(isHidden(hidden, KMB, [rule]), true);
  assert.equal(isHidden(shown, KMB, [rule]), false);
  assert.deepEqual(setHidden({ stops: [KMB], exclude: [rule] }, KMB, hidden, false).exclude, []);
});

test("addStop adds a KMB stop", () => {
  assert.deepEqual(addStop({ stops: [] }, KMB).stops, [KMB]);
});

test("adding a stop already on the list changes nothing", () => {
  assert.deepEqual(addStop({ stops: [KMB] }, KMB).stops, [KMB]);
});

test("adding another route at a Citybus stop joins it to that stop", () => {
  const config = addStop({ stops: [CTB] }, { ...CTB, routes: ["2"] });
  assert.deepEqual(config.stops, [{ ...CTB, routes: ["1", "2"] }]);
});

const way = (dir, fields) => ({ route: "42", dir, label: `往 ${dir}`, ...fields });
const atStop = (...routes) => ({ ...CTB, routes });

test("adding the other direction at a stop keeps both", () => {
  const config = addStop({ stops: [atStop(way("I"))] }, atStop(way("O")));
  assert.deepEqual(config.stops[0].routes, [way("I"), way("O")]);
});

test("adding a direction already at a stop does not repeat it", () => {
  const config = addStop({ stops: [atStop(way("I"))] }, atStop(way("I")));
  assert.deepEqual(config.stops[0].routes, [way("I")]);
});

test("choosing a direction narrows a route that had none", () => {
  for (const old of ["42", 42, { route: "42" }]) {
    const config = addStop({ stops: [atStop(old, "9")] }, atStop(way("I")));
    assert.deepEqual(config.stops[0].routes, ["9", way("I")]);
  }
});

test("adding a route to a KMB stop that shows everything changes nothing", () => {
  const config = { stops: [KMB] };
  assert.deepEqual(addStop(config, { ...KMB, routes: [way("I")] }), config);
});

test("two destinations of one KMB direction can sit at the same stop", () => {
  const one = way("O", { service_type: "1" });
  const two = way("O", { service_type: "2" });
  const config = addStop({ stops: [atStop(one)] }, atStop(two));
  assert.deepEqual(config.stops[0].routes, [one, two]);
});

test("hasRoute tells which stops already have the chosen direction", () => {
  const config = { stops: [atStop(way("I")), KMB] };
  assert.equal(hasRoute(config, atStop(way("I"))), true);
  assert.equal(hasRoute(config, atStop(way("O"))), false);
  assert.equal(hasRoute(config, { ...atStop(way("I")), stop_id: "other" }), false);
  assert.equal(hasRoute(config, { ...KMB, routes: [way("I")] }), true);
});

test("hasRoute does not count a route with no direction as the chosen direction", () => {
  assert.equal(hasRoute({ stops: [atStop("42")] }, atStop(way("I"))), false);
});

test("removing a stop also removes rules that only applied to it", () => {
  const exclude = [{ stop_id: "K1", route: "1" }, { route: "9" }];
  assert.deepEqual(removeStop({ stops: [KMB, CTB], exclude }, 0), {
    stops: [CTB],
    exclude: [{ route: "9" }],
  });
});

test("removing a stop keeps rules for other stops", () => {
  const exclude = [{ stop_id: "C1", route: "1" }];
  assert.deepEqual(removeStop({ stops: [KMB, CTB], exclude }, 0).exclude, exclude);
});

test("removing one of several Citybus routes keeps the stop", () => {
  const config = { stops: [{ ...CTB, routes: ["1", "2"] }], exclude: [] };
  assert.deepEqual(removeRoute(config, 0, 0).stops, [{ ...CTB, routes: ["2"] }]);
});

test("removing one direction keeps the other", () => {
  const config = { stops: [atStop(way("I"), way("O"))], exclude: [] };
  assert.deepEqual(removeRoute(config, 0, 0).stops[0].routes, [way("O")]);
});

test("removing the last Citybus route removes the stop", () => {
  assert.deepEqual(removeRoute({ stops: [CTB], exclude: [] }, 0, 0).stops, []);
});

const entry = (route, dir, label) => ({ route, dir, label });
const shown = (groups) =>
  groups.map(({ operator, rows }) => [
    operator,
    rows.map(({ route, direction, stop }) => [route, direction, stop].join(" | ")),
  ]);

test("added routes are in route order, with numbers compared as numbers", () => {
  const stops = [
    { ...KMB, routes: [entry("42A", "O", "往 A"), entry("10", "O", "往 A"), entry("2", "O", "往 A")] },
  ];
  assert.deepEqual(addedRoutes(stops)[0].rows.map(({ route }) => route), ["2", "10", "42A"]);
});

test("added routes on one route are ordered by direction, then stop", () => {
  const stops = [
    { ...KMB, name: "Stop B", routes: [entry("1", "O", "往 B")] },
    { ...KMB, stop_id: "K2", name: "Stop B", routes: [entry("1", "I", "往 A")] },
    { ...KMB, stop_id: "K3", name: "Stop A", routes: [entry("1", "O", "往 B")] },
  ];
  assert.deepEqual(shown(addedRoutes(stops)), [
    ["kmb", ["1 | 往 A | Stop B", "1 | 往 B | Stop A", "1 | 往 B | Stop B"]],
  ]);
});

test("added routes are split by operator, KMB first", () => {
  const stops = [CTB, { ...KMB, routes: ["9"] }];
  assert.deepEqual(addedRoutes(stops).map(({ operator }) => operator), ["kmb", "ctb"]);
});

test("an operator with nothing added gets no group", () => {
  assert.deepEqual(addedRoutes([CTB]).map(({ operator }) => operator), ["ctb"]);
  assert.deepEqual(addedRoutes([]), []);
});

test("a route with no direction reads as all directions", () => {
  assert.deepEqual(shown(addedRoutes([{ ...CTB, name: "Stop B" }])), [
    ["ctb", ["1 | 全部方向 | Stop B"]],
  ]);
});

test("a stop showing every route is one row", () => {
  assert.deepEqual(shown(addedRoutes([{ ...KMB, name: "Stop A" }])), [
    ["kmb", ["全部路線 |  | Stop A"]],
  ]);
});

test("each added route row still points at its own config entry", () => {
  const config = {
    stops: [{ ...CTB, routes: ["9", "2"] }, { ...CTB, stop_id: "C2", routes: ["1"] }],
    exclude: [],
  };
  const [{ rows }] = addedRoutes(config.stops);
  assert.deepEqual(rows.map(({ route }) => route), ["1", "2", "9"]);
  const { index, routeIndex } = rows[2];
  assert.deepEqual(removeRoute(config, index, routeIndex).stops[0].routes, ["2"]);
});

test("config helpers leave the original config untouched", () => {
  const config = Object.freeze({
    stops: Object.freeze([Object.freeze({ ...CTB })]),
    exclude: Object.freeze([]),
  });
  assert.doesNotThrow(() => {
    addStop(config, { ...CTB, routes: ["2"] });
    removeStop(config, 0);
    removeRoute(config, 0, 0);
    setHidden(config, CTB, OPTION, true);
  });
});
