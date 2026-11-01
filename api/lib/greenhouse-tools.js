import { fetchThingSpeakFeeds } from "./thingspeak.js";
import { GREENHOUSE_CONFIG } from "./greenhouse-config.js";

const HISTORY_FIELDS = ["all", ...GREENHOUSE_CONFIG.fields.map(({ field }) => field)];
const STATE_FIELDS = new Set(["field5", "field6", "field7", "field8"]);
const MAX_HISTORY_HOURS = 720;
const MAX_HISTORY_SAMPLES = 40;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BUDAPEST_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function formatBudapestTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    BUDAPEST_FORMATTER.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );
  const localEpoch = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offsetMinutes = Math.round((localEpoch - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function budapestDate(timestamp) {
  return formatBudapestTimestamp(timestamp)?.slice(0, 10) || "unknown";
}

function addBudapestTime(sample) {
  return { ...sample, recorded_at_budapest: formatBudapestTimestamp(sample.recorded_at) };
}

function budapestMidnightUtc(dateString) {
  if (!DATE_ONLY_PATTERN.test(dateString)) return null;
  const [year, month, day] = dateString.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const check = new Date(target);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  let guess = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const local = Object.fromEntries(BUDAPEST_FORMATTER.formatToParts(new Date(guess))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]));
    const representedAsUtc = Date.UTC(
      Number(local.year), Number(local.month) - 1, Number(local.day),
      Number(local.hour), Number(local.minute), Number(local.second)
    );
    guess += target - representedAsUtc;
  }
  return new Date(guess);
}

