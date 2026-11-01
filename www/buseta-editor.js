// buseta-card-editor — visual editor for buseta-card.
// Uses plain form controls: HA's own elements are lazy-loaded and change between releases.

const version = new URL(import.meta.url).search;
const { COLOR_SCHEMES, DEFAULTS, OPERATORS, escapeHtml, withNames } = await import(`./buseta.js${version}`);
const {
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
} = await import(`./buseta-config.js${version}`);

const MIN_REFRESH_SECONDS = 10;
const MIN_ROWS = 2;
const MIN_COLUMNS = 1;
const DEFAULT_ROWS = 8;

const STYLE = `
  :host { color: var(--primary-text-color); display: block; }
  section { margin-bottom: 20px; }
  h3 { font-size: 1em; font-weight: 500; margin: 0 0 8px; }
  h4 { color: var(--secondary-text-color); font-size: 0.85em; font-weight: 500; margin: 12px 0 4px; }
  label { display: block; margin-bottom: 8px; }
  label span { color: var(--secondary-text-color); display: block; font-size: 0.85em; margin-bottom: 2px; }
  input:not([type="checkbox"]), select, button {
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    border-radius: 6px;
    box-sizing: border-box;
    color: var(--primary-text-color);
    font: inherit;
    padding: 8px;
  }
  input:not([type="checkbox"]), select { width: 100%; }
  button { cursor: pointer; }
  button:disabled { cursor: default; opacity: 0.5; }
  .numbers { display: flex; gap: 8px; }
  .numbers label { flex: 1; }
  .routes { align-items: center; display: grid; gap: 4px 8px; grid-template-columns: minmax(3.5em, auto) 1fr 1fr auto; }
  .route { font-weight: 500; }
  .routes button { padding: 2px 8px; }
  .show-buses { margin-top: 8px; }
  .route-form { align-items: center; display: flex; gap: 8px; }
  .route-form input { flex: 1; min-width: 0; }
  .hint { color: var(--secondary-text-color); font-size: 0.85em; margin: 6px 0; }
  .primary { background: var(--primary-color); border: none; color: var(--text-primary-color); }
  .error { color: var(--error-color); }
  ul { list-style: none; margin: 8px 0 0; max-height: 320px; overflow: auto; padding: 0; }
  li { margin-bottom: 4px; }
  li > button { display: flex; gap: 8px; justify-content: space-between; text-align: left; width: 100%; }
  .options { margin-top: 8px; }
  .options label { align-items: center; display: flex; gap: 8px; margin-bottom: 4px; }
  .nearest button { display: flex; gap: 8px; justify-content: space-between; margin-bottom: 4px; text-align: left; width: 100%; }
  .selected { border-color: var(--primary-color); color: var(--primary-color); }
  .added { color: var(--primary-color); font-size: 0.9em; }
`;

const TEMPLATE = `
  <style>${STYLE}</style>
  <section>
    <h3>基本設定</h3>
    <label><span>標題</span><input data-action="title"></label>
    <div class="numbers">
      <label><span>更新間隔（秒，最少 ${MIN_REFRESH_SECONDS}）</span>
        <input data-action="refresh" type="number" min="${MIN_REFRESH_SECONDS}" placeholder="${DEFAULTS.refresh_seconds}"></label>
      <label><span>顯示多少分鐘內的班次</span>
        <input data-action="max" type="number" min="1" placeholder="${DEFAULTS.max_minutes}"></label>
    </div>
    <div class="numbers">
      <label><span>出門時間（分鐘，0 為關閉）</span>
        <input data-action="leave" type="number" min="0" placeholder="${DEFAULTS.leave_minutes}"></label>
      <label><span>配色</span>
        <select data-action="scheme">
          ${Object.entries(COLOR_SCHEMES).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}
        </select></label>
    </div>
    <div class="numbers">
      <label><span>卡片寬度（欄，留空為全寬）</span>
        <input data-action="width" type="number" min="${MIN_COLUMNS}" placeholder="全寬"></label>
      <label><span>卡片高度（行，最少 ${MIN_ROWS}）</span>
        <input data-action="height" type="number" min="${MIN_ROWS}" placeholder="${DEFAULT_ROWS}"></label>
    </div>
    <div class="hint">每個區段 12 欄，每行約 64 像素。只在「區段」版面的 dashboard 生效。</div>
  </section>
  <section>
    <h3>已加入的站點</h3>
    <div id="stops"></div>
  </section>
  <section>
    <h3>加入路線</h3>
    <label><span>營運商</span>
      <select data-action="operator">
        ${Object.entries(OPERATORS).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}
      </select></label>
    <div id="add"></div>
  </section>
`;

