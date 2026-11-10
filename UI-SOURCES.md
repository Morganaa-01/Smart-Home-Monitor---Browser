# UI sources

Updated on 10 November 2026. The interface is built from **Tabler** (Open Source edition, MIT license), an HTML/CSS/JavaScript admin template based on Bootstrap 5. The charts are drawn with **ApexCharts**, which is bundled with Tabler.

| Item | Details |
| --- | --- |
| Package | `@tabler/core` 1.7.3 (npm) |
| Source | [tabler.io/admin-template](https://tabler.io/admin-template), [github.com/tabler/tabler](https://github.com/tabler/tabler) |
| License | MIT (the paid Pro and All Package editions are not used) |
| Location in the project | `public/vendor/tabler/` |
| Charts | ApexCharts, bundled with Tabler (`public/vendor/tabler/libs/apexcharts/`) |
| Icons | Google Material Symbols Rounded (not part of Tabler) |

| Project element | Tabler component |
| --- | --- |
| Login page | `page-center`, `card-md`, form controls, input group |
| Top navigation | `navbar`, `navbar-toggler`, `nav-link` |
| Page headers | `page-header`, `page-pretitle`, `page-title` |
| Sensor cards | `card-sm`, `avatar`, `subheader` |
| Latest data package | `card`, `list-group`, `badge` |
| Forms and filters | `form-control`, `form-select`, `input-group` |
| Buttons (including the PDF buttons) | `btn`, `btn-primary`, `btn-icon`, `btn-list` |
| Actuator demo switches | `form-switch` |
| City suggestions, activity log, editor lists | `list-group`, `list-group-item` |
| Status messages | `alert`, `badge` |
| Confirmation and message dialogs | native `<dialog>` element with Tabler colors and `btn` buttons |
| ThingSpeak history charts | ApexCharts `area` charts |

## Project-specific parts

These parts have no ready-made Tabler component. They are styled in `public/app.css` with Tabler CSS variables:

- the grids of the sensor cards, devices and charts,
- the AI chat window and its message bubbles,
- the drag and drop editor lists for cards and chart tiles,
- the chart tiles, including the add and remove controls,
- the weather city suggestions list.

See [docs/TABLER-UI.md](docs/TABLER-UI.md) for the full description of the interface (in Hungarian).

## External services

The weather card uses Open-Meteo for forecasts and its name-based geocoding API. For browser-detected coordinates, it uses [OpenStreetMap Nominatim reverse geocoding](https://nominatim.openstreetmap.org/) to display the nearest available place name. The Nominatim use is initiated only after the user requests their location; attribution and a link to the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) are shown in the weather card. Keep usage user-initiated and within the service's published request limits.

## Thesis references

Cite Tabler (version, license, access date) and ApexCharts, and describe the resulting interface as built from these components. Record the access date for each reference in the thesis bibliography.
