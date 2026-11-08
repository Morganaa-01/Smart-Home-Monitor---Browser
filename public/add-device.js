// Device manager page: add, edit and delete devices in the local storage of the browser.
// The list is saved in the browser and the cards are drawn from it.
// Adding a device is only a record. It does not pair any hardware or change the ESP32 program.
const deviceForm = document.getElementById("deviceForm");
const deviceList = document.getElementById("deviceList");
const themeToggle = document.getElementById("themeToggle");

const editIndexInput = document.getElementById("editIndex");
const deviceNameInput = document.getElementById("deviceName");
const deviceTypeInput = document.getElementById("deviceType");
const thingSpeakFieldInput = document.getElementById("thingSpeakField");
const deviceLocationInput = document.getElementById("deviceLocation");
const saveDeviceBtn = document.getElementById("saveDeviceBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const deviceMessage = document.getElementById("deviceMessage");

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

const DEVICE_INITIALIZED_KEY = "smartHomeDevicesInitialized";
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

// ---------- Saved devices ----------

// The default list is added only once, so a deleted card does not come back at every start.
function loadDevices() {
  // On the first visit add the known ESP32 devices, afterwards load the user's list.
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

let devices = loadDevices();

// This is local storage only, it is not synced to another phone or computer.
function saveDevices() {
  // The list is stored per browser, not in the ThingSpeak channel.
  localStorage.setItem("smartHomeDevices", JSON.stringify(devices));
}

function formatDate(dateString) {
  if (!dateString) {
    return "Nincs adat";
  }

  const date = new Date(dateString);
  return Number.isNaN(date.getTime())
    ? "Nincs adat"
    : date.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
}

function logDeviceActivity(message) {
  // Write to the same local activity log that the main page shows.
  try {
    const savedEntries = JSON.parse(localStorage.getItem("greenhouse-activity-log") || "[]");
    const entries = Array.isArray(savedEntries) ? savedEntries : [];
    entries.unshift({ at: new Date().toISOString(), message, level: "success" });
    localStorage.setItem("greenhouse-activity-log", JSON.stringify(entries.slice(0, 30)));
  } catch {
    // Saving the device still works if the browser does not allow logging.
  }
}

function addDetail(container, label, value) {
  const line = document.createElement("p");
  const name = document.createElement("strong");

  name.textContent = `${label}: `;
  line.append(name, document.createTextNode(value));
  container.appendChild(line);
}

// ---------- Showing the device list ----------

// After saving or deleting, rebuild the cards from the stored list.
function renderDevices() {
  // Build the list items from DOM elements, so user text never runs as HTML.
  deviceList.replaceChildren();
  const count = document.getElementById("deviceCount");
  if (count) count.textContent = `${devices.length} eszköz`;

  if (devices.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "device-list-empty muted";
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

    item.className = "saved-device device-list-item";
    details.className = "device-tile-details";
    actions.className = "device-actions";
    title.textContent = device.name || "Névtelen eszköz";

    // Put the saved data on the page as plain text.
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
    editButton.className = "button secondary";
    editButton.textContent = "Szerkesztés";
    editButton.addEventListener("click", () => editDevice(index));

    deleteButton.type = "button";
    deleteButton.className = "button danger-small";
    deleteButton.textContent = "Törlés";
    deleteButton.addEventListener("click", () => deleteDevice(index));

    actions.append(editButton, deleteButton);
    details.prepend(title);
    item.append(details, actions);
    deviceList.appendChild(item);
  });
}

function resetForm() {
  // After saving or cancelling, reset the form for a new device.
  deviceForm.reset();
  editIndexInput.value = "";
  saveDeviceBtn.textContent = "Eszköz mentése";
  deviceMessage.textContent = "";
}

// ---------- Add, edit and delete a device ----------

// Fill the form with the saved data, so the same form can be used for editing.
function editDevice(index) {
  // Load the data of the selected device into the form fields.
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

function deleteDevice(index) {
  // Ask for confirmation before deleting, because the device is removed from the saved list.
  if (!devices[index]) return;

  const confirmed = window.confirm("Biztosan törlöd ezt az eszközt?");
  if (!confirmed) return;

  devices.splice(index, 1);
  saveDevices();
  renderDevices();
  resetForm();
  logDeviceActivity("Egy eszköz törölve lett.");
}

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

  // When editing, replace the existing record. A new device goes to the end of the list.
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

cancelEditBtn.addEventListener("click", resetForm);

// ---------- Theme and page start ----------

function setupTheme() {
  // Use the same theme setting as the main page, so changing page keeps the theme.
  const storedTheme = localStorage.getItem("greenhouse-theme");
  if (storedTheme === "dark") document.documentElement.classList.add("dark");
  themeToggle.setAttribute("aria-pressed", String(document.documentElement.classList.contains("dark")));

  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");

    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    localStorage.setItem("greenhouse-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121813" : "#f3f6f1");
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  });
}

function setupNavigation() {
  const menuButton = document.getElementById("menuToggle");
  const menuIcon = menuButton.querySelector(".material-symbols-rounded");
  const navLinks = document.getElementById("navLinks");

  menuButton.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Menü bezárása" : "Menü megnyitása");
    menuIcon.textContent = isOpen ? "close" : "menu";
  });

  navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Menü megnyitása");
    menuIcon.textContent = "menu";
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

async function initializeDevicePage() {
  try {
    // Show the page only after the server has confirmed the login.
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

initializeDevicePage();
