/*
Az AI számára elérhető adatlekérések és összesítések.
Az eszközleírások megmondják a modellnek, mit kérhet; a fájl végén
lévő elágazás választja ki a ténylegesen futó függvényt.
A hiányzó adat nem nullás mérés. A ritkított mintasor csökkenti
a válasz méretét, az összesítések a lekért adatokból készülnek.
*/
// Az asszisztens innen olvashatja ki a friss és korábbi szenzoradatokat, valamint az azokból számolt összesítéseket.
import { fetchThingSpeakFeeds } from "./thingspeak.js";
import { GREENHOUSE_CONFIG } from "./greenhouse-config.js";

const HISTORY_FIELDS = ["all", ...GREENHOUSE_CONFIG.fields.map(({ field }) => field)];
const STATE_FIELDS = new Set(["field5", "field6", "field7", "field8"]);
const MAX_HISTORY_HOURS = 720;
const MAX_HISTORY_SAMPLES = 40;
const SUNLIGHT_THRESHOLD_LUX = 600;
const MAX_SUNLIGHT_SAMPLE_GAP_SECONDS = 60;
const THINGSPEAK_UPLOAD_INTERVAL_SECONDS = 30;
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
  // A ThingSpeak UTC-időpontját úgy alakítjuk át, hogy a budapesti dátum és idő is megmaradjon.
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
  // A megadott naptári nap kezdetét UTC-re váltjuk; így az óraátállítás is helyesen működik.
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
    description: "Read historical ThingSpeak data and calculate summaries. For field4, also estimates greenhouse sunshine hours from readings above the configured 600 lux threshold. Use hours for relative time ranges (1 to 720), or Budapest calendar dates for explicit date questions.",
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

