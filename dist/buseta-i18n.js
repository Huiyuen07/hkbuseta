// Text shown by the card and its editor. Keys match the operators' field suffixes
// (`dest_tc`, `name_sc`, `rmk_en`), so the same key picks the language of API text too.

export const LANGUAGES = {
  tc: { name: "繁體中文", tag: "zh-HK" },
  sc: { name: "简体中文", tag: "zh-CN" },
  en: { name: "English", tag: "en" },
};

const STRINGS = {
  tc: {
    operators: { kmb: "九巴", ctb: "城巴" },
    schemes: { auto: "跟隨主題", mono: "墨色", led: "車頭牌", icehouse: "冰室" },
    // Card
    noStops: "請在卡片設定加入站點",
    loading: "載入中…",
    failed: "無法取得班次，稍後會自動重試",
    noBuses: "暫無班次",
    now: "現在",
    mayMiss: (minutes) => `${minutes} 分鐘內未必趕到`,
    scheduled: "原定班次",
    updated: (time) => `更新於 ${time}`,
    updateFailed: "更新失敗",
    someStops: "部分站點",
    stopsFailed: (names) => `${names} 更新失敗`,
    listSeparator: "、",
    statusSeparator: "，",
    // Route and direction labels
    towards: (place) => `往 ${place}`,
    from: (place) => `（由 ${place} 開出）`,
    allDirections: "全部方向",
    allRoutes: "全部路線",
    // Editor
    basics: "基本設定",
    language: "語言 / Language",
    followHa: "跟隨 Home Assistant",
    title: "標題",
    refresh: (minimum) => `更新間隔（秒，最少 ${minimum}）`,
    maxMinutes: "顯示多少分鐘內的班次",
    leave: "出門時間（分鐘，0 為關閉）",
    scheme: "配色",
    width: "卡片寬度（欄，留空為全寬）",
    fullWidth: "全寬",
    height: (minimum) => `卡片高度（行，最少 ${minimum}）`,
    sizeHint: "每個區段 12 欄，每行約 64 像素。只在「區段」版面的 dashboard 生效。",
    addedStops: "已加入的站點",
    addRoute: "加入路線",
    operator: "營運商",
    loadingBuses: "載入班次中…",
    noBusData: "暫無班次資料。收車後部分路線不會列出，請稍後再試。",
    untickToHide: "取消勾選即隱藏。同一班車有兩個目的地時，只會顯示一個。",
    remove: "移除",
    chooseBuses: (stop) => `${stop}：選擇顯示的班次`,
    noStopsYet: "尚未加入站點，請在下方輸入路線。",
    route: "路線",
    routeExample: "路線，例如 1A",
    search: "查詢",
    added: (what) => `已加入 ${what}`,
    chooseDirection: "選擇方向",
    alreadyAdded: "已加入",
    add: "加入",
    nearest: (distance) => `離家最近 ${distance}`,
    metres: (metres) => `${metres} 米`,
    kilometres: (kilometres) => `${kilometres} 公里`,
    missingStops: (count) => `有 ${count} 個站牌未能載入，清單可能不完整，請稍後再查詢一次。`,
    pickStop: (route, direction) => `按站牌加入路線 ${route} ${direction}。`,
    noSuchRoute: (operator, route) => `${operator}沒有路線 ${route}`,
    routeFailed: "無法載入路線，請稍後再試。",
    stopListFailed:
      "暫時無法載入站牌，請稍後再查詢一次。也可以按編輯視窗左下角的「使用文字編輯器」，直接填入 stop_id。",
    busesFailed: "無法載入班次，請稍後再試。",
  },
  sc: {
    operators: { kmb: "九巴", ctb: "城巴" },
    schemes: { auto: "跟随主题", mono: "墨色", led: "车头牌", icehouse: "冰室" },
    noStops: "请在卡片设置中添加站点",
    loading: "加载中…",
    failed: "无法获取班次，稍后会自动重试",
    noBuses: "暂无班次",
    now: "现在",
    mayMiss: (minutes) => `${minutes} 分钟内未必赶上`,
    scheduled: "原定班次",
    updated: (time) => `更新于 ${time}`,
    updateFailed: "更新失败",
    someStops: "部分站点",
    stopsFailed: (names) => `${names} 更新失败`,
    listSeparator: "、",
    statusSeparator: "，",
    towards: (place) => `往 ${place}`,
    from: (place) => `（由 ${place} 开出）`,
    allDirections: "全部方向",
    allRoutes: "全部路线",
    basics: "基本设置",
    language: "语言 / Language",
    followHa: "跟随 Home Assistant",
    title: "标题",
    refresh: (minimum) => `更新间隔（秒，最少 ${minimum}）`,
    maxMinutes: "显示多少分钟内的班次",
    leave: "出门时间（分钟，0 为关闭）",
    scheme: "配色",
    width: "卡片宽度（列，留空为全宽）",
    fullWidth: "全宽",
    height: (minimum) => `卡片高度（行，最少 ${minimum}）`,
    sizeHint: "每个区段 12 列，每行约 64 像素。只在「区段」布局的仪表板生效。",
    addedStops: "已添加的站点",
    addRoute: "添加路线",
    operator: "营运商",
    loadingBuses: "加载班次中…",
    noBusData: "暂无班次数据。收车后部分路线不会列出，请稍后再试。",
    untickToHide: "取消勾选即隐藏。同一班车有两个目的地时，只会显示一个。",
    remove: "移除",
    chooseBuses: (stop) => `${stop}：选择显示的班次`,
    noStopsYet: "尚未添加站点，请在下方输入路线。",
    route: "路线",
    routeExample: "路线，例如 1A",
    search: "查询",
    added: (what) => `已添加 ${what}`,
    chooseDirection: "选择方向",
    alreadyAdded: "已添加",
    add: "添加",
    nearest: (distance) => `离家最近 ${distance}`,
    metres: (metres) => `${metres} 米`,
    kilometres: (kilometres) => `${kilometres} 公里`,
    missingStops: (count) => `有 ${count} 个站牌未能加载，列表可能不完整，请稍后再查询一次。`,
    pickStop: (route, direction) => `按站牌添加路线 ${route} ${direction}。`,
    noSuchRoute: (operator, route) => `${operator}没有路线 ${route}`,
    routeFailed: "无法加载路线，请稍后再试。",
    stopListFailed:
      "暂时无法加载站牌，请稍后再查询一次。也可以改用编辑窗口左下角的代码编辑器，直接填入 stop_id。",
    busesFailed: "无法加载班次，请稍后再试。",
  },
  en: {
    operators: { kmb: "KMB", ctb: "Citybus" },
    schemes: { auto: "Follow theme", mono: "Ink", led: "LED sign", icehouse: "Cha chaan teng" },
    noStops: "Add stops in the card settings",
    loading: "Loading…",
    failed: "Couldn't fetch buses. Retrying shortly.",
    noBuses: "No buses",
    now: "Now",
    mayMiss: (minutes) => `May miss within ${minutes} min`,
    scheduled: "Scheduled",
    updated: (time) => `Updated ${time}`,
    updateFailed: "Update failed",
    someStops: "Some stops",
    stopsFailed: (names) => `${names} failed to update`,
    listSeparator: ", ",
    statusSeparator: " · ",
    towards: (place) => `To ${place}`,
    from: (place) => ` (from ${place})`,
    allDirections: "All directions",
    allRoutes: "All routes",
    basics: "Basics",
    language: "Language / 語言",
    followHa: "Follow Home Assistant",
    title: "Title",
    refresh: (minimum) => `Refresh every (seconds, at least ${minimum})`,
    maxMinutes: "Show buses within (minutes)",
    leave: "Leaving time (minutes, 0 turns it off)",
    scheme: "Colors",
    width: "Card width (columns, blank for full width)",
    fullWidth: "Full width",
    height: (minimum) => `Card height (rows, at least ${minimum})`,
    sizeHint:
      "A section is 12 columns wide and a row is about 64 pixels. Only applies to dashboards with the Sections layout.",
    addedStops: "Added stops",
    addRoute: "Add a route",
    operator: "Operator",
    loadingBuses: "Loading buses…",
    noBusData: "No bus data yet. Some routes aren't listed after service ends, so try again later.",
    untickToHide: "Untick to hide. When one bus has two destinations, only one is shown.",
    remove: "Remove",
    chooseBuses: (stop) => `${stop}: choose buses to show`,
    noStopsYet: "No stops yet. Enter a route below.",
    route: "Route",
    routeExample: "Route, such as 1A",
    search: "Search",
    added: (what) => `Added ${what}`,
    chooseDirection: "Choose a direction",
    alreadyAdded: "Added",
    add: "Add",
    nearest: (distance) => `Nearest to home, ${distance}`,
    metres: (metres) => `${metres} m`,
    kilometres: (kilometres) => `${kilometres} km`,
    missingStops: (count) =>
      `${count} stops couldn't be loaded, so the list may be incomplete. Search again later.`,
    pickStop: (route, direction) => `Choose a stop to add route ${route} ${direction}.`,
    noSuchRoute: (operator, route) => `${operator} has no route ${route}`,
    routeFailed: "Couldn't load the route. Try again later.",
    stopListFailed:
      "Couldn't load the stops. Search again later, or open the code editor at the bottom left of the dialog and enter the stop_id.",
    busesFailed: "Couldn't load buses. Try again later.",
  },
};

