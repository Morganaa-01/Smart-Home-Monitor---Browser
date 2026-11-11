// Helyi fejlesztői szerver (indítás: npm.cmd start).
// Kiszolgálja a public mappa fájljait, az /api címeket pedig ugyanazoknak a függvényeknek adja át, amik az éles Vercel-en is futnak, így nincs külön helyi másolat az API-ból.
// Ez CommonJS fájl (require), az API modulok viszont ES modulok, ezért dinamikus import()-tal töltjük be őket.
// Az Express egy Node.js webszerver keretrendszer.
const express = require("express");
const path = require("path");
// A dotenv beolvassa a .env fájlt, és környezeti változóvá teszi a benne lévő beállításokat (kulcsok, jelszó). A .env fájlt nem töltjük fel GitHubra.
require("dotenv").config();

// Webalkalmazás létrehozása, a port alapból 3000.
const app = express();
const PORT = process.env.PORT || 3000;

// A kérések JSON törzsét objektummá alakítjuk (max. 20 kB).
app.use(express.json({ limit: "20kb" }));
// A public mappa fájljait (index.html, script.js, app.css...) közvetlenül kiszolgáljuk.
app.use(express.static(path.join(__dirname, "public")));

// A főoldal (/) az index.html.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Bejelentkezés végpont: GET, POST és DELETE is ugyanazt a kezelőt hívja.
app.all("/api/auth", async (req, res) => {
  try {
    const { default: authHandler } = await import("./api/auth.js");
    return authHandler(req, res);
  } catch (error) {
    console.error("[auth] Local route failed", error.name);
    return res.status(500).json({ error: "Nem sikerült elindítani a bejelentkezést." });
  }
});

// AI-chat végpont, csak POST.
app.post("/api/chat", async (req, res) => {
  try {
    // Helyben és élesben is ugyanaz a kezelő fut.
    const { default: chatHandler } = await import("./api/chat.js");
    return chatHandler(req, res);
  } catch (error) {
    return res.status(500).json({ error: "Server error.", details: error.message });
  }
});

// Mérések végpontja, innen kéri a böngésző a ThingSpeak adatait.
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

// Szerver indítása, a cím kiírása a konzolra.
app.listen(PORT, () => {
  console.log(`Okos Növényház elérhető itt: http://localhost:${PORT}`);
});
