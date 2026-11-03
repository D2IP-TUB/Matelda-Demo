import pytest

from api.labeling import (
    Verdict,
    candidate_keys,
    cards_for_keys,
    cell_key,
    judge,
    parse_cell_key,
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


def test_candidates_start_with_sample_then_round_robin():
    assert candidate_keys(SAMPLED, CELL_FOLDS, set()) == [
        "t1|0|a", "t1|1|a", "t2|0|b", "t3|0|c", "t1|2|a", "t3|1|c",
    ]


def test_candidates_skip_folds_and_have_no_duplicates():
    keys = candidate_keys(SAMPLED, CELL_FOLDS, {"F1"})
    assert "t2|0|b" not in keys and len(keys) == len(set(keys)) == 5


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
