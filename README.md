# buseta

[中文](#中文) | [English](#english)

## 中文

在 Home Assistant dashboard 上顯示香港巴士預計到站時間的看板，支援九巴（KMB）和城巴（Citybus）。

資料來自政府開放數據 API，由瀏覽器直接讀取，不需要 API key、整合或背景服務。

### 安裝

1. 複製範例設定，並填入你的站點：

   ```bash
   cp www/config.example.json www/config.json
   ```

2. 部署到 Home Assistant：

   ```bash
   ./deploy.sh <ssh-host>
   ```

   沒有 SSH 的話，把 `www/` 內的檔案複製到 `/config/www/buseta/` 即可。

3. 在 dashboard 加入 iframe 卡片，內容見 `examples/lovelace-card.yaml`。

### 設定（`www/config.json`）

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `refresh_seconds` | 更新間隔（秒） | `30` |
| `max_minutes` | 只顯示此分鐘數內到站的班次 | `30` |
| `stops` | 要顯示的站點 | 必填 |
| `exclude` | 要隱藏的班次規則 | `[]` |

`stops` 每項的欄位：

| 欄位 | 說明 |
|------|------|
| `operator` | `kmb` 或 `ctb` |
| `stop_id` | 營運商的站點 ID |
| `name` | 看板顯示的站名 |
| `routes` | 城巴必填：要查詢的路線；九巴會自動取得該站所有路線 |

`exclude` 每項可使用 `operator`、`stop`（對應 `name`）、`route`、`dir`（`I`／`O`）、`destination`。一條規則內的欄位要全部相符才會隱藏該班次。

### 查找站點 ID

- 九巴：`https://data.etabus.gov.hk/v1/transport/kmb/stop` 列出全部站點，以 `name_tc` 搜尋。
- 城巴：`https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/<路線>/inbound`（或 `outbound`）列出路線上的站點 ID，再用 `https://rt.data.gov.hk/v2/transport/citybus/stop/<站點 ID>` 確認站名。

### 私隱

`www/config.json` 已列入 `.gitignore`，因為你常用的站點會透露住處。另外 `/config/www/` 的檔案經 `/local/` 提供時**不需登入**，所以若 Home Assistant 對外開放，知道網址的人可以讀到此檔。

### 開發

```bash
npm test
```

只需 Node.js 22 或以上，沒有其他依賴。

後續工作見 [IMPROVEMENTS.md](IMPROVEMENTS.md)。

---

## English

A Hong Kong bus arrival board for Home Assistant dashboards, covering KMB and Citybus.

Data comes from the government's open data APIs and is read directly by the browser. It needs no API key, integration or background service.

### Install

1. Copy the example config and fill in your stops:

   ```bash
   cp www/config.example.json www/config.json
   ```

2. Deploy to Home Assistant:

   ```bash
   ./deploy.sh <ssh-host>
   ```

   Without SSH, copy the files in `www/` to `/config/www/buseta/`.

3. Add an iframe card to your dashboard, as shown in `examples/lovelace-card.yaml`.

### Configuration (`www/config.json`)

| Field | Meaning | Default |
|-------|---------|---------|
| `refresh_seconds` | Refresh interval in seconds | `30` |
| `max_minutes` | Only show buses arriving within this many minutes | `30` |
| `stops` | Stops to display | Required |
| `exclude` | Rules for buses to hide | `[]` |

Fields for each entry in `stops`:

| Field | Meaning |
|-------|---------|
| `operator` | `kmb` or `ctb` |
| `stop_id` | The operator's stop ID |
| `name` | Stop name shown on the board |
| `routes` | Required for Citybus: routes to query. KMB returns every route at the stop |

Each `exclude` entry can use `operator`, `stop` (matches `name`), `route`, `dir` (`I` or `O`) and `destination`. A bus is hidden only when every field in the rule matches.

### Finding stop IDs

- KMB: `https://data.etabus.gov.hk/v1/transport/kmb/stop` lists every stop. Search by `name_tc`.
- Citybus: `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/<route>/inbound` (or `outbound`) lists the stop IDs on a route. Confirm a name with `https://rt.data.gov.hk/v2/transport/citybus/stop/<stop-id>`.

### Privacy

`www/config.json` is in `.gitignore` because your usual stops reveal where you live. Files under `/config/www/` are served through `/local/` **without authentication**, so if your Home Assistant is reachable from the internet, anyone who knows the URL can read this file.

### Development

```bash
npm test
```

Requires Node.js 22 or later, with no other dependencies.

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for planned work.
