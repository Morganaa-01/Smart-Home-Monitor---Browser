import { fetchThingSpeakFeeds, ThingSpeakError } from "./lib/thingspeak.js";
import { requireAuthentication } from "./lib/auth.js";

const BUDAPEST_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const BUDAPEST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

// A datetime-local érték nem tartalmaz zónát, ezért Budapest időzónáját számoljuk hozzá.
function parseBudapestDateTime(value) {
  if (typeof value !== "string") return null;
  const match = BUDAPEST_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const calendarCheck = new Date(localAsUtc);
  if (calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day) return null;

  let timestamp = localAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(BUDAPEST_DATE_TIME_FORMATTER.formatToParts(new Date(timestamp))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]));
    const representedAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const adjustment = localAsUtc - representedAsUtc;
    timestamp += adjustment;
    if (adjustment === 0) break;
  }

  const resolved = Object.fromEntries(BUDAPEST_DATE_TIME_FORMATTER.formatToParts(new Date(timestamp))
    .filter(({ type }) => type !== "literal")
    .map(({ type, value: part }) => [type, part]));
  if (Number(resolved.year) !== year
    || Number(resolved.month) !== month
    || Number(resolved.day) !== day
    || Number(resolved.hour) !== hour
    || Number(resolved.minute) !== minute) return null;

  return new Date(timestamp);
}

export default async function handler(req, res) {
  if (!requireAuthentication(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  // Ellenőrizzük a lekérdezés paramétereit, hogy hibás időszaknál érthető választ adjunk.
  const hasDays = req.query?.days !== undefined;
  const hasStart = req.query?.start !== undefined;
  const hasEnd = req.query?.end !== undefined;
  const hasCustomRange = hasStart || hasEnd;
  const requestedPeriod = req.query?.period;
  const requestedDays = Number(req.query?.days);
  const requestedResults = Number(req.query?.results ?? 60);
  const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 365
    ? requestedDays
    : null;
  const results = Number.isInteger(requestedResults) ? requestedResults : 60;
  const isSeptemberDemoPeriod = requestedPeriod === "september-demo-2026";

  if (requestedPeriod !== undefined && !isSeptemberDemoPeriod) {
    return res.status(400).json({ error: "Ismeretlen ThingSpeak grafikon-időszak." });
  }

  if (hasDays && days === null) {
    return res.status(400).json({ error: "A days értéke 1 és 365 közötti egész szám legyen." });
  }

  let customStart;
  let customEnd;
  if (hasCustomRange) {
    customStart = parseBudapestDateTime(req.query.start);
    customEnd = parseBudapestDateTime(req.query.end);
    if (!hasStart || !hasEnd || !customStart || !customEnd || customStart >= customEnd
      || hasDays || requestedPeriod !== undefined || req.query?.results !== undefined) {
      return res.status(400).json({
        error: "Adj meg érvényes kezdő és záró időpontot Budapest helyi ideje szerint. A záró időpont legyen későbbi."
      });
    }
    if (customEnd.getTime() > Date.now() + 60_000) {
      return res.status(400).json({ error: "A záró időpont nem lehet a jövőben." });
    }
  }

  try {
    const data = await fetchThingSpeakFeeds(
      isSeptemberDemoPeriod
        ? { start: "2026-08-31T22:00:00Z", end: "2026-09-30T21:50:00Z" }
        : hasCustomRange
          ? { start: customStart.toISOString(), end: customEnd.toISOString() }
          : hasDays
            ? { days }
            : { results }
    );
    return res.status(200).json(data);
  } catch (error) {
    console.error("[thingspeak] Feed request failed", {
      code: error.code || "unknown",
      status: error.statusCode || 500
    });

    const status = error instanceof ThingSpeakError ? error.statusCode : 500;
    return res.status(status).json({
      error: error.message || "Nem sikerült adatot olvasni a ThingSpeak-csatornából.",
      code: error.code || "thingspeak_request_failed"
    });
  }
}
