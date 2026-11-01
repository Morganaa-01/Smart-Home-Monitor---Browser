import { fetchThingSpeakFeeds, ThingSpeakError } from "./lib/thingspeak.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const hasDays = req.query?.days !== undefined;
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

  try {
    const data = await fetchThingSpeakFeeds(
      isSeptemberDemoPeriod
        ? { start: "2026-08-31T22:00:00Z", end: "2026-09-30T21:50:00Z" }
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
