const GREENHOUSE_PROMPT = {
  id: "pmpt_6ae5c7f946048193b2d3179d34a7437e054fcdc8a79330d8",
  version: "1"
};

async function fetchOpenAIWithRetry(url, options) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const { message, sensorContext } = req.body || {};

    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    if (message.length > 1000) {
      return res.status(413).json({
        error: "Message is too long."
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing OpenAI API key."
      });
    }

    const openAIResponse = await fetchOpenAIWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: GREENHOUSE_PROMPT,
        input: `A ThingSpeak-mezők aktuális kiosztása: field1 hőmérséklet °C, field2 relatív páratartalom %, field3 légnyomás (a mértékegység nincs megadva), field4 megvilágítás lux, field5 eső 1/0, field6 ventilátor 1/0, field7 LED 1/0, field8 tető 1/0. Ez a kiosztás az irányadó: field3 nem talajnedvesség.

Aktuális szenzoradatok (JSON):
${JSON.stringify(sensorContext ?? {}, null, 2)}

Felhasználó kérdése:
${message.trim()}`,
        store: false,
      })
    });

    if (!openAIResponse.ok) {
      let providerError = {};
      try {
        providerError = (await openAIResponse.json()).error || {};
      } catch {
        // The provider may return a non-JSON error body.
      }

      console.error("[chat] OpenAI request failed", {
        status: openAIResponse.status,
        code: providerError.code || providerError.type || "unknown"
      });

      let userMessage = "Az OpenAI szolgáltatás most hibát adott. Próbáld újra később.";
      if (openAIResponse.status === 401) {
        userMessage = "Az OpenAI API-kulcs érvénytelen vagy nem fér hozzá ehhez a projekthez.";
      } else if (openAIResponse.status === 403 || openAIResponse.status === 404) {
        userMessage = "Az OpenAI projekt nem éri el a beállított promptot. Ellenőrizd a prompt azonosítóját és a projekt hozzáférését.";
      } else if (openAIResponse.status === 429) {
        userMessage = "Az OpenAI API kérési korlátja vagy kerete miatt most nem sikerült a válasz. Próbáld újra később.";
      }

      return res.status(openAIResponse.status).json({
        error: userMessage,
        code: providerError.code || providerError.type || "openai_error"
      });
    }

    const data = await openAIResponse.json();
    const reply = data.output
      ?.flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("\n")
      .trim() || "Nem érkezett válasz.";

    return res.status(200).json({
      reply
    });
  } catch (error) {
    console.error("[chat] Server request failed", {
      name: error.name,
      networkCode: error.cause?.code || null
    });

    if (error.name === "TypeError" || error.cause?.code) {
      return res.status(502).json({
        error: "Nem sikerült elérni az OpenAI API-t. Ellenőrizd a szerver internetkapcsolatát, majd próbáld újra.",
        code: error.cause?.code || "network_error"
      });
    }

    return res.status(500).json({
      error: "Belső szerverhiba történt. Részletek a szerver naplójában.",
      code: "internal_server_error"
    });
  }
}
