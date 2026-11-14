# Hierarchical containers

The supplied `comContainers(definicao, pais)` implementation inserts a `multifield` into either the root `fields` (when `pais[containerField] === null`) or a matching subItem's fields (when parent is a subItem ID). It also adds a tab, organizes fields and removes nested multifield fields when composing the child editor.

The new `extractContainerTree` reads **evaluated** definitions and follows `field.type === "multifield"` with `field.model`. It supports nested structures such as `abas -> servicos`, detects unresolved models and cycles. It does not write JCR nodes, does not expand helpers, and does not assume all multifields have models.

Next: connect this hierarchy to a local metadata exporter, then inspect a persisted sample AEM node to determine the serialization contract.
