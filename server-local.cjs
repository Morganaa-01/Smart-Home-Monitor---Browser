const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/chat", async (req, res) => {
  try {
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
