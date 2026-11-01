import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

// The card needs only a few DOM features, so these stubs stand in for a browser.
globalThis.HTMLElement = class {
  attachShadow() {
    const body = { innerHTML: "" };
    this.shadowRoot = { innerHTML: "", querySelector: () => body, addEventListener() {} };
    return this.shadowRoot;
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
const FUTURE = () => new Date(Date.now() + 5 * 60000).toISOString();

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
const body = (card) => card.shadowRoot.querySelector("tbody").innerHTML;

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

test("the card shows rows once it is on the page", async () => {
  respondWith([{ route: "K1", dir: "O", dest_tc: "Kowloon", eta: FUTURE() }]);
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP] });
  card.connectedCallback();
  await settle();
  assert.match(body(card), /<td>Stop A<\/td><td>K1<\/td><td>Kowloon<\/td><td>5<\/td>/);
  card.disconnectedCallback();
});

test("text from the API is escaped", async () => {
  respondWith([{ route: "K1", dir: "O", dest_tc: "<img src=x>", eta: FUTURE() }]);
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP] });
  card.connectedCallback();
  await settle();
  assert.ok(!body(card).includes("<img"));
  assert.ok(body(card).includes("&lt;img src=x&gt;"));
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
  respondWith([{ route: "K1", dir: "O", dest_tc: "Kowloon", eta: FUTURE() }]);
  const card = new BusetaCard();
  card.setConfig({ stops: [STOP], refresh_seconds: 10 });
  card.connectedCallback();
  await settle();
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const logged = mock.method(console, "error", () => {});
  mock.timers.tick(10000);
  await settle();
  assert.match(body(card), /Kowloon/);
  assert.equal(logged.mock.callCount(), 1);
  logged.mock.restore();
  card.disconnectedCallback();
});
