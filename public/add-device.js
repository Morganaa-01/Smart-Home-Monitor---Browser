// Eszközkezelő oldal: eszközök felvétele, szerkesztése és törlése.
// A lista a localStorage-ban van, ebből rajzoljuk ki a kártyákat. Ez csak nyilvántartás, a hardvert és az ESP32 programját nem érinti.
const deviceForm = document.getElementById("deviceForm");
const deviceList = document.getElementById("deviceList");
const themeToggle = document.getElementById("themeToggle");

// Az űrlap mezői. Az editIndex rejtett mező: üres = új eszköz, szám = ennek az eszköznek a szerkesztése.
const editIndexInput = document.getElementById("editIndex");
const deviceNameInput = document.getElementById("deviceName");
const deviceTypeInput = document.getElementById("deviceType");
const thingSpeakFieldInput = document.getElementById("thingSpeakField");
const deviceLocationInput = document.getElementById("deviceLocation");
const saveDeviceBtn = document.getElementById("saveDeviceBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const deviceMessage = document.getElementById("deviceMessage");

// Eszköztípusok: angol kulcs -> magyar név.
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

// Ezzel jegyezzük meg, hogy az alaplistát már betöltöttük (így a törölt kártya nem jön vissza).
const DEVICE_INITIALIZED_KEY = "smartHomeDevicesInitialized";
// A növényház jelenlegi eszközei, mindegyikhez egy ThingSpeak-mező (field1...field8) tartozik.
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

// Eszközlista betöltése a localStorage-ból. Első megnyitáskor hozzáadjuk a növényház ismert eszközeit is.
// Sérült adatnál üres listával folytatjuk.
function loadDevices() {
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

// Az eszközök listája (memóriában), induláskor a localStorage-ból töltjük.
let devices = loadDevices();

// Lista mentése a localStorage-ba. Böngészőnként külön van, a ThingSpeak csatornába nem kerül.
function saveDevices() {
  localStorage.setItem("smartHomeDevices", JSON.stringify(devices));
}

// ISO dátum (2026-11-08T19:33:00Z) -> olvasható, budapesti idejű szöveg.
function formatDate(dateString) {
  if (!dateString) {
    return "Nincs adat";
  }

  const date = new Date(dateString);
  return Number.isNaN(date.getTime())
    ? "Nincs adat"
    : date.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
}

// Sor az eseménynaplóba, amit a főoldal is mutat. A script.js naplózó függvénye ide van másolva, mert ez az oldal nem tölti be a script.js-t.
// TODO: a localStorage függvényeket közös fájlba lehetne tenni.
function logDeviceActivity(message) {
  try {
    const savedEntries = JSON.parse(localStorage.getItem("greenhouse-activity-log") || "[]");
    const entries = Array.isArray(savedEntries) ? savedEntries : [];
    entries.unshift({ at: new Date().toISOString(), message, level: "success" });
    localStorage.setItem("greenhouse-activity-log", JSON.stringify(entries.slice(0, 30)));
  } catch {
    // Az eszköz mentése akkor is sikeres, ha a naplózás nem megy.
  }
}

// 'Címke: érték' sor az eszközkártyára. textContent-et használunk, így a beírt szöveg nem futhat le HTML-ként.
function addDetail(container, label, value) {
  const line = document.createElement("p");
  const name = document.createElement("strong");

  name.textContent = `${label}: `;
  line.append(name, document.createTextNode(value));
  container.appendChild(line);
}

// ---------- Az eszközlista megjelenítése ----------

// Eszközkártyák újrarajzolása a listából (mentés vagy törlés után).
// DOM-elemekből építjük, nem HTML-szövegből.
function renderDevices() {
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

// Űrlap kiürítése. Az editIndex törlésével visszaáll 'új eszköz' módba.
function resetForm() {
  deviceForm.reset();
  editIndexInput.value = "";
  saveDeviceBtn.textContent = "Eszköz mentése";
  deviceMessage.textContent = "";
}

// ---------- Eszköz felvétele, szerkesztése, törlése ----------

// Szerkesztés indítása: az eszköz adatai az űrlapba kerülnek, így ugyanaz az űrlap jó felvételre és módosításra is.
function editDevice(index) {
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

// Eszköz törlése. Visszavonás nincs, ezért előbb megerősítést kérünk.
async function deleteDevice(index) {
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

// Űrlap elküldése: kötelező mezők ellenőrzése, majd új eszköz felvétele vagy a meglévő módosítása.
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

  // Szerkesztéskor a régi rekord helyére írunk, új eszköznél a lista végére.
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

// A Mégse gomb kiüríti az űrlapot.
cancelEditBtn.addEventListener("click", resetForm);

// ---------- Téma és az oldal indítása ----------

// Világos/sötét téma. Ugyanaz a kód, mint a script.js-ben, hogy a két oldal témája egyezzen (<html data-bs-theme>).
// TODO: közös fájlba lehetne tenni.
function setupTheme() {
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
  // A menü nyitását a Tabler (Bootstrap) intézi, linkre kattintva csak bezárjuk.
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

// Oldal indítása. Az eszközlista helyi adat, de az oldalhoz bejelentkezés kell, ezért előbb megkérdezzük a szervert.
async function initializeDevicePage() {
  try {
    // Csak a bejelentkezés megerősítése után mutatjuk az oldalt.
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

// Indítás.
initializeDevicePage();
