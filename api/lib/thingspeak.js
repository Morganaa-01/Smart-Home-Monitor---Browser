const DEFAULT_CHANNEL_ID = "3560978";
const MAX_RESULTS = 8000;

export class ThingSpeakError extends Error {
  constructor(message, code, statusCode = 502) {
    super(message);
    this.name = "ThingSpeakError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function fetchThingSpeakFeeds({ results = 60, days, start, end } = {}) {
  // A csatorna adatait a szerver környezeti változóiból olvassuk ki.
  const channelId = process.env.THINGSPEAK_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const readApiKey = process.env.THINGSPEAK_READ_API_KEY;

  const url = new URL(`https://api.thingspeak.com/channels/${encodeURIComponent(channelId)}/feeds.json`);
  if (readApiKey) url.searchParams.set("api_key", readApiKey);
  url.searchParams.set("timezone", "UTC");

  // Egy lekérdezés időintervallumot, napok számát vagy rekordszámot kap.
  if (start && end) {
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("results", String(MAX_RESULTS));
  } else if (Number.isInteger(days)) {
    const safeDays = Math.max(1, Math.min(days, 365));
    url.searchParams.set("days", String(safeDays));
    url.searchParams.set("results", String(MAX_RESULTS));
  } else {
    const safeResults = Number.isInteger(results)
      ? Math.max(1, Math.min(results, MAX_RESULTS))
      : 60;
    url.searchParams.set("results", String(safeResults));
  }

  let response;
  try {
    // Az API-kulcs szerveroldalon marad, nem kerül ki a böngészőbe.
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new ThingSpeakError(
      "Nem sikerült elérni a ThingSpeak szolgáltatást.",
      error.cause?.code || "thingspeak_network_error"
    );
  }

  if (!response.ok) {
    throw new ThingSpeakError(
      readApiKey
        ? "Nem sikerült adatot olvasni a ThingSpeak-csatornából."
        : "Nem sikerült olvasni a ThingSpeak-csatornát. Ha privát csatornát használsz, állíts be Read API Key-t.",
      readApiKey ? "thingspeak_read_failed" : "missing_thingspeak_read_key"
    );
  }

  const data = await response.json();
  if (!Array.isArray(data.feeds)) {
    throw new ThingSpeakError(
      "A ThingSpeak nem adott vissza mérési adatokat.",
      "invalid_thingspeak_response"
    );
  }

  return data;
}
