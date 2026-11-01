// buseta-card — Lovelace card that shows Hong Kong bus arrivals on a time axis.

// Passing on the resource's ?v= keeps the other modules in step with the card.
const version = new URL(import.meta.url).search;
const { axisTicks, escapeHtml, fetchRows, groupRows, staggerDepartures, validateConfig } =
  await import(`./buseta.js${version}`);

// These sizes also decide when dots need moving off the rail, so the styles use them too.
const LABEL_WIDTH = 130;
const NARROW_LABEL_WIDTH = 66;
const NARROW_CARD = 440;
const PAD_LEFT = 16;
const PAD_RIGHT = 22;
const DOT_SPACING = 28;

// Every colour comes from these tokens. `auto` and `mono` use the HA theme, so they
// follow light and dark mode; the others draw their own background in both.
const THEME_COLOURS = `
  --bg: var(--ha-card-background, var(--card-background-color, #fff));
  --ink: var(--primary-text-color);
  --soft: var(--secondary-text-color);
  --rail: var(--divider-color);
  --hatch: var(--divider-color);
`;
const OPERATOR_COLOURS = `
  --kmb: #c8102e;
  --kmb-ink: #fff;
  --ctb: #ffd100;
  --ctb-ink: #14284b;
`;

const STYLE = `
  ha-card {
    --label: ${LABEL_WIDTH}px;
    --lane: 32px;
    --shift: 8px;
    --pad-left: ${PAD_LEFT}px;
    --pad-right: ${PAD_RIGHT}px;
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .scheme-auto { ${THEME_COLOURS} ${OPERATOR_COLOURS} }
  .scheme-mono {
    ${THEME_COLOURS}
    --kmb: var(--ink);
    --kmb-ink: var(--bg);
    --ctb: var(--soft);
    --ctb-ink: var(--bg);
  }
  .scheme-led {
    --bg: #000;
    --ink: #ffa800;
    --soft: #c48a1c;
    --rail: rgba(255, 168, 0, .3);
    --hatch: rgba(255, 168, 0, .16);
    --kmb: #ff5a36;
    --kmb-ink: #000;
    --ctb: #ffe100;
    --ctb-ink: #000;
  }
  .scheme-icehouse {
    --bg: #d3ecdf;
    --ink: #123b33;
    --soft: #47665d;
    --rail: rgba(18, 59, 51, .22);
    --hatch: rgba(18, 59, 51, .13);
    --kmb: #a8201a;
    --kmb-ink: #fff;
    --ctb: #f0b100;
    --ctb-ink: #2b1d00;
  }
  .scheme-led, .scheme-icehouse {
    --ha-card-background: var(--bg);
    --ha-card-header-color: var(--ink);
    color: var(--ink);
  }
  .scroll { flex: 1; min-height: 0; overflow: auto; }
  .chart { color: var(--ink); padding: 0 var(--pad-right) 4px var(--pad-left); position: relative; }
  .message { color: var(--soft); padding: 16px 0; text-align: center; }
  .band {
    background: repeating-linear-gradient(135deg, var(--hatch) 0 2px, transparent 2px 8px);
    border-right: 2px dashed var(--ink);
    bottom: 0;
    left: calc(var(--pad-left) + var(--label));
    position: absolute;
    top: 28px;
  }
  .axis {
    background: var(--bg);
    display: grid;
    grid-template-columns: var(--label) minmax(0, 1fr);
    height: 28px;
    position: sticky;
    top: 0;
    z-index: 30;
  }
  .scale { position: relative; }
  .tick {
    bottom: 5px;
    color: var(--soft);
    font-size: 12px;
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .tick.now { color: var(--ink); transform: none; }
  .tick.leave { color: var(--ink); font-weight: 700; }
  .stop { font-size: 13px; font-weight: 700; margin: 0; padding: 6px 0 2px; position: relative; }
  .lane {
    align-items: center;
    display: grid;
    grid-template-columns: var(--label) minmax(0, 1fr);
    height: var(--lane);
    position: relative;
  }
  .who { align-items: center; display: flex; gap: 6px; min-width: 0; }
  .plate {
    border-radius: 4px;
    flex: none;
    font-size: 14px;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
    width: 46px;
  }
  .kmb { background: var(--kmb); color: var(--kmb-ink); }
  .ctb { background: var(--ctb); color: var(--ctb-ink); }
  .destination { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { height: var(--lane); position: relative; }
  .rail {
    background: var(--rail);
    height: 2px;
    left: 0;
    position: absolute;
    right: 0;
    top: calc(50% - 1px);
  }
  .dot {
    align-items: center;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--bg);
    box-sizing: border-box;
    display: flex;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    height: 24px;
    justify-content: center;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 24px;
  }
  .dot.next { font-size: 16px; height: 30px; width: 30px; }
  .dot.up, .dot.down { font-size: 12px; height: 20px; width: 20px; }
  .dot.next.up, .dot.next.down { font-size: 13px; height: 24px; width: 24px; }
  .dot.up { top: calc(50% - var(--shift)); }
  .dot.down { top: calc(50% + var(--shift)); }
  .dot.miss { background: var(--bg); border: 2px solid var(--soft); color: var(--soft); }
  .dot.scheduled { background: var(--bg); border: 2px dashed var(--ink); color: var(--ink); }
  .dot.miss.scheduled { border-color: var(--soft); color: var(--soft); }
  .note {
    background: var(--bg);
    color: var(--soft);
    font-size: 11px;
    line-height: 14px;
    margin-left: var(--label);
    padding-bottom: 4px;
    position: relative;
    width: fit-content;
  }
  .foot {
    align-items: center;
    border-top: 1px solid var(--rail);
    color: var(--soft);
    display: flex;
    flex: none;
    flex-wrap: wrap;
    font-size: 12px;
    gap: 4px 12px;
    padding: 8px 16px 10px;
  }
  .key { align-items: center; display: inline-flex; gap: 5px; }
  .chip { border-radius: 50%; box-sizing: border-box; display: inline-block; height: 14px; width: 14px; }
  .chip.area {
    background: repeating-linear-gradient(135deg, var(--soft) 0 2px, transparent 2px 5px);
    border-radius: 3px;
  }
  .chip.scheduled { border: 2px dashed var(--soft); }
  .updated { margin-left: auto; }
  @container (max-width: ${NARROW_CARD}px) {
    .chart { --label: ${NARROW_LABEL_WIDTH}px; --lane: 44px; --shift: 11px; }
    .who { align-items: flex-start; flex-direction: column; gap: 2px; }
    .destination { font-size: 11px; line-height: 13px; max-width: 62px; }
  }
`;

