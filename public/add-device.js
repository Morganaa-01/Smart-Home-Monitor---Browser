// Eszközkezelő oldal: itt lehet eszközöket felvenni, szerkeszteni és törölni.
// Az eszközlistát a böngésző helyi tárhelyében (localStorage) tároljuk, és ebből rajzoljuk ki a kártyákat.
// Egy eszköz felvétele csak nyilvántartás: nem párosít hardvert, és az ESP32 programját sem módosítja.
// Az oldal elemei: az űrlap, az eszközlista és a téma kapcsoló (a HTML-ben az id alapján keressük meg őket).
const deviceForm = document.getElementById("deviceForm");
const deviceList = document.getElementById("deviceList");
const themeToggle = document.getElementById("themeToggle");

// Az űrlap mezői. Az editIndex rejtett mező: ha üres, új eszközt veszünk fel, ha szám, akkor azt az eszközt szerkesztjük.
const editIndexInput = document.getElementById("editIndex");
const deviceNameInput = document.getElementById("deviceName");
const deviceTypeInput = document.getElementById("deviceType");
const thingSpeakFieldInput = document.getElementById("thingSpeakField");
const deviceLocationInput = document.getElementById("deviceLocation");
const saveDeviceBtn = document.getElementById("saveDeviceBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const deviceMessage = document.getElementById("deviceMessage");

// Az eszköztípusok angol kulcsai és a felületen megjelenő magyar nevei.
const DEVICE_TYPE_LABELS = {
  Temperature: "Hőmérséklet",
  Humidity: "Páratartalom",
  "Soil Moisture": "Talajnedvesség",
  Rain: "Esőérzékelő",
  Fan: "Ventilátor",
  "Air Pressure": "Légnyomás",
  Light: "Megvilágítás",
  Thermostat: "Termosztát",
  Security: "Biztonsági érzékelő",
  LED: "LED-világítás",
  Servo: "Szervomotor",
  Other: "Egyéb"
};

// Ezzel a kulccsal jegyezzük meg, hogy az alaplistát már betöltöttük (ne kerüljön vissza egy törölt kártya).
const DEVICE_INITIALIZED_KEY = "smartHomeDevicesInitialized";
// A növényház jelenlegi eszközei: minden eszközhöz tartozik egy ThingSpeak-mező (field1...field8).
const CURRENT_GREENHOUSE_DEVICES = [
  { id: "firmware-field1", name: "BME280 · Hőmérséklet", type: "Temperature", field: "1" },
  { id: "firmware-field2", name: "BME280 · Páratartalom", type: "Humidity", field: "2" },
  { id: "firmware-field3", name: "BME280 · Légnyomás", type: "Air Pressure", field: "3" },
  { id: "firmware-field4", name: "TSL2561 · Fényérzékelő", type: "Light", field: "4" },
  { id: "firmware-field5", name: "Esőérzékelő", type: "Rain", field: "5" },
  { id: "firmware-field6", name: "Ventilátor", type: "Fan", field: "6" },
  { id: "firmware-field7", name: "Kiegészítő LED", type: "LED", field: "7" },
  { id: "firmware-field8", name: "Tető szervómotor", type: "Servo", field: "8" }
].map((device) => ({
  ...device,
  thingSpeakField: device.field,
  location: "Növényház",
  status: "Hozzárendelve",
  source: "ESP32 · ThingSpeak"
}));

// ---------- Mentett eszközök ----------

// Betölti az eszközlistát a böngésző helyi tárhelyéből. Az első megnyitáskor a növényház ismert eszközeit is hozzáadja,
// utána már csak a felhasználó saját listáját használja. Az alaplista csak egyszer kerül be, így a törölt kártya nem jön vissza.
// Ha a mentett adat sérült, üres listával folytatjuk, hogy az oldal ne álljon le.
function loadDevices() {
  // Első megnyitáskor betesszük az ESP32 ismert eszközeit, utána a felhasználó saját listáját töltjük be.
  try {
    const savedDevices = JSON.parse(localStorage.getItem("smartHomeDevices") || "[]");
    const devices = Array.isArray(savedDevices)
      ? savedDevices.filter((device) => device && typeof device === "object" && !Array.isArray(device))
      : [];

    if (localStorage.getItem(DEVICE_INITIALIZED_KEY) !== "true") {
      const existingIds = new Set(devices.map((device) => device.id).filter(Boolean));
      const currentDevices = CURRENT_GREENHOUSE_DEVICES.filter((device) => !existingIds.has(device.id));
      const initialDevices = [...devices, ...currentDevices];
      localStorage.setItem("smartHomeDevices", JSON.stringify(initialDevices));
      localStorage.setItem(DEVICE_INITIALIZED_KEY, "true");
      return initialDevices;
    }

    return devices;
  } catch (error) {
    console.warn("Saved device data could not be read:", error);
    return [];
  }
}

// Az eszközök listája a memóriában. Induláskor a helyi tárhelyből töltjük be.
let devices = loadDevices();

// Elmenti az eszközlistát a böngésző helyi tárhelyébe. Ez böngészőnként külön tárolódik, nem szinkronizálódik másik
// telefonra vagy gépre, és nem a ThingSpeak csatornába kerül.
function saveDevices() {
  // A lista böngészőnként tárolódik, nem a ThingSpeak csatornában.
  localStorage.setItem("smartHomeDevices", JSON.stringify(devices));
}

// Egy ISO formátumú dátumot (2026-11-08T19:33:00Z) olvasható, budapesti idejű szöveggé alakít.
function formatDate(dateString) {
  if (!dateString) {
    return "Nincs adat";
  }

  const date = new Date(dateString);
  return Number.isNaN(date.getTime())
    ? "Nincs adat"
    : date.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
}

// Beír egy sort az eseménynaplóba, amit a főoldal is megjelenít. A főoldal naplózó függvénye (script.js) ide másolva van,
// mert ez az oldal nem tölti be a script.js fájlt. TODO: a localStorage segédfüggvényeket egy közös fájlba lehetne tenni.
function logDeviceActivity(message) {
  // Ugyanabba a helyi eseménynaplóba írunk, amit a főoldal is megjelenít.
  try {
    const savedEntries = JSON.parse(localStorage.getItem("greenhouse-activity-log") || "[]");
    const entries = Array.isArray(savedEntries) ? savedEntries : [];
    entries.unshift({ at: new Date().toISOString(), message, level: "success" });
    localStorage.setItem("greenhouse-activity-log", JSON.stringify(entries.slice(0, 30)));
  } catch {
    // Az eszköz mentése akkor is sikeres marad, ha a böngésző nem engedi a naplózást.
  }
}

// Egy 'Címke: érték' sort ad az eszközkártyához. Az értéket textContent-tel (sima szövegként) tesszük ki,
// így amit a felhasználó beírt, soha nem futhat le HTML-ként.
function addDetail(container, label, value) {
  const line = document.createElement("p");
  const name = document.createElement("strong");

  name.textContent = `${label}: `;
  line.append(name, document.createTextNode(value));
  container.appendChild(line);
}

// ---------- Az eszközlista megjelenítése ----------

// Újrarajzolja az eszközkártyákat a tárolt listából. Mentés vagy törlés után mindig ezt hívjuk meg.
// A kártyákat DOM-elemekből építjük fel (nem HTML-szövegből), így a felhasználó szövege sosem futhat le kódként.
function renderDevices() {
  // A listaelemeket DOM-elemekből építjük fel, így a felhasználó szövege nem futhat le HTML-kódként.
  deviceList.replaceChildren();
  const count = document.getElementById("deviceCount");
  if (count) count.textContent = `${devices.length} eszköz`;

  if (devices.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "device-list-empty text-secondary";
    emptyMessage.textContent = "Még nincs felvett eszköz.";
    deviceList.appendChild(emptyMessage);
    return;
  }

  devices.forEach((device, index) => {
    const item = document.createElement("div");
    const details = document.createElement("div");
    const title = document.createElement("h4");
    const actions = document.createElement("div");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "card saved-device device-list-item";
    details.className = "card-body device-tile-details";
    actions.className = "card-footer d-flex gap-2 device-actions";
    title.textContent = device.name || "Névtelen eszköz";

    // Az elmentett adatokat egyszerű szövegként tesszük az oldalra.
    addDetail(details, "Típus", DEVICE_TYPE_LABELS[device.type] || device.type || "Nincs megadva");
    addDetail(details, "ThingSpeak-mező", device.field || device.thingSpeakField || "Nincs hozzárendelve");
    addDetail(details, "Elhelyezés", device.location || "Nincs megadva");
    addDetail(details, "Állapot", device.status || "Aktív");
    if (device.source) {
      addDetail(details, "Forrás", device.source);
    } else {
      addDetail(details, "Felvéve", formatDate(device.createdAt));
    }

    editButton.type = "button";
    editButton.className = "btn btn-sm";
    editButton.textContent = "Szerkesztés";
    editButton.addEventListener("click", () => editDevice(index));

    deleteButton.type = "button";
    deleteButton.className = "btn btn-sm btn-outline-danger";
    deleteButton.textContent = "Törlés";
    deleteButton.addEventListener("click", () => deleteDevice(index));

    actions.append(editButton, deleteButton);
    details.prepend(title);
    item.append(details, actions);
    deviceList.appendChild(item);
  });
}

// Kiüríti az űrlapot. Az editIndex mező törlésével visszaáll 'új eszköz felvétele' módba a szerkesztés módból.
function resetForm() {
  // Mentés vagy megszakítás után visszaállítjuk az űrlapot új eszköz felvételére.
  deviceForm.reset();
  editIndexInput.value = "";
  saveDeviceBtn.textContent = "Eszköz mentése";
  deviceMessage.textContent = "";
}

// ---------- Eszköz felvétele, szerkesztése, törlése ----------

// Szerkesztés indítása: a kiválasztott eszköz adatait visszatölti az űrlapba, így ugyanaz az űrlap használható új felvételre és módosításra is.
function editDevice(index) {
  // A kiválasztott eszköz adatait betöltjük az űrlap mezőibe.
  const device = devices[index];
  if (!device) return;

  editIndexInput.value = index;
  deviceNameInput.value = device.name || "";
  deviceTypeInput.value = device.type || "";
  thingSpeakFieldInput.value = device.field || device.thingSpeakField || "";
  deviceLocationInput.value = device.location || "";
  saveDeviceBtn.textContent = "Módosítás mentése";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Egy eszköz törlése. Visszavonás nincs, ezért előbb megerősítést kérünk egy párbeszédablakban.
async function deleteDevice(index) {
  // Törlés előtt megerősítést kérünk, mert az eszköz kikerül a mentett listából.
  if (!devices[index]) return;

  const confirmed = await window.AppDialog.confirm("Biztosan törlöd ezt az eszközt?", {
    title: "Eszköz törlése",
    confirmText: "Törlés"
  });
  if (!confirmed) return;

  devices.splice(index, 1);
  saveDevices();
  renderDevices();
  resetForm();
  logDeviceActivity("Egy eszköz törölve lett.");
}

// Az űrlap elküldése (mentés gomb): ellenőrzi a kötelező mezőket, majd új eszközt vesz fel vagy a meglévőt módosítja.
deviceForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const editIndex = editIndexInput.value;
  const name = deviceNameInput.value.trim();
  const type = deviceTypeInput.value;
  const field = thingSpeakFieldInput.value.trim();
  const location = deviceLocationInput.value.trim();

  if (!name || !type) {
    deviceMessage.textContent = "Add meg az eszköz nevét és típusát.";
    return;
  }

  const existingDevice = editIndex === "" ? null : devices[Number(editIndex)];
  const isNewDevice = editIndex === "" || !existingDevice;
  const now = new Date().toISOString();
  const deviceData = {
    name,
    type,
    field,
    thingSpeakField: field,
    location,
    status: existingDevice?.status || "Active",
    createdAt: existingDevice?.createdAt || now,
    updatedAt: now,
    ...(existingDevice?.id ? { id: existingDevice.id } : {}),
    ...(existingDevice?.source ? { source: existingDevice.source } : {})
  };

  // Szerkesztéskor a meglévő rekord helyére írunk, új eszköznél pedig a lista végére tesszük.
  if (isNewDevice) {
    devices.push(deviceData);
  } else {
    devices[Number(editIndex)] = deviceData;
  }

  saveDevices();
  renderDevices();
  resetForm();
  deviceMessage.textContent = isNewDevice ? "Az eszköz mentése sikerült." : "Az eszköz adatainak módosítása sikerült.";
  logDeviceActivity(isNewDevice ? `Új eszköz felvéve: ${name}.` : `Eszköz módosítva: ${name}.`);
});

