from typing import Any

from api.pipelines import DERIVED_KEYS

# Everything downstream of the domain folds.
STALE_AFTER_DOMAIN_FOLDS = ("cell_folds", "cell_fold_labels") + tuple(
    k for k in DERIVED_KEYS if k not in ("domain_folds", "cell_folds")
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