const messageHtml = (text) => `<div class="message">${text}</div>`;
const NO_STOPS = messageHtml("請在卡片設定加入站點 / Add stops in the card settings");
const LOADING = messageHtml("載入中…");
const FAILED = messageHtml("無法取得班次，稍後會自動重試");
const NO_BUSES = messageHtml("暫無班次");

const share = (minutes, config) => (Math.min(minutes, config.max_minutes) / config.max_minutes) * 100;

// Earlier buses stack on top, because they are the ones that matter when two touch.
const dotHtml = ({ minutes, scheduled, status, row }, index, operator, config) => {
  const classes = [
    "dot",
    operator,
    status,
    ...(scheduled ? ["scheduled"] : []),
    ...(row ? [row] : []),
  ].join(" ");
  return `<span class="${classes}" style="left:${share(minutes, config)}%;z-index:${20 - index}">${minutes}</span>`;
};

// The minutes one dot spans on this card. Zero while the card has no width yet.
function dotGap(cardWidth, { max_minutes: max }) {
  const label = cardWidth <= NARROW_CARD ? NARROW_LABEL_WIDTH : LABEL_WIDTH;
  const track = cardWidth - PAD_LEFT - PAD_RIGHT - label;
  return track > 0 ? (DOT_SPACING / track) * max : 0;
}

const laneHtml = ({ operator, route, destination, departures, notes }, config, gap) => `
  <div class="lane">
    <div class="who">
      <span class="plate ${operator}">${escapeHtml(route)}</span>
      <span class="destination">${escapeHtml(destination)}</span>
    </div>
    <div class="track">
      <span class="rail"></span>
      ${staggerDepartures(departures, gap)
        .map((item, index) => dotHtml(item, index, operator, config))
        .join("")}
    </div>
  </div>
  ${notes.map((note) => `<div class="note">${escapeHtml(note)}</div>`).join("")}`;

const groupHtml = ({ name, lanes }, config, gap) => `
  <section>
    <h3 class="stop">${escapeHtml(name)}</h3>
    ${lanes.map((lane) => laneHtml(lane, config, gap)).join("")}
  </section>`;

// The width is the track's share of the chart once the padding and label column are gone.
function bandHtml({ leave_minutes: leave, max_minutes: max }) {
  if (leave === 0) return "";
  const ratio = Math.min(leave, max) / max;
  const track = "100% - var(--pad-left) - var(--pad-right) - var(--label)";
  return `<div class="band" style="width:calc((${track}) * ${ratio})"></div>`;
}

const tickHtml = (minutes, config, kind = "") =>
  `<span class="tick ${kind}" style="left:${share(minutes, config)}%">${minutes}</span>`;

