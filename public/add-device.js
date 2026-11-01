const deviceForm = document.getElementById("deviceForm");
const deviceList = document.getElementById("deviceList");
const deviceCount = document.getElementById("deviceCount");
const deviceMessage = document.getElementById("deviceMessage");
const themeToggle = document.getElementById("themeToggle");

const editIndexInput = document.getElementById("editIndex");
const deviceNameInput = document.getElementById("deviceName");
const deviceTypeInput = document.getElementById("deviceType");
const thingSpeakFieldInput = document.getElementById("thingSpeakField");
const deviceLocationInput = document.getElementById("deviceLocation");
const saveDeviceBtn = document.getElementById("saveDeviceBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const DEFAULT_DEVICES = [
  { name: "Hőmérséklet", type: "Temperature", field: "1", location: "BME280", icon: "device_thermostat" },
  { name: "Relatív páratartalom", type: "Humidity", field: "2", location: "BME280", icon: "humidity_mid" },
  { name: "Légnyomás", type: "Air Pressure", field: "3", location: "BME280", icon: "speed" },
  { name: "Megvilágítás", type: "Light", field: "4", location: "TSL2561", icon: "light_mode" },
  { name: "Esőérzékelő", type: "Rain", field: "5", location: "Növényház", icon: "rainy" },
  { name: "Ventilátor", type: "Fan", field: "6", location: "Növényház", icon: "mode_fan" },
  { name: "Kiegészítő LED", type: "Light", field: "7", location: "Növényház", icon: "lightbulb" },
  { name: "Növényház teteje", type: "Roof", field: "8", location: "Növényház", icon: "roofing" }
];

function loadDevices() {
  try {
    const storedDevices = localStorage.getItem("smartHomeDevices");
    if (storedDevices === null) {
      localStorage.setItem("smartHomeDevices", JSON.stringify(DEFAULT_DEVICES));
      return DEFAULT_DEVICES.map((device) => ({ ...device }));
    }

    const savedDevices = JSON.parse(storedDevices);
    return Array.isArray(savedDevices)
      ? savedDevices.filter((device) => device && typeof device === "object" && !Array.isArray(device))
      : [];
  } catch (error) {
    console.warn("A mentett eszközlista nem olvasható:", error);
    return [];
  }
}

let devices = loadDevices();
let draggedDeviceIndex = null;

function saveDevices() {
  try {
    localStorage.setItem("smartHomeDevices", JSON.stringify(devices));
    return true;
  } catch (error) {
    console.warn("Az eszközlista mentése nem sikerült:", error);
    deviceMessage.textContent = "A böngésző nem tudta elmenteni a változtatást.";
    return false;
  }
}

function getDeviceIcon(type) {
  const icons = {
    Temperature: "device_thermostat",
    Humidity: "humidity_mid",
    "Air Pressure": "speed",
    Light: "light_mode",
    Rain: "rainy",
    Fan: "mode_fan",
    "Soil Moisture": "water_drop",
    Thermostat: "device_thermostat",
    Roof: "roofing",
    Security: "sensors"
  };
  return icons[type] || "sensors";
}

function getDeviceTypeLabel(type) {
  const labels = {
    Temperature: "Hőmérséklet",
    Humidity: "Páratartalom",
    "Air Pressure": "Légnyomás",
    Light: "Fényérzékelő / LED",
    Rain: "Esőérzékelő",
    Fan: "Ventilátor",
    "Soil Moisture": "Talajnedvesség",
    Thermostat: "Termosztát",
    Roof: "Tetőmozgatás",
    Security: "Egyéb eszköz"
  };
  return labels[type] || type || "Nincs megadva";
}

function makeIconButton(iconName, label, className, onClick) {
  const button = document.createElement("button");
  const icon = document.createElement("span");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  icon.className = "material-symbols-rounded";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconName;
  button.append(icon, document.createTextNode(label));
  button.addEventListener("click", onClick);
  return button;
}

function moveDevice(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= devices.length) return;

  [devices[index], devices[newIndex]] = [devices[newIndex], devices[index]];
  if (!saveDevices()) return;
  renderDevices();
  deviceMessage.textContent = "A csempék sorrendje elmentve.";
}

