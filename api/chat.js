// AI-chat végpont (/api/chat). Lépések: bejelentkezés és bemenet ellenőrzése, szükség esetén mérések lekérése, végül az AI megfogalmazza a választ.
// Az AI csak azokat az eszközöket használhatja, amiket a szerver engedélyez. A számolást lehetőleg a kód végzi, a modell csak elmondja az eredményt.
// Az 'utolsó eső' kérdésre külön ág van, ott a választ a kód állítja össze.
import { GREENHOUSE_TOOLS, runGreenhouseTool } from "./lib/greenhouse-tools.js";
import { GREENHOUSE_INSTRUCTIONS, GREENHOUSE_MODEL } from "./lib/greenhouse-prompt.js";
import { requireAuthentication } from "./lib/auth.js";

// OpenAI Responses API címe.
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Legfeljebb ennyi eszközhívási kör egy válaszhoz (végtelen ciklus ellen).
const MAX_TOOL_ROUNDS = 4;
// Ennyiszer próbáljuk újra a kérést, ha átmeneti hiba van.
const MAX_OPENAI_ATTEMPTS = 3;

// Kérés küldése az OpenAI-nak, átmeneti hibánál újrapróbálás. Az OpenAI néha 503-as 'server_is_overloaded' hibát ad, ez pár másodperc múlva elmúlik. Más hibát változtatás nélkül visszaadunk.
async function fetchOpenAIWithRetry(apiKey, body) {
  // Hálózati hibánál vagy túlterheltségnél várunk egy kicsit, aztán újra próbáljuk.
  for (let attempt = 0; attempt < MAX_OPENAI_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (response.status === 503 && attempt < MAX_OPENAI_ATTEMPTS - 1) {
        const errorBody = await response.clone().json().catch(() => ({}));
        if (errorBody.error?.code === "server_is_overloaded") {
          // Ha a szolgáltatás megadja a várakozási időt, azt követjük, különben próbálkozásonként egyre többet várunk.
          const retryAfter = Number(response.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 5000)
            : 800 * (2 ** attempt);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }

      return response;
    } catch (error) {
      if (attempt === MAX_OPENAI_ATTEMPTS - 1) {
        const networkError = new Error("Nem sikerült elérni az OpenAI API-t.");
        networkError.code = "openai_network_error";
        networkError.cause = error;
        throw networkError;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
    }
  }
}

// Kulcsszavas vizsgálat (nem kell hozzá AI-hívás): múltbeli adatról van-e szó. Időt jelző ÉS növényházi adatot jelző szó is kell, így a 'milyen idő van ma?' nem indít ThingSpeak-lekérést.
function isHistoricalDataQuestion(message) {
  // Múltbeli kérdésnél előre lekérjük az adatokat, hogy az AI ne találgasson.
  if (isLastRainQuestion(message)) return true;
  if (extractBudapestDates(message).length > 0) return true;
  const asksAboutTime = /tegnap\w*|tegnapelőtt\w*|ma\w*|elmúlt\w*|utolsó\w*|trend\w*|átlag\w*|minimum\w*|maximum\w*|változás\w*|összehasonlít\w*|időbeli\w*/i.test(message);
  const asksAboutGreenhouseData = /adat\w*|mérés\w*|hőmérséklet\w*|páratartalom\w*|légnyomás\w*|megvilágítás\w*|lux\b|napsütés\w*|napfény\w*|világos ór\w*|eső\w*|ventilátor\w*|led\b|tető\w*|szenzor\w*/i.test(message);
  return asksAboutTime && asksAboutGreenhouseData;
}

// Az utolsó esőre kérdez-e ('mikor esett utoljára?'). Ezt a kód válaszolja meg, nem a modell, így a dátum és az időtartam a mért adatból jön.
function isLastRainQuestion(message) {
  // Ékezetek nélkül és az egész üzenetet vizsgáljuk, így a mondat elején lévő köszönés nem zavar.
  const normalized = message.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /mikor\w*|utoljara\w*|legutobb\w*/i.test(normalized) && /eso\w*|rain\w*/i.test(normalized);
}

// Dátumok kikeresése a kérdésből, pl. 'október 30-án' -> 2026-10-30. Csak magyar hónapneveket ismer. Ha nincs év, az aktuálisat vesszük. A visszaadott lista rendezett és nincs benne ismétlődés.
export function extractBudapestDates(message) {
  // Magyar hónapnevek -> konkrét napok (budapesti idő szerint).
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

// A megnevezett napokra külön összefoglalót kérünk, hogy az AI csak róluk beszéljen. A mintákat (samples) kivesszük, hogy rövid maradjon a szöveg.
async function getRequestedDaySummaries(dates) {
  // Minden megnevezett napot külön kérdezünk le, a közbeesőket nem.
  const days = await Promise.all(dates.map(async (date) => {
    const result = await runGreenhouseTool("get_sensor_history", {
      hours: null,
      start_date: date,
      end_date: date,
      field: "all"
    });
    const daily = result.daily_budapest[date] || null;
    const fields = daily && Object.fromEntries(Object.entries(daily)
      .filter(([field]) => field !== "sunshine_hours_above_threshold")
      .map(([field, summary]) => {
        if (!summary) return [field, null];
        const { samples, ...statistics } = summary;
        return [field, statistics];
      }));
    return {
      date,
      returned_records: result.returned_records,
      fields,
      sunshine_hours_above_threshold: daily?.sunshine_hours_above_threshold ?? null
    };
  }));

  return {
    timezone: "Europe/Budapest",
    requested_dates: dates,
    days: Object.fromEntries(days.map(({ date, ...data }) => [date, data]))
  };
}

// Összefoglaló az utolsó eső jelzéséről az elmúlt 30 napból (720 óra). A 30 nap kompromisszum: elég hosszú az utolsó eső megtalálásához, de belefér a ThingSpeak rekordkorlátjába.
async function getLastRainSummary() {
  // Az utolsó 30 napban keressük a legutóbbi esőjelzést.
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
    last_active_event: rain?.last_active_event || null,
    active_samples: rain?.active_samples ?? 0,
    total_samples: rain?.count ?? 0
  };
}

// Magyar mondat az utolsó esőről a mérésekből. Ezt a kód állítja össze, ezért a prompt átírása erre az ágra nincs hatással.
function formatLastRainReply(summary) {
  // Ezt a választ a szerver állítja össze, a modell nem találhatja ki.
  if (!summary.total_samples) {
    return "A lekért időszakban nincs esőérzékelő-adat.";
  }
  if (!summary.last_active_at_budapest) {
    return "A lekért időszakban az érzékelő nem jelzett esőt.";
  }

  const formatDateTime = (timestamp) => new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(timestamp));
  const event = summary.last_active_event;
  if (!event) {
    return "Az érzékelő legutóbb " + formatDateTime(summary.last_active_at_budapest) + "-kor jelzett esőt. A csapadék mennyiségét nem méri.";
  }

  // Az első és az utolsó aktív minta közti idő percben.
  const durationMinutes = Math.max(1, Math.round((Date.parse(event.last_active_at_budapest) - Date.parse(event.started_at_budapest)) / 60000));
  const days = Math.floor(durationMinutes / 1440);
  const hours = Math.floor((durationMinutes % 1440) / 60);
  const minutes = durationMinutes % 60;
  const duration = [
    days ? days + " nap" : "",
    hours ? hours + " óra" : "",
    minutes ? minutes + " perc" : ""
  ].filter(Boolean).join(" ");
  const startTime = formatDateTime(event.started_at_budapest);
  const endTime = formatDateTime(event.last_active_at_budapest);
  if (event.is_active_at_end) {
    return "Az érzékelő " + startTime + " óta jelez esőt (eddig körülbelül " + duration + "). A csapadék mennyiségét nem méri.";
  }
  return "Az érzékelő " + startTime + " és " + endTime + " között jelzett esőt, körülbelül " + duration + " hosszan. A csapadék mennyiségét nem méri.";
}