export const DEFAULT_LANGUAGE = "tc";

// `auto` follows the language of the person viewing the dashboard.
export const AUTO = "auto";
export const LANGUAGE_CHOICES = [AUTO, ...Object.keys(LANGUAGES)];

// Maps a BCP 47 tag such as HA's "zh-Hant", "zh-Hans" or "en-GB" to one of LANGUAGES.
// Chinese without a script is taken as Traditional, as written in Hong Kong. Any other
// language gets English, the one of the three most readers of it will know.
export function languageFromTag(tag) {
  const lower = (tag ?? "").toLowerCase();
  if (!lower) return DEFAULT_LANGUAGE;
  if (lower.startsWith("zh")) return /hans|-cn|-sg/.test(lower) ? "sc" : "tc";
  return "en";
}

// The language to show for a saved `language` choice. HA gives the user's language in
// `hass.locale`, and also sets it on <html> before any card has `hass`.
export function resolveLanguage(choice, hass) {
  if (choice !== AUTO) return choice ?? DEFAULT_LANGUAGE;
  const tag =
    hass?.locale?.language ??
    hass?.language ??
    (globalThis.document?.documentElement?.lang || globalThis.navigator?.language);
  return languageFromTag(tag);
}

export const strings = (language) => STRINGS[language] ?? STRINGS[DEFAULT_LANGUAGE];

// An API field in the chosen language, such as `dest_en`, falling back to Traditional Chinese.
export const localText = (record, field, language) =>
  record[`${field}_${language}`] || record[`${field}_tc`];