function renderDevices() {
  deviceList.replaceChildren();
  deviceCount.textContent = `${devices.length} eszköz`;

  if (devices.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "device-empty-state";
    emptyMessage.textContent = "Még nincs felvett eszköz. Az űrlappal újat adhatsz hozzá.";
    deviceList.appendChild(emptyMessage);
    return;
  }

  devices.forEach((device, index) => {
    const tile = document.createElement("article");
    const header = document.createElement("div");
    const icon = document.createElement("span");
    const titleGroup = document.createElement("div");
    const title = document.createElement("h4");
    const type = document.createElement("p");
    const field = document.createElement("p");
    const location = document.createElement("p");
    const actions = document.createElement("div");
    const orderControls = document.createElement("div");
    const moveUp = document.createElement("button");
    const moveDown = document.createElement("button");
    const moveLabel = document.createElement("span");

    tile.className = "saved-device device-tile";
    tile.setAttribute("role", "listitem");
    tile.draggable = true;
    tile.dataset.deviceIndex = String(index);

    header.className = "device-tile-header";
    icon.className = "device-tile-icon material-symbols-rounded";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = device.icon || getDeviceIcon(device.type);
    titleGroup.className = "device-tile-title";
    title.textContent = device.name || "Névtelen eszköz";
    type.className = "device-tile-type";
    type.textContent = getDeviceTypeLabel(device.type);
    titleGroup.append(title, type);
    header.append(icon, titleGroup);

    field.className = "device-tile-detail";
    const fieldNumber = device.field || device.thingSpeakField;
    field.textContent = fieldNumber ? `ThingSpeak · Field ${fieldNumber}` : "Nincs ThingSpeak-mező hozzárendelve";
    location.className = "device-tile-location";
    location.textContent = device.location || "Hely nincs megadva";

    actions.className = "device-tile-actions";
    actions.append(
      makeIconButton("edit", "Eszköz szerkesztése", "button secondary device-edit-button", () => editDevice(index)),
      makeIconButton("delete", "Eszköz eltávolítása", "button secondary device-delete-button", () => deleteDevice(index))
    );

    orderControls.className = "device-order-controls";
    moveUp.type = "button";
    moveUp.className = "device-order-button";
    moveUp.textContent = "↑";
    moveUp.disabled = index === 0;
    moveUp.setAttribute("aria-label", "Eszköz mozgatása feljebb");
    moveUp.addEventListener("click", () => moveDevice(index, -1));
    moveDown.type = "button";
    moveDown.className = "device-order-button";
    moveDown.textContent = "↓";
    moveDown.disabled = index === devices.length - 1;
    moveDown.setAttribute("aria-label", "Eszköz mozgatása lejjebb");
    moveDown.addEventListener("click", () => moveDevice(index, 1));
    moveLabel.className = "device-drag-label";
    moveLabel.textContent = "Húzd a csempét az átrendezéshez";
    orderControls.append(moveUp, moveDown, moveLabel);

    tile.append(header, field, location, actions, orderControls);
    tile.addEventListener("dragstart", handleTileDragStart);
    tile.addEventListener("dragover", handleTileDragOver);
    tile.addEventListener("dragleave", handleTileDragLeave);
    tile.addEventListener("drop", handleTileDrop);
    tile.addEventListener("dragend", handleTileDragEnd);
    deviceList.appendChild(tile);
  });
}

function handleTileDragStart(event) {
  if (event.target.closest("button")) {
    event.preventDefault();
    return;
  }
  draggedDeviceIndex = Number(event.currentTarget.dataset.deviceIndex);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedDeviceIndex));
  event.currentTarget.classList.add("is-dragging");
}

function handleTileDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("is-drop-target");
}

function handleTileDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("is-drop-target");
  }
}

function handleTileDrop(event) {
  event.preventDefault();
  const targetIndex = Number(event.currentTarget.dataset.deviceIndex);
  if (draggedDeviceIndex === null || draggedDeviceIndex === targetIndex) return;

  const [movedDevice] = devices.splice(draggedDeviceIndex, 1);
  devices.splice(targetIndex, 0, movedDevice);
  if (!saveDevices()) return;
  renderDevices();
  deviceMessage.textContent = "A csempék sorrendje elmentve.";
}

function handleTileDragEnd() {
  draggedDeviceIndex = null;
  deviceList.querySelectorAll(".device-tile").forEach((tile) => {
    tile.classList.remove("is-dragging", "is-drop-target");
  });
}

function resetForm() {
  deviceForm.reset();
  editIndexInput.value = "";
  saveDeviceBtn.textContent = "Eszköz mentése";
  deviceMessage.textContent = "";
}

function editDevice(index) {
  const device = devices[index];
  if (!device) return;

  editIndexInput.value = String(index);
  deviceNameInput.value = device.name || "";
  deviceTypeInput.value = device.type || "";
  thingSpeakFieldInput.value = device.field || device.thingSpeakField || "";
  deviceLocationInput.value = device.location || "";
  saveDeviceBtn.textContent = "Módosítás mentése";
  deviceMessage.textContent = `${device.name || "Eszköz"} szerkesztése.`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  deviceNameInput.focus({ preventScroll: true });
}

function deleteDevice(index) {
  const device = devices[index];
  if (!device) return;

  const confirmed = window.confirm(`Eltávolítod ezt az eszközt: ${device.name || "Névtelen eszköz"}?`);
  if (!confirmed) return;

  devices.splice(index, 1);
  if (!saveDevices()) return;
  renderDevices();
  resetForm();
  deviceMessage.textContent = "Az eszközt eltávolítottad.";
}

deviceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = deviceNameInput.value.trim();
  const type = deviceTypeInput.value;
  if (!name || !type) return;

  const editIndex = editIndexInput.value;
  const existingDevice = editIndex === "" ? null : devices[Number(editIndex)];
  const now = new Date().toISOString();
  const field = thingSpeakFieldInput.value.trim();
  const deviceData = {
    name,
    type,
    field,
    thingSpeakField: field,
    location: deviceLocationInput.value.trim(),
    icon: existingDevice?.icon || getDeviceIcon(type),
    status: existingDevice?.status || "Beállítva",
    createdAt: existingDevice?.createdAt || now,
    updatedAt: now
  };

  if (editIndex === "" || !existingDevice) devices.push(deviceData);
  else devices[Number(editIndex)] = deviceData;

  if (!saveDevices()) return;
  renderDevices();
  resetForm();
  deviceMessage.textContent = existingDevice ? "Az eszköz adatai frissültek." : "Az eszköz bekerült a listába.";
});

cancelEditBtn.addEventListener("click", resetForm);

function setupTheme() {
  const storedTheme = localStorage.getItem("greenhouse-theme") || localStorage.getItem("smart-home-theme");
  if (storedTheme === "dark") document.body.classList.add("dark");

  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const theme = document.body.classList.contains("dark") ? "dark" : "light";
    localStorage.setItem("greenhouse-theme", theme);
  });
}

setupTheme();
renderDevices();
