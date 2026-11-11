// Főoldal: mérések, grafikonok, időjárás, téma és AI-chat.
// Az adatok az API-ból jönnek, a beállításokat a localStorage őrzi (böngészőnként).
// Az oldal elrejtése nem biztonság, az API-k külön ellenőrzik a belépést.
// Frissítés: a kártyák 30 mp-enként, a grafikonok 5 percenként.
const REFRESH_INTERVAL_MS = 30_000;
const CHART_REFRESH_INTERVAL_MS = 5 * 60_000;

// Az utolsó mérés, hogy az oldal és a chat ugyanazt használja.
// chartFiltered: van-e szűrés a grafikonokon (ettől függ, hogy a PDF-be kerülnek-e a grafikonok).
const state = {
  readings: null,
  lastEntry: null,
  lastChartFetchedAt: null,
  chartFiltered: false,
  chartPeriodLabel: "",
  refreshTimer: null,
  chartRefreshTimer: null
};

// localStorage kulcsok és a megtartott elemek maximális száma.
const ACTIVITY_LOG_KEY = "greenhouse-activity-log";
const ACTIVITY_LOG_LIMIT = 30;
const CHAT_HISTORY_KEY = "greenhouse-chat-history";
const CHAT_HISTORY_LIMIT = 60;
const SENSOR_CACHE_KEY = "greenhouse-last-reading";
// A chat nyitóüzenete, ha még nincs mentett beszélgetés.
const CHAT_GREETING_TEXT = "Szia! A legutóbb betöltött növényházi mérések alapján tudok segíteni. A beszélgetést a gpt-6-luna modell működteti.";

// Mentett beszélgetés beolvasása. Hibás adatnál üres lista jön vissza.
function getSavedChatHistory() {
  try {
    const messages = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    if (!Array.isArray(messages)) return [];

    return messages
      .filter((message) => message && ["user", "bot"].includes(message.type)
        && typeof message.sender === "string" && typeof message.text === "string")
      .slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

// Beszélgetés mentése a chatbuborékokból. A 'Gondolkodom…' üzenetet nem mentjük.
function saveChatHistory() {
  // Csak a felhasználó és az asszisztens üzenetét mentjük.
  const messages = [...$("chatMessages").querySelectorAll(".chat-message")]
    .filter((item) => item.classList.contains("user-message") || item.classList.contains("bot-message"))
    .map((item) => ({
      type: item.classList.contains("user-message") ? "user" : "bot",
      sender: item.querySelector("strong")?.textContent || "",
      text: item.querySelector("p")?.textContent || ""
    }))
    .filter((message) => message.text && message.text !== "Gondolkodom…")
    .slice(-CHAT_HISTORY_LIMIT);

  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages));
  } catch {
    // Ha a böngésző nem engedi a tárolást, a chat attól még működik.
  }
}

// Korábbi beszélgetés visszatöltése. Igaz, ha volt mentett üzenet.
function restoreChatHistory() {
  // A false paraméter miatt nem ment újra.
  const messages = getSavedChatHistory();
  messages.forEach(({ sender, text, type }, index) => {
    // A régi nyitóüzenetet is frissítjük, hogy a modell neve látszódjon.
    const greeting = index === 0 && type === "bot" && text === "Szia! A legutóbb betöltött növényházi mérések alapján tudok segíteni."
      ? CHAT_GREETING_TEXT
      : text;
    addChatMessage(sender, greeting, type, false);
  });
  return messages.length > 0;
}

// Induláskor az utoljára mentett mérést mutatjuk, amíg a friss lekérés tart.
function restoreCachedReading() {
  try {
    const entry = JSON.parse(localStorage.getItem(SENSOR_CACHE_KEY) || "null");
    if (entry && typeof entry.created_at === "string") renderReadings(entry, false);
  } catch {
    // Ha nincs mentett adat, a ThingSpeak-lekérés tölti be.
  }
}

// Eseménynapló beolvasása, hibánál üres napló.
function getActivityLog() {
  try {
    const savedEntries = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || "[]");
    return Array.isArray(savedEntries) ? savedEntries : [];
  } catch {
    return [];
  }
}

// Eseménynapló kirajzolása (idő + üzenet). Csak helyi napló.
function renderActivityLog() {
  const list = $("activityLogEntries");
  if (!list) return;

  const entries = getActivityLog();
  list.replaceChildren();
  if (entries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "list-group-item activity-log-empty";
    emptyItem.textContent = "Még nincs rögzített esemény.";
    list.append(emptyItem);
    return;
  }

  const timeFormatter = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = `list-group-item activity-log-entry activity-log-${entry.level || "info"}`;

    const time = document.createElement("time");
    time.dateTime = entry.at;
    time.textContent = timeFormatter.format(new Date(entry.at));

    const message = document.createElement("span");
    message.textContent = entry.message;
    item.append(time, message);
    list.append(item);
  });
}

// Új naplósor, legfeljebb ACTIVITY_LOG_LIMIT darab marad.
// level: 'info', 'success' vagy 'error'.
function addActivityLog(message, level = "info") {
  const entries = getActivityLog();
  entries.unshift({ at: new Date().toISOString(), message, level });
  try {
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(entries.slice(0, ACTIVITY_LOG_LIMIT)));
  } catch {
    // Ha nem lehet menteni, az oldal attól még megy tovább.
  }
  renderActivityLog();
}

// Napló megjelenítése és a törlés gomb bekötése.
function setupActivityLog() {
  renderActivityLog();
  $("clearActivityLogBtn").addEventListener("click", () => {
    localStorage.removeItem(ACTIVITY_LOG_KEY);
    renderActivityLog();
  });
}

// A grafikonok adatai mezőszám szerint (1-8): cím, mértékegység, állapotszövegek.
const CHART_LABELS = {
  1: "Hőmérséklet előzményei",
  2: "Páratartalom előzményei",
  3: "Légnyomás előzményei",
  4: "Megvilágítás előzményei",
  5: "Esőérzékelő előzményei",
  6: "Ventilátor előzményei",
  7: "LED állapota",
  8: "Tetőállapot előzményei"
};

const CHART_UNITS = {
  1: "°C",
  2: "%",
  3: "hPa",
  4: "lux",
  5: "",
  6: "",
  7: "",
  8: ""
};

const CHART_STATE_LABELS = {
  5: { 0: "Nem esik", 1: "Esik" },
  6: { 0: "Ki", 1: "Be" },
  7: { 0: "Ki", 1: "Be" },
  8: { 0: "Zárva", 1: "Nyitva" }
};

// Utoljára betöltött grafikonadat (témaváltáskor ebből rajzolunk újra) és hogy egyéni időszak van-e.
let chartFeedsForResize = null;
let chartCustomRangeActive = false;

// Rövidítés a document.getElementById-ra.
const $ = (id) => document.getElementById(id);

// A felső kártya sorai: key = kód, label = megjelenő név.
const SUMMARY_STORAGE_KEY = "greenhouse-summary-rows";
const SUMMARY_ROWS = [
  { key: "temperature", label: "Hőmérséklet · BME280" },
  { key: "humidity", label: "Páratartalom · BME280" },
  { key: "pressure", label: "Légnyomás · BME280" },
  { key: "light", label: "Megvilágítás · TSL2561" },
  { key: "rain", label: "Esőérzékelő" },
  { key: "fan", label: "Ventilátor" },
  { key: "led", label: "Kiegészítő LED" },
  { key: "roof", label: "Növényház teteje" }
];

const DEFAULT_SUMMARY_ORDER = SUMMARY_ROWS.map((row) => row.key);

// Mérőkártyák listája (át lehet rendezni, el lehet rejteni).
const METRIC_CARDS = [
  { key: "temperature", label: "Hőmérséklet" },
  { key: "humidity", label: "Relatív páratartalom" },
  { key: "pressure", label: "Légnyomás" },
  { key: "light", label: "Megvilágítás" },
  { key: "rain", label: "Esőérzékelő" },
  { key: "fan", label: "Ventilátor" },
  { key: "led", label: "Kiegészítő LED" },
  { key: "roof", label: "Növényház teteje" }
];
const DEFAULT_METRIC_ORDER = METRIC_CARDS.slice(0, 4).map((item) => item.key);
const METRIC_STORAGE_KEY = "greenhouse-metric-cards";
// Grafikon beállítások: melyik mezők látszanak, legfeljebb 8.
const CHART_STORAGE_KEY = "greenhouse-chart-fields";
const DEFAULT_CHART_FIELDS = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_CHART_SLOTS = 8;

