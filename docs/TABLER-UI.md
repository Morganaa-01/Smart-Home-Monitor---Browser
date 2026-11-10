# Tabler alapú felület – dokumentáció

Ez a dokumentum leírja, hogyan épül fel a webes felület a **Tabler** (Open Source, MIT) elemeiből, mely fájlok tartoznak hozzá, és hogyan lehet a felületet bővíteni.

## 1. Miért a Tabler?

A Tabler valódi HTML/CSS/JavaScript admin sablon (Bootstrap 5 alapokon), ezért az elemei közvetlenül beilleszthetők ebbe a projektbe. Kész komponenseket ad (menü, kártyák, űrlapok, gombok, kapcsolók, jelvények, listák), és tartalmaz grafikon-megoldást is (ApexCharts). Így a felülethez nem kell több ezer soros, saját CSS.

| | |
| --- | --- |
| Csomag | `@tabler/core` **1.7.3** (npm) |
| Licenc | MIT (az ingyenes Open Source változat; a fizetős Pro/All Package nincs használva) |
| Forrás | https://tabler.io/admin-template, https://github.com/tabler/tabler |
| Letöltés dátuma | 2026. november 10. |
| Grafikon | ApexCharts (a Tabler csomagjában érkezik) |

## 2. Fájlok

| Fájl | Szerep |
| --- | --- |
| `public/vendor/tabler/css/tabler.min.css` | A Tabler stíluslapja. Mindkét oldal ezt tölti be. |
| `public/vendor/tabler/css/tabler-themes.min.css`, `tabler-vendors.min.css` | Letöltve, de jelenleg nincsenek betöltve (téma- és bővítmény-stílusok). |
| `public/vendor/tabler/js/tabler.min.js` | A Tabler JS (a Bootstrap-ot is tartalmazza): menü lenyitása, kártyák, lenyíló elemek. |
| `public/vendor/tabler/js/tabler-theme.min.js` | Letöltve, de nincs használatban (a témaváltást saját kód végzi). |
| `public/vendor/tabler/libs/apexcharts/apexcharts.min.js` | ApexCharts, a mérési előzmények grafikonjaihoz. |
| `public/app.css` | Kis, projekt-specifikus kiegészítés (rácsok, szerkesztőlisták, chat, napló, grafikon-csempék, párbeszédablak). Csak Tabler CSS-változókat használ, ezért követi a világos/sötét témát. |
| `public/index.html`, `public/add-device.html` | Tabler elemekből épített oldalak. |
| `public/script.js`, `public/add-device.js` | Az oldalak működése: adatbetöltés, grafikonok, témaváltás, menü. |
| `public/app-dialog.js` | Párbeszédablak (megerősítés, üzenet), Tabler színekkel és gombokkal. |
| `public/measurement-report.js` | A PDF-jelentés készítése (lásd a 7. pontot). |

## 3. Használt Tabler elemek

| Felületi elem | Tabler elem |
| --- | --- |
| Bejelentkezés | `page page-center`, `container-tight`, `card card-md`, `form-label`, `form-control`, `input-group input-group-flat`, `btn btn-primary` |
| Felső menü | `navbar navbar-expand-md sticky-top`, `navbar-toggler` (`data-bs-toggle="collapse"`), `nav-link` |
| Oldalfejléc | `page-header`, `page-pretitle`, `page-title`, `btn-list` |
| Mérőkártyák | `card card-sm`, `avatar bg-*-lt`, `subheader`, `h1` |
| Legutóbbi adatcsomag | `card`, `card-header`, `card-actions`, `list-group list-group-flush`, `badge bg-*-lt` |
| Szerkesztőlisták (húzható sorok) | `list-group`, `list-group-item`, `btn btn-icon btn-sm btn-ghost-*` |
| Űrlapok | `form-label`, `form-control`, `form-select`, `input-group` |
| Beavatkozók kapcsolói | `form-check form-switch` + `form-check-input` (csak felületi próba) |
| Állapotjelzők | `badge bg-green-lt` / `bg-yellow-lt` / `bg-red-lt` / `bg-secondary-lt` |
| Tájékoztató sávok | `alert alert-info` |
| Településjavaslatok | `list-group`, `list-group-item list-group-item-action` |
| Eseménynapló | `list-group`, `list-group-item` |
| Eszközlista (Eszközök kezelése) | `card`, `card-body`, `card-footer`, `btn btn-sm`, `btn-outline-danger` |
| PDF-gombok | `btn` |
| Párbeszédablak | natív `<dialog>`, Tabler színváltozók (`app.css`), `btn`, `btn-primary` |
| Grafikonok | ApexCharts `area` diagram (állapotmezőknél lépcsős vonal) |

