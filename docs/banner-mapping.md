# Banner definition mapping — example

Observed from supplied personal-project component:
- `modelId = legado-cartoes--banner`
- `name = banner`, `version = v1`, `group = legado/cartoes`
- `subItems[0].id = legado-cartoes--banner-slide`
- `subItems[0].containerField = slides`
- `comContainers(definition, { slides: null })`

The parent has fields created by `tabConteudo`, `segmentoField`, `tabAvancado`, `textField("trocaMs", ...)` and `paginaField`. Slide fields include desktop/mobile image, dimension helpers, alt, title, desktop/mobile links and tracking helpers.

## Safe initial behavior
The prototype builds a **proposal** preserving the parent model ID, qualified key and slide model ID. It does not claim to serialize to AEM JCR, validate helper-expanded fields, create nodes, or publish. Those require inspection of `comContainers`, dialog helpers and actual AEM persistence contracts.

## Next integration
Export evaluated definitions locally through an approved read-only utility; derive field schemas from the evaluated helper results instead of guessing their shapes. Validate proposed data against those schemas before an authorized write adapter is implemented.
