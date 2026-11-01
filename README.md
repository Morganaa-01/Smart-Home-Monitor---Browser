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

## Bejelentkezés

A felülethez a szerver ellenőrzi a belépési adatokat, és aláírt, HttpOnly munkamenet-sütit ad ki. A ThingSpeak- és AI-végpontok bejelentkezés nélkül nem használhatók.

Állítsd be ezeket a környezeti változókat helyben a `.env` fájlban és Vercelben is:

- `ADMIN_USERNAME` – a rendszergazda felhasználóneve
- `ADMIN_PASSWORD` – a rendszergazda jelszava
- `SESSION_SECRET` – legalább 32 karakter hosszú, véletlenszerű titok

A belépési jelszót és a munkamenet titkát ne tedd a forráskódba és ne töltsd fel GitHubra. Nyilvános tárhelyen használj egyedi, erős jelszót.

## Indítás helyben

```powershell
npm install
npm start
```

A helyi szerver a projekt gyökérmappájában lévő `.env` fájlból olvassa az `OPENAI_API_KEY`, `THINGSPEAK_CHANNEL_ID`, `THINGSPEAK_READ_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` és `SESSION_SECRET` változókat. A `.env` fájlt ne töltsd fel verziókezelőbe. Tárhelyre telepítéskor ugyanezeket a változókat a tárhely környezeti beállításai között add meg.

Az AI-chat szerver nélkül is megjelenik, de válaszolni csak az API-kulcs beállítása után tud. A ThingSpeak élő adatai internetkapcsolatot igényelnek.
