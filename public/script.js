// Main page logic: loads the measurements and the charts, handles the weather, the theme and the AI chat.
// The cards, charts and chat data come from the API. localStorage keeps the local settings and the
// conversation per browser and address, there is no shared server database.
// The login check starts at the end of the file. Hiding the page is not security by itself,
// the API routes check the permission too.
// How often the dashboard asks ThingSpeak for new measurements.
const REFRESH_INTERVAL_MS = 30_000;
const CHART_REFRESH_INTERVAL_MS = 5 * 60_000;

// The latest data is kept here, so the page and the chat use the same values.
const state = {
  readings: null,
  lastEntry: null,
  lastChartFetchedAt: null,
  chartFiltered: false,
  chartPeriodLabel: "",
  refreshTimer: null,
  chartRefreshTimer: null
};

const ACTIVITY_LOG_KEY = "greenhouse-activity-log";
const ACTIVITY_LOG_LIMIT = 30;
const CHAT_HISTORY_KEY = "greenhouse-chat-history";
const CHAT_HISTORY_LIMIT = 60;
const SENSOR_CACHE_KEY = "greenhouse-last-reading";
const CHAT_GREETING_TEXT = "Szia! A legutóbb betöltött növényházi mérések alapján tudok segíteni. A beszélgetést a gpt-6-luna modell működteti.";

// The conversation is kept in this browser only, and its size is limited.
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

// The history is rebuilt from the chat bubbles on the page, so there is no second copy of the messages
// that could get out of sync. The "thinking" placeholder is skipped, otherwise it would be shown again after a reload.
function saveChatHistory() {
  // Save only real user and assistant messages, not system notices.
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
    // If storage is blocked, the chat still works.
  }
}

// Do not save the messages one by one while restoring, so there are no duplicates.
function restoreChatHistory() {
  // Restore the last messages. The false argument of addChatMessage stops it from saving again.
  const messages = getSavedChatHistory();
  messages.forEach(({ sender, text, type }, index) => {
    // Also update the saved welcome message, so the model name is shown there.
    const greeting = index === 0 && type === "bot" && text === "Szia! A legutóbb betöltött növényházi mérések alapján tudok segíteni."
      ? CHAT_GREETING_TEXT
      : text;
    addChatMessage(sender, greeting, type, false);
  });
  return messages.length > 0;
}

// The cached last measurement is shown at start while the fresh request is running.
// The saved value shows quickly but keeps its original time, so it is not fresh data.
function restoreCachedReading() {
  try {
    const entry = JSON.parse(localStorage.getItem(SENSOR_CACHE_KEY) || "null");
    if (entry && typeof entry.created_at === "string") renderReadings(entry, false);
  } catch {
    // If the cache is broken or missing, the ThingSpeak request loads the data.
  }
}

// Broken JSON in localStorage must not break the page, so any problem falls back to an empty log.
function getActivityLog() {
  try {
    const savedEntries = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || "[]");
    return Array.isArray(savedEntries) ? savedEntries : [];
  } catch {
    return [];
  }
}

// This is a local activity log for the user, not a full server audit log.
function renderActivityLog() {
  const list = $("activityLogEntries");
  if (!list) return;

  const entries = getActivityLog();
  list.replaceChildren();
  if (entries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "activity-log-empty";
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
    item.className = `activity-log-entry activity-log-${entry.level || "info"}`;

    const time = document.createElement("time");
    time.dateTime = entry.at;
    time.textContent = timeFormatter.format(new Date(entry.at));

    const message = document.createElement("span");
    message.textContent = entry.message;
    item.append(time, message);
    list.append(item);
  });
}

// Newest entry goes first and the list is cut at ACTIVITY_LOG_LIMIT, so localStorage does not grow forever.
function addActivityLog(message, level = "info") {
  const entries = getActivityLog();
  entries.unshift({ at: new Date().toISOString(), message, level });
  try {
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(entries.slice(0, ACTIVITY_LOG_LIMIT)));
  } catch {
    // If storage is not allowed, the page keeps working.
  }
  renderActivityLog();
}

// Show the saved log when the page opens and let the user clear it.
function setupActivityLog() {
  renderActivityLog();
  $("clearActivityLogBtn").addEventListener("click", () => {
    localStorage.removeItem(ACTIVITY_LOG_KEY);
    renderActivityLog();
  });
}

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

let chartFeedsForResize = null;
let chartResizeTimer = null;
let chartCustomRangeActive = false;