// ---------- Grafikon-segédek ----------

// Időpont budapesti időben (a ThingSpeak UTC-t ad).
function formatBudapestTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

// Rövid budapesti időpont az állapotsorokhoz.
function formatCompactBudapestTime(value) {
  if (!value) return "nincs adat";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "nincs adat";

  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

// '2026-09-03T19:33' -> '2026. 09. 03. 19:33' (a PDF-hez).
function formatFullDateTimeInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  return match ? `${match[1]}. ${match[2]}. ${match[3]}. ${match[4]}:${match[5]}` : value;
}

// Dátummező értéke rövid alakra. Regexszel vágjuk szét, mert a new Date() az időzóna miatt eltolhatná az időt.
function formatCompactDateTimeInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  return match ? `${match[3]}.${match[2]}. ${match[4]}:${match[5]}` : value;
}

// Date objektum -> dátummező formátum (ÉÉÉÉ-HH-NNTÓÓ:PP), budapesti idővel.
function formatBudapestDateTimeInput(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value)
    .filter(({ type }) => type !== "literal")
    .map(({ type, value: part }) => [type, part]));

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Sok pontnál ritkítjuk az adatsort, hogy gyors maradjon a grafikon.
// Csoportonként megtartjuk a min. és max. értéket, így a csúcsok nem tűnnek el.
function downsampleReadings(readings, maxPoints = 480) {
  if (readings.length <= maxPoints) {
    return readings.map((reading, index) => ({ ...reading, sourceIndex: index }));
  }

  // Csoportonként a legkisebb és a legnagyobb érték marad.
  const bucketSize = Math.ceil((readings.length - 2) / ((maxPoints - 2) / 2));
  const sampled = [{ ...readings[0], sourceIndex: 0 }];

  for (let start = 1; start < readings.length - 1; start += bucketSize) {
    const end = Math.min(start + bucketSize, readings.length - 1);
    let minimumIndex = start;
    let maximumIndex = start;

    for (let index = start + 1; index < end; index += 1) {
      if (readings[index].value < readings[minimumIndex].value) minimumIndex = index;
      if (readings[index].value > readings[maximumIndex].value) maximumIndex = index;
    }

    [minimumIndex, maximumIndex]
      .sort((left, right) => left - right)
      .forEach((sourceIndex) => {
        if (sampled[sampled.length - 1].sourceIndex !== sourceIndex) {
          sampled.push({ ...readings[sourceIndex], sourceIndex });
        }
      });
  }

  sampled.push({ ...readings.at(-1), sourceIndex: readings.length - 1 });
  return sampled;
}

// ---------- Grafikonok (ApexCharts) ----------

// Az ApexCharts a Tabler csomagjával jön (vendor/tabler/libs/apexcharts).
// A példányokat itt tartjuk, hogy újrarajzolás előtt törölni tudjuk őket.
const apexCharts = new Map();

// Dátumformátum a vízszintes tengelyhez.
const chartAxisDateFormat = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function renderThingSpeakCharts(feeds) {
  chartFeedsForResize = feeds;
  const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
  const textColor = isDark ? "#9aa5b5" : "#667382";

  // Az eltávolított grafikonok példányait töröljük.
  apexCharts.forEach((instance, element) => {
    if (!element.isConnected) {
      instance.destroy();
      apexCharts.delete(element);
    }
  });

  document.querySelectorAll("[data-field-chart]").forEach((chart) => {
    const fieldNumber = chart.dataset.fieldChart;
    const field = "field" + fieldNumber;
    const readings = feeds
      .map((feed) => ({
        value: feed[field] === null || feed[field] === "" ? Number.NaN : Number(feed[field]),
        timestamp: feed.created_at
      }))
      .filter((reading) => Number.isFinite(reading.value) && !Number.isNaN(new Date(reading.timestamp).getTime()));
    const plottedReadings = downsampleReadings(readings);
    const label = CHART_LABELS[fieldNumber] || chart.title;
    const unit = CHART_UNITS[fieldNumber] || "";
    const stateLabels = CHART_STATE_LABELS[fieldNumber];
    const formatChartValue = (value) => {
      if (stateLabels && (value === 0 || value === 1)) return stateLabels[value];
      const formattedValue = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(value);
      return unit ? `${formattedValue} ${unit}` : formattedValue;
    };

    // Régi példány törlése.
    apexCharts.get(chart)?.destroy();
    apexCharts.delete(chart);
    chart.replaceChildren();

    if (!plottedReadings.length) {
      const empty = document.createElement("p");
      empty.className = "text-secondary text-center py-5 mb-0";
      empty.textContent = "Nincs mérési adat";
      chart.append(empty);
      return;
    }

    const latest = formatChartValue(readings.at(-1).value);
    const options = {
      chart: {
        type: "area",
        height: 260,
        fontFamily: "inherit",
        foreColor: textColor,
        parentHeightOffset: 0,
        toolbar: { show: false },
        animations: { enabled: false },
        zoom: { enabled: false }
      },
      series: [{
        name: label,
        data: plottedReadings.map((reading) => ({ x: new Date(reading.timestamp).getTime(), y: reading.value }))
      }],
      title: { text: `${label}${unit ? ` (${unit})` : ""}`, style: { fontSize: "14px", fontWeight: 600 } },
      subtitle: { text: `Legutóbbi: ${latest}` },
      stroke: { curve: stateLabels ? "stepline" : "smooth", width: 2 },
      fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05 } },
      colors: ["#2fb344"],
      dataLabels: { enabled: false },
      grid: { borderColor: isDark ? "#2b3645" : "#e6e7e9", strokeDashArray: 4 },
      xaxis: {
        type: "datetime",
        tooltip: { enabled: false },
        labels: { datetimeUTC: false, formatter: (value) => chartAxisDateFormat.format(new Date(value)) }
      },
      yaxis: {
        ...(stateLabels ? { min: 0, max: 1, tickAmount: 1 } : {}),
        labels: {
          formatter: (value) => stateLabels
            ? (stateLabels[Math.round(value)] ?? "")
            : new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 }).format(value)
        }
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        x: { formatter: (value) => formatBudapestTime(new Date(value)) },
        y: { formatter: (value) => formatChartValue(value) }
      },
      legend: { show: false },
      noData: { text: "Nincs mérési adat" }
    };

    const instance = new ApexCharts(chart, options);
    apexCharts.set(chart, instance);
    instance.render();
  });
}

// ---------- Chat és szenzoradatok ----------

// Új üzenet a chatablakba. textContent-et használunk, így nem fut le a kapott HTML.
// sender = küldő, type = 'user' / 'bot' / 'system', save = mentse-e (visszatöltéskor false).
function addChatMessage(sender, message, type, save = true) {
  const item = document.createElement("article");
  item.className = `chat-message ${type}-message`;
  const heading = document.createElement("strong");
  heading.textContent = sender;
  const body = document.createElement("p");
  body.textContent = message;
  item.append(heading, body);
  $("chatMessages").append(item);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  // Visszatöltésnél nem mentünk, új üzenetnél igen.
  if (save && ["user", "bot"].includes(type)) saveChatHistory();
  return body;
}

// Igaz, ha csak köszönés (pl. 'szia'). Erre fix választ adunk, nem hívjuk az AI-t.
function isSimpleGreeting(message) {
  return /^(szia|helló|hello|üdv|jó napot|jó reggelt|jó estét|szevasz|szervusz|hi|hey)[!.?\s]*$/iu.test(message.trim());
}

