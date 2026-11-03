import pytest

from api.labeling import (
    Verdict,
    cards_for_keys,
    cell_key,
    judge,
    parse_cell_key,
    sampled_keys,
    sampled_to_cards,
)


def c(table, row, col, val="v", strategies=None):
    return {"table": table, "row": row, "col": col, "val": val, "features": [1], "strategies": strategies or []}


CELL_FOLDS = {
    "D0": {
        "F0": [c("t1", 0, "a"), c("t1", 1, "a"), c("t1", 2, "a")],
        "F1": [c("t2", 0, "b")],
    },
    "D1": {"F2": [c("t3", 0, "c"), c("t3", 1, "c")]},
}
SAMPLED = [
    {"table": "t1", "row": 0, "col": "a", "val": "x", "domain_fold": "D0", "cell_fold": "F0", "strategies": ["Typo"]}
]


def test_cell_key_roundtrip_with_pipe_in_column():
    assert cell_key("t1", 3, "a|b") == "t1|3|a|b"
    assert parse_cell_key("t1|3|a|b") == ("t1", 3, "a|b")


@pytest.mark.parametrize("key", ["", "t1", "t1|x|a", "t1|1"])
def test_malformed_key_raises(key):
    with pytest.raises(ValueError):
        parse_cell_key(key)


def test_sampled_to_cards():
    [card] = sampled_to_cards(SAMPLED)
    assert card.key == "t1|0|a" and card.domain_fold == "D0" and card.cell_fold == "F0"
    assert card.strategies == ["Typo"] and card.val == "x"


def test_sampled_keys_keeps_order_and_dedupes():
    cells = [
        {"table": "t2", "row": 1, "col": "b"},
        {"table": "t1", "row": 0, "col": "a"},
        {"table": "t2", "row": 1, "col": "b"},
    ]
    assert sampled_keys(cells) == ["t2|1|b", "t1|0|a"]


def test_cards_for_keys_keep_order_and_skip_unknown():
    cards = cards_for_keys(CELL_FOLDS, ["t3|1|c", "nope", "t1|0|a", "t9|0|z", "garbage"])
    assert [x.key for x in cards] == ["t3|1|c", "t1|0|a"]
    assert cards[0].domain_fold == "D1" and cards[0].cell_fold == "F2"


@pytest.fixture
def dataset(tmp_path):
    (tmp_path / "t1").mkdir()
    (tmp_path / "t1" / "dirty.csv").write_text("a,b\nx,y\np,q\n")
    (tmp_path / "t1" / "clean.csv").write_text("a,b\nx,y\np,Q\n")
    (tmp_path / "noclean").mkdir()
    (tmp_path / "noclean" / "dirty.csv").write_text("a\n1\n")
    return tmp_path


@pytest.mark.parametrize(
    "row,col,said_correct,expected",
    [
        (0, "a", True, True),  # clean cell, player says correct
        (1, "b", True, False),  # dirty cell, player says correct
        (1, "b", False, True),  # dirty cell, player says error
        (0, "a", False, False),  # clean cell, player says error
    ],
)
def test_judge_truth_table(dataset, row, col, said_correct, expected):
    assert judge(dataset, [Verdict(table="t1", row=row, col=col, said_correct=said_correct)]) == [expected]


def test_judge_returns_none_without_ground_truth_or_cell(dataset):
    verdicts = [
        Verdict(table="noclean", row=0, col="a", said_correct=True),
        Verdict(table="t1", row=99, col="a", said_correct=True),
        Verdict(table="t1", row=0, col="zzz", said_correct=True),
        Verdict(table="../t1", row=0, col="a", said_correct=True),
        Verdict(table="missing", row=0, col="a", said_correct=True),
    ]
    assert judge(dataset, verdicts) == [None] * 5


# ---------------------------------------------------------------- room merge
from api.labeling import merge_with_pool


def own_cell(table, row, col, is_error):
    return {"table": table, "row": row, "col": col, "val": "v", "is_error": is_error,
            "domain_fold": "D0", "cell_fold": "F0"}


def room_label(key, player, said_correct):
    return {"cell_id": key, "player": player, "value": said_correct}


def by_key(cells):
    return {cell_key(c["table"], c["row"], c["col"]): c["is_error"] for c in cells}


def test_merge_own_only_is_unchanged():
    own = [own_cell("t1", 0, "a", True), own_cell("t1", 1, "a", False)]
    merged, disputed = merge_with_pool(own, [], "me", CELL_FOLDS)
    assert by_key(merged) == {"t1|0|a": True, "t1|1|a": False} and disputed == []


def test_merge_majority_across_players():
    own = [own_cell("t1", 0, "a", True)]
    labels = [room_label("t1|0|a", "p2", True), room_label("t1|0|a", "p3", True)]  # two say correct
    merged, disputed = merge_with_pool(own, labels, "me", CELL_FOLDS)
    assert by_key(merged) == {"t1|0|a": False} and disputed == []


def test_merge_tie_is_disputed_and_left_out():
    own = [own_cell("t1", 0, "a", True)]
    merged, disputed = merge_with_pool(own, [room_label("t1|0|a", "p2", True)], "me", CELL_FOLDS)
    assert merged == [] and disputed == ["t1|0|a"]


def test_merge_drops_other_players_cells_missing_from_these_folds():
    merged, _ = merge_with_pool([], [room_label("t9|0|z", "p2", False)], "me", CELL_FOLDS)
    assert merged == []


def test_merge_ignores_own_room_label_for_a_cell_already_in_own():
    own = [own_cell("t1", 0, "a", True)]
    merged, disputed = merge_with_pool(own, [room_label("t1|0|a", "me", True)], "me", CELL_FOLDS)
    assert by_key(merged) == {"t1|0|a": True} and disputed == []


def test_merge_builds_cells_from_other_players_labels_using_these_folds():
    merged, _ = merge_with_pool([], [room_label("t3|1|c", "p2", False)], "me", CELL_FOLDS)
    [cell] = merged
    assert cell["is_error"] is True and cell["domain_fold"] == "D1" and cell["cell_fold"] == "F2"
    assert cell["val"] == "v" and (cell["table"], cell["row"], cell["col"]) == ("t3", 1, "c")


def test_merge_counts_own_earlier_room_label_when_not_swiped_now():
    merged, _ = merge_with_pool([], [room_label("t1|1|a", "me", True)], "me", CELL_FOLDS)
    assert by_key(merged) == {"t1|1|a": False}