// A böngészőtől kapott korábbi beszélgetés tisztítása: csak felhasználói és asszisztensi szöveg jöhet, üzenetenként max. 2000 karakter, és csak az utolsó 12 marad. A böngésző nem küldhet rendszerutasítást vagy eszközeredményt.
function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) return [];

  return conversation
    .filter((item) => item && ["user", "assistant"].includes(item.role)
      && typeof item.content === "string")
    .map(({ role, content }) => ({ role, content: content.trim().slice(0, 2000) }))
    .filter((item) => item.content && item.content !== "Gondolkodom…")
    .slice(-12);
}

// A modellnek küldött üzenet: kérdés, az oldalon látható adatok, az előre lekért előzmények és az aktuális budapesti idő. A modellnek nincs órája, idő nélkül a 'ma' és a 'tegnap' nem értelmezhető.
function buildUserInput(message, sensorContext, historyResult = null, conversation = []) {
  // A modell megkapja a kérdést, az oldalon látható adatokat és a külön lekért adatokat is.
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

  return [...sanitizeConversation(conversation), {
    role: "user",
    content: `A felület által utoljára betöltött szenzoradatok és eszközállapotok. Ezek az adatok elavultak lehetnek:\n${context}\n\n${history}\n${dateScope}\n\nAktuális dátum és idő: ${budapestNow}\n\nFelhasználói kérdés:\n${message.trim()}`
  }];
}

