# IoT okos növényház webes felügyelete

ESP32-alapú növényházi prototípus böngészős felülete. A szerver privát ThingSpeak-csatornáról olvassa a legutóbbi méréseket, a dashboard megjeleníti az értékeket és az eszközállapotokat, az AI-chat pedig megkapja az aktuális adatcsomagot.

## ThingSpeak mezők

A privát csatorna azonosítója és Read API Key-je szerveroldali környezeti változóként van beállítva. A kulcs nem kerül a böngészőbe.

| Mező | Csatornabeállítás |
| --- | --- |
| `field1` | Hőmérséklet (°C) |
| `field2` | Relatív páratartalom (%) |
| `field3` | Légnyomás (a firmware egysége nincs megadva) |
| `field4` | Megvilágítás (lux) |
| `field5` | Eső (1/0) |
| `field6` | Ventilátor (1/0) |
| `field7` | LED (1/0) |
| `field8` | Tető (1/0) |

A dashboard a legutóbbi 60 feedet a szerveroldali `/api/thingspeak` végponton kéri le; ugyanebből rajzolja a mérési előzményeket, a legfrissebb csomagot pedig az AI-chat is megkapja.

## Indítás helyben

```powershell
npm install
npm start
```

A helyi szerver a projekt gyökérmappájában lévő `.env` fájlból olvassa az `OPENAI_API_KEY`, `THINGSPEAK_CHANNEL_ID` és `THINGSPEAK_READ_API_KEY` változókat. A `.env` fájlt ne töltsd fel verziókezelőbe. Tárhelyre telepítéskor ugyanezeket a változókat a tárhely környezeti beállításai között add meg.

Az AI-chat szerver nélkül is megjelenik, de válaszolni csak az API-kulcs beállítása után tud. A ThingSpeak élő adatai internetkapcsolatot igényelnek.