// AI válasz tisztítása: a modell néha markdown jeleket (**, #, -) használ, de a buborék sima szöveg.
function cleanAssistantReply(message) {
  return String(message)
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/(^|\n)#{1,6}\s*/g, "$1")
    .replace(/(^|\n)\s*[-*]\s+/g, "$1• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A ThingSpeak szövegként adja a mezőket. Számmá alakítjuk, hiányzó érték = null.
function numericField(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Szám magyar formában (tizedesvessző). Null esetén '—'.
function formatted(value, digits = 0) {
  return value === null ? "—" : new Intl.NumberFormat("hu-HU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

// Kártyán az érték és az egység együtt (pl. 22,5 °C).
function setMetric(id, value, unit, digits = 0) {
  $(id).textContent = value === null ? "—" : `${formatted(value, digits)} ${unit}`;
}

// Mint a setMetric, de itt az egység külön van a HTML-ben.
function setNumber(id, value, digits = 0) {
  $(id).textContent = formatted(value, digits);
}

// Állapotjelző felirata és színe (Tabler badge: zöld = rendben, sárga = figyelmeztetés).
const STATE_BADGE_CLASSES = { on: "bg-green-lt", warning: "bg-yellow-lt", pending: "bg-secondary-lt" };

function setStateBadge(id, label, stateName) {
  const element = $(id);
  element.textContent = label;
  element.className = `badge ${STATE_BADGE_CLASSES[stateName] || STATE_BADGE_CLASSES.pending}`;
}

// A bemutató kapcsoló követi az eszközállapotot, amíg a felhasználó át nem állítja. Csak demó, nem vezérel semmit.
function syncDemoSwitch(id, isOn) {
  const control = $(id);
  if (!control.dataset.previewChanged) control.checked = isOn === true;
}

// ---------- Az irányítópult mérései ----------

// Mérőkártyák, állapotjelzők és kapcsolók frissítése egy ThingSpeak-rekordból.
// 2 percnél régebbi mérés = 'Régi mérés'. Hálózati hiba esetére elmentjük a mérést.
// entry = rekord (field1-8, created_at), saveToCache = mentse-e.
function renderReadings(entry, saveToCache = true) {
  const fields = {
    temperature: numericField(entry.field1),
    humidity: numericField(entry.field2),
    pressure: numericField(entry.field3),
    light: numericField(entry.field4),
    rain: numericField(entry.field5),
    fan: numericField(entry.field6),
    led: numericField(entry.field7),
    roofOpen: numericField(entry.field8)
  };

  state.readings = fields;
  state.lastEntry = entry;
  $("exportPdfBtn").disabled = false;
  $("emailPdfBtn").disabled = false;
  if (saveToCache) {
    try {
      // Hálózati hibánál ezt tudjuk megmutatni.
      localStorage.setItem(SENSOR_CACHE_KEY, JSON.stringify(entry));
    } catch {
      // Ha tele van a tárhely, attól még megjelenik a mérés.
    }
  }

  setNumber("temperatureValue", fields.temperature, 1);
  setNumber("humidityValue", fields.humidity);
  setNumber("pressureValue", fields.pressure, 1);
  setNumber("lightValue", fields.light);
  setMetric("heroTemperature", fields.temperature, "°C", 1);
  setMetric("heroHumidity", fields.humidity, "%");
  setMetric("heroPressure", fields.pressure, "hPa", 1);
  setMetric("heroLight", fields.light, "lux");
  $("metricRainValue").textContent = fields.rain === null ? "—" : fields.rain === 1 ? "Esőt érzékel" : "Nem esik";
  $("metricFanValue").textContent = fields.fan === null ? "—" : fields.fan === 1 ? "Bekapcsolva" : "Kikapcsolva";
  $("metricLedValue").textContent = fields.led === null ? "—" : fields.led === 1 ? "Bekapcsolva" : "Kikapcsolva";
  $("metricRoofValue").textContent = fields.roofOpen === null ? "—" : fields.roofOpen === 1 ? "Nyitva" : "Zárva";

  const raining = fields.rain === null ? null : fields.rain === 1;
  const fanOn = fields.fan === null ? null : fields.fan === 1;
  const ledOn = fields.led === null ? null : fields.led === 1;
  const roofOpen = fields.roofOpen === null ? null : fields.roofOpen === 1;

  $("heroRain").textContent = raining === null ? "—" : raining ? "Észlelve" : "Nem észlelhető";
  $("heroFan").textContent = fanOn === null ? "—" : fanOn ? "Bekapcsolva" : "Kikapcsolva";
  $("heroLed").textContent = ledOn === null ? "—" : ledOn ? "Bekapcsolva" : "Kikapcsolva";
  $("heroRoof").textContent = roofOpen === null ? "—" : roofOpen ? "Nyitva" : "Zárva";
  setStateBadge("rainStatus", raining === null ? "Nincs adat" : raining ? "Esőt érzékel" : "Nem esik", raining === null ? "pending" : raining ? "warning" : "on");
  syncDemoSwitch("fanDemoSwitch", fanOn);
  syncDemoSwitch("ledDemoSwitch", ledOn);
  syncDemoSwitch("roofDemoSwitch", roofOpen);

  const date = entry.created_at ? new Date(entry.created_at) : null;
  const ageSeconds = date && !Number.isNaN(date.valueOf())
    ? Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000))
    : null;
  // 2 percnél régebbi = régi adat.
  const isStale = ageSeconds !== null && ageSeconds > 120;
  $("lastUpdated").textContent = date && !Number.isNaN(date.valueOf())
    ? `Utoljára frissítve: ${date.toLocaleString("hu-HU")}`
    : "A ThingSpeak nem adott meg mérési időpontot.";
  $("connectionStatus").textContent = isStale ? "Régi mérés" : "Kapcsolódva";
  $("connectionStatus").className = `badge ${isStale ? "bg-yellow-lt" : "bg-green-lt"}`;
}

// Utolsó 60 mérés lekérése, az utolsóból frissülnek a kártyák (és a chat adatai).
// quiet = háttérfrissítés, csak új mérésnél írunk üzenetet.
async function loadLatestReadings({ quiet = false } = {}) {
  const button = $("refreshDataBtn");
  if (button) button.disabled = true;
  if (!quiet && !state.lastEntry) $("connectionStatus").textContent = "Kapcsolódás…";
  try {
    const response = await fetch("/api/thingspeak?results=60", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || ("ThingSpeak válasza: " + response.status));
    const feeds = Array.isArray(data.feeds) ? data.feeds : [];
    const entry = feeds.at(-1);
    if (!entry || !entry.created_at) throw new Error("A csatornából nem érkezett mérési adat.");
    const previousMeasurement = state.lastEntry?.created_at;
    renderReadings(entry);
    if (!quiet || entry.created_at !== previousMeasurement) {
      addActivityLog("A ThingSpeak mérési adatai frissültek.", "success");
    }
  } catch (error) {
    $("connectionStatus").textContent = "Nem elérhető";
    $("connectionStatus").className = "badge bg-red-lt";
    if (!state.lastEntry) $("lastUpdated").textContent = "Nem sikerült csatlakozni a ThingSpeak csatornához.";
    if (!quiet) addChatMessage("Rendszer", error.message || "Nem sikerült adatot betölteni a ThingSpeak csatornából.", "system");
    if (!quiet) addActivityLog("Nem sikerült betölteni a legutóbbi szenzoradatokat.", "error");
    console.error("ThingSpeak read failed:", error);
  } finally {
    if (button) button.disabled = false;
  }
}

// Kiválasztott időszak betöltése és a grafikonok újrarajzolása. A szűrő az API-kérésbe kerül.
// Elmentjük, hogy van-e szűrés és mi az időszak szövege (a PDF-hez).
async function loadChartHistory({ quiet = false } = {}) {
  const button = $("refreshChartsBtn");
  const status = $("chartStatus");
  const rangeSelect = $("chartRangeSelect");

  if (button) button.disabled = true;
  if (!quiet) status.textContent = "Grafikonadatok betöltése…";

  try {
    let params;
    let rangeLabel;
    let periodText;
    if (chartCustomRangeActive) {
      const start = $("chartStartDate").value;
      const end = $("chartEndDate").value;
      if (!start || !end || end <= start) {
        throw new Error("Adj meg érvényes kezdő és záró időpontot; a záró időpont legyen későbbi.");
      }
      params = new URLSearchParams({ start, end });
      rangeLabel = `${formatCompactDateTimeInput(start)}–${formatCompactDateTimeInput(end)}`;
      periodText = `${formatFullDateTimeInput(start)} – ${formatFullDateTimeInput(end)}`;
    } else {
      const [rangeType, rangeValue] = rangeSelect.value.split(":");
      params = new URLSearchParams({ [rangeType]: rangeValue });
      rangeLabel = rangeSelect.selectedOptions[0]?.textContent || "kiválasztott időszak";
      periodText = rangeLabel;
    }

    const response = await fetch(`/api/thingspeak?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `ThingSpeak válasza: ${response.status}`);

    const feeds = Array.isArray(data.feeds) ? data.feeds : [];
    renderThingSpeakCharts(feeds);
    // A PDF-hez tároljuk. Alapnézet = utolsó 60 mérés, minden más szűrésnek számít.
    state.chartFiltered = chartCustomRangeActive || rangeSelect.value !== "results:60";
    // A PDF-be a teljes alakú időszak (évvel) kerül.
    state.chartPeriodLabel = `Szűrt időszak: ${periodText} · ${new Intl.NumberFormat("hu-HU").format(feeds.length)} mérési pont`;
    state.lastChartFetchedAt = new Date();
    const latestMeasurement = feeds.at(-1)?.created_at;
    const periodSummary = chartCustomRangeActive
      ? rangeLabel
      : `utolsó: ${formatCompactBudapestTime(latestMeasurement)}`;
    status.textContent = `${new Intl.NumberFormat("hu-HU").format(feeds.length)} pont · ${periodSummary} · frissítve ${formatCompactBudapestTime(state.lastChartFetchedAt)}`;
    if (!quiet) addActivityLog(`${rangeLabel}: ${feeds.length} mérési pont betöltve.`, "success");
  } catch (error) {
    const lastSuccess = state.lastChartFetchedAt
      ? ` Utolsó sikeres frissítés: ${formatBudapestTime(state.lastChartFetchedAt)}.`
      : "";
    status.textContent = `${error.message || "Nem sikerült betölteni a grafikonadatokat."}${lastSuccess}`;
    if (!quiet) addActivityLog("Nem sikerült betölteni a grafikonadatokat.", "error");
    console.error("ThingSpeak chart history failed:", error);
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- Időjárás ----------

// Az időjárás-kártya állapotsora, hibánál piros.
function setWeatherStatus(message, isError = false) {
  const status = $("weatherStatus");
  status.textContent = message;
  status.classList.toggle("weather-error", isError);
}

// Szám magyar formában az időjáráshoz, NaN helyett '—'.
function weatherNumber(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("hu-HU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(number)
    : "—";
}

// Aktuális időjárás lekérése az Open-Meteo-tól. A timezone=auto miatt a hely saját idejét kapjuk.
async function loadCurrentWeather(latitude, longitude, placeName) {
  setWeatherStatus("Időjárási adatok lekérése…");
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    timezone: "auto"
  });
  const response = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("Az időjárási szolgáltatás nem érhető el (" + response.status + ").");
  const data = await response.json();
  const current = data.current;
  if (!current || !Number.isFinite(Number(current.temperature_2m))) {
    throw new Error("Nem érkezett aktuális hőmérsékleti adat ehhez a helyhez.");
  }

  $("weatherPlace").textContent = placeName;
  $("weatherTemperature").textContent = weatherNumber(current.temperature_2m, 1);
  $("weatherFeelsLike").textContent = weatherNumber(current.apparent_temperature, 1) + " °C";
  $("weatherHumidity").textContent = weatherNumber(current.relative_humidity_2m) + " %";
  $("weatherWind").textContent = weatherNumber(current.wind_speed_10m, 1) + " km/h";
  $("weatherPrecipitation").textContent = weatherNumber(current.precipitation, 1) + " mm";
  const updatedAt = current.time ? new Date(current.time) : null;
  $("weatherUpdated").textContent = updatedAt && !Number.isNaN(updatedAt.valueOf())
    ? "Modelladat időpontja: " + new Intl.DateTimeFormat("hu-HU", { dateStyle: "short", timeStyle: "short" }).format(updatedAt)
    : "";
  $("weatherResult").hidden = false;
  setWeatherStatus("Sikeresen betöltve.");
}

// Városkereső űrlap elküldése. Ha már van kiválasztott javaslat, annak a koordinátáit használjuk, különben keresünk a beírt névre.
async function searchWeatherByCity(event) {
  event.preventDefault();
  const query = $("weatherLocationInput").value.trim();
  if (query.length < 2) {
    setWeatherStatus("Adj meg legalább két karaktert a település nevéből.", true);
    return;
  }

  const button = $("weatherSearchBtn");
  button.disabled = true;
  try {
    const place = weatherSelectedPlace && weatherSelectedQuery === query
      ? weatherSelectedPlace
      : (await findWeatherPlaces(query))[0];
    if (!place) throw new Error("Nem találtam ilyen települést. Próbáld meg ország megadásával, például: Szolnok, Magyarország.");
    await loadCurrentWeather(place.latitude, place.longitude, formatWeatherPlace(place));
  } catch (error) {
    setWeatherStatus(error.message || "Nem sikerült betölteni az időjárást.", true);
  } finally {
    button.disabled = false;
  }
}

// Városkereső állapota: javaslatok, kijelölt elem, késleltetés (nem küldünk kérést minden billentyűre).
let weatherSuggestionTimer;
let weatherSuggestionRequest = 0;
let weatherSelectedPlace = null;
let weatherSelectedQuery = "";
let weatherActiveSuggestion = -1;

// Találatból szöveg (név, megye, ország), az ismétlődéseket kivesszük.
function formatWeatherPlace(place) {
  return [place.name, place.admin1, place.country]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
}

// Településkeresés az Open-Meteo-n: max. 5 találat, magyarul.
async function findWeatherPlaces(query) {
  const params = new URLSearchParams({ name: query, count: "5", language: "hu", format: "json" });
  const response = await fetch("https://geocoding-api.open-meteo.com/v1/search?" + params.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("A településkereső nem érhető el.");
  const data = await response.json();
  return data.results || [];
}

// Javaslatlista bezárása (az aria attribútumokkal együtt).
function closeWeatherSuggestions() {
  const input = $("weatherLocationInput");
  const list = $("weatherLocationSuggestions");
  list.hidden = true;
  list.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  weatherActiveSuggestion = -1;
}

// Javaslat kiválasztása: beírjuk a mezőbe és rögtön elküldjük az űrlapot.
function selectWeatherSuggestion(place) {
  const input = $("weatherLocationInput");
  input.value = formatWeatherPlace(place);
  weatherSelectedPlace = place;
  weatherSelectedQuery = input.value;
  closeWeatherSuggestions();
  $("weatherForm").requestSubmit();
}

// Javaslatok lekérése. Az elavult válaszokat a requestId és a szöveg ellenőrzésével eldobjuk, mert a kérések más sorrendben is befejeződhetnek.
async function loadWeatherSuggestions(query) {
  const requestId = ++weatherSuggestionRequest;
  try {
    const places = await findWeatherPlaces(query);
    if (requestId !== weatherSuggestionRequest || $("weatherLocationInput").value.trim() !== query) return;
    const list = $("weatherLocationSuggestions");
    list.replaceChildren();
    places.forEach((place, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "weather-suggestion list-group-item list-group-item-action";
      option.id = `weather-location-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = formatWeatherPlace(place);
      option.addEventListener("click", () => selectWeatherSuggestion(place));
      list.append(option);
    });
    list.hidden = places.length === 0;
    $("weatherLocationInput").setAttribute("aria-expanded", String(places.length > 0));
  } catch {
    if (requestId === weatherSuggestionRequest) closeWeatherSuggestions();
  }
}

// Nyilakkal lépkedés a javaslatok között (körbeér).
// Az aria-activedescendant miatt a fókusz a beviteli mezőben marad.
function moveWeatherSuggestionSelection(direction) {
  const input = $("weatherLocationInput");
  const options = [...$("weatherLocationSuggestions").querySelectorAll('[role="option"]')];
  if (!options.length) return;
  weatherActiveSuggestion = weatherActiveSuggestion < 0
    ? (direction > 0 ? 0 : options.length - 1)
    : (weatherActiveSuggestion + direction + options.length) % options.length;
  options.forEach((option, index) => {
    const selected = index === weatherActiveSuggestion;
    option.setAttribute("aria-selected", String(selected));
  });
  input.setAttribute("aria-activedescendant", options[weatherActiveSuggestion].id);
}

// Gépeléskor hívódik. Várunk, amíg abbahagyja a gépelést (debounce), nem küldünk kérést minden betűre.
function handleWeatherLocationInput(event) {
  const query = event.currentTarget.value.trim();
  weatherSelectedPlace = null;
  weatherSelectedQuery = "";
  clearTimeout(weatherSuggestionTimer);
  // Ha közben újabb keresés indult, a régi eredményt eldobjuk.
  weatherSuggestionRequest += 1;
  closeWeatherSuggestions();
  if (query.length < 2) return;
  weatherSuggestionTimer = setTimeout(() => loadWeatherSuggestions(query), 300);
}

// Billentyűkezelés: fel/le nyíl léptet, Enter kiválasztja a javaslatot.
function handleWeatherLocationKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveWeatherSuggestionSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveWeatherSuggestionSelection(-1);
  } else if (event.key === "Enter" && weatherActiveSuggestion >= 0) {
    const option = $("weatherLocationSuggestions").querySelectorAll('[role="option"]')[weatherActiveSuggestion];
    if (option) {
      event.preventDefault();
      option.click();
    }
  } else if (event.key === "Escape") {
    closeWeatherSuggestions();
  }
}