const $ = (id) => document.getElementById(id);

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
const CHART_STORAGE_KEY = "greenhouse-chart-fields";
const DEFAULT_CHART_FIELDS = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_CHART_SLOTS = 8;

// ---------- Chart helpers ----------

// ThingSpeak times are UTC, the page shows Budapest time.
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

// Short time for the status lines. It is always Budapest time, so the hour is the same for everyone who looks at the page.
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

// A datetime-local value looks like 2026-11-07T15:33. We cut it up with a regex instead of new Date(),
// so the time zone of the browser cannot shift the hour.
function formatCompactDateTimeInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  return match ? `${match[3]}.${match[2]}. ${match[4]}:${match[5]}` : value;
}

// The date input uses Budapest wall-clock time, whatever the time zone of the browser is.
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

// With many points the series is thinned, but the extreme values are kept.
function downsampleReadings(readings, maxPoints = 480) {
  if (readings.length <= maxPoints) {
    return readings.map((reading, index) => ({ ...reading, sourceIndex: index }));
  }

  // Keep the lowest and highest value of each group, so the peaks stay visible.
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

// ---------- Charts and cursor tracking ----------

// The charts are drawn as SVG, so no chart library is needed.
// The SVG is built from the data. A new filter needs a redraw, changing the label is not enough.
function renderThingSpeakCharts(feeds) {
  chartFeedsForResize = feeds;
  const svgNS = "http://www.w3.org/2000/svg";
  document.querySelectorAll("[data-field-chart]").forEach((chart) => {
    const chartWidth = Math.max(Math.round(chart.getBoundingClientRect().width) || 760, 320);
    const field = "field" + chart.dataset.fieldChart;
    const readings = feeds
      .map((feed) => ({
        // A missing field is NaN, so it is not shown as a fake zero measurement.
        value: feed[field] === null || feed[field] === "" ? Number.NaN : Number(feed[field]),
        timestamp: feed.created_at
      }))
      .filter((reading) => Number.isFinite(reading.value));
    const plottedReadings = downsampleReadings(readings);
    const fieldNumber = chart.dataset.fieldChart;
    const label = CHART_LABELS[fieldNumber] || chart.title;
    const unit = CHART_UNITS[fieldNumber] || "";
    const stateLabels = CHART_STATE_LABELS[fieldNumber];
    const chartLabel = unit ? `${label} (${unit})` : stateLabels ? `${label} · állapot` : label;
    const formatChartValue = (value) => {
      if (stateLabels && (value === 0 || value === 1)) return stateLabels[value];
      const formattedValue = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(value);
      return unit ? `${formattedValue} ${unit}` : formattedValue;
    };
    const svg = document.createElementNS(svgNS, "svg");
    // The viewBox follows the card width, so the labels do not shrink on mobile.
    svg.setAttribute("viewBox", `0 0 ${chartWidth} 270`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", chartLabel);

    const addText = (text, x, y, className, anchor = "start") => {
      const element = document.createElementNS(svgNS, "text");
      element.setAttribute("x", String(x));
      element.setAttribute("y", String(y));
      element.setAttribute("text-anchor", anchor);
      element.setAttribute("class", className);
      element.textContent = text;
      svg.append(element);
      return element;
    };

    const title = document.createElementNS(svgNS, "text");
    title.setAttribute("x", "24");
    title.setAttribute("y", "30");
    title.setAttribute("class", "chart-title");
    title.textContent = chartLabel;
    svg.append(title);

    const latestValue = readings.length
      ? formatChartValue(readings[readings.length - 1].value)
      : "—";
    addText(latestValue, chartWidth - 20, 30, "chart-value", "end");

    const plot = { left: stateLabels ? 114 : 58, right: chartWidth - 18, top: 76, bottom: 226 };
    const frame = document.createElementNS(svgNS, "rect");
    frame.setAttribute("x", String(plot.left));
    frame.setAttribute("y", String(plot.top));
    frame.setAttribute("width", String(plot.right - plot.left));
    frame.setAttribute("height", String(plot.bottom - plot.top));
    frame.setAttribute("class", "chart-frame");
    svg.append(frame);

    const values = readings.map((reading) => reading.value);
    let min = stateLabels ? 0 : values.length ? Math.min(...values) : 0;
    let max = stateLabels ? 1 : values.length ? Math.max(...values) : 1;
    if (min === max) {
      // For a constant value give the axis a small range, otherwise the line calculation divides by zero.
      const padding = Math.abs(min) * 0.1 || 1;
      min -= padding;
      max += padding;
    }
    const range = max - min || 1;
    const tickCount = stateLabels ? 2 : 4;

    if (readings.length) {
      const summary = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 });
      const summaryText = stateLabels
        ? `0 = ${stateLabels[0]}  ·  1 = ${stateLabels[1]}`
        : `Min. ${summary.format(min)}${unit ? ` ${unit}` : ""}  ·  Max. ${summary.format(max)}${unit ? ` ${unit}` : ""}`;
      addText(summaryText, 24, 53, "chart-summary");
    }

    for (let index = 0; index < tickCount; index += 1) {
      const ratio = index / (tickCount - 1);
      const y = plot.top + ratio * (plot.bottom - plot.top);
      const tickValue = max - ratio * range;
      const gridLine = document.createElementNS(svgNS, "line");
      gridLine.setAttribute("x1", String(plot.left));
      gridLine.setAttribute("x2", String(plot.right));
      gridLine.setAttribute("y1", y.toFixed(1));
      gridLine.setAttribute("y2", y.toFixed(1));
      gridLine.setAttribute("class", "chart-grid-line");
      svg.append(gridLine);
      const axisLabel = stateLabels
        ? stateLabels[Math.round(tickValue)]
        : new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 }).format(tickValue);
      addText(axisLabel, plot.left - 10, y + 4, "chart-axis-label", "end");
    }

    const xTickCount = Math.min(5, readings.length);
    const formatTimestamp = (timestamp) => {
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime())
        ? ""
        : new Intl.DateTimeFormat("hu-HU", {
            timeZone: "Europe/Budapest",
            month: "short",
            day: "numeric"
          }).format(date);
    };

    for (let index = 0; index < xTickCount; index += 1) {
      // Spread the time labels evenly over the whole series.
      const ratio = xTickCount === 1 ? 0.5 : index / (xTickCount - 1);
      const x = plot.left + ratio * (plot.right - plot.left);
      const gridLine = document.createElementNS(svgNS, "line");
      gridLine.setAttribute("x1", x.toFixed(1));
      gridLine.setAttribute("x2", x.toFixed(1));
      gridLine.setAttribute("y1", String(plot.top));
      gridLine.setAttribute("y2", String(plot.bottom));
      gridLine.setAttribute("class", "chart-grid-line");
      svg.append(gridLine);

      const readingIndex = Math.round(ratio * Math.max(readings.length - 1, 0));
      const timestampLabel = readings.length ? formatTimestamp(readings[readingIndex].timestamp) : "";
      const anchor = index === 0 ? "start" : index === xTickCount - 1 ? "end" : "middle";
      addText(timestampLabel, x, plot.bottom + 22, "chart-axis-label", anchor);
    }

    if (plottedReadings.length) {
      // Map the sensor values to the coordinates of the drawing area.
      const coordinates = plottedReadings.map((reading) => ({
        x: readings.length === 1 ? (plot.left + plot.right) / 2 : plot.left + (reading.sourceIndex / (readings.length - 1)) * (plot.right - plot.left),
        y: plot.bottom - ((reading.value - min) / range) * (plot.bottom - plot.top)
      }));

      const pointList = coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      const area = document.createElementNS(svgNS, "polygon");
      area.setAttribute("points", `${plot.left},${plot.bottom} ${pointList} ${plot.right},${plot.bottom}`);
      area.setAttribute("class", "chart-area");
      svg.append(area);

      const line = document.createElementNS(svgNS, "polyline");
      line.setAttribute("points", pointList);
      line.setAttribute("class", "chart-line");
      svg.append(line);

      const latestPoint = coordinates.at(-1);
      const marker = document.createElementNS(svgNS, "circle");
      marker.setAttribute("cx", latestPoint.x.toFixed(1));
      marker.setAttribute("cy", latestPoint.y.toFixed(1));
      marker.setAttribute("r", "5");
      marker.setAttribute("class", "chart-last-point");
      svg.append(marker);

      const hoverIndicator = document.createElementNS(svgNS, "g");
      hoverIndicator.setAttribute("class", "chart-hover-indicator");
      hoverIndicator.setAttribute("aria-hidden", "true");

      const hoverLine = document.createElementNS(svgNS, "line");
      hoverLine.setAttribute("y1", String(plot.top));
      hoverLine.setAttribute("y2", String(plot.bottom));
      hoverLine.setAttribute("class", "chart-hover-line");
      hoverIndicator.append(hoverLine);

      const hoverPoint = document.createElementNS(svgNS, "circle");
      hoverPoint.setAttribute("r", "6");
      hoverPoint.setAttribute("class", "chart-hover-point");
      hoverIndicator.append(hoverPoint);

      const tooltipWidth = 196;
      const tooltipHeight = 58;
      const tooltipBackground = document.createElementNS(svgNS, "rect");
      tooltipBackground.setAttribute("width", String(tooltipWidth));
      tooltipBackground.setAttribute("height", String(tooltipHeight));
      tooltipBackground.setAttribute("rx", "10");
      tooltipBackground.setAttribute("class", "chart-tooltip-background");
      hoverIndicator.append(tooltipBackground);

      const tooltipTime = document.createElementNS(svgNS, "text");
      tooltipTime.setAttribute("class", "chart-tooltip-time");
      tooltipTime.setAttribute("x", "12");
      tooltipTime.setAttribute("y", "22");
      hoverIndicator.append(tooltipTime);

      const tooltipValue = document.createElementNS(svgNS, "text");
      tooltipValue.setAttribute("class", "chart-tooltip-value");
      tooltipValue.setAttribute("x", "12");
      tooltipValue.setAttribute("y", "44");
      hoverIndicator.append(tooltipValue);

      svg.append(hoverIndicator);

      const hitArea = document.createElementNS(svgNS, "rect");
      hitArea.setAttribute("x", String(plot.left));
      hitArea.setAttribute("y", String(plot.top));
      hitArea.setAttribute("width", String(plot.right - plot.left));
      hitArea.setAttribute("height", String(plot.bottom - plot.top));
      hitArea.setAttribute("class", "chart-hover-area");
      hitArea.setAttribute("aria-label", "Mutass egy mérési pontot a grafikonon");
      svg.append(hitArea);

      const moveHoverIndicator = (event) => {
        const bounds = svg.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;

        const pointerX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;

        // Find the measurement nearest to the cursor and show its value.
        coordinates.forEach((coordinate, index) => {
          const distance = Math.abs(coordinate.x - pointerX);
          if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
          }
        });

        const coordinate = coordinates[nearestIndex];
        const reading = plottedReadings[nearestIndex];
        // Near the chart edges the tooltip goes to the other side and stays inside the drawing area.
        const tooltipX = coordinate.x + tooltipWidth + 14 > plot.right
          ? coordinate.x - tooltipWidth - 14
          : coordinate.x + 14;
        const tooltipY = Math.max(
          plot.top + 4,
          Math.min(plot.bottom - tooltipHeight - 4, coordinate.y - tooltipHeight - 14)
        );

        hoverLine.setAttribute("x1", coordinate.x.toFixed(1));
        hoverLine.setAttribute("x2", coordinate.x.toFixed(1));
        hoverPoint.setAttribute("cx", coordinate.x.toFixed(1));
        hoverPoint.setAttribute("cy", coordinate.y.toFixed(1));
        tooltipBackground.setAttribute("x", tooltipX.toFixed(1));
        tooltipBackground.setAttribute("y", tooltipY.toFixed(1));
        tooltipTime.setAttribute("x", (tooltipX + 12).toFixed(1));
        tooltipTime.setAttribute("y", (tooltipY + 22).toFixed(1));
        tooltipValue.setAttribute("x", (tooltipX + 12).toFixed(1));
        tooltipValue.setAttribute("y", (tooltipY + 44).toFixed(1));
        tooltipTime.textContent = formatBudapestTime(reading.timestamp);
        tooltipValue.textContent = formatChartValue(reading.value);
        hoverIndicator.classList.add("is-visible");
      };

      hitArea.addEventListener("pointermove", moveHoverIndicator);
      hitArea.addEventListener("pointerdown", moveHoverIndicator);
      hitArea.addEventListener("pointerleave", () => hoverIndicator.classList.remove("is-visible"));
    } else {
      addText("Nincs mérési adat", (plot.left + plot.right) / 2, (plot.top + plot.bottom) / 2, "chart-axis-label", "middle");
    }

    chart.replaceChildren(svg);
  });
}

