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

// ----------------------- Mentett eszközök adatai ---------------------------

function loadDevices() {
  try {
    const savedDevices = JSON.parse(localStorage.getItem("smartHomeDevices") || "[]");
    return Array.isArray(savedDevices)
      ? savedDevices.filter((device) => device && typeof device === "object" && !Array.isArray(device))
      : [];
  } catch (error) {
    console.warn("Saved device data could not be read:", error);
    return [];
  }
}

let devices = loadDevices();

function saveDevices() {
  localStorage.setItem("smartHomeDevices", JSON.stringify(devices));
}

function formatDate(dateString) {
  if (!dateString) {
    return "Not available";
  }

  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function addDetail(container, label, value) {
  const line = document.createElement("p");
  const name = document.createElement("strong");

  name.textContent = `${label}: `;
  line.append(name, document.createTextNode(value));
  container.appendChild(line);
}

// -------------------------- Eszközlista megjelenítése ----------------------

function renderDevices() {
  deviceList.replaceChildren();

  if (devices.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "No devices added yet.";
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
    actions.className = "device-actions";
    title.textContent = device.name || "Unnamed device";

    // Az elmentett adatokat egyszerű szövegként tesszük az oldalra.
    addDetail(details, "Type", device.type || "Not specified");
    addDetail(details, "ThingSpeak field", device.field || device.thingSpeakField || "Not assigned");
    addDetail(details, "Location", device.location || "Not specified");
    addDetail(details, "Status", device.status || "Active");
    addDetail(details, "Created", formatDate(device.createdAt));

    editButton.type = "button";
    editButton.className = "button secondary";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => editDevice(index));

    deleteButton.type = "button";
    deleteButton.className = "button danger-small";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteDevice(index));

    actions.append(editButton, deleteButton);
    details.prepend(title);
    item.append(details, actions);
    deviceList.appendChild(item);
  });
}

function resetForm() {
  deviceForm.reset();
  editIndexInput.value = "";
  saveDeviceBtn.textContent = "Save device";
}

// ----------------------- Eszköz felvétele, szerkesztése, törlése ------------

function editDevice(index) {
  const device = devices[index];
  if (!device) return;

  editIndexInput.value = index;
  deviceNameInput.value = device.name || "";
  deviceTypeInput.value = device.type || "";
  thingSpeakFieldInput.value = device.field || device.thingSpeakField || "";
  deviceLocationInput.value = device.location || "";
  saveDeviceBtn.textContent = "Update device";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteDevice(index) {
  if (!devices[index]) return;

  const confirmed = window.confirm("Are you sure you want to delete this device?");
  if (!confirmed) return;

  devices.splice(index, 1);
  saveDevices();
  renderDevices();
  resetForm();
}

deviceForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const editIndex = editIndexInput.value;
  const name = deviceNameInput.value.trim();
  const type = deviceTypeInput.value;
  const field = thingSpeakFieldInput.value.trim();
  const location = deviceLocationInput.value.trim();

  if (!name || !type) {
    window.alert("Please enter a device name and select a device type.");
    return;
  }

  const existingDevice = editIndex === "" ? null : devices[Number(editIndex)];
  const now = new Date().toISOString();
  const deviceData = {
    name,
    type,
    field,
    thingSpeakField: field,
    location,
    status: existingDevice?.status || "Active",
    createdAt: existingDevice?.createdAt || now,
    updatedAt: now
  };

  if (editIndex === "" || !existingDevice) {
    devices.push(deviceData);
  } else {
    devices[Number(editIndex)] = deviceData;
  }

  saveDevices();
  renderDevices();
  resetForm();
});

cancelEditBtn.addEventListener("click", resetForm);

// ------------------------- Téma és oldalindítás ----------------------------

function setupTheme() {
  const storedTheme = localStorage.getItem("smart-home-theme");
  if (storedTheme === "dark") {
    document.body.classList.add("dark");
  }

  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");

    const theme = document.body.classList.contains("dark") ? "dark" : "light";
    localStorage.setItem("smart-home-theme", theme);
  });
}

setupTheme();
renderDevices();