// Település neve a koordinátákból (Nominatim). Csak a helyzet gomb megnyomása után hívjuk.
async function findNearbyPlaceName(latitude, longitude) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "10",
    addressdetails: "1",
    "accept-language": "hu"
  });
  const response = await fetch("https://nominatim.openstreetmap.org/reverse?" + params.toString());
  if (!response.ok) throw new Error("A településnév nem érhető el.");
  const data = await response.json();
  const address = data.address || {};
  return address.city || address.town || address.village || address.municipality || address.hamlet || address.suburb || address.county || data.name || null;
}

// 'Saját helyzetem' gomb: helyadat kérése a böngészőtől, majd az ottani időjárás betöltése.
function useCurrentLocation() {
  const button = $("useMyLocationBtn");
  if (!navigator.geolocation) {
    setWeatherStatus("Ez a böngésző nem támogatja a helymeghatározást.", true);
    return;
  }

  button.disabled = true;
  setWeatherStatus("Helymeghatározás folyamatban. A böngésző engedélykérést jeleníthet meg.");
  navigator.geolocation.getCurrentPosition(async (position) => {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    try {
      let placeName = "Saját helyzet";
      try {
        placeName = await findNearbyPlaceName(latitude, longitude) || placeName;
      } catch (error) {
        console.warn("Reverse geocoding failed:", error.message);
      }
      await loadCurrentWeather(latitude, longitude, placeName);
    } catch (error) {
      setWeatherStatus(error.message || "Nem sikerült betölteni az időjárást.", true);
    } finally {
      button.disabled = false;
    }
  }, (error) => {
    const messages = {
      1: "A helymeghatározási engedélyt elutasítottad. Engedélyezd a böngésző címsorában, vagy írj be egy települést.",
      2: "A készülék helyzete most nem állapítható meg. Próbáld meg később vagy írj be egy települést.",
      3: "A helymeghatározás túllépte az időkorlátot. Próbáld újra vagy írj be egy települést."
    };
    setWeatherStatus(messages[error.code] || "Nem sikerült meghatározni a helyzeted.", true);
    button.disabled = false;
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}

function setupWeather() {
  // Az időjárás-kártya eseményeinek bekötése.
  $("weatherForm").addEventListener("submit", searchWeatherByCity);
  $("weatherLocationInput").addEventListener("input", handleWeatherLocationInput);
  $("weatherLocationInput").addEventListener("keydown", handleWeatherLocationKeydown);
  $("weatherLocationInput").addEventListener("blur", () => setTimeout(closeWeatherSuggestions, 150));
  $("useMyLocationBtn").addEventListener("click", useCurrentLocation);
}

// ---------- AI-chat ----------

// Az AI-nak küldött adatcsomag (utolsó mérés, kora, elavult-e). Az oszlopnevek angolul vannak, mert a szerver promptja is ezeket használja.
function sensorContext() {
  if (!state.readings) return { status: "Még nincs betöltött mérési adat." };
  const measuredAt = state.lastEntry?.created_at ? new Date(state.lastEntry.created_at) : null;
  const ageSeconds = measuredAt && !Number.isNaN(measuredAt.valueOf())
    ? Math.max(0, Math.floor((Date.now() - measuredAt.valueOf()) / 1000))
    : null;
  return {
    measured_at: state.lastEntry?.created_at ?? null,
    data_age_seconds: ageSeconds,
    data_is_stale: ageSeconds !== null && ageSeconds > 120,
    temperature_c: state.readings.temperature,
    relative_humidity_percent: state.readings.humidity,
    air_pressure: state.readings.pressure,
    illuminance_lux: state.readings.light,
    rain_detected: state.readings.rain === null ? null : state.readings.rain === 1,
    fan_on: state.readings.fan === null ? null : state.readings.fan === 1,
    led_on: state.readings.led === null ? null : state.readings.led === 1,
    roof_open: state.readings.roofOpen === null ? null : state.readings.roofOpen === 1,
    note: "ThingSpeak mezők: field1 hőmérséklet (°C), field2 páratartalom (%), field3 légnyomás (hPa), field4 megvilágítás (lux), field5 eső (1/0), field6 ventilátor (1/0), field7 LED (1/0), field8 tető (1/0)."
  };
}

// Chat űrlap elküldése: kérdés kiírása, küldés a /api/chat-nek, válasz megjelenítése. Küldés közben a gomb le van tiltva.
async function submitChat(event) {
  event.preventDefault();
  const input = $("chatInput");
  const message = input.value.trim();
  if (!message) return;

  addChatMessage("Te", message, "user");
  // A most elküldött kérdést kihagyjuk az előzményből, mert azt külön kapja a szerver.
  const conversation = [...$("chatMessages").querySelectorAll(".chat-message")]
    .filter((item) => item.classList.contains("user-message") || item.classList.contains("bot-message"))
    .map((item) => ({
      role: item.classList.contains("user-message") ? "user" : "assistant",
      content: item.querySelector("p")?.textContent?.trim() || ""
    }))
    .filter((item) => item.content && item.content !== "Gondolkodom…")
    .slice(-13, -1);
  input.value = "";

  if (isSimpleGreeting(message)) {
    addChatMessage("Növényház okos kertésze", "Szia! Miben segíthetek a növényházzal kapcsolatban?", "bot");
    return;
  }

  const reply = addChatMessage("Növényház okos kertésze", "Gondolkodom…", "bot");
  $("sendChatBtn").disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sensorContext: sensorContext(), conversation })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Az AI-kérés nem sikerült.");
    reply.textContent = cleanAssistantReply(data.reply || "Nem érkezett válasz.");
    saveChatHistory();
    addActivityLog("Az AI-asszisztens válasza megérkezett.", "success");
  } catch (error) {
    reply.textContent = error.message || "Az asszisztens most nem érhető el. Ellenőrizd a szerver AI-beállításait, majd próbáld újra.";
    saveChatHistory();
    addActivityLog("Az AI-asszisztens kérése nem sikerült.", "error");
    console.error("AI chat failed:", error);
  } finally {
    $("sendChatBtn").disabled = false;
    input.focus();
  }
}

