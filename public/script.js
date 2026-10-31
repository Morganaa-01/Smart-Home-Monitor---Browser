const REFRESH_INTERVAL_MS = 30_000;

const state = {
  readings: null,
  lastEntry: null,
  refreshTimer: null
};

const $ = (id) => document.getElementById(id);

function renderThingSpeakCharts(feeds) {
  const svgNS = "http://www.w3.org/2000/svg";
  document.querySelectorAll("[data-field-chart]").forEach((chart) => {
    const field = "field" + chart.dataset.fieldChart;
    const points = feeds.map((feed) => feed[field] === null || feed[field] === "" ? null : Number(feed[field])).filter(Number.isFinite);
    const labels = { 1: "Hőmérséklet előzményei", 2: "Páratartalom előzményei", 3: "Légnyomás előzményei", 4: "Megvilágítás előzményei", 5: "Esőérzékelő előzményei", 6: "Ventilátor előzményei", 7: "LED állapota", 8: "Tetőállapot előzményei" };
    const label = labels[chart.dataset.fieldChart] || chart.title;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 760 220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const title = document.createElementNS(svgNS, "text");
    title.setAttribute("x", "24"); title.setAttribute("y", "30");
    title.setAttribute("class", "chart-title"); title.textContent = label; svg.append(title);
    [70, 110, 150, 190].forEach((y) => {
      const gridLine = document.createElementNS(svgNS, "line");
      gridLine.setAttribute("x1", "24"); gridLine.setAttribute("x2", "736");
      gridLine.setAttribute("y1", String(y)); gridLine.setAttribute("y2", String(y));
      gridLine.setAttribute("class", "chart-grid-line"); svg.append(gridLine);
    });
    if (points.length) {
      const min = Math.min(...points); const range = Math.max(...points) - min || 1;
      const pathData = points.map((value, index) => {
        const x = points.length === 1 ? 380 : 28 + (index / (points.length - 1)) * 704;
        const y = 190 - ((value - min) / range) * 120;
        return (index ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
      const line = document.createElementNS(svgNS, "path");
      line.setAttribute("d", pathData); line.setAttribute("class", "chart-line"); svg.append(line);
      const latest = document.createElementNS(svgNS, "text");
      latest.setAttribute("x", "736"); latest.setAttribute("y", "30");
      latest.setAttribute("text-anchor", "end"); latest.setAttribute("class", "chart-value");
      latest.textContent = String(points[points.length - 1]); svg.append(latest);
    }
    chart.replaceChildren(svg);
  });
}

function addChatMessage(sender, message, type) {
  const item = document.createElement("article");
  item.className = `chat-message ${type}-message`;
  const heading = document.createElement("strong");
  heading.textContent = sender;
  const body = document.createElement("p");
  body.textContent = message;
  item.append(heading, body);
  $("chatMessages").append(item);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  return body;
}

function isSimpleGreeting(message) {
  return /^(szia|helló|hello|üdv|jó napot|jó reggelt|jó estét|szevasz|szervusz|hi|hey)[!.?\s]*$/iu.test(message.trim());
}

function cleanAssistantReply(message) {
  return String(message)
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/(^|\n)#{1,6}\s*/g, "$1")
    .replace(/(^|\n)\s*[-*]\s+/g, "$1• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function numericField(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatted(value, digits = 0) {
  return value === null ? "—" : new Intl.NumberFormat("hu-HU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function setMetric(id, value, unit, digits = 0) {
  $(id).textContent = value === null ? "—" : `${formatted(value, digits)} ${unit}`;
}

function setNumber(id, value, digits = 0) {
  $(id).textContent = formatted(value, digits);
}

function setStateBadge(id, label, stateName) {
  const element = $(id);
  element.textContent = label;
  element.className = `status status-${stateName}`;
}

function renderReadings(entry) {
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

  setNumber("temperatureValue", fields.temperature, 1);
  setNumber("humidityValue", fields.humidity);
  setNumber("pressureValue", fields.pressure, 1);
  setNumber("lightValue", fields.light);
  setMetric("heroTemperature", fields.temperature, "°C", 1);
  setMetric("heroHumidity", fields.humidity, "%");
  $("heroPressure").textContent = fields.pressure === null ? "—" : formatted(fields.pressure, 1);

  const raining = fields.rain === null ? null : fields.rain === 1;
  const fanOn = fields.fan === null ? null : fields.fan === 1;
  const ledOn = fields.led === null ? null : fields.led === 1;
  const roofOpen = fields.roofOpen === null ? null : fields.roofOpen === 1;

  $("heroRain").textContent = raining === null ? "—" : raining ? "Észlelve" : "Nem észlelhető";
  setStateBadge("rainStatus", raining === null ? "Nincs adat" : raining ? "Esőt érzékel" : "Nem esik", raining === null ? "pending" : raining ? "warning" : "on");
  setStateBadge("fanStatus", fanOn === null ? "Nincs adat" : fanOn ? "Bekapcsolva" : "Kikapcsolva", fanOn === null ? "pending" : fanOn ? "on" : "off");
  setStateBadge("ledStatus", ledOn === null ? "Nincs adat" : ledOn ? "Bekapcsolva" : "Kikapcsolva", ledOn === null ? "pending" : ledOn ? "on" : "off");
  setStateBadge("roofStatus", roofOpen === null ? "Nincs adat" : roofOpen ? "Nyitva" : "Zárva", roofOpen === null ? "pending" : roofOpen ? "warning" : "on");

  const date = entry.created_at ? new Date(entry.created_at) : null;
  const ageSeconds = date && !Number.isNaN(date.valueOf())
    ? Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000))
    : null;
  const isStale = ageSeconds !== null && ageSeconds > 120;
  $("lastUpdated").textContent = date && !Number.isNaN(date.valueOf())
    ? `Utoljára frissítve: ${date.toLocaleString("hu-HU")}`
    : "A ThingSpeak nem adott meg mérési időpontot.";
  $("connectionStatus").textContent = isStale ? "Régi mérés" : "Kapcsolódva";
  $("connectionStatus").className = `connection-pill ${isStale ? "stale" : "connected"}`;
}

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
    renderReadings(entry);
    renderThingSpeakCharts(feeds);
  } catch (error) {
    $("connectionStatus").textContent = "Nem elérhető";
    $("connectionStatus").className = "connection-pill disconnected";
    if (!state.lastEntry) $("lastUpdated").textContent = "Nem sikerült csatlakozni a ThingSpeak csatornához.";
    if (!quiet) addChatMessage("Rendszer", error.message || "Nem sikerült adatot betölteni a ThingSpeak csatornából.", "system");
    console.error("ThingSpeak read failed:", error);
  } finally {
    if (button) button.disabled = false;
  }
}

function setWeatherStatus(message, isError = false) {
  const status = $("weatherStatus");
  status.textContent = message;
  status.classList.toggle("weather-error", isError);
}

function weatherNumber(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("hu-HU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(number)
    : "—";
}

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
    setWeatherStatus("Település keresése…");
    const params = new URLSearchParams({ name: query, count: "5", language: "hu", format: "json" });
    const response = await fetch("https://geocoding-api.open-meteo.com/v1/search?" + params.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error("A településkereső nem érhető el.");
    const data = await response.json();
    const place = data.results?.[0];
    if (!place) throw new Error("Nem találtam ilyen települést. Próbáld meg ország megadásával, például: Szolnok, Magyarország.");
    const placeName = [place.name, place.admin1, place.country].filter((value, index, values) => value && values.indexOf(value) === index).join(", ");
    await loadCurrentWeather(place.latitude, place.longitude, placeName);
  } catch (error) {
    setWeatherStatus(error.message || "Nem sikerült betölteni az időjárást.", true);
  } finally {
    button.disabled = false;
  }
}

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
    const placeName = "Saját helyzet (" + latitude.toFixed(2) + ", " + longitude.toFixed(2) + ")";
    try {
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
  $("weatherForm").addEventListener("submit", searchWeatherByCity);
  $("useMyLocationBtn").addEventListener("click", useCurrentLocation);
}

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
    note: "ThingSpeak mezők: field1 hőmérséklet (°C), field2 páratartalom (%), field3 légnyomás (a firmware egysége nincs megadva), field4 megvilágítás (lux), field5 eső (1/0), field6 ventilátor (1/0), field7 LED (1/0), field8 tető (1/0)."
  };
}

