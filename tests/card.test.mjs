import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

// The card needs only a few DOM features, so these stubs stand in for a browser.
globalThis.HTMLElement = class {
  attachShadow() {
    const elements = new Map();
    const listeners = {};
    this.shadowRoot = {
      innerHTML: "",
      listeners,
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { innerHTML: "", value: "" });
        return elements.get(selector);
      },
      addEventListener: (type, listener) => (listeners[type] = listener),
    };
    return this.shadowRoot;
  }
  dispatchEvent(event) {
    this.lastEvent = event;
  }
};
const defined = new Map();
globalThis.customElements = {
  define: (name, element) => defined.set(name, element),
  get: (name) => defined.get(name),
};
globalThis.window = globalThis;
globalThis.document = { createElement: (name) => new (defined.get(name))() };

await import("../www/buseta-card.js");
const BusetaCard = defined.get("buseta-card");

const STOP = { operator: "kmb", stop_id: "KMB1" };

let requests;
function respondWith(records) {
  requests = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/stop/KMB1")) {
      return { ok: true, json: async () => ({ data: { name_tc: "Stop A (AB123)" } }) };
    }
    requests += 1;
    return { ok: true, json: async () => ({ data: records }) };
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const body = (card) => card.shadowRoot.querySelector(".chart").innerHTML;
const foot = (card) => card.shadowRoot.querySelector(".foot").innerHTML;
async function showCard(config) {
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP], ...config });
  card.connectedCallback();
  await settle();
  return card;
}
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60000 - 1000).toISOString();
const k1 = (minutes, fields) => ({ route: "K1", dir: "O", dest_tc: "Kowloon", eta: inMinutes(minutes), ...fields });
async function editorWith(config) {
  const editor = await BusetaCard.getConfigElement();
  editor.setConfig({ stops: [], ...config });
  return editor;
}
function change(editor, action, value) {
  editor.shadowRoot.listeners.change({ target: { dataset: { action }, value } });
  return editor.lastEvent.detail.config;
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setInterval"] });
  respondWith([]);
});
afterEach(() => mock.timers.reset());

test("the card registers itself for the card picker", () => {
  assert.ok(window.customCards.some((card) => card.type === "buseta-card"));
});

test("setConfig rejects an invalid config so HA can show the error", () => {
  assert.throws(() => new BusetaCard().setConfig({ stops: "A" }), /array/);
});

test("a new card starts with no stops and asks for some", async () => {
  const card = new BusetaCard();
  card.setConfig(BusetaCard.getStubConfig());
  card.connectedCallback();
  await settle();
  assert.equal(requests, 0);
  assert.match(body(card), /加入站點/);
  card.disconnectedCallback();
});

test("the card provides the visual editor", async () => {
  const editor = await BusetaCard.getConfigElement();
  assert.equal(typeof editor.setConfig, "function");
});

test("the editor lists stops by name, with no stop ID or rename box", async () => {
  const editor = await BusetaCard.getConfigElement();
  editor.setConfig({ stops: [{ ...STOP, routes: [{ route: "1", dir: "O", label: "往 A" }] }] });
  await settle();
  const list = editor.shadowRoot.querySelector("#stops").innerHTML;
  assert.match(list, /<span>Stop A<\/span>/);
  assert.doesNotMatch(list, /KMB1/);
  assert.doesNotMatch(list, /<input/);
});

test("the card shows the stop, route and destination once it is on the page", async () => {
  respondWith([k1(5)]);
  const card = await showCard();
  assert.match(body(card), /Stop A/);
  assert.match(body(card), /K1/);
  assert.match(body(card), /Kowloon/);
  card.disconnectedCallback();
});

test("a departure sits at its share of the time axis", async () => {
  respondWith([k1(15)]);
  const card = await showCard({ max_minutes: 30 });
  assert.match(body(card), /left:50%/);
  card.disconnectedCallback();
});

test("the leaving time draws a band over that share of the axis", async () => {
  respondWith([k1(9)]);
  const card = await showCard({ leave_minutes: 6, max_minutes: 30 });
  assert.match(body(card), /class="band"[^>]*0\.2\b/);
  card.disconnectedCallback();
});

test("a leaving time longer than the axis fills it without spilling over", async () => {
  respondWith([k1(9)]);
  const card = await showCard({ leave_minutes: 40, max_minutes: 30 });
  assert.match(body(card), /class="band"[^>]*\* 1\)/);
  card.disconnectedCallback();
});

test("a leaving time of zero draws no band or legend", async () => {
  respondWith([k1(9)]);
  const card = await showCard({ leave_minutes: 0 });
  assert.doesNotMatch(body(card), /class="band"/);
  assert.doesNotMatch(foot(card), /未必趕到/);
  card.disconnectedCallback();
});

test("departures carry their status so they can be drawn differently", async () => {
  respondWith([k1(3), k1(8), k1(12, { rmk_tc: "原定班次" })]);
  const card = await showCard({ leave_minutes: 5 });
  assert.match(body(card), /class="dot kmb miss"[^>]*>3</);
  assert.match(body(card), /class="dot kmb next"[^>]*>8</);
  assert.match(body(card), /class="dot kmb later scheduled"[^>]*>12</);
  card.disconnectedCallback();
});

test("the footer states the leaving time and when the data was fetched", async () => {
  respondWith([k1(9)]);
  const card = await showCard({ leave_minutes: 7 });
  assert.match(foot(card), /7 分鐘內未必趕到/);
  assert.match(foot(card), /更新於 \d\d:\d\d/);
  card.disconnectedCallback();
});

test("a stop with no buses says so instead of showing an empty card", async () => {
  respondWith([]);
  const card = await showCard();
  assert.match(body(card), /暫無班次/);
  card.disconnectedCallback();
});