// ---------- A felület indítása ----------

// Világos/sötét téma. A Tabler a <html data-bs-theme> attribútumot használja, a választást a localStorage őrzi.
// TODO: ugyanez van az add-device.js-ben is, közös fájlba lehetne tenni.
function setupTheme() {
  const root = document.documentElement;
  const themeToggle = $("themeToggle");
  const updateThemeState = () => {
    themeToggle.setAttribute("aria-pressed", String(root.getAttribute("data-bs-theme") === "dark"));
  };
  updateThemeState();
  themeToggle.addEventListener("click", () => {
    const nextTheme = root.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-bs-theme", nextTheme);
    localStorage.setItem("greenhouse-theme", nextTheme);
    updateThemeState();
    // A grafikonok színe a témától függ, ezért újrarajzoljuk őket.
    if (chartFeedsForResize) renderThingSpeakCharts(chartFeedsForResize);
  });
}

function setupNavigation() {
  // A menü nyitását a Tabler (Bootstrap) intézi, linkre kattintva csak bezárjuk.
  const navLinks = $("navLinks");
  navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    navLinks.classList.remove("show");
    document.querySelector(".navbar-toggler")?.setAttribute("aria-expanded", "false");
  }));
}

function setupDemoSwitches() {
  // Csak demó kapcsolók, nem küldenek parancsot az ESP32-nek.
  ["fanDemoSwitch", "ledDemoSwitch", "roofDemoSwitch"].forEach((id) => {
    $(id).addEventListener("change", (event) => {
      event.currentTarget.dataset.previewChanged = "true";
    });
  });
}

