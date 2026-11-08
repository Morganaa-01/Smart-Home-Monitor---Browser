/*
Helyi indítás: npm.cmd start
Az Express kiszolgálja a public mappát, az API-kéréseket pedig
ugyanazok a kezelők kapják meg, amelyek Vercelen is futnak.
Így nem kell külön helyi másolatot fenntartani az API működéséből.
Ez CommonJS-fájl; az API-modulokat dinamikus import tölti be.
*/
// Helyi fejlesztőszerver: kiszolgálja a public felületet, és a Vercel API-kezelőire irányítja a kéréseket.
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Kiszolgáljuk az irányítópult fájljait, és fogadjuk a chat JSON-kéréseit.
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.all("/api/auth", async (req, res) => {
  try {
    const { default: authHandler } = await import("./api/auth.js");
    return authHandler(req, res);
  } catch (error) {
    console.error("[auth] Local route failed", error.name);
    return res.status(500).json({ error: "Nem sikerült elindítani a bejelentkezést." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    // Helyben és a tárhelyen is ugyanazt az API-kezelőt használjuk.
    const { default: chatHandler } = await import("./api/chat.js");
    return chatHandler(req, res);
  } catch (error) {
    return res.status(500).json({ error: "Server error.", details: error.message });
  }
});

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

app.listen(PORT, () => {
  console.log(`Okos Növényház elérhető itt: http://localhost:${PORT}`);
});
