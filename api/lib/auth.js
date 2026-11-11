// Közös bejelentkezési függvények a védett API-khoz.
// A munkamenetet aláírt süti tárolja, ezért nem kell hozzá adatbázis. Az aláírás csak azt veszi észre, ha átírták a sütit, titkosítani nem titkosít, ezért jelszó vagy API-kulcs nem kerül bele.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "greenhouse_session";
const SESSION_SECONDS = 8 * 60 * 60;

// Belépési beállítások beolvasása a környezeti változókból (név, jelszó, titkos kulcs). Ha valami hiányzik, vagy a kulcs rövidebb 32 karakternél, null jön vissza (a belépés nincs beállítva).
function getAuthSettings() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!username || !password || !sessionSecret || sessionSecret.length < 32) {
    return null;
  }

  return { username, password, sessionSecret };
}

// Két szöveg biztonságos összehasonlítása. Előbb hash-t készítünk belőlük, így azonos hosszúak lesznek, és az összehasonlítás ideje nem árulja el, hány karakter egyezett.
function secureEquals(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

// Aláírás a sütihez a titkos kulccsal (HMAC-SHA256). A kulcsot csak a szerver ismeri, ezért csak ő tud érvényes aláírást készíteni.
function sign(payload, secret) {
  // Az aláírásból kiderül, ha valaki átírta a sütit.
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

// Munkamenet-süti kikeresése a kérésből. Egyetlen sütihez nem telepítünk külön csomagot.
function getCookie(req) {
  const cookies = req.headers.cookie || "";
  const item = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return item ? item.slice(COOKIE_NAME.length + 1) : "";
}

// Be van-e jelentkezve a felhasználó (true/false). Előbb az aláírást ellenőrizzük, és csak utána olvassuk ki a süti tartalmát.
export function isAuthenticated(req) {
  const settings = getAuthSettings();
  if (!settings) return false;

  const [payload, signature, extra] = getCookie(req).split(".");
  if (!payload || !signature || extra) return false;

  // Csak érvényes aláírású, még le nem járt munkamenetet fogadunk el.
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

// Védett végpontok elején használjuk. Ha nincs bejelentkezve a felhasználó, 401-et küldünk és false a visszatérési érték. A hívónak ilyenkor ki kell lépnie (return).
export function requireAuthentication(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: "Bejelentkezés szükséges.", code: "authentication_required" });
  return false;
}

// Beírt név és jelszó ellenőrzése. Mindkét összehasonlítás lefut (nincs korai kilépés), így az idő nem mutatja, melyik volt hibás.
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

// Munkamenet-süti: a név és a lejárat base64-ben, mögötte az aláírás. A lejárat ezredmásodpercben van, a Max-Age viszont másodperc, ezért kell átváltani.
export function createSessionCookie(username, sessionSecret, req) {
  // HttpOnly süti (JS nem olvashatja), nyolc óra után lejár.
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

// Kijelentkezéshez: ugyanaz a süti Max-Age=0-val, így a böngésző törli.
export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
