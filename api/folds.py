from typing import Any, Literal

from pydantic import BaseModel

from api.pipelines import DERIVED_KEYS

# Everything downstream of the domain folds.
STALE_AFTER_DOMAIN_FOLDS = ("cell_folds", "cell_fold_labels", "propagation_results", "error_detection") + tuple(
    k for k in DERIVED_KEYS if k not in ("domain_folds", "cell_folds")
)

# Everything downstream of the cell folds.
STALE_AFTER_QUALITY_FOLDS = (
    "cell_folds",
    "cell_fold_labels",
    "results",
    "propagation_results",
    "error_detection",
)


def validate_domain_folds(folds: dict[str, list[str]], known_tables: list[str]) -> None:
    seen: set[str] = set()
    for name, tables in folds.items():
        if not name.strip():
            raise ValueError("Fold names must not be empty")
        if not tables:
            raise ValueError(f"Fold '{name}' has no tables")
        for table in tables:
            if table not in known_tables:
                raise ValueError(f"Unknown table '{table}'")
            if table in seen:
                raise ValueError(f"Table '{table}' is in more than one fold")
            seen.add(table)


def apply_domain_folds(config: dict[str, Any], folds: dict[str, list[str]]) -> dict[str, Any]:
    """Set `domain_folds`; if they changed, the cell folds, labels and results are stale."""
    out = dict(config)
    if out.get("domain_folds") != folds:
        for key in STALE_AFTER_DOMAIN_FOLDS:
            out.pop(key, None)
    out["domain_folds"] = {name: list(tables) for name, tables in folds.items()}
    return out


# ---------------------------------------------------------------- cell folds
# cell_folds: {domain: {cell_fold: [cell]}}; labels: {cell_fold: "correct" | "false"}.
# All operations return new structures and never mutate their inputs.

CellFolds = dict[str, dict[str, list[dict[str, Any]]]]
Labels = dict[str, str]


class FoldNotFound(ValueError):
    pass


class CellRef(BaseModel):
    table: str
    row: int
    col: str


class FoldSummary(BaseModel):
    name: str
    domain: str
    cell_count: int
    label: Literal["correct", "false", "neutral"]
    tables: dict[str, dict[str, int]]


class CellView(BaseModel):
    table: str
    row: int
    col: str
    val: Any = None
    strategies: list[str] = []
    selected_for_labeling: bool = False


def _copy(cell_folds: CellFolds) -> CellFolds:
    return {d: {f: list(cells) for f, cells in folds.items()} for d, folds in cell_folds.items()}


def _domain_of(cell_folds: CellFolds, fold: str) -> str:
    for domain, folds in cell_folds.items():
        if fold in folds:
            return domain
    raise FoldNotFound(f"Unknown fold '{fold}'")


def _matches(cell: dict[str, Any], ref: CellRef) -> bool:
    return cell["table"] == ref.table and cell["row"] == ref.row and cell["col"] == ref.col


def _drop_if_empty(cell_folds: CellFolds, labels: Labels, domain: str, fold: str) -> None:
    if not cell_folds[domain][fold]:
        del cell_folds[domain][fold]
        labels.pop(fold, None)
        if not cell_folds[domain]:
            del cell_folds[domain]


def summarize(cell_folds: CellFolds, labels: Labels) -> list[FoldSummary]:
    out = []
    for domain, folds in cell_folds.items():
        for name, cells in folds.items():
            tables: dict[str, dict[str, int]] = {}
            for c in cells:
                per_table = tables.setdefault(c["table"], {})
                per_table[c["col"]] = per_table.get(c["col"], 0) + 1
            out.append(
                FoldSummary(
                    name=name, domain=domain, cell_count=len(cells),
                    label=labels.get(name, "neutral"), tables=tables,
                )
            )
    return out


def fold_cells(cell_folds: CellFolds, fold: str, offset: int, limit: int) -> tuple[list[CellView], int]:
    cells = cell_folds[_domain_of(cell_folds, fold)][fold]
    page = cells[offset : offset + limit]
    return [CellView(**{k: c.get(k) for k in CellView.model_fields if k in c}) for c in page], len(cells)


def move_cell(
    cell_folds: CellFolds, labels: Labels, cell: CellRef, to_fold: str
) -> tuple[CellFolds, Labels]:
    target_domain = _domain_of(cell_folds, to_fold)
    for domain, folds in cell_folds.items():
        for fold, cells in folds.items():
            for i, existing in enumerate(cells):
                if _matches(existing, cell):
                    new, new_labels = _copy(cell_folds), dict(labels)
                    if fold == to_fold:
                        return new, new_labels
                    moved = new[domain][fold].pop(i)
                    new[target_domain][to_fold].append(moved)
                    _drop_if_empty(new, new_labels, domain, fold)
                    return new, new_labels
    raise ValueError("Cell not found in any fold")


