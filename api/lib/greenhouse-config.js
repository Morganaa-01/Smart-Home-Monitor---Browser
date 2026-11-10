// A szenzormezők leírása: melyik ThingSpeak-mező mit jelent, milyen egységben.
// A mezők sorszámának egyeznie kell azzal, amit a mikrovezérlő küld. Ha a firmware-ben megváltozik, itt is át kell írni.
// A fényküszöb számítási szabály (600 lux), nem valamelyik növényfajta célértéke.
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
    "A napsütéses órák becslése az egymást követő, 600 lux feletti TSL2561-mérések közötti időt számolja.",
    "Ez a növényház megvilágításának közelítő időtartama, nem hivatalos napsugárzási mérés.",
    "Növényfajta és kalibrált termesztési határérték nincs beállítva.",
    "Az automatika helyben, az ESP32-n fut. A weboldal nem küld vezérlőparancsot."
  ]
});
