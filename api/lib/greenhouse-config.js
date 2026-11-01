export const GREENHOUSE_CONFIG = Object.freeze({
  controller: "ESP32",
  automationLocation: "local_device",
  remoteControlEnabled: false,
  sunshineLuxThreshold: 600,
  plantSpeciesConfigured: false,
  calibratedThresholdsConfigured: false,
  fields: [
    { field: "field1", name: "temperature", unit: "°C", type: "measurement" },
    { field: "field2", name: "relative_humidity", unit: "%", type: "measurement" },
    { field: "field3", name: "air_pressure", unit: "hPa", type: "measurement" },
    { field: "field4", name: "light", unit: "lux", type: "measurement" },
    { field: "field5", name: "rain_sensor", unit: null, type: "boolean_state", values: { "0": "no_rain", "1": "rain_detected" } },
    { field: "field6", name: "fan", unit: null, type: "boolean_state", values: { "0": "off", "1": "on" } },
    { field: "field7", name: "led", unit: null, type: "boolean_state", values: { "0": "off", "1": "on" } },
    { field: "field8", name: "roof", unit: null, type: "boolean_state", values: { "0": "closed", "1": "open" } }
  ],
  notes: [
    "The greenhouse sunshine-hours estimate counts periods when consecutive TSL2561 readings are above the configured 600 lux threshold.",
    "Sunshine hours are an approximate greenhouse light-duration measure, not an official direct-solar-radiation measurement.",
    "Plant species and calibrated growing thresholds have not been configured.",
    "The ESP32 runs local automation. The web app does not send control commands."
  ]
});
