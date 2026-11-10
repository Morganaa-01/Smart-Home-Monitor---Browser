# UI example sources

Updated on 1 November 2026. The Flet Studio Gallery contains runnable Flet/Python examples; it does not provide standalone CSS files for this HTML/CSS/JavaScript project. The project uses selected interaction and visual patterns implemented in its existing web stack, then adapts spacing, colors, contrast, and responsive behavior to the greenhouse dashboard.

| Project element | Flet Studio source | Adaptation in this project |
| --- | --- | --- |
| City autocomplete | [Input / AutoComplete](https://studio.flet.dev/gallery/input/autocomplete) | Debounced city suggestions, keyboard selection, and selected-location handling for the weather search. |
| Buttons | [Buttons gallery](https://studio.flet.dev/gallery/buttons) | Filled, outlined, and icon button appearance, recolored to match the greenhouse palette with visible keyboard focus. |
| Login form fields | [Flet TextField](https://flet.dev/docs/controls/textfield/) | Username and masked password fields with an accessible reveal control based on Flet's password visibility option. |
| Login panel and submit action | [Flet Card](https://flet.dev/docs/controls/card/), [Flet Button](https://flet.dev/docs/controls/button/), and [Buttons gallery](https://studio.flet.dev/gallery/buttons) | A compact sign-in card and full-width submit button adapted to this HTML/CSS/JavaScript app. |
| Actuator demo switches | [Input / Switch](https://studio.flet.dev/gallery/input/switch), especially the [Switch example](https://studio.flet.dev/gallery/input/switch/example/controls/material/switch/switch) | Material-style checked and unchecked switch appearance, adapted as UI-only controls for the fan, LED, and greenhouse roof. |
| ThingSpeak line charts | [Charts gallery](https://studio.flet.dev/gallery/charts), especially [LineChart](https://studio.flet.dev/gallery/charts/linechart) | Dark chart surface, contrasting axes, restrained grid lines, and a greenhouse-green data series. |
| Sensor and actuator cards | [Layout / Card](https://studio.flet.dev/gallery/layout/card), especially [Music info card](https://studio.flet.dev/gallery/layout/card/example/controls/material/card/music_info) | Consistent card corners and spacing, with distinct icon, label, reading, and switch hierarchy for the greenhouse sensors and devices. |
| Confirmation and message dialogs | [Flet Studio Gallery](https://studio.flet.dev/gallery), category Dialogs (AlertDialog) | Rounded dialog card with title, text and actions on the right, built with the native `<dialog>` element. It replaces the browser's own `confirm` and `alert` windows (deleting a device, PDF messages). |

The Flet Studio Gallery does not provide a complete sign-in page, so the login combines reusable field, card, and button patterns. Its sample controls are implemented for this project in HTML, CSS, and JavaScript. The AutoComplete example demonstrates suggestions and separate change/select handling. Its sample is written with Flet's Python API. The greenhouse app's autocomplete was implemented for this project in HTML, CSS, and JavaScript and queries Open-Meteo's geocoding service. The gallery is a design and behavior reference, not a source of drop-in CSS files.

The weather card uses Open-Meteo for forecasts and its name-based geocoding API. For browser-detected coordinates, it uses [OpenStreetMap Nominatim reverse geocoding](https://nominatim.openstreetmap.org/) to display the nearest available place name. The Nominatim use is initiated only after the user requests their location; attribution and a link to the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) are shown in the weather card. Keep usage user-initiated and within the service's published request limits.

## Elements that are not taken from the gallery

These parts of the interface are our own design. The gallery has no direct match, or it was not used:

- Top navigation and the dropdown menu on small screens (the gallery has a Navigation category, but it was not used here).
- The AI chat window and its message bubbles.
- Status badges, the activity log and the weather card layout.
- Date and time inputs and the select of the chart filter (native HTML controls, only recolored).
- The drag and drop editor lists for cards and chart tiles.

The gallery examples are Flet (Python/Flutter) apps. They cannot be copied into an HTML/CSS/JavaScript project, so every element above and in the table is a re-implementation of the look, not copied code.

For thesis references, cite the specific example pages above and describe the resulting controls as adaptations implemented in the project's web technologies. Record the access date for each reference in the thesis bibliography.
