// Shared login helpers for the protected API routes.
// The session is a signed cookie, so there is no database. The signature only detects changes
// (the content is not encrypted), so a password or API key must never go into the cookie.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "greenhouse_session";
const SESSION_SECONDS = 8 * 60 * 60;

// Credentials and the cookie secret come from the server settings only.
function getAuthSettings() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!username || !password || !sessionSecret || sessionSecret.length < 32) {
    return null;
  }

  return { username, password, sessionSecret };
}

// Comparing hashes of equal length avoids leaking information through timing.
function secureEquals(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sign(payload, secret) {
  // The signature lets us notice if someone edited the cookie.
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function getCookie(req) {
  const cookies = req.headers.cookie || "";
  const item = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return item ? item.slice(COOKIE_NAME.length + 1) : "";
}

export function isAuthenticated(req) {
  const settings = getAuthSettings();
  if (!settings) return false;

  const [payload, signature, extra] = getCookie(req).split(".");
  if (!payload || !signature || extra) return false;

  // Accept only a valid signature and a session that has not expired.
  const expected = Buffer.from(sign(payload, settings.sessionSecret), "base64url");
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.user === settings.username && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

// Returns false after sending a 401, so the caller must return right away.
export function requireAuthentication(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: "Bejelentkezés szükséges.", code: "authentication_required" });
  return false;
}

export function verifyCredentials(username, password) {
  const settings = getAuthSettings();
  if (!settings) return { configured: false, valid: false };

  const usernameMatches = secureEquals(username, settings.username);
  const passwordMatches = secureEquals(password, settings.password);

  return {
    configured: true,
    valid: usernameMatches && passwordMatches,
    username: settings.username,
    sessionSecret: settings.sessionSecret
  };
}

// Expiry is stored in milliseconds but Max-Age is in seconds, so we convert.
export function createSessionCookie(username, sessionSecret, req) {
  // HttpOnly cookie, it expires after eight hours.
  const payload = Buffer.from(JSON.stringify({
    user: username,
    expiresAt: Date.now() + SESSION_SECONDS * 1000
  })).toString("base64url");
  const signature = sign(payload, sessionSecret);
  const forwardedProtocol = req.headers["x-forwarded-proto"] || "";
  const isSecure = process.env.VERCEL === "1" || forwardedProtocol.split(",")[0].trim() === "https";
  const secureFlag = isSecure ? "; Secure" : "";

  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secureFlag}`;
}

export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