// A Mégse gomb kiüríti az űrlapot, és visszaáll új eszköz felvételére.
cancelEditBtn.addEventListener("click", resetForm);

// ---------- Téma és az oldal indítása ----------

// A világos/sötét téma beállítása. A téma a 'dark' osztály a <html> elemen, és a localStorage-ban is megmarad.
// Ugyanaz a kód van a script.js-ben, hogy a két oldal témája mindig egyezzen. TODO: közös fájlba lehetne tenni.
function setupTheme() {
  // A főoldallal közös beállítást használjuk (<html data-bs-theme>), így az oldalváltás nem vált témát.
  const root = document.documentElement;
  themeToggle.setAttribute("aria-pressed", String(root.getAttribute("data-bs-theme") === "dark"));

  themeToggle.addEventListener("click", () => {
    const theme = root.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-bs-theme", theme);
    localStorage.setItem("greenhouse-theme", theme);
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  });
}

function setupNavigation() {
  // A menü lenyitását a Tabler (Bootstrap) kezeli; linkre kattintva mobilon csak becsukjuk.
  const navLinks = document.getElementById("navLinks");
  navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    navLinks.classList.remove("show");
  }));
}

function setupLogout() {
  const logoutButton = document.getElementById("logoutBtn");
  if (!logoutButton) return;

  logoutButton.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Nem sikerült kijelentkezni.");
      window.location.replace("index.html");
    } catch (error) {
      deviceMessage.textContent = error.message || "Nem sikerült kijelentkezni.";
    }
  });
}

// Az oldal indítása. Az eszközlista csak helyi adat, de az oldalhoz így is bejelentkezés kell,
// ezért előbb megkérdezzük a szervert, hogy a felhasználó be van-e jelentkezve, és csak utána jelenítünk meg bármit.
async function initializeDevicePage() {
  try {
    // Az oldalt csak azután mutatjuk meg, hogy a szerver megerősítette a bejelentkezést.
    const response = await fetch("/api/auth", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.authenticated) {
      window.location.replace("index.html");
      return;
    }

    document.getElementById("devicePageContent").hidden = false;
    setupTheme();
    setupNavigation();
    setupLogout();
    renderDevices();
  } catch {
    window.location.replace("index.html");
  }
}

// Az oldal indítása.
initializeDevicePage();