const stopKey = (stop) => `${stop.operator}:${stop.stop_id}`;
const formatDistance = (metres) =>
  metres < 1000 ? `${metres} 米` : `${(metres / 1000).toFixed(1)} 公里`;
const optionLabel = (option) => `${option.route} → ${option.destination}`;
// Only a stop still showing whole routes has anything left to hide.
const canHide = (stop) => !stop.routes || stop.routes.some((entry) => entry.dir === undefined);

class BusetaCardEditor extends HTMLElement {
  #config = { stops: [], exclude: [] };
  #hass;
  #names = new Map();
  #options = new Map();
  #operator = "kmb";
  #search = { input: "" };
  #added = "";

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.addEventListener("click", (event) => this.#onClick(event));
    root.addEventListener("change", (event) => this.#onChange(event));
    root.addEventListener("input", (event) => this.#onInput(event));
    root.addEventListener("submit", (event) => this.#onSubmit(event));
  }

  set hass(hass) {
    const firstTime = !this.#hass;
    this.#hass = hass;
    if (firstTime && this.#search.stops) this.#renderAdd();
  }

  setConfig(config) {
    const next = { ...config, stops: config.stops ?? [], exclude: config.exclude ?? [] };
    if (JSON.stringify(next) === JSON.stringify(this.#config)) return;
    this.#config = next;
    this.#renderSettings();
    this.#renderStops();
    this.#loadNames();
  }

  connectedCallback() {
    this.#renderSettings();
    this.#renderStops();
    this.#renderAdd();
  }

  get #namedStops() {
    return this.#config.stops.map((stop) => ({
      ...stop,
      name: this.#names.get(stopKey(stop)) ?? "",
    }));
  }

  async #loadNames() {
    const { stops } = this.#config;
    for (const stop of await withNames(stops)) this.#names.set(stopKey(stop), stop.name);
    if (stops === this.#config.stops) this.#renderStops();
  }

  get #home() {
    const { latitude, longitude } = this.#hass?.config ?? {};
    return latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
  }

  #find(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  #save(config, { render = false } = {}) {
    this.#config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }),
    );
    if (render) {
      this.#renderStops();
      this.#renderAdd();
      this.#loadNames();
    }
  }

  #setSetting(key, value) {
    const { [key]: _removed, ...rest } = this.#config;
    this.#save(value === "" ? rest : { ...rest, [key]: value });
  }

  #setNumber(key, input, minimum) {
    if (input.value === "") return this.#setSetting(key, "");
    const value = Math.max(Number(input.value), minimum);
    input.value = value;
    this.#setSetting(key, value);
  }

  // Card size is HA's own grid_options, so this and HA's Layout tab edit the same values.
  #setGrid(key, input, minimum) {
    const { grid_options: { [key]: _removed, ...kept } = {}, ...rest } = this.#config;
    const value = input.value === "" ? undefined : Math.max(Number(input.value), minimum);
    if (value !== undefined) input.value = value;
    const grid = value === undefined ? kept : { ...kept, [key]: value };
    this.#save(Object.keys(grid).length ? { ...rest, grid_options: grid } : rest);
  }

  #renderSettings() {
    const { columns, rows } = this.#config.grid_options ?? {};
    this.#find("[data-action=title]").value = this.#config.title ?? "";
    this.#find("[data-action=leave]").value = this.#config.leave_minutes ?? "";
    this.#find("[data-action=scheme]").value = this.#config.color_scheme ?? DEFAULTS.color_scheme;
    this.#find("[data-action=width]").value = typeof columns === "number" ? columns : "";
    this.#find("[data-action=height]").value = rows ?? "";
    this.#find("[data-action=refresh]").value = this.#config.refresh_seconds ?? "";
    this.#find("[data-action=max]").value = this.#config.max_minutes ?? "";
  }

  #optionsHtml(stop) {
    const options = this.#options.get(stopKey(stop));
    if (options === undefined) return "";
    if (options === "loading") return `<div class="options hint">載入班次中…</div>`;
    if (options.error) return `<div class="options error">${escapeHtml(options.error)}</div>`;
    if (options.length === 0) {
      return `<div class="options hint">暫無班次資料。收車後部分路線不會列出，請稍後再試。</div>`;
    }
    const rows = options.map((option, index) => {
      const checked = isHidden(option, stop, this.#config.exclude) ? "" : " checked";
      return `<label><input type="checkbox" data-action="toggle" data-key="${escapeHtml(stopKey(stop))}"
        data-option="${index}"${checked}>${escapeHtml(optionLabel(option))}</label>`;
    });
    return `<div class="options"><div class="hint">取消勾選即隱藏。同一班車有兩個目的地時，只會顯示一個。</div>${rows.join("")}</div>`;
  }

  #rowHtml({ route, direction, stop, index, routeIndex }) {
    const remove =
      routeIndex === undefined
        ? `data-action="remove"`
        : `data-action="remove-route" data-route="${routeIndex}"`;
    return `
      <span class="route">${escapeHtml(route)}</span>
      <span>${escapeHtml(direction)}</span>
      <span>${escapeHtml(stop)}</span>
      <button type="button" ${remove} data-index="${index}" aria-label="移除" title="移除">×</button>`;
  }

  #showBusesHtml(stop, index) {
    if (!canHide(stop)) return "";
    return `
      <div class="show-buses">
        <button type="button" data-action="options" data-index="${index}">${escapeHtml(stop.name)}：選擇顯示的班次</button>
        ${this.#optionsHtml(stop)}
      </div>`;
  }

  #groupHtml({ operator, rows }) {
    const showBuses = this.#namedStops.map((stop, index) =>
      stop.operator === operator ? this.#showBusesHtml(stop, index) : "",
    );
    return `
      <h4>${OPERATORS[operator]}</h4>
      <div class="routes">${rows.map((row) => this.#rowHtml(row)).join("")}</div>
      ${showBuses.join("")}`;
  }

  #renderStops() {
    const groups = addedRoutes(this.#namedStops);
    this.#find("#stops").innerHTML = groups.length
      ? groups.map((group) => this.#groupHtml(group)).join("")
      : `<div class="hint">尚未加入站點，請在下方輸入路線。</div>`;
  }

  #renderAdd() {
    const { input, loading, error, route } = this.#search;
    this.#find("#add").innerHTML = `
      <form class="route-form">
        <input data-action="route" value="${escapeHtml(input)}" placeholder="路線，例如 1A" aria-label="路線">
        <button type="submit">查詢</button>
      </form>
      ${this.#added ? `<div class="added">已加入 ${escapeHtml(this.#added)}</div>` : ""}
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      ${route ? this.#directionsHtml() : ""}
      ${loading ? `<div class="hint">載入中…</div>` : ""}
      ${this.#stopsHtml()}`;
  }

  #directionsHtml() {
    const { route, direction } = this.#search;
    if (route.directions.length === 1) return "";
    const items = route.directions.map(
      ({ label }, index) => `<li><button type="button" data-action="pick-direction" data-index="${index}"
        ${index === direction ? `class="selected"` : ""}>${escapeHtml(label)}</button></li>`,
    );
    return `<div class="hint">選擇方向</div><ul>${items.join("")}</ul>`;
  }

  #stopButton(stop, note) {
    const { route, direction } = this.#search;
    const entry = routeEntry(route.route, route.directions[direction], stop.stop_id);
    const added = hasRoute(this.#config, { ...stop, operator: this.#operator, routes: [entry] });
    return `<button type="button" data-action="add-stop" data-id="${escapeHtml(stop.stop_id)}"
      data-name="${escapeHtml(stop.name)}"${added ? " disabled" : ""}><span>${escapeHtml(stop.name)}</span>
      <small>${added ? "已加入" : note}</small></button>`;
  }

  #stopsHtml() {
    const { route, direction, stops } = this.#search;
    if (!stops) return "";
    const nearest = nearestStop(stops, this.#home);
    const nearestHtml = nearest
      ? `<div class="nearest">${this.#stopButton(nearest, `離家最近 ${formatDistance(nearest.distance)}`)}</div>`
      : "";
    const items = stops.map((stop) => `<li>${this.#stopButton(stop, "加入")}</li>`);
    const { label } = route.directions[direction];
    return `<div class="hint">按站牌加入路線 ${escapeHtml(route.route)} ${escapeHtml(label)}。</div>
      ${nearestHtml}<ul>${items.join("")}</ul>`;
  }

  #searchFailed(message) {
    this.#search = { ...this.#search, loading: false, error: message };
    this.#renderAdd();
  }

  async #findRoute() {
    const operator = this.#operator;
    const input = this.#search.input.trim().toUpperCase();
    const request = {};
    this.#search = { input: this.#search.input, request, loading: true };
    this.#added = "";
    this.#renderAdd();
    try {
      const route = await loadRoute(operator, input);
      if (this.#search.request !== request) return;
      if (!route) return this.#searchFailed(`${OPERATORS[operator]}沒有路線 ${input}`);
      this.#search = { ...this.#search, route, loading: false };
      if (route.directions.length === 1) return this.#pickDirection(0);
      this.#renderAdd();
    } catch (error) {
      if (this.#search.request !== request) return;
      console.error("buseta:", error);
      this.#searchFailed("無法載入路線，請稍後再試。");
    }
  }

  async #pickDirection(direction) {
    const operator = this.#operator;
    const { route } = this.#search;
    this.#search = { ...this.#search, direction, stops: undefined, loading: true, error: "" };
    this.#added = "";
    this.#renderAdd();
    const current = () => this.#search.route === route && this.#search.direction === direction;
    try {
      const stops = await loadRouteStops(operator, route.directions[direction].stopIds);
      if (!current()) return;
      this.#search = { ...this.#search, stops, loading: false };
      this.#renderAdd();
    } catch (error) {
      if (!current()) return;
      console.error("buseta:", error);
      this.#searchFailed(
        "暫時無法載入站牌，請稍後再查詢一次。也可以按編輯視窗左下角的「使用文字編輯器」，直接填入 stop_id。",
      );
    }
  }

  #addRoute(stop_id, name) {
    const { route, direction } = this.#search;
    const entry = routeEntry(route.route, route.directions[direction], stop_id);
    const stop = { operator: this.#operator, stop_id, routes: [entry] };
    this.#added = `${name} ${routeLabel(entry)}`;
    this.#save(addStop(this.#config, stop), { render: true });
  }

  async #showOptions(stop) {
    const key = stopKey(stop);
    if (this.#options.has(key) && this.#options.get(key) !== "loading") {
      this.#options.delete(key);
      return this.#renderStops();
    }
    this.#options.set(key, "loading");
    this.#renderStops();
    try {
      this.#options.set(key, await loadStopOptions(stop, this.#config.exclude));
    } catch (error) {
      console.error("buseta:", error);
      this.#options.set(key, { error: "無法載入班次，請稍後再試。" });
    }
    this.#renderStops();
  }

  #toggle(input) {
    const stop = this.#config.stops.find((item) => stopKey(item) === input.dataset.key);
    const option = this.#options.get(input.dataset.key)[Number(input.dataset.option)];
    this.#save(setHidden(this.#config, stop, option, !input.checked), { render: true });
  }

  #onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element) return;
    const index = Number(element.dataset.index);
    const { id, name } = element.dataset;
    switch (element.dataset.action) {
      case "remove":
        return this.#save(removeStop(this.#config, index), { render: true });
      case "remove-route":
        return this.#save(removeRoute(this.#config, index, Number(element.dataset.route)), {
          render: true,
        });
      case "options":
        return this.#showOptions(this.#config.stops[index]);
      case "pick-direction":
        return this.#pickDirection(index);
      case "add-stop":
        return this.#addRoute(id, name);
    }
  }

  #onChange(event) {
    const input = event.target;
    switch (input.dataset.action) {
      case "title":
        return this.#setSetting("title", input.value.trim());
      case "refresh":
        return this.#setNumber("refresh_seconds", input, MIN_REFRESH_SECONDS);
      case "max":
        return this.#setNumber("max_minutes", input, 1);
      case "leave":
        return this.#setNumber("leave_minutes", input, 0);
      case "scheme":
        return this.#setSetting("color_scheme", input.value);
      case "width":
        return this.#setGrid("columns", input, MIN_COLUMNS);
      case "height":
        return this.#setGrid("rows", input, MIN_ROWS);
      case "toggle":
        return this.#toggle(input);
      case "operator":
        this.#operator = input.value;
        this.#search = { input: "" };
        this.#added = "";
        return this.#renderAdd();
    }
  }

  #onInput(event) {
    if (event.target.dataset.action === "route") this.#search.input = event.target.value;
  }

  #onSubmit(event) {
    event.preventDefault();
    if (this.#search.input.trim()) this.#findRoute();
  }
}

if (!customElements.get("buseta-card-editor")) {
  customElements.define("buseta-card-editor", BusetaCardEditor);
}
