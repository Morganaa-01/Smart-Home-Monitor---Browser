// Közös bejelentkezési segédfüggvények minden védett API-hoz.
// A munkamenetet egy aláírt süti (cookie) tárolja, ezért nincs hozzá külön adatbázis.
// Az aláírás csak azt veszi észre, ha valaki átírta a süti tartalmát, de nem titkosítja azt.
// Ezért jelszót vagy API-kulcsot soha nem teszünk a sütibe.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "greenhouse_session";
const SESSION_SECONDS = 8 * 60 * 60;

// Beolvassa a belépéshez szükséges beállításokat a szerver környezeti változóiból (felhasználónév, jelszó, titkos kulcs).
// Ha bármelyik hiányzik, vagy a titkos kulcs rövidebb 32 karakternél, null-t ad: ilyenkor a belépés nincs beállítva.
function getAuthSettings() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!username || !password || !sessionSecret || sessionSecret.length < 32) {
    return null;
  }

  return { username, password, sessionSecret };
}

// Két szöveg biztonságos összehasonlítása. Előbb mindkettőből hash-t (ujjlenyomatot) készít, így azonos hosszúak lesznek,
// és az összehasonlítás ideje nem árulja el, hogy hány karakter egyezett. Így a jelszót nem lehet 'kitalálni' az időmérésből.
function secureEquals(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

// Aláírást készít a sütihez a szerver titkos kulcsával (HMAC-SHA256).
// Csak a szerver ismeri a kulcsot, ezért csak ő tud érvényes aláírást készíteni, és észreveszi, ha valaki átírta a sütit.
function sign(payload, secret) {
  // Az aláírásból később észrevesszük, ha valaki átírta a süti tartalmát.
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

// Kikeresi a kérésből a munkamenet-sütit. Egyetlen sütihez nem érdemes külön csomagot telepíteni, ezért kicsi saját megoldás.
function getCookie(req) {
  const cookies = req.headers.cookie || "";
  const item = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return item ? item.slice(COOKIE_NAME.length + 1) : "";
}

// Megmondja, hogy a kérést küldő felhasználó be van-e jelentkezve (true/false).
// Először az aláírást ellenőrzi, és csak utána olvassa ki a süti tartalmát, így aláíratlan adattal nem dolgozunk.
export function isAuthenticated(req) {
  const settings = getAuthSettings();
  if (!settings) return false;

  const [payload, signature, extra] = getCookie(req).split(".");
  if (!payload || !signature || extra) return false;

  // Csak érvényes aláírású és még le nem járt munkamenetet fogadunk el.
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

// Védett végpontok elején használjuk. Ha a felhasználó nincs bejelentkezve, 401-es hibát küld, és false-t ad vissza.
// A hívó függvénynek ilyenkor azonnal ki kell lépnie (return), különben a védett kód mégis lefutna.
export function requireAuthentication(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: "Bejelentkezés szükséges.", code: "authentication_required" });
  return false;
}

// Ellenőrzi a beírt felhasználónevet és jelszót a beállított értékekkel.
// A két összehasonlítás mindig mindkettő lefut (nincs korai kilépés), így a válasz ideje nem mutatja, melyik volt hibás.
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

// Elkészíti a munkamenet-sütit: a felhasználónév és a lejárati idő base64-be kódolva, mögötte az aláírás.
// A lejárat ezredmásodpercben van tárolva, a Max-Age viszont másodpercben kell, ezért kell átváltani.
export function createSessionCookie(username, sessionSecret, req) {
  // HttpOnly süti (JavaScript nem olvashatja), nyolc óra után lejár.
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

// Kijelentkezéshez: ugyanaz a süti Max-Age=0 értékkel, így a böngésző azonnal törli.
export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
