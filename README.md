# buseta

[中文](#中文) | [English](#english)

## 中文

Home Assistant 的 Lovelace 卡片，以時間軸顯示香港巴士預計到站時間，支援九巴（KMB）和城巴（Citybus）。卡片會標示出門來不及的班次，並提供四款配色。

資料來自政府開放數據 API，由瀏覽器直接讀取，不需要 API key、整合或背景服務。

### 安裝

1. 部署卡片：

   ```bash
   ./deploy.sh <ssh-host>
   ```

   指令最後會印出資源網址。沒有 SSH 的話，把 `www/` 內的四個 `.js` 檔複製到 `/config/www/buseta/`，資源網址就是 `/local/buseta/buseta-card.js`。

2. 加入資源：到「設定 → 儀表板 → 右上角選單 → 資源」新增上述網址，類型選「JavaScript 模組」。

3. 在 dashboard 新增卡片，搜尋「Bus ETA」。編輯視窗可以用圖形介面設定，不用查站點 ID：

   - **加入路線：** 九巴和城巴步驟相同：選營運商，輸入路線號，選方向，再按站牌加入。只有一個方向的路線（例如循環線）會跳過選方向。清單上方會標示離 HA 家中位置最近的站牌。
   - **只顯示所選方向：** 總站常由來回兩個方向共用，卡片只顯示你選的方向。兩個方向都要看的話，就各加一次。
   - **一個方向有多個目的地：** 九巴部分路線同一方向有不同目的地，會分開列出，所以這類循環線也要選一次。
   - **已加入的站點：** 九巴和城巴分開列出，依路線、方向、站牌排列。
   - **隱藏班次：** 沒有寫方向的舊設定，可按「選擇顯示的班次」，取消勾選不想看的路線和目的地。

   - **出門時間：** 這段時間內到站的班次會顯示為空心圓點，表示未必趕到；第一班趕得及的圓點會加大。填 `0` 可關閉。
   - **配色：** 「跟隨主題」（九巴紅、城巴黃）和「墨色」跟隨 HA 淺色或深色主題；「車頭牌」和「冰室」使用固定底色。
   - **卡片寬度和高度：** 「區段」版面每個區段 12 欄，每行約 64 像素，與 HA「佈局」分頁修改同一組數值。寬度留空即全寬。路線放不下時，卡片內可捲動，時間刻度固定在頂部。

   喜歡寫 YAML 的話，按編輯視窗左下角的「使用文字編輯器」，內容見 `examples/lovelace-card.yaml`。兩者讀寫同一份設定。

### 看懂時間軸

- 同一站的路線放在一起，每條路線加目的地佔一條軌道，按路線號排列，不會因班次而改變位置。
- 該段時間內沒有班次的路線不會顯示。
- 實心圓點是實時班次，虛線圓點是營運商標明的「原定班次」，空心圓點在出門時間內。
- 底部顯示最後更新時間；更新失敗時會顯示「更新失敗」，並保留上次的班次。

更新版本後，把資源網址的 `?v=` 改為 `deploy.sh` 印出的新值，瀏覽器才會載入新版。

### 圖形介面的限制

- 第一次查詢九巴路線時會下載路線清單（約 350 KB），選方向後再下載全站清單（約 1.2 MB），每次開啟編輯視窗最多各一次。九巴的服務曾在短時間多次下載後拒絕全站清單（HTTP 403），這時無法選站牌，請稍後重試或改用 YAML。到站顯示不受影響。
- 不能按站名搜尋，要先輸入路線號。
- 「選擇顯示的班次」的選項來自該站的即時資料。收車後或暫停服務的路線可能不會列出；已隱藏的班次則一定會列出。
- 介面暫時只有繁體中文。
- 卡片寬度和高度只在「區段」版面生效，舊式版面由 HA 決定大小。

### 設定（卡片 YAML）

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `title` | 卡片標題 | 無 |
| `refresh_seconds` | 更新間隔（秒） | `30` |
| `max_minutes` | 只顯示此分鐘數內到站的班次，也是時間軸的長度 | `30` |
| `leave_minutes` | 出門時間（分鐘），`0` 為關閉 | `5` |
| `color_scheme` | 配色：`auto`、`mono`、`led`、`icehouse` | `auto` |
| `grid_options` | HA 的卡片大小設定：`columns`（欄）和 `rows`（行） | 全寬、8 行 |
| `stops` | 要顯示的站點 | 必填 |
| `exclude` | 要隱藏的班次規則 | `[]` |

`stops` 每項的欄位：

| 欄位 | 說明 |
|------|------|
| `operator` | `kmb` 或 `ctb` |
| `stop_id` | 營運商的站點 ID。純數字的 ID 要加引號，例如 `"002403"` |
| `routes` | 要顯示的路線，城巴必填。九巴不寫時顯示該站所有路線 |

`routes` 每項可以只寫路線號，也可以寫成物件：

| 欄位 | 說明 |
|------|------|
| `route` | 路線號 |
| `dir` | `I` 或 `O`。不寫時顯示兩個方向 |
| `service_type` | 九巴專用：同一方向有多個目的地時，指定其中一個 |
| `label` | 編輯器顯示的方向文字，不影響卡片顯示的班次 |

站名一律即時取自營運商，不存於設定，九巴站名後的站牌代碼（例如 `(WT916)`）不會顯示。每個站只查一次；查詢失敗時站名暫時留空，到站時間不受影響，下次更新再試。

`exclude` 每項可使用 `operator`、`stop_id`、`route`、`dir`（`I`／`O`）、`destination`。一條規則內的欄位要全部相符才會隱藏該班次。

### 重複班次

九巴會為同一班車的每個 `service_type` 各回傳一筆。同站、同路線、同方向而且 ETA 相同的班次只顯示一個圓點，並保留 `service_type` 最小的一筆。

`routes` 和 `exclude` 都先於去重執行。如果想顯示另一個目的地，用 `routes` 的 `service_type` 指定，或用 `exclude` 隱藏不要的一筆。

### 查找站點 ID

- 九巴：`https://data.etabus.gov.hk/v1/transport/kmb/stop` 列出全部站點，以 `name_tc` 搜尋。
- 城巴：`https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/<路線>/inbound`（或 `outbound`）列出路線上的站點 ID，再用 `https://rt.data.gov.hk/v2/transport/citybus/stop/<站點 ID>` 確認站名。

### 私隱

站點只存於 dashboard 設定，要登入才能讀取。部署到 `/config/www/` 的只有卡片程式，不含個人資料。

### 開發

```bash
npm test
```

只需 Node.js 22 或以上，沒有其他依賴。

後續工作見 [IMPROVEMENTS.md](IMPROVEMENTS.md)。

### 授權

[MIT](LICENSE)

---

## English

A Lovelace card for Home Assistant that shows Hong Kong bus arrivals on a time axis. It covers KMB and Citybus, marks buses you may be too late for, and comes in four color schemes.

Data comes from the government's open data APIs and is read directly by the browser. It needs no API key, integration or background service.

### Install

1. Deploy the card:

   ```bash
   ./deploy.sh <ssh-host>
   ```

   The command ends by printing the resource URL. Without SSH, copy the four `.js` files in `www/` to `/config/www/buseta/`. The resource URL is then `/local/buseta/buseta-card.js`.

2. Add the resource: go to Settings → Dashboards → top-right menu → Resources, add that URL, and choose JavaScript module.

3. Add a card to your dashboard and search for "Bus ETA". The edit dialog has a visual editor, so you don't need stop IDs:

   - **Adding a route:** KMB and Citybus work the same way: choose the operator, enter a route number, choose a direction, then select a stop to add it. Routes with only one direction, such as circular routes, skip the direction step. The stop nearest your HA home location is marked above the list.
   - **Only the chosen direction appears:** Both directions of a route often share a terminus, so the card shows only the one you chose. To see both, add each one.
   - **Several destinations in one direction:** Some KMB routes have different destinations in the same direction. They are listed separately, so you also choose one for these circular routes.
   - **Added stops:** KMB and Citybus are listed separately, in route, direction, then stop order.
   - **Hiding buses:** For older entries with no direction, select 「選擇顯示的班次」 and untick the routes and destinations you don't want.

   - **Leaving time:** Buses arriving within this time appear as hollow dots, because you may not make them. The first bus you can catch gets a larger dot. Enter `0` to turn this off.
   - **Color scheme:** 「跟隨主題」 (KMB red and Citybus yellow) and 「墨色」 follow your HA light or dark theme. 「車頭牌」 and 「冰室」 use a fixed background.
   - **Card width and height:** In the Sections layout, each section has 12 columns and each row is about 64 pixels. These are the same values as HA's Layout tab. Leave the width blank for full width. When routes don't fit, the card scrolls and the time scale stays at the top.

   To write YAML instead, select the text editor option at the bottom left of the dialog. See `examples/lovelace-card.yaml`. Both read and write the same config.

### Reading the time axis

- Routes at the same stop are grouped. Each route and destination has its own track, ordered by route number, so tracks don't move as buses come and go.
- Routes with no bus in the time shown don't appear.
- A solid dot is a live departure, a dashed dot is one the operator marks as scheduled (「原定班次」), and a hollow dot is inside your leaving time.
- The footer shows the last update time. If an update fails, it shows 「更新失敗」 and keeps the last buses on screen.

After an update, change the `?v=` in the resource URL to the new value printed by `deploy.sh`, so browsers load the new version.

### Visual editor limits

- The first KMB route lookup downloads the route list (about 350 KB). Choosing a direction then downloads the full stop list (about 1.2 MB). Each is downloaded at most once per edit dialog. KMB has refused the stop list (HTTP 403) after many downloads in a short time. You then can't choose a stop, so try again later or use YAML. Arrival times are not affected.
- You can't search by stop name, so enter a route number first.
- The options under 「選擇顯示的班次」 come from the stop's live data. Routes that have finished for the day or are suspended may be missing. Buses you have hidden are always listed.
- The editor is in Traditional Chinese only for now.
- Card width and height only apply in the Sections layout. In older layouts, HA decides the size.

### Configuration (card YAML)

| Field | Meaning | Default |
|-------|---------|---------|
| `title` | Card title | None |
| `refresh_seconds` | Refresh interval in seconds | `30` |
| `max_minutes` | Only show buses arriving within this many minutes. Also the length of the time axis | `30` |
| `leave_minutes` | Leaving time in minutes. `0` turns it off | `5` |
| `color_scheme` | Color scheme: `auto`, `mono`, `led` or `icehouse` | `auto` |
| `grid_options` | HA's card size: `columns` and `rows` | Full width, 8 rows |
| `stops` | Stops to display | Required |
| `exclude` | Rules for buses to hide | `[]` |

Fields for each entry in `stops`:

| Field | Meaning |
|-------|---------|
| `operator` | `kmb` or `ctb` |
| `stop_id` | The operator's stop ID. Put all-digit IDs in quotes, such as `"002403"` |
| `routes` | Routes to show. Required for Citybus. Without it, a KMB stop shows every route |

Each entry in `routes` is a route number or an object:

| Field | Meaning |
|-------|---------|
| `route` | Route number |
| `dir` | `I` or `O`. Without it, both directions appear |
| `service_type` | KMB only: picks one destination when a direction has several |
| `label` | Direction text for the editor. It doesn't change which buses appear |

Stop names always come live from the operator and aren't stored in the config. The stop code after a KMB name, such as `(WT916)`, isn't shown. Each stop is looked up once. If a lookup fails, the stop name stays blank until the next refresh, and arrival times are not affected.

Each `exclude` entry can use `operator`, `stop_id`, `route`, `dir` (`I` or `O`) and `destination`. A bus is hidden only when every field in the rule matches.

### Duplicate departures

KMB returns a departure once for each `service_type`. Departures with the same stop, route, direction and ETA appear as one dot, keeping the lowest `service_type`.

`routes` and `exclude` both run before this step. To show the other destination, set `service_type` in `routes`, or hide the one you don't want with `exclude`.

### Finding stop IDs

- KMB: `https://data.etabus.gov.hk/v1/transport/kmb/stop` lists every stop. Search by `name_tc`.
- Citybus: `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/<route>/inbound` (or `outbound`) lists the stop IDs on a route. Confirm a name with `https://rt.data.gov.hk/v2/transport/citybus/stop/<stop-id>`.

### Privacy

Your stops are stored only in the dashboard config, which requires a login to read. Only the card's code is deployed to `/config/www/`, and it holds no personal data.

### Development

```bash
npm test
```

Requires Node.js 22 or later, with no other dependencies.

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for planned work.

### License

[MIT](LICENSE)
