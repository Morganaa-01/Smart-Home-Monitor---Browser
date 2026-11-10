// Helyi fejlesztői szerver: a saját gépeden ezzel tudod kipróbálni a programot (indítás: npm.cmd start).
// Két dolgot csinál: kiszolgálja a public mappa fájljait (HTML, CSS, JS), és az /api címekre érkező
// kéréseket ugyanazoknak a függvényeknek adja át, amelyek az éles Vercel-en is futnak.
// Így nincs külön, helyi másolat az API-ból, ami eltérhetne az éles változattól.
// Ez egy CommonJS fájl (require), az API modulok viszont ES modulok, ezért dinamikus import()-tal töltjük be őket.

// Az Express egy népszerű Node.js keretrendszer: egyszerűvé teszi a webszerver írását.
const express = require("express");
const path = require("path");
// A dotenv beolvassa a projekt gyökerében lévő .env fájlt, és a benne lévő beállításokat (kulcsok, jelszó)
// környezeti változóként elérhetővé teszi. A .env fájlt soha nem töltjük fel GitHubra.
require("dotenv").config();

// Létrehozzuk a webalkalmazást, és megadjuk, melyik porton figyeljen (alapból a 3000-esen).
const app = express();
const PORT = process.env.PORT || 3000;

// A beérkező kérések JSON törzsét (például a chat kérdését) automatikusan objektummá alakítjuk,
// legfeljebb 20 kilobájtig, hogy egy túl nagy kérés ne terhelje a szervert.
app.use(express.json({ limit: "20kb" }));
// A public mappa fájljait (index.html, script.js, style.css...) közvetlenül kiszolgáljuk a böngészőnek.
app.use(express.static(path.join(__dirname, "public")));

// A főoldal címére (/) az index.html fájlt küldjük vissza.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Bejelentkezés végpontja: minden módszert (GET, POST, DELETE) ugyanaz a kezelő dolgozza fel.
app.all("/api/auth", async (req, res) => {
  try {
    const { default: authHandler } = await import("./api/auth.js");
    return authHandler(req, res);
  } catch (error) {
    console.error("[auth] Local route failed", error.name);
    return res.status(500).json({ error: "Nem sikerült elindítani a bejelentkezést." });
  }
});

// AI-chat végpont: csak POST kérést fogad.
app.post("/api/chat", async (req, res) => {
  try {
    // Helyben és az éles tárhelyen is ugyanazt az API-kezelőt használjuk.
    const { default: chatHandler } = await import("./api/chat.js");
    return chatHandler(req, res);
  } catch (error) {
    return res.status(500).json({ error: "Server error.", details: error.message });
  }
});

// Mérések végpontja: a böngésző innen kéri a ThingSpeak adatait.
app.get("/api/thingspeak", async (req, res) => {
  try {
    const { default: thingSpeakHandler } = await import("./api/thingspeak.js");
    return thingSpeakHandler(req, res);
  } catch (error) {
    console.error("[thingspeak] Local route failed", error.name);
    return res.status(500).json({
      error: "Nem sikerült elindítani a ThingSpeak adatolvasást.",
      code: "thingspeak_route_error"
    });
  }
});

// Elindítjuk a szervert, és kiírjuk a konzolra, melyik címen érhető el az oldal.
app.listen(PORT, () => {
  console.log(`Okos Növényház elérhető itt: http://localhost:${PORT}`);
});