async function submitChat(event) {
  event.preventDefault();
  const input = $("chatInput");
  const message = input.value.trim();
  if (!message) return;

  addChatMessage("Te", message, "user");
  input.value = "";

  if (isSimpleGreeting(message)) {
    addChatMessage("Növényházi asszisztens", "Szia! Miben segíthetek a növényházzal kapcsolatban?", "bot");
    return;
  }

  const reply = addChatMessage("Növényházi asszisztens", "Gondolkodom…", "bot");
  $("sendChatBtn").disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sensorContext: sensorContext() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Az AI-kérés nem sikerült.");
    reply.textContent = cleanAssistantReply(data.reply || "Nem érkezett válasz.");
  } catch (error) {
    reply.textContent = error.message || "Az asszisztens most nem érhető el. Ellenőrizd a szerver AI-beállításait, majd próbáld újra.";
    console.error("AI chat failed:", error);
  } finally {
    $("sendChatBtn").disabled = false;
    input.focus();
  }
}

function setupTheme() {
  const savedTheme = localStorage.getItem("greenhouse-theme");
  const themeToggle = $("themeToggle");
  if (savedTheme === "dark") document.body.classList.add("dark");
  const updateThemeState = () => {
    themeToggle.setAttribute("aria-pressed", String(document.body.classList.contains("dark")));
  };
  updateThemeState();
  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("greenhouse-theme", document.body.classList.contains("dark") ? "dark" : "light");
    updateThemeState();
  });
}

function setupNavigation() {
  const menuButton = $("menuToggle");
  const navLinks = $("navLinks");
  menuButton.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });
  navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }));
}

function init() {
  setupTheme();
  setupWeather();
  setupNavigation();
  $("refreshDataBtn").addEventListener("click", () => loadLatestReadings());
  $("chatForm").addEventListener("submit", submitChat);
  addChatMessage("Növényházi asszisztens", "Szia! A legutóbb betöltött növényházi mérések alapján tudok segíteni.", "bot");
  loadLatestReadings();
  state.refreshTimer = window.setInterval(() => loadLatestReadings({ quiet: true }), REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", init);
