const DEFAULT_CHANNEL_ID = "3560978";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const channelId = process.env.THINGSPEAK_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const readApiKey = process.env.THINGSPEAK_READ_API_KEY;
  if (!readApiKey) {
    return res.status(500).json({
      error: "Hiányzik a ThingSpeak Read API Key szerverbeállítása.",
      code: "missing_thingspeak_read_key"
    });
  }

  const requestedResults = Number(req.query?.results ?? 60);
  const results = Number.isInteger(requestedResults)
    ? Math.max(1, Math.min(requestedResults, 8000))
    : 60;
  const url = new URL(`https://api.thingspeak.com/channels/${encodeURIComponent(channelId)}/feeds.json`);
  url.searchParams.set("api_key", readApiKey);
  url.searchParams.set("results", String(results));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      console.error("[thingspeak] Feed request failed", { status: response.status });
      return res.status(502).json({
        error: "Nem sikerült adatot olvasni a ThingSpeak-csatornából. Ellenőrizd a csatornaazonosítót és a Read API Key-t.",
        code: "thingspeak_read_failed"
      });
    }

    const data = await response.json();
    if (!Array.isArray(data.feeds)) {
      return res.status(502).json({
        error: "A ThingSpeak nem adott vissza mérési adatokat.",
        code: "invalid_thingspeak_response"
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("[thingspeak] Server request failed", {
      name: error.name,
      networkCode: error.cause?.code || null
    });
    return res.status(502).json({
      error: "Nem sikerült elérni a ThingSpeak szolgáltatást. Ellenőrizd a szerver internetkapcsolatát.",
      code: "thingspeak_network_error"
    });
  }
}