// Grafikon-szűrő beállítása: visszaállítja a mentett időszakot és bekötjük a gombokat.
// A gyors lista és az egyéni időszak kizárják egymást.
function setupChartControls() {
  const select = $("chartRangeSelect");
  const filterPanel = $("chartFilterPanel");
  const customRange = $("chartCustomRange");
  const filterToggle = $("chartFilterToggle");
  const startInput = $("chartStartDate");
  const endInput = $("chartEndDate");
  const savedRange = localStorage.getItem("greenhouse-chart-range");
  chartCustomRangeActive = savedRange === "custom"
    || localStorage.getItem("greenhouse-chart-custom-active") === "true";
  if ([...select.options].some((option) => option.value === savedRange)) {
    select.value = savedRange;
  } else {
    select.value = "results:60";
  }
  if (chartCustomRangeActive) select.value = "";

  const now = new Date();
  now.setSeconds(0, 0);
  startInput.value = localStorage.getItem("greenhouse-chart-start")
    || formatBudapestDateTimeInput(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  endInput.value = localStorage.getItem("greenhouse-chart-end")
    || formatBudapestDateTimeInput(now);
  filterPanel.hidden = true;
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.classList.toggle("has-custom-range", chartCustomRangeActive);

  select.addEventListener("change", () => {
    localStorage.setItem("greenhouse-chart-range", select.value);
    chartCustomRangeActive = false;
    localStorage.setItem("greenhouse-chart-custom-active", "false");
    filterToggle.classList.remove("has-custom-range");
    loadChartHistory();
  });
  filterToggle.addEventListener("click", () => {
    const shouldOpen = filterPanel.hidden;
    filterPanel.hidden = !shouldOpen;
    filterToggle.setAttribute("aria-expanded", String(shouldOpen));
    filterToggle.classList.toggle("is-active", shouldOpen);
  });
  customRange.addEventListener("submit", (event) => {
    event.preventDefault();
    chartCustomRangeActive = true;
    select.value = "";
    localStorage.setItem("greenhouse-chart-custom-active", "true");
    filterToggle.classList.add("has-custom-range");
    localStorage.setItem("greenhouse-chart-start", startInput.value);
    localStorage.setItem("greenhouse-chart-end", endInput.value);
    filterPanel.hidden = true;
    filterToggle.setAttribute("aria-expanded", "false");
    filterToggle.classList.remove("is-active");
    loadChartHistory();
  });
  $("refreshChartsBtn").addEventListener("click", () => loadChartHistory());
}

// Főoldal indítása bejelentkezés után: gombok, szerkesztők és PDF gombok bekötése, chat és mentett mérés visszatöltése, adatok betöltése, időzített frissítés.
function initializeDashboard() {
  setupActivityLog();
  addActivityLog("A felügyeleti felület megnyílt.");
  setupTheme();
  setupWeather();
  setupNavigation();
  setupDemoSwitches();
  setupChartControls();
  setupSummaryEditor();
  setupMetricEditor();
  setupChartEditor();
  // A PDF-modul külön fájl, ha nem töltődött be (pl. régi gyorsítótár), üzenetet adunk.
  // A grafikonok csak szűrésnél kerülnek a PDF-be.
  const reportOptions = () => (state.chartFiltered
    ? { charts: [...document.querySelectorAll("[data-field-chart] svg.apexcharts-svg")], periodLabel: state.chartPeriodLabel }
    : {});
  const getReportModule = () => {
    if (!state.lastEntry) throw new Error("Még nincs exportálható mérés.");
    const report = window.GreenhouseReport;
    if (!report || typeof report.download !== "function" || typeof report.sendByEmail !== "function") {
      throw new Error("A PDF-készítő még nem töltődött be. Frissítsd az oldalt (Ctrl+F5), majd próbáld újra.");
    }
    return report;
  };
  $("exportPdfBtn").addEventListener("click", async () => {
    try {
      // A jelentés a betöltött adatokból készül.
      const report = getReportModule();
      const name = await report.download(state.lastEntry, reportOptions());
      addActivityLog(`A mérési jelentés PDF-ként letöltődött (${name}).`);
    } catch (error) {
      addActivityLog(error.message, "error");
      await window.AppDialog.alert(error.message, "Hiba");
    }
  });
  $("emailPdfBtn").addEventListener("click", async () => {
    try {
      const report = getReportModule();
      const result = await report.sendByEmail(state.lastEntry, reportOptions());
      if (result.method === "share") {
        addActivityLog("A PDF-jelentés átadva a megosztási ablaknak.");
      } else if (result.method === "mailto") {
        addActivityLog(`A PDF letöltődött (${result.fileName}); csatold a megnyílt levélhez.`);
        await window.AppDialog.alert(
          `A PDF letöltődött: ${result.fileName}\n\nA levelező megnyílik – a küldés előtt csatold hozzá a letöltött fájlt.`,
          "PDF letöltve"
        );
      }
    } catch (error) {
      addActivityLog(error.message, "error");
      await window.AppDialog.alert(error.message, "Hiba");
    }
  });
  $("refreshDataBtn").addEventListener("click", () => {
    loadLatestReadings();
    loadChartHistory({ quiet: true });
  });
  $("chatForm").addEventListener("submit", submitChat);
  // Előbb a régi beszélgetést töltjük vissza, így az üdvözlés csak üres chatnél jelenik meg.
  const hasChatHistory = restoreChatHistory();
  if (!hasChatHistory) {
    addChatMessage("Növényház okos kertésze", CHAT_GREETING_TEXT, "bot");
  }
  // A mentett mérés rögtön látszik, a következő sor friss adatot kér.
  restoreCachedReading();
  loadLatestReadings();
  loadChartHistory({ quiet: true });
  state.refreshTimer = window.setInterval(() => loadLatestReadings({ quiet: true }), REFRESH_INTERVAL_MS);
  state.chartRefreshTimer = window.setInterval(() => loadChartHistory({ quiet: true }), CHART_REFRESH_INTERVAL_MS);
}

// Felső kártya szerkesztője (fogaskerék): sorrend és láthatóság. A mérések nem törlődnek.
function setupSummaryEditor() {
  const toggle = $("summarySettingsToggle");
  const panel = $("summarySettings");
  const list = $("summaryConfigList");
  const select = $("summaryRowSelect");
  const addButton = $("addSummaryRowBtn");
  const rowsContainer = $("latestMetricRows");
  if (!toggle || !panel || !list || !select || !addButton || !rowsContainer) return;

  let order = DEFAULT_SUMMARY_ORDER;
  try {
    const savedOrder = JSON.parse(localStorage.getItem(SUMMARY_STORAGE_KEY));
    if (Array.isArray(savedOrder)) {
      order = savedOrder.filter((key, index) =>
        SUMMARY_ROWS.some((row) => row.key === key) && savedOrder.indexOf(key) === index
      );
    }
  } catch {
    order = DEFAULT_SUMMARY_ORDER;
  }

  let draggedKey = null;
  let isOpen = false;

  // Sorok elrejtése/megjelenítése a mentett sorrend szerint. Nem töröljük őket, csak elrejtjük.
  function updateRows() {
    const rows = new Map(
      [...rowsContainer.querySelectorAll("[data-summary-key]")]
        .map((row) => [row.dataset.summaryKey, row])
    );
    order.forEach((key) => {
      const row = rows.get(key);
      if (!row) return;
      row.hidden = false;
      rowsContainer.append(row);
      rows.delete(key);
    });
    rows.forEach((row) => {
      row.hidden = true;
      rowsContainer.append(row);
    });
  }

  // A legördülő listába azok a sorok kerülnek, amik most nem látszanak.
  function updateSelect() {
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Eszközsor kiválasztása";
    select.append(placeholder);

    SUMMARY_ROWS.filter((row) => !order.includes(row.key)).forEach((row) => {
      const option = document.createElement("option");
      option.value = row.key;
      option.textContent = row.label;
      select.append(option);
    });
    select.disabled = select.options.length === 1;
    addButton.disabled = select.disabled;
  }

  // Minden változtatást mentünk, és újrarajzoljuk a kártyát meg a listát.
  function saveOrder(nextOrder) {
    order = nextOrder;
    localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(order));
    updateRows();
    renderEditorList();
  }

  // Sor áthelyezése másik sor helyére (húzással vagy nyilakkal).
  function moveRow(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const nextOrder = [...order];
    const fromIndex = nextOrder.indexOf(fromKey);
    const toIndex = nextOrder.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, fromKey);
    saveOrder(nextOrder);
  }

  // Szerkesztőlista kirajzolása DOM-elemekkel (nem innerHTML-lel). Soronként fogantyú, fel/le nyíl és törlés gomb.
  function renderEditorList() {
    list.replaceChildren();
    order.forEach((key, index) => {
      const rowInfo = SUMMARY_ROWS.find((row) => row.key === key);
      if (!rowInfo) return;

      const item = document.createElement("li");
      item.className = "summary-config-item list-group-item d-flex align-items-center gap-2";
      item.draggable = true;
      item.dataset.summaryKey = key;

      const grip = document.createElement("span");
      grip.className = "material-symbols-rounded summary-drag-icon";
      grip.textContent = "drag_indicator";
      grip.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "summary-config-label";
      label.textContent = rowInfo.label;

      const actions = document.createElement("div");
      actions.className = "summary-config-actions";

      const upButton = document.createElement("button");
      upButton.type = "button";
      upButton.className = "btn btn-icon btn-sm btn-ghost-secondary summary-config-button";
      upButton.disabled = index === 0;
      upButton.setAttribute("aria-label", `${rowInfo.label} mozgatása feljebb`);
      upButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">arrow_upward</span>';
      upButton.addEventListener("click", () => moveRow(key, order[index - 1]));

      const downButton = document.createElement("button");
      downButton.type = "button";
      downButton.className = "btn btn-icon btn-sm btn-ghost-secondary summary-config-button";
      downButton.disabled = index === order.length - 1;
      downButton.setAttribute("aria-label", `${rowInfo.label} mozgatása lejjebb`);
      downButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">arrow_downward</span>';
      downButton.addEventListener("click", () => moveRow(key, order[index + 1]));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-icon btn-sm btn-ghost-danger summary-config-button summary-remove-button";
      removeButton.setAttribute("aria-label", `${rowInfo.label} eltávolítása a főoldalról`);
      removeButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">close</span>';
      removeButton.addEventListener("click", () => saveOrder(order.filter((itemKey) => itemKey !== key)));

      actions.append(upButton, downButton, removeButton);
      item.append(grip, label, actions);

      item.addEventListener("dragstart", (event) => {
        draggedKey = key;
        item.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        moveRow(draggedKey || event.dataTransfer.getData("text/plain"), key);
      });
      item.addEventListener("dragend", () => {
        draggedKey = null;
        item.classList.remove("is-dragging");
      });

      list.append(item);
    });
    updateSelect();
  }

  toggle.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.hidden = !isOpen;
    $("metricSettings").hidden = !isOpen;
    $("chartEditHint").hidden = !isOpen;
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.classList.toggle("is-active", isOpen);
  });

  addButton.addEventListener("click", () => {
    if (!select.value || order.includes(select.value)) return;
    saveOrder([...order, select.value]);
  });

  updateRows();
  renderEditorList();
}