// Redraw on resize, so the chart stays readable when the phone is rotated.
window.addEventListener("resize", () => {
  if (!chartFeedsForResize) return;
  window.clearTimeout(chartResizeTimer);
  chartResizeTimer = window.setTimeout(() => renderThingSpeakCharts(chartFeedsForResize), 150);
});

// ---------- Chat and sensor data ----------

// The chat reply is shown as text, not as HTML.
// Because of textContent, HTML in a message does not run.
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
  // Saving is off for restored messages, a new message updates the history.
  if (save && ["user", "bot"].includes(type)) saveChatHistory();
  return body;
}

// A plain "szia" does not need an AI call, so it gets a fixed answer (see submitChat) and costs nothing.
function isSimpleGreeting(message) {
  return /^(szia|helló|hello|üdv|jó napot|jó reggelt|jó estét|szevasz|szervusz|hi|hey)[!.?\s]*$/iu.test(message.trim());
}

// The model sometimes answers with markdown (**bold**, # headings, - lists) but the chat bubble shows plain text,
// so we remove the markdown characters instead of showing stray asterisks.
function cleanAssistantReply(message) {
  return String(message)
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/(^|\n)#{1,6}\s*/g, "$1")
    .replace(/(^|\n)\s*[-*]\s+/g, "$1• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ThingSpeak fields arrive as text. Missing values are handled as null.
function numericField(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Hungarian number format (decimal comma). null shows a dash, never a fake zero.
function formatted(value, digits = 0) {
  return value === null ? "—" : new Intl.NumberFormat("hu-HU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

// Value + unit in one card; a dash when the sensor sent nothing.
function setMetric(id, value, unit, digits = 0) {
  $(id).textContent = value === null ? "—" : `${formatted(value, digits)} ${unit}`;
}

// Same as setMetric, for the places where the unit is written separately in the HTML.
function setNumber(id, value, digits = 0) {
  $(id).textContent = formatted(value, digits);
}

// The CSS class (status-on, status-off, ...) decides the colour of the badge.
function setStateBadge(id, label, stateName) {
  const element = $(id);
  element.textContent = label;
  element.className = `status status-${stateName}`;
}

// Follow the real device state until the user clicks the demo switch once. After that the page keeps the choice of the user,
// because these switches are only a demo, they do not control the ESP32.
function syncDemoSwitch(id, isOn) {
  const control = $(id);
  if (!control.dataset.previewChanged) control.checked = isOn === true;
}

// ---------- Dashboard measurements ----------

// Update the measurement cards and the switches from one ThingSpeak record.
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
      // So an earlier measurement can still be shown after a network error.
      localStorage.setItem(SENSOR_CACHE_KEY, JSON.stringify(entry));
    } catch {
      // A full storage must not stop the fresh measurement from showing.
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
  // A measurement older than two minutes is marked as old data.
  const isStale = ageSeconds !== null && ageSeconds > 120;
  $("lastUpdated").textContent = date && !Number.isNaN(date.valueOf())
    ? `Utoljára frissítve: ${date.toLocaleString("hu-HU")}`
    : "A ThingSpeak nem adott meg mérési időpontot.";
  $("connectionStatus").textContent = isStale ? "Régi mérés" : "Kapcsolódva";
  $("connectionStatus").className = `connection-pill ${isStale ? "stale" : "connected"}`;
}

// Load a few recent records for the cards and for the data package of the AI chat.
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
    $("connectionStatus").className = "connection-pill disconnected";
    if (!state.lastEntry) $("lastUpdated").textContent = "Nem sikerült csatlakozni a ThingSpeak csatornához.";
    if (!quiet) addChatMessage("Rendszer", error.message || "Nem sikerült adatot betölteni a ThingSpeak csatornából.", "system");
    if (!quiet) addActivityLog("Nem sikerült betölteni a legutóbbi szenzoradatokat.", "error");
    console.error("ThingSpeak read failed:", error);
  } finally {
    if (button) button.disabled = false;
  }
}

// Load the data of the selected period, then redraw the charts.
// The filter goes into the API request, so the chart really uses the requested data.
async function loadChartHistory({ quiet = false } = {}) {
  const button = $("refreshChartsBtn");
  const status = $("chartStatus");
  const rangeSelect = $("chartRangeSelect");

  if (button) button.disabled = true;
  if (!quiet) status.textContent = "Grafikonadatok betöltése…";

  try {
    let params;
    let rangeLabel;
    if (chartCustomRangeActive) {
      const start = $("chartStartDate").value;
      const end = $("chartEndDate").value;
      if (!start || !end || end <= start) {
        throw new Error("Adj meg érvényes kezdő és záró időpontot; a záró időpont legyen későbbi.");
      }
      params = new URLSearchParams({ start, end });
      rangeLabel = `${formatCompactDateTimeInput(start)}–${formatCompactDateTimeInput(end)}`;
    } else {
      const [rangeType, rangeValue] = rangeSelect.value.split(":");
      params = new URLSearchParams({ [rangeType]: rangeValue });
      rangeLabel = rangeSelect.selectedOptions[0]?.textContent || "kiválasztott időszak";
    }

    const response = await fetch(`/api/thingspeak?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `ThingSpeak válasza: ${response.status}`);

    const feeds = Array.isArray(data.feeds) ? data.feeds : [];
    renderThingSpeakCharts(feeds);
    // Kept for the PDF report. The charts themselves are taken from the page.
    // The default view is the last 60 measurements. Anything else counts as a filter.
    state.chartFiltered = chartCustomRangeActive || rangeSelect.value !== "results:60";
    state.chartPeriodLabel = `${rangeLabel} · ${new Intl.NumberFormat("hu-HU").format(feeds.length)} mérési pont`;
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

// ---------- Weather ----------

// City search and the current weather use the Open-Meteo service.
function setWeatherStatus(message, isError = false) {
  const status = $("weatherStatus");
  status.textContent = message;
  status.classList.toggle("weather-error", isError);
}

// Not every value is a number (the service can send nothing), so show a dash instead of NaN.
function weatherNumber(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("hu-HU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(number)
    : "—";
}

// timezone=auto makes Open-Meteo return the time of the place itself, not the time of the browser.
async function loadCurrentWeather(latitude, longitude, placeName) {
  setWeatherStatus("Időjárási adatok lekérése…");
  // The weather service gives the current data in its own local time for the coordinates.
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

// If the user already picked a suggestion we reuse its coordinates, so there is no second geocoding request.
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

// These variables handle the suggestion list while typing and the keyboard selection.
// After typing we wait a little before asking for suggestions, so there is no request for every key.
let weatherSuggestionTimer;
let weatherSuggestionRequest = 0;
let weatherSelectedPlace = null;
let weatherSelectedQuery = "";
let weatherActiveSuggestion = -1;

// Remove duplicates (for example Budapest, Budapest, Magyarország) before joining the name.
function formatWeatherPlace(place) {
  return [place.name, place.admin1, place.country]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
}

// Geocoding of Open-Meteo, only 5 results and in Hungarian, that is enough for a suggestion list.
async function findWeatherPlaces(query) {
  const params = new URLSearchParams({ name: query, count: "5", language: "hu", format: "json" });
  const response = await fetch("https://geocoding-api.open-meteo.com/v1/search?" + params.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("A településkereső nem érhető el.");
  const data = await response.json();
  return data.results || [];
}

// Besides hiding the list the aria attributes are reset too, so screen readers do not read an old list.
function closeWeatherSuggestions() {
  const input = $("weatherLocationInput");
  const list = $("weatherLocationSuggestions");
  list.hidden = true;
  list.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  weatherActiveSuggestion = -1;
}

// Submit the form right after the click, so choosing a suggestion loads the weather in one step.
function selectWeatherSuggestion(place) {
  const input = $("weatherLocationInput");
  input.value = formatWeatherPlace(place);
  weatherSelectedPlace = place;
  weatherSelectedQuery = input.value;
  closeWeatherSuggestions();
  $("weatherForm").requestSubmit();
}

// Requests can finish in a different order than they started. requestId and the query check throw away the old ones.
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
      option.className = "weather-suggestion";
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

// The selection wraps around with modulo. aria-activedescendant is used instead of moving the focus,
// so the user can keep typing while the list is open.
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

// Debounce: we wait until the user stops typing, otherwise every key would be an API call.
function handleWeatherLocationInput(event) {
  const query = event.currentTarget.value.trim();
  weatherSelectedPlace = null;
  weatherSelectedQuery = "";
  clearTimeout(weatherSuggestionTimer);
  // Drop the result of older requests if a newer search has started.
  weatherSuggestionRequest += 1;
  closeWeatherSuggestions();
  if (query.length < 2) return;
  weatherSuggestionTimer = setTimeout(() => loadWeatherSuggestions(query), 300);
}

// Arrow keys move in the list, Enter picks the highlighted item.
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

// Reverse geocoding with Nominatim, only after the user clicks the location button (this is in its usage policy).
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

// The location is requested only after the button is pressed.
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
  // Connect the events of the search field, the keyboard and the location button.
  $("weatherForm").addEventListener("submit", searchWeatherByCity);
  $("weatherLocationInput").addEventListener("input", handleWeatherLocationInput);
  $("weatherLocationInput").addEventListener("keydown", handleWeatherLocationKeydown);
  $("weatherLocationInput").addEventListener("blur", () => setTimeout(closeWeatherSuggestions, 150));
  $("useMyLocationBtn").addEventListener("click", useCurrentLocation);
}

// ---------- AI chat ----------

// Collect the sensor data that is sent together with the question of the user.
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

// While sending, the disabled button stops the question from being sent twice by accident.
async function submitChat(event) {
  event.preventDefault();
  const input = $("chatInput");
  const message = input.value.trim();
  if (!message) return;

  addChatMessage("Te", message, "user");
  // Leave out the question that was just sent. The server gets it separately.
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

// ---------- Starting the page ----------

// The theme is a "dark" class on <html> and a value in localStorage. The theme-color meta keeps the mobile browser bar in sync.
// TODO: the same code is in add-device.js, it could be one shared file.
function setupTheme() {
  // The browser remembers the chosen theme, so it does not reset after changing page.
  const savedTheme = localStorage.getItem("greenhouse-theme");
  const themeToggle = $("themeToggle");
  if (savedTheme === "dark") document.documentElement.classList.add("dark");
  const updateThemeState = () => {
    themeToggle.setAttribute("aria-pressed", String(document.documentElement.classList.contains("dark")));
  };
  updateThemeState();
  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    localStorage.setItem("greenhouse-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121813" : "#f3f6f1");
    updateThemeState();
  });
}

// Hamburger menu for small screens. It closes after a link click, so it does not cover the section we scrolled to.
// aria-expanded and aria-label are updated for screen readers.
function setupNavigation() {
  const menuButton = $("menuToggle");
  const menuIcon = menuButton.querySelector(".material-symbols-rounded");
  const navLinks = $("navLinks");
  menuButton.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Menü bezárása" : "Menü megnyitása");
    menuIcon.textContent = isOpen ? "close" : "menu";
  });
  navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Menü megnyitása");
    menuIcon.textContent = "menu";
  }));
}

// Demo switches: they do not send any control to the microcontroller.
function setupDemoSwitches() {
  // These are only visual switches, they send no command to the ESP32.
  ["fanDemoSwitch", "ledDemoSwitch", "roofDemoSwitch"].forEach((id) => {
    $(id).addEventListener("change", (event) => {
      event.currentTarget.dataset.previewChanged = "true";
    });
  });
}

// Restores the last chart range from localStorage. The quick select and the custom range exclude each other:
// when the custom range is active the select is empty.
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

// Set up the buttons of the page, then start refreshing the data.
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
  // The PDF module is a separate file; if it is missing (e.g. an old cached version), show a readable message.
  // The charts go into the PDF only when a filter is set, otherwise the PDF has the general data only.
  const reportOptions = () => (state.chartFiltered
    ? { charts: [...document.querySelectorAll("[data-field-chart] svg")], periodLabel: state.chartPeriodLabel }
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
      // The report uses the loaded data; demo toggles do not override the device states.
      const report = getReportModule();
      const name = await report.download(state.lastEntry, reportOptions());
      addActivityLog(`A mérési jelentés PDF-ként letöltődött (${name}).`);
    } catch (error) {
      addActivityLog(error.message, "error");
      window.alert(error.message);
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
        window.alert(`A PDF letöltődött: ${result.fileName}\n\nA levelező megnyílik – a küldés előtt csatold hozzá a letöltött fájlt.`);
      }
    } catch (error) {
      addActivityLog(error.message, "error");
      window.alert(error.message);
    }
  });
  $("refreshDataBtn").addEventListener("click", () => {
    loadLatestReadings();
    loadChartHistory({ quiet: true });
  });
  $("chatForm").addEventListener("submit", submitChat);
  // Restore the earlier conversation first, so the greeting shows only in an empty chat.
  const hasChatHistory = restoreChatHistory();
  if (!hasChatHistory) {
    addChatMessage("Növényház okos kertésze", CHAT_GREETING_TEXT, "bot");
  }
  // The saved measurement is visible at once. The next line asks ThingSpeak for fresh data.
  restoreCachedReading();
  loadLatestReadings();
  loadChartHistory({ quiet: true });
  state.refreshTimer = window.setInterval(() => loadLatestReadings({ quiet: true }), REFRESH_INTERVAL_MS);
  state.chartRefreshTimer = window.setInterval(() => loadChartHistory({ quiet: true }), CHART_REFRESH_INTERVAL_MS);
}

// The order and visibility of the rows are edited, the measurements are not deleted.
function setupSummaryEditor() {
  // Handle the order and visibility of the rows in the top ThingSpeak card.
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

  // Rows are hidden, not deleted, so they can be added back later. Visible rows are appended in the saved order.
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

  // Every change is saved at once and both the card and the editor list are drawn again.
  function saveOrder(nextOrder) {
    order = nextOrder;
    localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(order));
    updateRows();
    renderEditorList();
  }

  // Take the row out and put it at the position of the target row (used by drag and drop and by the buttons).
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

  // The list is built from DOM elements, not from innerHTML, so no text can turn into HTML.
  function renderEditorList() {
    list.replaceChildren();
    order.forEach((key, index) => {
      const rowInfo = SUMMARY_ROWS.find((row) => row.key === key);
      if (!rowInfo) return;

      const item = document.createElement("li");
      item.className = "summary-config-item";
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
      upButton.className = "icon-button summary-config-button";
      upButton.disabled = index === 0;
      upButton.setAttribute("aria-label", `${rowInfo.label} mozgatása feljebb`);
      upButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">arrow_upward</span>';
      upButton.addEventListener("click", () => moveRow(key, order[index - 1]));

      const downButton = document.createElement("button");
      downButton.type = "button";
      downButton.className = "icon-button summary-config-button";
      downButton.disabled = index === order.length - 1;
      downButton.setAttribute("aria-label", `${rowInfo.label} mozgatása lejjebb`);
      downButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">arrow_downward</span>';
      downButton.addEventListener("click", () => moveRow(key, order[index + 1]));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "icon-button summary-config-button summary-remove-button";
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
    document.body.classList.toggle("homepage-editing", isOpen);
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

// The card layout is a local setting and can be different in another browser.
function setupMetricEditor() {
  // The environment cards can be sorted, hidden and put back the same way.
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

  // Same idea as updateRows, but for the environment cards.
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

  // Same as in the summary editor, but for the environment cards.
  function saveOrder(nextOrder) {
    order = nextOrder;
    localStorage.setItem(METRIC_STORAGE_KEY, JSON.stringify(order));
    applyOrder();
    renderList();
  }

  // Same reordering as moveRow.
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

  // Editor list of the cards, built from DOM elements like renderEditorList.
  function renderList() {
    list.replaceChildren();
    order.forEach((key, index) => {
      const itemInfo = METRIC_CARDS.find((item) => item.key === key);
      if (!itemInfo) return;
      const item = document.createElement("li");
      item.className = "summary-config-item";
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
        button.className = "icon-button summary-config-button";
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
      remove.className = "icon-button summary-config-button summary-remove-button";
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

// Fields are assigned to the chart slots. Deleting a tile only changes the layout.
function setupChartEditor() {
  // Save the selected chart fields. An empty slot can get a new field.
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

  // Set removes duplicates and slice keeps at most MAX_CHART_SLOTS. The charts are drawn again from the feeds that are
  // already loaded, so there is no new API call.
  function saveFields(nextFields) {
    fields = [...new Set(nextFields)].slice(0, MAX_CHART_SLOTS);
    localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(fields));
    renderSlots();
    if (chartFeedsForResize) renderThingSpeakCharts(chartFeedsForResize);
  }

  // One tile for every chosen field and an empty tile with a plus button for each free slot.
  function renderSlots() {
    grid.replaceChildren();
    fields.forEach((field) => {
      const tile = document.createElement("article");
      tile.className = "chart-tile";
      tile.dataset.chartTile = String(field);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button chart-remove-button";
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
      addButton.className = "chart-add-trigger";
      addButton.setAttribute("aria-label", "Grafikon hozzáadása");
      addButton.title = "Grafikon hozzáadása";
      addButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">add</span>';

      const picker = document.createElement("div");
      picker.className = "chart-add-picker";
      picker.hidden = true;
      const select = document.createElement("select");
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
      confirm.className = "button secondary chart-add-confirm";
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

// The page must be visible before scrolling, so the final positions can be measured.
function showDashboard() {
  $("loginScreen").hidden = true;
  $("appShell").hidden = false;
  initializeDashboard();

  // The main page becomes visible after login, so we scroll to the target after that.
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

// Error text of the login form.
function setLoginMessage(message) {
  $("loginMessage").textContent = message;
}

// The session cookie is HttpOnly, so JavaScript cannot read it. This is why we have to ask the server if we are logged in.
async function checkLogin() {
  const response = await fetch("/api/auth", { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Nem sikerült ellenőrizni a bejelentkezést.");
  if (result.authenticated) showDashboard();
}

// Password show/hide button and the login form. The password is only sent to the server, it is not stored in the browser.
// TODO: script.js is already very long, the login part could move to its own file.
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

document.addEventListener("DOMContentLoaded", setupAuthentication);
