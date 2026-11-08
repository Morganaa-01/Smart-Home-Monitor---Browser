// Local development server: serves the public folder and passes the API requests to the same
// handlers that run on Vercel, so there is no separate local copy of the API.
// Start it with: npm.cmd start. This is a CommonJS file, so the API modules are loaded with dynamic import.
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the dashboard files and accept the JSON requests of the chat.
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
    // Use the same API handler locally and on the host.
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
