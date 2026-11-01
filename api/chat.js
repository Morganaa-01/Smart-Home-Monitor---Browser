import { GREENHOUSE_TOOLS, runGreenhouseTool } from "./lib/greenhouse-tools.js";
import { GREENHOUSE_INSTRUCTIONS, GREENHOUSE_MODEL } from "./lib/greenhouse-prompt.js";
import { requireAuthentication } from "./lib/auth.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_TOOL_ROUNDS = 4;

async function fetchOpenAIWithRetry(apiKey, body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (attempt === 1) {
        const networkError = new Error("Nem sikerült elérni az OpenAI API-t.");
        networkError.code = "openai_network_error";
        networkError.cause = error;
        throw networkError;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
}

function isHistoricalDataQuestion(message) {
  if (isLastRainQuestion(message)) return true;
  if (extractBudapestDates(message).length > 0) return true;
  const asksAboutTime = /tegnap\w*|tegnapelőtt\w*|ma\w*|elmúlt\w*|utolsó\w*|trend\w*|átlag\w*|minimum\w*|maximum\w*|változás\w*|összehasonlít\w*|időbeli\w*/i.test(message);
  const asksAboutGreenhouseData = /adat\w*|mérés\w*|hőmérséklet\w*|páratartalom\w*|légnyomás\w*|megvilágítás\w*|lux\b|eső\w*|ventilátor\w*|led\b|tető\w*|szenzor\w*/i.test(message);
  return asksAboutTime && asksAboutGreenhouseData;
}

function isLastRainQuestion(message) {
  const normalized = message.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /mikor\w*|utoljara\w*|legutobb\w*/i.test(normalized) && /eso\w*|rain\w*/i.test(normalized);
}

export function extractBudapestDates(message) {
  const normalized = message.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const monthNumbers = {
    januar: "01", februar: "02", marcius: "03", aprilis: "04", majus: "05", junius: "06",
    julius: "07", augusztus: "08", szeptember: "09", oktober: "10", november: "11", december: "12"
  };
  const currentYear = new Intl.DateTimeFormat("en", { timeZone: "Europe/Budapest", year: "numeric" }).format(new Date());
  const dates = [];
  const datePattern = /(?:(20\d{2})\s*[.,]?\s*)?(januar|februar|marcius|aprilis|majus|junius|julius|augusztus|szeptember|oktober|november|december)\s+(\d{1,2})(?:\s*[- ]?(?:en|an|on|in))?/g;
  let inheritedYear = currentYear;
  for (const match of normalized.matchAll(datePattern)) {
    const year = match[1] || inheritedYear;
    inheritedYear = year;
    const date = `${year}-${monthNumbers[match[2]]}-${match[3].padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (parsed.toISOString().slice(0, 10) === date) dates.push(date);
  }
  return [...new Set(dates)].sort();
}

async function getRequestedDaySummaries(dates) {
  const days = await Promise.all(dates.map(async (date) => {
    const result = await runGreenhouseTool("get_sensor_history", {
      hours: null,
      start_date: date,
      end_date: date,
      field: "all"
    });
    const daily = result.daily_budapest[date] || null;
    const fields = daily && Object.fromEntries(Object.entries(daily).map(([field, summary]) => {
      if (!summary) return [field, null];
      const { samples, ...statistics } = summary;
      return [field, statistics];
    }));
    return { date, returned_records: result.returned_records, fields };
  }));

  return {
    timezone: "Europe/Budapest",
    requested_dates: dates,
    days: Object.fromEntries(days.map(({ date, ...data }) => [date, data]))
  };
}

async function getLastRainSummary() {
  const result = await runGreenhouseTool("get_sensor_history", {
    hours: 720,
    start_date: null,
    end_date: null,
    field: "field5"
  });
  const rain = result.fields.field5;
  return {
    requested_hours: result.requested_hours,
    start_budapest: result.start_budapest,
    end_budapest: result.end_budapest,
    returned_records: result.returned_records,
    possibly_truncated: result.possibly_truncated,
    field: "field5",
    sensor: "rain_sensor",
    last_active_at_budapest: rain?.last_active_at_budapest || null,
    active_samples: rain?.active_samples ?? 0,
    total_samples: rain?.count ?? 0
  };
}

function formatLastRainReply(summary) {
  if (!summary.total_samples) {
    return "A lekért előzményidőszakban nincs esőérzékelő-adat.";
  }
  if (!summary.last_active_at_budapest) {
    return "A lekért előzményidőszakban az esőérzékelő nem rögzített aktív jelzést.";
  }

  const date = new Date(summary.last_active_at_budapest);
  const formattedTime = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
  return `A lekért ThingSpeak-előzményekben az esőérzékelő legutóbb ${formattedTime}-kor jelzett (budapesti idő szerint). Ez az érzékelő jelzése; önmagában nem bizonyítja, hogy ténylegesen esett az eső.`;
}

function buildUserInput(message, sensorContext, historyResult = null) {
  const context = JSON.stringify(sensorContext ?? {}, null, 2);
  const now = new Date();
  const budapestNow = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(now);
  const history = historyResult === null
    ? "Ehhez a kérdéshez nem történt külön előzmény-lekérdezés."
    : `A szerver által lekért ThingSpeak-előzmények. A pontos időszakot a JSON metaadatai tartalmazzák:\n${JSON.stringify(historyResult, null, 2)}`;
  const dateScope = historyResult?.requested_dates?.length
    ? `A lekérdezés kizárólag ezekre a napokra szól: ${historyResult.requested_dates.join(", ")}. Más napokról ne adj adatot, és ne kezeld a két dátum közötti időszakot kért időszakként.`
    : "";

  return [{
    role: "user",
    content: `A felület által utoljára betöltött szenzoradatok és eszközállapotok. Ezek az adatok elavultak lehetnek:\n${context}\n\n${history}\n${dateScope}\n\nAktuális UTC idő: ${now.toISOString()}\nAktuális helyi idő (Europe/Budapest): ${budapestNow}\n\nFelhasználói kérdés:\n${message.trim()}`
  }];
}

async function requestModel(apiKey, input, allowToolCalls = true) {
  const response = await fetchOpenAIWithRetry(apiKey, {
    model: GREENHOUSE_MODEL,
    service_tier: "default",
    instructions: GREENHOUSE_INSTRUCTIONS,
    input,
    text: {
      format: { type: "text" },
      verbosity: "medium"
    },
    reasoning: {
      effort: "medium",
      summary: "auto"
    },
    tools: GREENHOUSE_TOOLS,
    tool_choice: allowToolCalls ? "auto" : "none",
    store: false
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const providerError = data.error || {};
    const error = new Error("Az OpenAI szolgáltatás nem tudta feldolgozni a kérést.");
    error.statusCode = response.status;
    error.code = providerError.code || providerError.type || "openai_error";
    throw error;
  }

  return data;
}

async function executeToolCall(toolCall) {
  try {
    const args = JSON.parse(toolCall.arguments || "{}");
    const result = await runGreenhouseTool(toolCall.name, args);
    return {
      type: "function_call_output",
      call_id: toolCall.call_id,
      output: JSON.stringify({ ok: true, data: result })
    };
  } catch (error) {
    return {
      type: "function_call_output",
      call_id: toolCall.call_id,
      output: JSON.stringify({
        ok: false,
        error: error.message || "Az adatlekérés nem sikerült.",
        code: error.code || "tool_execution_failed"
      })
    };
  }
}

async function runAssistantTurn(apiKey, input, allowToolCalls) {
  let response = await requestModel(apiKey, input, allowToolCalls);
  let round = 0;

  while (true) {
    const toolCalls = (response.output || []).filter((item) => item.type === "function_call");
    if (toolCalls.length === 0) return response;
    if (round >= MAX_TOOL_ROUNDS) break;

    const toolOutputs = await Promise.all(toolCalls.map(executeToolCall));

    // Keep the model's response items so tool results stay attached to their calls.
    input.push(...response.output, ...toolOutputs);
    response = await requestModel(apiKey, input, allowToolCalls);
    round += 1;
  }

  const error = new Error("Az asszisztens túl sok adatlekérési lépést kért egy válaszhoz.");
  error.statusCode = 502;
  error.code = "tool_call_limit_reached";
  throw error;
}

function extractReply(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function userFacingError(error) {
  if (error.code === "tool_call_limit_reached") return error.message;
  if (error.statusCode === 401) return "Az OpenAI API-kulcs érvénytelen vagy nem fér hozzá ehhez a projekthez.";
  if (error.statusCode === 403 || error.statusCode === 404) {
    return "Az OpenAI projekt nem éri el a beállított modellt vagy API-erőforrást. Ellenőrizd a projekt hozzáférését.";
  }
  if (error.statusCode === 429) return "Az OpenAI API kérési korlátja vagy kerete miatt most nem sikerült a válasz. Próbáld újra később.";
  if (error.code === "openai_network_error") return "Nem sikerült elérni az OpenAI API-t. Ellenőrizd a szerver internetkapcsolatát, majd próbáld újra.";
  if (error.code === "missing_thingspeak_read_key") return "Hiányzik a ThingSpeak Read API Key szerverbeállítása.";
  if (error.code === "thingspeak_network_error" || error.cause?.code) {
    return "Nem sikerült elérni az adatforrást. Ellenőrizd a szerver internetkapcsolatát, majd próbáld újra.";
  }
  return "Az asszisztens most nem érhető el. Ellenőrizd a szerver AI- és ThingSpeak-beállításait, majd próbáld újra.";
}

export default async function handler(req, res) {
  if (!requireAuthentication(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { message, sensorContext } = req.body || {};
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (message.length > 1000) {
    return res.status(413).json({ error: "Message is too long." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OpenAI API key." });
  }

  try {
    let historyResult = null;
    if (isHistoricalDataQuestion(message)) {
      try {
        const requestedDates = extractBudapestDates(message);
        historyResult = isLastRainQuestion(message)
          ? await getLastRainSummary()
          : requestedDates.length
          ? await getRequestedDaySummaries(requestedDates)
          : await runGreenhouseTool("get_sensor_history", { hours: 48, start_date: null, end_date: null, field: "all" });
      } catch (error) {
        historyResult = {
          error: error.message || "A mérési előzmények lekérése nem sikerült.",
          code: error.code || "history_query_failed"
        };
      }
    }

    if (isLastRainQuestion(message)) {
      if (historyResult?.error) {
        return res.status(502).json({ error: userFacingError(historyResult), code: historyResult.code });
      }
      return res.status(200).json({ reply: formatLastRainReply(historyResult) });
    }

    const input = buildUserInput(message, sensorContext, historyResult);
    const response = await runAssistantTurn(apiKey, input, historyResult === null);
    const reply = extractReply(response) || "Nem érkezett válasz.";
    return res.status(200).json({ reply });
  } catch (error) {
    console.error("[chat] Request failed", {
      status: error.statusCode || 500,
      code: error.code || "internal_server_error",
      name: error.name
    });

    return res.status(error.statusCode || 500).json({
      error: userFacingError(error),
      code: error.code || "internal_server_error"
    });
  }
}
