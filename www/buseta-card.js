// buseta-card — Lovelace card that shows Hong Kong bus arrivals.

// Passing on the resource's ?v= keeps the other modules in step with the card.
const version = new URL(import.meta.url).search;
const { COLUMNS, escapeHtml, fetchRows, validateConfig } = await import(`./buseta.js${version}`);

const STYLE = `
  ha-card { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .rows { flex: 1; min-height: 0; overflow: auto; }
  table { border-collapse: collapse; color: var(--primary-text-color); width: 100%; }
  th, td { border: 1px solid var(--divider-color); padding: 10px; text-align: center; }
  th {
    background: var(--primary-color);
    color: var(--text-primary-color);
    position: sticky;
    top: 0;
  }
  tbody tr:nth-child(even) { background: var(--secondary-background-color); }
`;

const NO_STOPS = `<tr><td colspan="${COLUMNS.length}">請在卡片設定加入站點 / Add stops in the card settings</td></tr>`;

const rowHtml = (row) =>
  `<tr>${COLUMNS.map(({ field }) => `<td>${escapeHtml(row[field])}</td>`).join("")}</tr>`;

class BusetaCard extends HTMLElement {
  #config;
  #body;
  #timer;
  #connected = false;

  static getStubConfig() {
    return { stops: [] };
  }

  static async getConfigElement() {
    await import(`./buseta-editor.js${version}`);
    return document.createElement("buseta-card-editor");
  }

  setConfig(config) {
    this.#config = validateConfig(config);
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const header = config.title ? ` header="${escapeHtml(config.title)}"` : "";
    const headings = COLUMNS.map(({ label }) => `<th>${label}</th>`).join("");
    root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card${header}>
        <div class="rows">
          <table><thead><tr>${headings}</tr></thead><tbody></tbody></table>
        </div>
      </ha-card>`;
    this.#body = root.querySelector("tbody");
    if (this.#connected) this.#start();
  }

  connectedCallback() {
    this.#connected = true;
    this.#start();
  }

  disconnectedCallback() {
    this.#connected = false;
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
      this.#body.innerHTML = NO_STOPS;
      return;
    }
    this.#refresh();
    this.#timer = setInterval(() => this.#refresh(), this.#config.refresh_seconds * 1000);
  }

  #stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #refresh() {
    const config = this.#config;
    try {
      const rows = await fetchRows(config);
      if (config === this.#config) this.#body.innerHTML = rows.map(rowHtml).join("");
    } catch (error) {
      console.error("無法獲取巴士數據：", error);
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