## 4. Ami szándékosan nem Tabler

- **Ikonok:** a Google Material Symbols Rounded betűkészlet (Google Fonts). A Tabler saját ikonkészlete (`@tabler/icons`) külön csomag; a váltás később külön lépésben elvégezhető.
- **Chat buborékok és a húzással rendezhető lista:** ezekre nincs kész Tabler komponens, ezeket az `app.css` formázza Tabler színváltozókkal.

## 5. Téma (világos/sötét)

A Tabler a témát a `<html data-bs-theme="light|dark">` attribútumból veszi. A választást a `localStorage` `greenhouse-theme` kulcsa őrzi. Mindkét HTML fejlécében egy rövid szkript az első kirajzolás előtt beállítja az attribútumot, így nincs villanás. A témaváltó gomb (`#themeToggle`) a `script.js` / `add-device.js` `setupTheme()` függvényében működik; a főoldalon váltáskor a grafikonok is újrarajzolódnak az új színekkel.

## 6. Grafikonok (ApexCharts)

A `script.js` `renderThingSpeakCharts()` függvénye ApexCharts `area` diagramot hoz létre minden `[data-field-chart]` elemben:

- az adatsor a `downsampleReadings()` függvénnyel ritkított (max. 480 pont, a szélső értékek megmaradnak);
- az idő budapesti időzónában jelenik meg (tengely és tooltip);
- az esőérzékelő, ventilátor, LED és tető mezők 0/1 értéke lépcsős vonallal, szöveges tengelyfelirattal látszik (pl. „Ki” / „Be”);
- a diagramok a szülőelem szélességéhez igazodnak;
- a példányokat az `apexCharts` térkép tartja nyilván, újrarajzolás előtt megszüntetjük őket.

## 7. PDF-jelentés

A **Mentés PDF-be** és **Küldés e-mailben** gombok (`#exportPdfBtn`, `#emailPdfBtn`) Tabler `btn` elemek. A `measurement-report.js` a szűrt időszak grafikonjait az oldalon lévő ApexCharts SVG-ből (`[data-field-chart] svg.apexcharts-svg`) rajzolja át vászonra, így a PDF-ben ugyanaz a kinézet szerepel, mint a képernyőn. A PDF előállítása külső könyvtár nélkül, a böngészőben történik.

## 8. Változatlan működés

A JavaScript által használt elemazonosítók (`id`) és `data-` attribútumok nem változtak (pl. `#chartGrid`, `data-metric-card`, `data-summary-key`), ezért az adatbetöltés, a főoldali szerkesztő, az időjárás, az AI-chat és a bejelentkezés logikája érintetlen. Az API-k (`/api/*`) nem módosultak.

## 9. Új Tabler elem hozzáadása

1. Keresd meg a komponenst a Tabler demóján (https://preview.tabler.io) vagy dokumentációjában (https://docs.tabler.io).
2. Másold be a HTML-t az `index.html`-be; a JS által használt azonosítókat tartsd meg.
3. Ha a Tabler nem ad kész megoldást, az `app.css`-be írj kiegészítést, Tabler CSS-változókkal (`var(--tblr-...)`).
4. Új külső könyvtárat a `public/vendor/` alá tegyél, és jegyezd be az `UI-SOURCES.md` fájlba.
