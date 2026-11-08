// Login endpoint: GET checks the session, POST logs in, DELETE logs out.
// The password is checked on the server only. The browser just gets a session cookie back.
import {
  createSessionCookie,
  expiredSessionCookie,
  isAuthenticated,
  verifyCredentials
} from "./lib/auth.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // GET returns the session state, DELETE logs out.
  if (req.method === "GET") {
    const settings = verifyCredentials("", "");
    if (!settings.configured) {
      return res.status(503).json({ error: "A bejelentkezés szerveroldali beállítása hiányzik." });
    }
    return res.status(200).json({ authenticated: isAuthenticated(req) });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", expiredSessionCookie());
    return res.status(200).json({ authenticated: false });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Nem támogatott kérés." });
  }

  // POST: check the credentials and send the cookie back if they are correct.
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password || username.length > 120 || password.length > 200) {
    return res.status(400).json({ error: "Add meg a felhasználónevet és a jelszót." });
  }

  const result = verifyCredentials(username, password);
  if (!result.configured) {
    return res.status(503).json({ error: "A bejelentkezés szerveroldali beállítása hiányzik." });
  }
  if (!result.valid) {
    return res.status(401).json({ error: "Hibás felhasználónév vagy jelszó." });
  }

  res.setHeader("Set-Cookie", createSessionCookie(result.username, result.sessionSecret, req));
  return res.status(200).json({ authenticated: true });
}