// A 0 érvényes mérés. Csak a hiányzó vagy hibás értékből legyen null.
function numericValue(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestFeed(data) {
  // A ThingSpeak-sor rövid field neveit itt beszédes nevekhez rendeljük az asszisztensnek.
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

// Az időszakból elosztva választunk mintákat, nem kell minden pontot a modellnek elküldeni.
function downsample(feeds, field) {
  const valid = feeds
    .map((feed) => ({ recorded_at: feed.created_at, value: numericValue(feed[field]) }))
    .filter((sample) => sample.recorded_at && sample.value !== null);

  if (valid.length <= MAX_HISTORY_SAMPLES) return valid;

  const step = (valid.length - 1) / (MAX_HISTORY_SAMPLES - 1);
  return Array.from({ length: MAX_HISTORY_SAMPLES }, (_, index) => valid[Math.round(index * step)]);
}

// Ez minták szerinti átlag, nem idővel súlyozott érték. Szabálytalan mintavételnél ez különbség.
function summarizeField(feeds, field) {
  // A hiányzó mező kimarad, a 0 viszont érvényes mérési érték marad.
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
    if (field === "field5") {
      summary.last_active_event = summarizeLastActiveEvent(feeds, field);
    }
  }

  return summary;
}

// Időrendbe rendezzük az adatokat; nagy adatszünet után külön eseményt kezdünk.
function summarizeLastActiveEvent(feeds, field) {
  const readings = feeds
    .map((feed) => ({ timestamp: Date.parse(feed.created_at), value: numericValue(feed[field]) }))
    .filter((reading) => Number.isFinite(reading.timestamp) && reading.value !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  let currentEvent = null;
  let lastEvent = null;
  let lastEventIsActive = false;
  // A kikapcsolt állapot lezárja a jelzést; nagy adatszünet után külön eseményt kezdünk.
  for (const reading of readings) {
    if (reading.value !== 1) {
      if (currentEvent) {
        lastEvent = currentEvent;
        lastEventIsActive = false;
      }
      currentEvent = null;
      continue;
    }

    if (!currentEvent || reading.timestamp - currentEvent.lastTimestamp > MAX_SUNLIGHT_SAMPLE_GAP_SECONDS * 1000) {
      if (currentEvent) {
        lastEvent = currentEvent;
        lastEventIsActive = false;
      }
      currentEvent = {
        firstTimestamp: reading.timestamp,
        lastTimestamp: reading.timestamp,
        activeSamples: 1
      };
      continue;
    }

    currentEvent.lastTimestamp = reading.timestamp;
    currentEvent.activeSamples += 1;
  }
  if (currentEvent) {
    lastEvent = currentEvent;
    lastEventIsActive = true;
  }
  if (!lastEvent) return null;

  // A ThingSpeak 30 másodpercenként küld mintát, ezért az esemény hossza becslés.
  return {
    started_at_budapest: formatBudapestTimestamp(new Date(lastEvent.firstTimestamp).toISOString()),
    last_active_at_budapest: formatBudapestTimestamp(new Date(lastEvent.lastTimestamp).toISOString()),
    active_samples: lastEvent.activeSamples,
    // A dátumok különbsége ezredmásodperc. Ehhez csak átváltás után adhatunk másodpercet.
    estimated_duration_seconds: (lastEvent.lastTimestamp - lastEvent.firstTimestamp) / 1000 + THINGSPEAK_UPLOAD_INTERVAL_SECONDS,
    is_active_at_end: lastEventIsActive,
    duration_is_estimated: true
  };
}

// Csak közeli, megfelelő minták közti idővel számolunk. Adathiányon át nem feltételezünk világosságot.
function calculateSunlightHours(feeds) {
  // Csak két egymást követő, 600 lux fölötti minta közötti időt számítjuk megvilágítottnak.
  const lightReadings = feeds
    .map((feed) => ({ timestamp: Date.parse(feed.created_at), value: numericValue(feed.field4) }))
    .filter((reading) => Number.isFinite(reading.timestamp) && reading.value !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
  const secondsByDay = new Map();
  let countedIntervals = 0;
  let skippedLongGaps = 0;

  for (const reading of lightReadings) {
    const day = budapestDate(new Date(reading.timestamp).toISOString());
    if (!secondsByDay.has(day)) secondsByDay.set(day, 0);
  }

  for (let index = 0; index < lightReadings.length - 1; index += 1) {
    const current = lightReadings[index];
    const next = lightReadings[index + 1];
    const intervalSeconds = (next.timestamp - current.timestamp) / 1000;
    if (intervalSeconds <= 0) continue;
    // Hosszabb adatszünetet nem számítunk napsütésnek, mert nem tudjuk, mi történt közben.
    if (intervalSeconds > MAX_SUNLIGHT_SAMPLE_GAP_SECONDS) {
      skippedLongGaps += 1;
      continue;
    }
    if (current.value <= SUNLIGHT_THRESHOLD_LUX || next.value <= SUNLIGHT_THRESHOLD_LUX) continue;

    // A két egymást követő, küszöb feletti minta közötti időt a helyi napokhoz adjuk.
    let cursor = current.timestamp;
    while (cursor < next.timestamp) {
      const day = budapestDate(new Date(cursor).toISOString());
      const [year, month, date] = day.split("-").map(Number);
      const nextCalendarDay = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
      const midnight = budapestMidnightUtc(nextCalendarDay)?.getTime() ?? next.timestamp;
      const segmentEnd = Math.min(next.timestamp, midnight);
      secondsByDay.set(day, (secondsByDay.get(day) || 0) + (segmentEnd - cursor) / 1000);
      cursor = segmentEnd;
    }
    countedIntervals += 1;
  }

  const dailyHours = Object.fromEntries(
    [...secondsByDay].map(([day, seconds]) => [day, Number((seconds / 3600).toFixed(3))])
  );
  const totalSeconds = [...secondsByDay.values()].reduce((sum, seconds) => sum + seconds, 0);

  return {
    threshold_lux: SUNLIGHT_THRESHOLD_LUX,
    comparison: "greater_than",
    total_hours: Number((totalSeconds / 3600).toFixed(3)),
    counted_intervals: countedIntervals,
    skipped_long_gaps: skippedLongGaps,
    daily_hours_budapest: dailyHours
  };
}

async function getLatestSensorData() {
  const data = await fetchThingSpeakFeeds({ results: 1 });
  return latestFeed(data);
}

async function getSensorHistory(args) {
  // A naptári napokra bontást Budapest helyi ideje szerint végezzük.
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
    // A JavaScript például február 30-át márciusra igazítaná. Ezt még az átalakítás előtt elutasítjuk.
    if (!start || !budapestMidnightUtc(args.end_date)) {
      throw new Error("A megadott budapesti dátumtartomány nem érvényes.");
    }
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
  // A záró időpontot kizárjuk, hogy a szomszédos időszakokban ne duplázódjon egy minta.
  const feeds = data.feeds.filter((feed) => {
    const timestamp = Date.parse(feed.created_at);
    return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
  }).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
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
  const sunlightHours = calculateSunlightHours(feeds);
  for (const [day, hours] of Object.entries(sunlightHours.daily_hours_budapest)) {
    if (dailySummaries[day]) dailySummaries[day].sunshine_hours_above_threshold = hours;
  }

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
    sunshine_hours_above_threshold: sunlightHours,
    daily_budapest: dailySummaries,
    fields: summaries
  };
}

// A modell csak az itt felsorolt függvényeket kérheti, tetszőleges kódot nem futtathat.
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