// Kérés a modellnek: itt áll össze a prompt, a bemenet és az engedélyezett eszközök listája. A store: false miatt az OpenAI nem tárolja a beszélgetést. Ha az előzmény már a bemenetben van, kikapcsoljuk az eszközhívást, különben a modell újra lekérné.
async function requestModel(apiKey, input, allowToolCalls = true) {
  // Modell neve, utasítás és az engedélyezett eszközök.
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

// Egy, a modell által kért eszközhívás végrehajtása (pl. get_sensor_history). Az eszközök csak olvasnak. A call_id köti össze a kérést az eredménnyel. Hibánál nem dobunk kivételt, hanem hibaüzenetet adunk vissza a modellnek.
async function executeToolCall(toolCall) {
  // Az eszközök csak olvasnak, az eszközök állapotát nem módosítják.
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

// Egy teljes forduló: a modell eszközhívást kérhet, mi végrehajtjuk, visszaadjuk az eredményt, és ez addig megy, amíg végső választ nem ad. A körök száma korlátozott (MAX_TOOL_ROUNDS).
async function runAssistantTurn(apiKey, input, allowToolCalls) {
  let response = await requestModel(apiKey, input, allowToolCalls);
  let round = 0;

  while (true) {
    const toolCalls = (response.output || []).filter((item) => item.type === "function_call");
    if (toolCalls.length === 0) return response;
    if (round >= MAX_TOOL_ROUNDS) break;

    // A lekérések párhuzamosan futhatnak (Promise.all), mert mind csak olvas.
    const toolOutputs = await Promise.all(toolCalls.map(executeToolCall));

    // A korábbi eszközhívásokat is visszaadjuk, hogy az eredményeket hozzájuk tudja kötni.
    input.push(...response.output, ...toolOutputs);
    response = await requestModel(apiKey, input, allowToolCalls);
    round += 1;
  }

  const error = new Error("Az asszisztens túl sok adatlekérési lépést kért egy válaszhoz.");
  error.statusCode = 502;
  error.code = "tool_call_limit_reached";
  throw error;
}

// A modell válaszából a megjeleníthető szöveg kiszedése. A belső eszközhívásokat nem mutatjuk.
function extractReply(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

// Technikai hibák -> rövid, érthető magyar üzenet. A felhasználó ne lásson nyers API-hibát.
function userFacingError(error) {
  if (error.code === "tool_call_limit_reached") return error.message;
  if (error.statusCode === 401) return "Az OpenAI API-kulcs érvénytelen vagy nem fér hozzá ehhez a projekthez.";
  if (error.statusCode === 403 || error.statusCode === 404) {
    return "Az OpenAI projekt nem éri el a beállított modellt vagy API-erőforrást. Ellenőrizd a projekt hozzáférését.";
  }
  if (error.statusCode === 503 && error.code === "server_is_overloaded") {
    return "Az OpenAI szolgáltatás átmenetileg túlterhelt. Próbáld újra néhány másodperc múlva.";
  }
  if (error.statusCode === 429) return "Az OpenAI API kérési korlátja vagy kerete miatt most nem sikerült a válasz. Próbáld újra később.";
  if (error.code === "openai_network_error") return "Nem sikerült elérni az OpenAI API-t. Ellenőrizd a szerver internetkapcsolatát, majd próbáld újra.";
  if (error.code === "missing_thingspeak_read_key") return "Hiányzik a ThingSpeak Read API Key szerverbeállítása.";
  if (error.code === "thingspeak_network_error" || error.cause?.code) {
    return "Nem sikerült elérni az adatforrást. Ellenőrizd a szerver internetkapcsolatát, majd próbáld újra.";
  }
  return "Az asszisztens most nem érhető el. Ellenőrizd a szerver AI- és ThingSpeak-beállításait, majd próbáld újra.";
}

// A végpont fő függvénye. A sorrend fontos: bejelentkezés, módszer, bemenet, API-kulcs, és csak utána a tényleges munka. Az olcsó ellenőrzések vannak elöl.
export default async function handler(req, res) {
  // A chat csak bejelentkezve és POST kéréssel használható.
  if (!requireAuthentication(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { message, sensorContext, conversation } = req.body || {};
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
        if (isLastRainQuestion(message)) {
          historyResult = await getLastRainSummary();
        } else if (requestedDates.length > 0) {
          historyResult = await getRequestedDaySummaries(requestedDates);
        } else {
          // Ha nincs dátum a kérdésben, az utolsó 48 órát kérjük le.
          historyResult = await runGreenhouseTool("get_sensor_history", { hours: 48, start_date: null, end_date: null, field: "all" });
        }
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
      // Itt a dátum és az időtartam közvetlenül a ThingSpeak adataiból jön.
      return res.status(200).json({ reply: formatLastRainReply(historyResult) });
    }

    const input = buildUserInput(message, sensorContext, historyResult, conversation);
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