// Mérőkártyák szerkesztője, ugyanúgy működik, mint a felső kártyáé. A beállítás böngészőnként külön van.
function setupMetricEditor() {
  const grid = document.querySelector(".greenhouse-grid");
  const list = $("metricConfigList");
  const select = $("metricRowSelect");
  const addButton = $("addMetricRowBtn");
  if (!grid || !list || !select || !addButton) return;

  let order = DEFAULT_METRIC_ORDER;
  try {
    const saved = JSON.parse(localStorage.getItem(METRIC_STORAGE_KEY));
    if (Array.isArray(saved)) {
      order = saved.filter((key, index) =>
        METRIC_CARDS.some((item) => item.key === key) && saved.indexOf(key) === index
      );
    }
  } catch {
    order = DEFAULT_METRIC_ORDER;
  }

  let draggedKey = null;

  // Mint az updateRows, de a mérőkártyákra.
  function applyOrder() {
    const cards = new Map(
      [...grid.querySelectorAll("[data-metric-card]")]
        .map((card) => [card.dataset.metricCard, card])
    );
    order.forEach((key) => {
      const card = cards.get(key);
      if (!card) return;
      card.hidden = false;
      grid.append(card);
      cards.delete(key);
    });
    cards.forEach((card) => {
      card.hidden = true;
      grid.append(card);
    });
  }

  // A legördülő listába a rejtett kártyák kerülnek.
  function updateSelect() {
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Mérőkártya kiválasztása";
    select.append(placeholder);
    METRIC_CARDS.filter((item) => !order.includes(item.key)).forEach((item) => {
      const option = document.createElement("option");
      option.value = item.key;
      option.textContent = item.label;
      select.append(option);
    });
    select.disabled = select.options.length === 1;
    addButton.disabled = select.disabled;
  }

  // Sorrend mentése és a nézetek újrarajzolása.
  function saveOrder(nextOrder) {
    order = nextOrder;
    localStorage.setItem(METRIC_STORAGE_KEY, JSON.stringify(order));
    applyOrder();
    renderList();
  }

  // Kártya áthelyezése (mint a moveRow).
  function moveCard(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const next = [...order];
    const from = next.indexOf(fromKey);
    const to = next.indexOf(toKey);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, fromKey);
    saveOrder(next);
  }

  // Szerkesztőlista kirajzolása, mint a renderEditorList.
  function renderList() {
    list.replaceChildren();
    order.forEach((key, index) => {
      const itemInfo = METRIC_CARDS.find((item) => item.key === key);
      if (!itemInfo) return;
      const item = document.createElement("li");
      item.className = "summary-config-item list-group-item d-flex align-items-center gap-2";
      item.draggable = true;

      const grip = document.createElement("span");
      grip.className = "material-symbols-rounded summary-drag-icon";
      grip.textContent = "drag_indicator";
      grip.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "summary-config-label";
      label.textContent = itemInfo.label;

      const actions = document.createElement("div");
      actions.className = "summary-config-actions";
      const makeMoveButton = (icon, direction, target) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-icon btn-sm btn-ghost-secondary summary-config-button";
        button.disabled = !target;
        button.setAttribute("aria-label", `${itemInfo.label} mozgatása ${direction}`);
        button.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">${icon}</span>`;
        button.addEventListener("click", () => moveCard(key, target));
        return button;
      };
      actions.append(
        makeMoveButton("arrow_upward", "feljebb", order[index - 1]),
        makeMoveButton("arrow_downward", "lejjebb", order[index + 1])
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-icon btn-sm btn-ghost-danger summary-config-button summary-remove-button";
      remove.setAttribute("aria-label", `${itemInfo.label} eltávolítása a mérőkártyák közül`);
      remove.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">close</span>';
      remove.addEventListener("click", () => saveOrder(order.filter((itemKey) => itemKey !== key)));
      actions.append(remove);
      item.append(grip, label, actions);

      item.addEventListener("dragstart", (event) => {
        draggedKey = key;
        item.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        moveCard(draggedKey || event.dataTransfer.getData("text/plain"), key);
      });
      item.addEventListener("dragend", () => {
        draggedKey = null;
        item.classList.remove("is-dragging");
      });
      list.append(item);
    });
    updateSelect();
  }

  addButton.addEventListener("click", () => {
    if (!select.value || order.includes(select.value)) return;
    saveOrder([...order, select.value]);
  });

  applyOrder();
  renderList();
}

