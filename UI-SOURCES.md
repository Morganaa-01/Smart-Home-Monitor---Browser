# UI example sources

Reviewed on 31 October 2026. The Flet Studio Gallery contains runnable Flet/Python examples; it does not provide standalone CSS files for this HTML/CSS/JavaScript project. The project uses selected interaction and visual patterns implemented in its existing web stack.

| Project element | Flet Studio source | Adaptation in this project |
| --- | --- | --- |
| City autocomplete | [Input / AutoComplete](https://studio.flet.dev/gallery/input/autocomplete) | Debounced city suggestions, keyboard selection, and selected-location handling for the weather search. |
| Buttons | [Buttons gallery](https://studio.flet.dev/gallery/buttons) | Filled, outlined, and icon button appearance. |
| ThingSpeak line charts | [Charts gallery](https://studio.flet.dev/gallery/charts), especially [LineChart](https://studio.flet.dev/gallery/charts/linechart) | Dark chart surface, grid, axes, and line-series presentation. |
| Sensor and actuator cards | [Layout / Card](https://studio.flet.dev/gallery/layout/card), especially [Music info card](https://studio.flet.dev/gallery/layout/card/example/controls/material/card/music_info) | Card surface, content padding, icon/title hierarchy, and grouped information adapted to the sensor metrics and local actuator states. |

The AutoComplete example demonstrates suggestions and separate change/select handling. Its sample is written with Flet's Python API. The greenhouse app's autocomplete was implemented for this project in HTML, CSS, and JavaScript and queries Open-Meteo's geocoding service. The gallery is a design and behavior reference, not a source of drop-in CSS files.

For thesis references, cite the specific example pages above and describe the resulting controls as adaptations implemented in the project's web technologies. Record the access date for each reference in the thesis bibliography.