function axisHtml(config) {
  const { leave_minutes: leave, max_minutes: max } = config;
  const ticks = axisTicks(max);
  // A label of its own only where it won't sit on top of 現在 or a round minute.
  const clear = leave > 2 && leave < max && ticks.every((tick) => Math.abs(tick - leave) > 1);
  return `
    <div class="axis">
      <span></span>
      <div class="scale">
        <span class="tick now" style="left:0">現在</span>
        ${clear ? tickHtml(leave, config, "leave") : ""}
        ${ticks.map((tick) => tickHtml(tick, config)).join("")}
      </div>
    </div>`;
}

const chartHtml = (groups, config, gap) =>
  bandHtml(config) + axisHtml(config) + groups.map((group) => groupHtml(group, config, gap)).join("");

const clock = (date) =>
  date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function failureHtml({ failures, allFailed }) {
  if (failures.length === 0) return "";
  if (allFailed) return "更新失敗";
  const names = new Set(failures.map(({ stop }) => stop || "部分站點"));
  return `${escapeHtml([...names].join("、"))} 更新失敗`;
}

function footHtml({ leave_minutes: leave }, updated, problem) {
  const area = leave ? `<span class="key"><span class="chip area"></span>${leave} 分鐘內未必趕到</span>` : "";
  const status = [
    ...(updated ? [`更新於 ${clock(updated)}`] : []),
    ...(problem ? [problem] : []),
  ].join("，");
  return `${area}<span class="key"><span class="chip scheduled"></span>原定班次</span>
    <span class="updated">${status}</span>`;
}

class BusetaCard extends HTMLElement {
  #config;
  #chart;
  #foot;
  #timer;
  #connected = false;
  #updated;
  #running;
  #memory = new Map();
  #onVisibility = () => {
    if (this.#config.stops.length === 0) return;
    if (document.hidden) this.#stop();
    else this.#poll();
  };

  static getStubConfig() {
    return { stops: [] };
  }

  static async getConfigElement() {
    await import(`./buseta-editor.js${version}`);
    return document.createElement("buseta-card-editor");
  }

  setConfig(config) {
    this.#config = validateConfig(config);
    this.#updated = undefined;
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const header = config.title ? ` header="${escapeHtml(config.title)}"` : "";
    root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="scheme-${this.#config.color_scheme}"${header}>
        <div class="scroll"><div class="chart"></div></div>
        <div class="foot"></div>
      </ha-card>`;
    this.#chart = root.querySelector(".chart");
    this.#foot = root.querySelector(".foot");
    if (this.#connected) this.#start();
  }

  connectedCallback() {
    this.#connected = true;
    document.addEventListener("visibilitychange", this.#onVisibility);
    this.#start();
  }

  disconnectedCallback() {
    this.#connected = false;
    document.removeEventListener("visibilitychange", this.#onVisibility);
    this.#stop();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: "full", rows: 8 };
  }

  #start() {
    this.#stop();
    if (this.#config.stops.length === 0) {
      this.#chart.innerHTML = NO_STOPS;
      return;
    }
    this.#chart.innerHTML = LOADING;
    this.#poll();
  }

  #poll() {
    this.#stop();
    if (document.hidden) return;
    this.#refresh();
    this.#timer = setInterval(() => this.#refresh(), this.#config.refresh_seconds * 1000);
  }

  #stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #show(result) {
    const config = this.#config;
    const groups = groupRows(result.rows, config);
    const gap = dotGap(this.#chart.clientWidth, config);
    const empty = result.allFailed ? FAILED : NO_BUSES;
    this.#chart.innerHTML = groups.length ? chartHtml(groups, config, gap) : empty;
    if (!result.allFailed) this.#updated = new Date();
    this.#foot.innerHTML = footHtml(config, this.#updated, failureHtml(result));
  }

  #showFailure() {
    if (!this.#updated) this.#chart.innerHTML = FAILED;
    this.#foot.innerHTML = footHtml(this.#config, this.#updated, "更新失敗");
  }

  async #refresh() {
    const config = this.#config;
    if (this.#running === config) return;
    this.#running = config;
    try {
      const result = await fetchRows(config, { memory: this.#memory });
      for (const { error } of result.failures) console.error("無法獲取巴士數據：", error);
      if (config === this.#config) this.#show(result);
    } catch (error) {
      console.error("無法獲取巴士數據：", error);
      if (config === this.#config) this.#showFailure();
    } finally {
      if (this.#running === config) this.#running = undefined;
    }
  }
}

if (!customElements.get("buseta-card")) {
  customElements.define("buseta-card", BusetaCard);
  window.customCards = window.customCards ?? [];
  window.customCards.push({
    type: "buseta-card",
    name: "Bus ETA / 巴士到站",
    description: "Hong Kong KMB and Citybus arrivals / 香港九巴、城巴預計到站時間",
  });
}