// Grafikon szerkesztő: minden grafikonhoz egy mező (1-8) tartozik. A csempe törlése csak az elrendezést érinti.
// Üres helyen a plusz gombbal új mező választható.
function setupChartEditor() {
  const grid = $("chartGrid");
  if (!grid) return;

  let fields = DEFAULT_CHART_FIELDS;
  try {
    const saved = JSON.parse(localStorage.getItem(CHART_STORAGE_KEY));
    if (Array.isArray(saved)) {
      fields = saved
        .map(Number)
        .filter((field, index) => Number.isInteger(field) && field >= 1 && field <= 8 && saved.indexOf(field) === index)
        .slice(0, MAX_CHART_SLOTS);
    }
  } catch {
    fields = DEFAULT_CHART_FIELDS;
  }

  const chartNames = {
    1: "Hőmérséklet",
    2: "Páratartalom",
    3: "Légnyomás",
    4: "Megvilágítás",
    5: "Esőérzékelő",
    6: "Ventilátor",
    7: "LED",
    8: "Növényház teteje"
  };

  // Grafikonmezők mentése. A Set kiszedi az ismétlődést, a slice legfeljebb MAX_CHART_SLOTS elemet hagy.
  // A már betöltött adatból rajzolunk újra, nincs új API-hívás.
  function saveFields(nextFields) {
    fields = [...new Set(nextFields)].slice(0, MAX_CHART_SLOTS);
    localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(fields));
    renderSlots();
    if (chartFeedsForResize) renderThingSpeakCharts(chartFeedsForResize);
  }

  // Minden mezőhöz grafikon-csempe, a szabad helyekre üres csempe plusz gombbal.
  function renderSlots() {
    grid.replaceChildren();
    fields.forEach((field) => {
      const tile = document.createElement("article");
      tile.className = "chart-tile";
      tile.dataset.chartTile = String(field);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-icon btn-sm btn-ghost-secondary chart-remove-button";
      remove.setAttribute("aria-label", `${chartNames[field]} grafikon eltávolítása`);
      remove.title = "Grafikon eltávolítása";
      remove.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">close</span>';
      remove.addEventListener("click", () => saveFields(fields.filter((item) => item !== field)));

      const chart = document.createElement("div");
      chart.className = "thingspeak-chart";
      chart.dataset.fieldChart = String(field);
      chart.title = `${chartNames[field]} előzményei`;
      tile.append(remove, chart);
      grid.append(tile);
    });

    const availableFields = DEFAULT_CHART_FIELDS.filter((field) => !fields.includes(field));
    for (let slot = fields.length; slot < MAX_CHART_SLOTS; slot += 1) {
      const tile = document.createElement("article");
      tile.className = "chart-add-tile";
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "btn btn-icon btn-primary chart-add-trigger";
      addButton.setAttribute("aria-label", "Grafikon hozzáadása");
      addButton.title = "Grafikon hozzáadása";
      addButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">add</span>';

      const picker = document.createElement("div");
      picker.className = "chart-add-picker";
      picker.hidden = true;
      const select = document.createElement("select");
      select.className = "form-select form-select-sm w-auto";
      select.setAttribute("aria-label", "Hozzáadható ThingSpeak-mező");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Válassz mérési adatot";
      select.append(placeholder);
      availableFields.forEach((field) => {
        const option = document.createElement("option");
        option.value = String(field);
        option.textContent = chartNames[field];
        select.append(option);
      });
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "btn btn-sm chart-add-confirm";
      confirm.textContent = "Hozzáadás";
      confirm.disabled = availableFields.length === 0;
      confirm.addEventListener("click", () => {
        const field = Number(select.value);
        if (!field || fields.includes(field)) return;
        saveFields([...fields, field]);
      });
      picker.append(select, confirm);
      addButton.addEventListener("click", () => {
        picker.hidden = !picker.hidden;
        addButton.setAttribute("aria-expanded", String(!picker.hidden));
      });
      tile.append(addButton, picker);
      grid.append(tile);
    }
  }

  renderSlots();
}

// Főoldal megjelenítése belépés után. Ha van horgony (#...) az URL-ben, odagörgetünk.
function showDashboard() {
  $("loginScreen").hidden = true;
  $("appShell").hidden = false;
  initializeDashboard();

  // Belépés után látszik az oldal, ezért csak utána görgetünk.
  const targetId = window.location.hash.slice(1);
  if (!targetId) return;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = document.getElementById(targetId);
    if (!target) return;

    const navbarHeight = document.querySelector(".navbar")?.offsetHeight || 0;
    const top = target.getBoundingClientRect().top + window.scrollY - navbarHeight - 24;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }));
}

// Bejelentkezési hibaüzenet beállítása.
function setLoginMessage(message) {
  $("loginMessage").textContent = message;
}

// Megkérdezzük a szervert, be van-e jelentkezve a felhasználó (a süti HttpOnly, JS-ből nem látszik). Ha igen, megjelenik a főoldal.
async function checkLogin() {
  const response = await fetch("/api/auth", { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Nem sikerült ellenőrizni a bejelentkezést.");
  if (result.authenticated) showDashboard();
}

// Bejelentkezés felülete: jelszó mutatása, belépés, kilépés. A jelszót csak a szervernek küldjük.
// TODO: a script.js már nagyon hosszú, a bejelentkezés külön fájlba kerülhetne.
function setupAuthentication() {
  const loginForm = $("loginForm");
  const loginButton = $("loginSubmit");
  const passwordInput = $("loginPassword");
  const passwordVisibilityButton = $("passwordVisibilityBtn");

  passwordVisibilityButton.addEventListener("click", () => {
    const showPassword = passwordInput.type === "password";
    passwordInput.type = showPassword ? "text" : "password";
    passwordVisibilityButton.setAttribute("aria-pressed", String(showPassword));
    passwordVisibilityButton.setAttribute(
      "aria-label",
      showPassword ? "Jelszó elrejtése" : "Jelszó megjelenítése"
    );
    passwordVisibilityButton.querySelector(".material-symbols-rounded").textContent =
      showPassword ? "visibility_off" : "visibility";
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginMessage("");
    loginButton.disabled = true;

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: $("loginUsername").value,
          password: $("loginPassword").value
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Nem sikerült bejelentkezni.");
      loginForm.reset();
      showDashboard();
      addActivityLog("Sikeres bejelentkezés.", "success");
    } catch (error) {
      setLoginMessage(error.message || "Nem sikerült bejelentkezni.");
    } finally {
      loginButton.disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Nem sikerült kijelentkezni.");
      addActivityLog("Kijelentkezés.");
      window.location.reload();
    } catch (error) {
      setLoginMessage(error.message || "Nem sikerült kijelentkezni.");
    }
  });

  checkLogin().catch((error) => setLoginMessage(error.message));
}

// Az oldal betöltése után a bejelentkezés ellenőrzésével indulunk.
document.addEventListener("DOMContentLoaded", setupAuthentication);
