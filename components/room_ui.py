"""Room create/join, dataset vote and Start, rendered on the Lobby page."""
from __future__ import annotations

import os
from collections import Counter
from typing import Any, Dict, List, Tuple

import segno
import streamlit as st

from . import room_store as rs

JOIN_PATH = "/Lobby"


def _qr_svg(url: str) -> str:
    return segno.make(url, error="m").svg_inline(scale=6, border=1, dark="#002f67")


def _leave_room() -> None:
    for key in ("room_name", "player_token"):
        st.session_state.pop(key, None)
    st.query_params.clear()
    st.rerun()


def _resolve_room() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Create/join flow. Returns (room, player) or stops the page."""
    qp = st.query_params
    room_name = st.session_state.get("room_name") or qp.get("room")
    token = st.session_state.get("player_token") or qp.get("p")
    try:
        if not room_name:
            left, right = st.columns(2)
            with left:
                st.subheader("Create a room")
                st.write("Start a new group. Others can join afterwards, even if you are alone at first.")
                if st.button("Create room", type="primary"):
                    room_name = rs.create_room()["name"]
                    st.session_state["room_name"] = room_name
            with right:
                st.subheader("Join a room")
                typed = st.text_input("Room name", placeholder="e.g. blue-banana-42").strip().lower()
                if st.button("Join") and typed:
                    if rs.get_room(typed):
                        room_name = typed
                        st.session_state["room_name"] = room_name
                    else:
                        st.error(f"No room called '{typed}'.")
            if not room_name:
                st.stop()

        room = rs.get_room(room_name)
        if not room:
            st.error(f"Room '{room_name}' does not exist.")
            if st.button("Back"):
                _leave_room()
            st.stop()

        player = rs.join_room(room_name, token)
        st.session_state["room_name"] = room_name
        st.session_state["player_token"] = player["token"]
        st.query_params["room"] = room_name
        st.query_params["p"] = player["token"]
        return room, player
    except rs.RoomError as e:
        st.error(str(e))
        st.stop()
    except Exception as e:
        if type(e).__name__ in ("StopException", "RerunException"):
            raise
        st.error(f"Could not reach the room server ({e}). Is PocketBase running?")
        st.stop()


def render_room(datasets: List[str]) -> Tuple[Dict[str, Any], Dict[str, Any], str]:
    """Render the room section; returns (room, player, dataset to preview)."""
    room, player = _resolve_room()
    room_name, locked = room["name"], room["phase"] != "lobby"
    base_url = os.environ.get("MATELDA_BASE_URL", "http://localhost:8501").rstrip("/")
    join_url = f"{base_url}{JOIN_PATH}?room={room_name}"

    st.subheader(f"Room: `{room_name}`")
    st.write(f"You are **{player['name']}**.")
    with st.expander("Invite others (link, room name, QR code)", expanded=not locked):
        st.write("Share this link, the room name, or the QR code:")
        st.code(join_url, language=None)
        st.markdown(_qr_svg(join_url), unsafe_allow_html=True)
    if st.button("Leave room"):
        _leave_room()

    st.divider()
    vote_col, players_col = st.columns(2)
    with vote_col:
        if locked:
            st.subheader("Dataset")
            dataset = room["dataset"] if room["dataset"] in datasets else datasets[0]
            st.selectbox("Locked by the room", datasets, index=datasets.index(dataset),
                         disabled=True, key="io_dataset_locked")
            st.success(f"Dataset locked: **{dataset}**")
            st.session_state["dataset_select"] = dataset
        else:
            st.subheader("Pick a dataset")
            current = player["vote"] if player["vote"] in datasets else datasets[0]
            dataset = st.selectbox("Your vote", datasets, index=datasets.index(current),
                                   key="io_dataset_vote")
            if dataset != player["vote"]:
                rs.set_vote(player, dataset)
            budget = st.number_input("Your labeling budget", 1, 500, int(player["budget"] or 10))
            if budget != player["budget"]:
                rs.set_budget(player, int(budget))
            st.caption("The most-picked dataset wins when someone clicks Start. Ties are broken randomly.")
            if st.button("Start", type="primary"):
                try:
                    rs.start_room(rs.get_room(room_name))
                    st.rerun()
                except rs.RoomError as e:
                    st.error(str(e))

    def players_list() -> None:
        try:
            current = rs.get_room(room_name)
            players = rs.list_players(room_name) if current else []
        except Exception:
            st.warning("Lost connection to the room server, retrying…")
            return
        if current is None:
            st.warning("This room no longer exists.")
            if st.button("Leave room", key="gone_leave"):
                _leave_room()
            return
        if current["phase"] != room["phase"]:
            st.rerun()  # someone pressed Start: reload the whole page
        tally = Counter(p["vote"] for p in players if p["vote"])
        st.subheader(f"Players ({len(players)})")
        for p in players:
            mark = " (you)" if p["id"] == player["id"] else ""
            st.markdown(
                f"- <span style='color:{rs.room_color(room_name)}'>●</span> **{p['name']}**{mark} "
                f"— {p['vote'] or 'no pick yet'}, budget {p['budget']}",
                unsafe_allow_html=True,
            )
        if tally and not locked:
            st.caption("Votes: " + ", ".join(f"{d} ×{n}" for d, n in tally.most_common()))

    with players_col:
        st.fragment(run_every=None if locked else "2s")(players_list)()

    st.divider()
    return room, player, dataset


def render_room_results(room: Dict[str, Any], player: Dict[str, Any]) -> None:
    """Room-wide labeling summary: shared pool size and per-player quality."""
    import pandas as pd

    st.markdown("### 👥 Room labeling")
    stats = rs.player_stats(room["name"])
    if not stats:
        st.caption(f"Room `{room['name']}` has no labels yet.")
        return
    total = sum(r["labels"] for r in stats)
    ok = sum(r["correct"] for r in stats)
    c1, c2, c3 = st.columns(3)
    c1.metric("Labels in the room", total)
    c2.metric("Labelers", len(stats))
    c3.metric("Room accuracy", f"{100 * ok / total:.0f}%")

    def flags(r: Dict[str, Any]) -> str:
        out = []
        if r["labels"] >= 5 and r["median_ms"] < 700:
            out.append("very fast")
        if r["labels"] >= 5 and max(r["error_share"], 1 - r["error_share"]) >= 0.9:
            out.append("same answer")
        return ", ".join(out)

    st.dataframe(
        pd.DataFrame([{
            "Player": r["name"] + (" (you)" if r["id"] == player["id"] else ""),
            "Labels": r["labels"],
            "Correct": r["correct"],
            "Accuracy": f"{100 * r['accuracy']:.0f}%",
            "Median time": f"{r['median_ms'] / 1000:.1f}s",
            "Marked as error": f"{100 * r['error_share']:.0f}%",
            "Pattern": flags(r),
        } for r in stats]),
        use_container_width=True, hide_index=True,
    )
    disputed = st.session_state.get("room_disputed_cells")
    if disputed:
        st.info(f"{len(disputed)} disputed cell(s) (players disagreed 50/50) were left out of your run.")
    st.caption("Everyone's labels count. The pattern column only hints at click-through "
               "(very fast answers, or almost always the same answer).")