export const GREENHOUSE_TOOLS = [
  {
    type: "function",
    name: "get_latest_sensor_data",
    description: "Read the newest ThingSpeak measurement. Use this when the user asks about current greenhouse readings or device states.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "get_sensor_history",
    description: "Read historical ThingSpeak data and calculate summaries. Use hours for relative time ranges (1 to 720), or Budapest calendar dates for explicit date questions.",
    parameters: {
      type: "object",
      properties: {
        hours: { type: ["integer", "null"], description: "Number of hours before now to include, from 1 to 720; null when calendar dates are supplied." },
        start_date: { type: ["string", "null"], description: "Optional inclusive Budapest start date in YYYY-MM-DD format." },
        end_date: { type: ["string", "null"], description: "Optional inclusive Budapest end date in YYYY-MM-DD format." },
        field: { type: "string", enum: HISTORY_FIELDS, description: "One ThingSpeak field, or all fields." }
      },
      required: ["hours", "start_date", "end_date", "field"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "get_greenhouse_config",
    description: "Read the confirmed ThingSpeak field mapping, units, controller role, and which plant thresholds are configured. Use this before interpreting a field or discussing configured limits.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  }
];

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestFeed(data) {
  const feed = data.feeds.at(-1);
  if (!feed) {
    const error = new Error("A ThingSpeak-csatornában még nincs mérési adat.");
    error.code = "empty_thingspeak_feed";
    error.statusCode = 502;
    throw error;
  }

  const timestamp = feed.created_at || null;
  const ageSeconds = timestamp ? Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000)) : null;

  return {
    measured_at: timestamp,
    measured_at_utc: timestamp,
    measured_at_budapest: formatBudapestTimestamp(timestamp),
    data_age_seconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    data_is_stale: Number.isFinite(ageSeconds) ? ageSeconds > 120 : null,
    entry_id: feed.entry_id ?? null,
    temperature_c: numericValue(feed.field1),
    relative_humidity_percent: numericValue(feed.field2),
    air_pressure: numericValue(feed.field3),
    illuminance_lux: numericValue(feed.field4),
    rain_detected: numericValue(feed.field5),
    fan_on: numericValue(feed.field6),
    led_on: numericValue(feed.field7),
    roof_open: numericValue(feed.field8)
  };
}

function formatThingSpeakDate(date) {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function downsample(feeds, field) {
  const valid = feeds
    .map((feed) => ({ recorded_at: feed.created_at, value: numericValue(feed[field]) }))
    .filter((sample) => sample.recorded_at && sample.value !== null);

  if (valid.length <= MAX_HISTORY_SAMPLES) return valid;

  const step = (valid.length - 1) / (MAX_HISTORY_SAMPLES - 1);
  return Array.from({ length: MAX_HISTORY_SAMPLES }, (_, index) => valid[Math.round(index * step)]);
}

function summarizeField(feeds, field) {
  const values = feeds
    .map((feed) => ({ recorded_at: feed.created_at, value: numericValue(feed[field]) }))
    .filter((sample) => sample.recorded_at && sample.value !== null);

  if (!values.length) return null;

  const numbers = values.map(({ value }) => value);
  const total = numbers.reduce((sum, value) => sum + value, 0);
  const summary = {
    count: values.length,
    first: addBudapestTime(values[0]),
    last: addBudapestTime(values.at(-1)),
    minimum: Math.min(...numbers),
    maximum: Math.max(...numbers),
    mean: Number((total / numbers.length).toFixed(3)),
    samples: downsample(feeds, field).map(addBudapestTime)
  };

  if (STATE_FIELDS.has(field)) {
    summary.active_samples = numbers.filter((value) => value === 1).length;
    summary.active_percent = Number((summary.active_samples / numbers.length * 100).toFixed(1));
    let lastActive = null;
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (values[index].value === 1) {
        lastActive = values[index];
        break;
      }
    }
    summary.last_active_at_utc = lastActive?.recorded_at || null;
    summary.last_active_at_budapest = lastActive
      ? formatBudapestTimestamp(lastActive.recorded_at)
      : null;
  }

  return summary;
}

async function getLatestSensorData() {
  const data = await fetchThingSpeakFeeds({ results: 1 });
  return latestFeed(data);
}

async function getSensorHistory(args) {
  if (!HISTORY_FIELDS.includes(args.field)) {
    throw new Error("A kért ThingSpeak mező nem érvényes.");
  }

  let start;
  let end;
  let requestedHours = null;
  if (args.start_date || args.end_date) {
    if (!args.start_date || !args.end_date || !DATE_ONLY_PATTERN.test(args.start_date) || !DATE_ONLY_PATTERN.test(args.end_date)) {
      throw new Error("A dátumtartományt YYYY-MM-DD formában, kezdő és záró nappal kell megadni.");
    }
    start = budapestMidnightUtc(args.start_date);
    const dayAfterEnd = new Date(`${args.end_date}T00:00:00Z`);
    dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
    end = budapestMidnightUtc(dayAfterEnd.toISOString().slice(0, 10));
    if (!start || !end || start >= end) throw new Error("A megadott budapesti dátumtartomány nem érvényes.");
  } else {
    requestedHours = Number(args.hours);
    if (!Number.isInteger(requestedHours) || requestedHours < 1 || requestedHours > MAX_HISTORY_HOURS) {
      throw new Error(`A kért időtartam 1 és ${MAX_HISTORY_HOURS} óra közé essen.`);
    }
    end = new Date();
    start = new Date(end.getTime() - requestedHours * 60 * 60 * 1000);
  }
  const data = await fetchThingSpeakFeeds({
    start: formatThingSpeakDate(start),
    end: formatThingSpeakDate(end)
  });
  // ThingSpeak may include a feed exactly at the requested end timestamp.
  const feeds = data.feeds.filter((feed) => {
    const timestamp = Date.parse(feed.created_at);
    return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
  });
  const fields = args.field === "all" ? HISTORY_FIELDS.slice(1) : [args.field];
  const summaries = Object.fromEntries(
    fields.map((field) => [field, summarizeField(feeds, field)])
  );
  const dailyFeeds = feeds.reduce((groups, feed) => {
    const day = budapestDate(feed.created_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(feed);
    return groups;
  }, new Map());
  const dailySummaries = Object.fromEntries(
    [...dailyFeeds].map(([day, feeds]) => [day, Object.fromEntries(
      fields.map((field) => [field, summarizeField(feeds, field)])
    )])
  );

  return {
    requested_hours: requestedHours,
    requested_start_date_budapest: args.start_date || null,
    requested_end_date_budapest: args.end_date || null,
    start_utc: start.toISOString(),
    end_utc: end.toISOString(),
    start_budapest: formatBudapestTimestamp(start.toISOString()),
    end_budapest: formatBudapestTimestamp(end.toISOString()),
    timezone: "Europe/Budapest",
    returned_records: feeds.length,
    possibly_truncated: feeds.length >= 8000,
    daily_budapest: dailySummaries,
    fields: summaries
  };
}

export async function runGreenhouseTool(name, args = {}) {
  switch (name) {
    case "get_latest_sensor_data":
      return getLatestSensorData();
    case "get_sensor_history":
      return getSensorHistory(args);
    case "get_greenhouse_config":
      return GREENHOUSE_CONFIG;
    default:
      throw new Error(`Unknown greenhouse tool: ${name}`);
  }
}