test("the chosen colour scheme is applied to the card", () => {
  const card = new BusetaCard();
  card.setConfig({ stops: [], color_scheme: "led" });
  assert.match(card.shadowRoot.innerHTML, /<ha-card class="scheme-led"/);
});

test("the editor shows the saved leaving time, colours and size", async () => {
  const editor = await editorWith({
    leave_minutes: 7,
    color_scheme: "icehouse",
    grid_options: { columns: 12, rows: 10 },
  });
  editor.connectedCallback();
  const value = (action) => editor.shadowRoot.querySelector(`[data-action=${action}]`).value;
  assert.equal(value("leave"), 7);
  assert.equal(value("scheme"), "icehouse");
  assert.equal(value("width"), 12);
  assert.equal(value("height"), 10);
});

test("the editor shows the default colours and a full width when none are saved", async () => {
  const editor = await editorWith({ grid_options: { columns: "full" } });
  editor.connectedCallback();
  const value = (action) => editor.shadowRoot.querySelector(`[data-action=${action}]`).value;
  assert.equal(value("scheme"), "auto");
  assert.equal(value("width"), "");
});

test("the editor offers exactly the four colour schemes", async () => {
  const editor = await editorWith();
  const offered = [...editor.shadowRoot.innerHTML.matchAll(/<option value="(auto|mono|led|icehouse|[a-z]+)"/g)]
    .map((match) => match[1])
    .filter((id) => !["kmb", "ctb"].includes(id));
  assert.deepEqual(offered, ["auto", "mono", "led", "icehouse"]);
});

test("the editor saves the colour scheme", async () => {
  const editor = await editorWith();
  assert.equal(change(editor, "scheme", "mono").color_scheme, "mono");
});

test("the editor saves a leaving time of zero", async () => {
  const editor = await editorWith();
  assert.equal(change(editor, "leave", "0").leave_minutes, 0);
});

test("the editor refuses a negative leaving time", async () => {
  const editor = await editorWith();
  assert.equal(change(editor, "leave", "-3").leave_minutes, 0);
});

test("the editor saves the card size as HA grid options and keeps the other value", async () => {
  const editor = await editorWith({ grid_options: { columns: "full", rows: 8 } });
  assert.deepEqual(change(editor, "height", "12").grid_options, { columns: "full", rows: 12 });
  assert.deepEqual(change(editor, "width", "24").grid_options, { columns: 24, rows: 12 });
});

test("emptying the width and height removes them", async () => {
  const editor = await editorWith({ grid_options: { columns: 12, rows: 8 } });
  assert.deepEqual(change(editor, "width", "").grid_options, { rows: 8 });
  assert.equal(change(editor, "height", "").grid_options, undefined);
});

test("the editor keeps the card at least two rows tall and one column wide", async () => {
  const editor = await editorWith();
  assert.equal(change(editor, "height", "1").grid_options.rows, 2);
  assert.equal(change(editor, "width", "0").grid_options.columns, 1);
});

test("text from the API is escaped", async () => {
  respondWith([k1(5, { dest_tc: "<img src=x>" })]);
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP] });
  card.connectedCallback();
  await settle();
  assert.ok(!body(card).includes("<img"));
  assert.ok(body(card).includes("&lt;img src=x&gt;"));
  card.disconnectedCallback();
});

test("a first refresh that fails says so instead of showing an empty card", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const logged = mock.method(console, "error", () => {});
  const card = await showCard();
  assert.match(body(card), /無法取得班次/);
  logged.mock.restore();
  card.disconnectedCallback();
});

test("the next good refresh clears the failure message", async () => {
  respondWith([k1(9)]);
  const card = await showCard({ refresh_seconds: 10 });
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const logged = mock.method(console, "error", () => {});
  mock.timers.tick(10000);
  await settle();
  respondWith([k1(9)]);
  mock.timers.tick(10000);
  await settle();
  assert.doesNotMatch(foot(card), /更新失敗/);
  logged.mock.restore();
  card.disconnectedCallback();
});

test("the card polls on the configured interval and stops when removed", async () => {
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP], refresh_seconds: 10 });
  card.connectedCallback();
  await settle();
  assert.equal(requests, 1);
  mock.timers.tick(10000);
  await settle();
  assert.equal(requests, 2);
  card.disconnectedCallback();
  mock.timers.tick(30000);
  await settle();
  assert.equal(requests, 2);
});

test("a card that is moved on the page keeps exactly one timer", async () => {
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP], refresh_seconds: 10 });
  card.connectedCallback();
  card.disconnectedCallback();
  card.connectedCallback();
  await settle();
  requests = 0;
  mock.timers.tick(10000);
  await settle();
  assert.equal(requests, 1);
  card.disconnectedCallback();
});

test("a new config applies straight away with one timer", async () => {
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP], refresh_seconds: 10 });
  card.connectedCallback();
  await settle();
  card.setConfig({ stops: [STOP], refresh_seconds: 20 });
  await settle();
  assert.equal(requests, 2);
  mock.timers.tick(20000);
  await settle();
  assert.equal(requests, 3);
  card.disconnectedCallback();
});

test("a failed refresh keeps the rows already on screen", async () => {
  respondWith([k1(5)]);
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP], refresh_seconds: 10 });
  card.connectedCallback();
  await settle();
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const logged = mock.method(console, "error", () => {});
  mock.timers.tick(10000);
  await settle();
  assert.match(body(card), /Kowloon/);
  assert.match(foot(card), /更新失敗/);
  assert.equal(logged.mock.callCount(), 1);
  logged.mock.restore();
  card.disconnectedCallback();
});