def merge_folds(cell_folds: CellFolds, labels: Labels, folds: list[str]) -> tuple[CellFolds, Labels]:
    distinct = list(dict.fromkeys(folds))
    if len(distinct) < 2:
        raise ValueError("Select at least two different folds to merge")
    domains = {f: _domain_of(cell_folds, f) for f in distinct}
    target, sources = distinct[0], distinct[1:]
    new, new_labels = _copy(cell_folds), dict(labels)
    present = {labels.get(f, "neutral") for f in distinct}
    for source in sources:
        new[domains[target]][target].extend(new[domains[source]].pop(source))
        new_labels.pop(source, None)
        if not new[domains[source]]:
            del new[domains[source]]
    if "correct" in present and "false" in present:
        final = None
    elif "false" in present:
        final = "false"
    elif "correct" in present:
        final = "correct"
    else:
        final = None
    if final:
        new_labels[target] = final
    else:
        new_labels.pop(target, None)
    return new, new_labels


def split_fold(
    cell_folds: CellFolds, labels: Labels, fold: str, after: list[CellRef]
) -> tuple[CellFolds, Labels]:
    domain = _domain_of(cell_folds, fold)
    if not after:
        raise ValueError("Select at least one cell to split after")
    cells = cell_folds[domain][fold]
    indices = set()
    for ref in after:
        found = [i for i, c in enumerate(cells) if _matches(c, ref)]
        if not found:
            raise ValueError("A selected cell is not in this fold")
        indices.add(found[0])
    segments, start = [], 0
    for idx in sorted(indices):
        segments.append(cells[start : idx + 1])
        start = idx + 1
    if start < len(cells):
        segments.append(cells[start:])
    new, new_labels = _copy(cell_folds), dict(labels)
    rebuilt: dict[str, list[dict[str, Any]]] = {}
    for name, existing in new[domain].items():
        if name != fold:
            rebuilt[name] = existing
            continue
        for n, segment in enumerate(segments, start=1):
            rebuilt[f"{fold} - Split {n}"] = list(segment)
    new[domain] = rebuilt
    label = new_labels.pop(fold, None)
    if label:
        for n in range(1, len(segments) + 1):
            new_labels[f"{fold} - Split {n}"] = label
    return new, new_labels


def move_fold_to_domain(
    cell_folds: CellFolds, labels: Labels, fold: str, to_domain: str
) -> tuple[CellFolds, Labels]:
    """Move a whole cell fold (name, cells and label unchanged) to the end of another domain."""
    source = _domain_of(cell_folds, fold)
    if to_domain not in cell_folds:
        raise FoldNotFound(f"Unknown domain '{to_domain}'")
    new, new_labels = _copy(cell_folds), dict(labels)
    if source == to_domain:
        return new, new_labels
    new[to_domain][fold] = new[source].pop(fold)
    if not new[source]:
        del new[source]
    return new, new_labels


def merge_domains(
    cell_folds: CellFolds, labels: Labels, domain: str, into: str
) -> tuple[CellFolds, Labels]:
    """All cell folds of `domain` move (names, cells and labels unchanged) to the end of `into`; `domain` is gone."""
    for d in (domain, into):
        if d not in cell_folds:
            raise FoldNotFound(f"Unknown domain '{d}'")
    if domain == into:
        raise ValueError("Pick another domain to merge into")
    new = _copy(cell_folds)
    new[into].update(new.pop(domain))
    return new, dict(labels)


def _free_domain_name(cell_folds: CellFolds, domain: str) -> str:
    n = 1
    while f"{domain} - Split {n}" in cell_folds:
        n += 1
    return f"{domain} - Split {n}"


def split_domain(
    cell_folds: CellFolds, labels: Labels, domain: str, after_fold: str
) -> tuple[CellFolds, Labels]:
    """The cell folds up to and including `after_fold` stay; the ones after it form a new domain
    that is placed right behind the original. Fold names and labels do not change."""
    if domain not in cell_folds:
        raise FoldNotFound(f"Unknown domain '{domain}'")
    names = list(cell_folds[domain])
    if after_fold not in names:
        raise FoldNotFound(f"Fold '{after_fold}' is not in domain '{domain}'")
    cut = names.index(after_fold) + 1
    if cut >= len(names):
        raise ValueError("There is no cell fold after this one to split off")
    new_name = _free_domain_name(cell_folds, domain)
    out: CellFolds = {}
    for name, folds in cell_folds.items():
        if name != domain:
            out[name] = {f: list(c) for f, c in folds.items()}
            continue
        out[name] = {f: list(folds[f]) for f in names[:cut]}
        out[new_name] = {f: list(folds[f]) for f in names[cut:]}
    return out, dict(labels)


def set_label(labels: Labels, fold: str, label: str | None) -> Labels:
    out = dict(labels)
    if label is None:
        out.pop(fold, None)
    else:
        out[fold] = label
    return out
