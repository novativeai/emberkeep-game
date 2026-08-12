#!/usr/bin/env python3
"""Mechanical half of the story-qa audit.

Checks only what a script can check with certainty: bubble length, the
proper-noun budget, chapter continuity, promise-ledger integrity, and doc<->data
id drift. Everything requiring judgement (contracts, voice, reveal order,
economy arithmetic) is the model's job -- see SKILL.md.

Exits 1 if any ERROR was found, 0 otherwise.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DOCS = ROOT / "docs"
DATA = ROOT / "src" / "data"

BUBBLE_MAX = 180

# story-bible.md section 8 -- eight nouns for the whole campaign. A ninth is a finding.
CANON_NOUNS = {
    "Emberkeep", "Borealis", "Moonhold", "Hold", "Daughters", "Moon",
    "Flame", "Keeping", "Lantern", "Keeper", "Silas", "Eleanor", "Selyna",
    "Elder", "Ledger", "Trust", "Regard", "Great",
}
# Words that legitimately capitalise mid-sentence without being proper nouns.
NOUN_NOISE = {
    "I", "I'd", "I'm", "I've", "I'll", "S", "A", "The", "It", "No", "Not",
    "Yes", "So", "And", "But", "Do", "Say", "Wait", "Come", "Don't", "Now",
    "Take", "Good", "Thank", "Delivered", "Warmer", "Another", "Half", "Two",
    "Three", "Five", "Nine", "Sixty", "Query", "Answer", "Correction", "Entry",
    "Note", "Refuses", "Sleeps", "Third", "Father", "Morning", "Cold", "North",
    "Rest", "Names", "They", "She", "He", "You", "We", "My", "Your", "That",
    "This", "There", "When", "What", "Where", "Whether", "Because", "If",
    "Everything", "Nothing", "Something", "Whatever", "Every", "Add", "Bring",
    "Use", "Let", "Give", "Feed", "Mind", "Ask", "Sorry", "Recording", "Left",
    "Sixty-year",
}

findings: list[tuple[str, str, str, str]] = []


def add(sev: str, check: str, where: str, msg: str) -> None:
    findings.append((sev, check, where, msg))


def read(p: Path) -> list[str]:
    if not p.exists():
        add("ERROR", "corpus", str(p.relative_to(ROOT)), "missing - check skipped, not passed")
        return []
    return p.read_text(encoding="utf-8").splitlines()


SPEAKER = re.compile(r"^\*\*([A-Za-z ]+):\*\*\s*")
TABLE_ROW = re.compile(r"^\s*\|")


def bubbles(lines: list[str], path: str) -> list[tuple[int, str, str]]:
    """(line_no, speaker, text) for every quoted spoken line.

    Skips the status callout at the top of each doc, table rows, and the
    italic craft commentary that follows some beats.
    """
    out: list[tuple[int, str, str]] = []
    in_callout = True
    for i, raw in enumerate(lines, 1):
        if in_callout:
            if raw.startswith("---"):
                in_callout = False
            continue
        if not raw.startswith(">"):
            continue
        text = raw[1:].strip()
        if not text or TABLE_ROW.match(text) or text.startswith(">"):
            continue
        speaker = "eleanor"
        m = SPEAKER.match(text)
        if m:
            speaker = m.group(1).strip().lower()
            text = text[m.end():]
        # Strip a bank label prefix ("**L1** (ch 5) - ...", "**3** - ...") ONLY
        # when content follows it. A whole line wrapped in ** is a bubble, not a
        # label -- opening-scene.md writes every beat that way, and a greedy
        # strip silently emptied all of them.
        m2 = re.match(r"^\*\*([^*]{1,24})\*\*\s*(?:\([^)]*\))?\s*[-—]?\s*(\S.*)$", text)
        if m2:
            text = m2.group(2)
        text = text.replace("**", "").replace("*", "").strip()
        if not text or text.startswith("["):
            continue
        out.append((i, speaker, text))
    return out


def check_length(path: Path) -> None:
    rel = str(path.relative_to(ROOT))
    for no, _spk, text in bubbles(read(path), rel):
        if len(text) > BUBBLE_MAX:
            add("ERROR", "budget/length", f"{rel}:{no}",
                f"bubble is {len(text)} chars (max {BUBBLE_MAX}) - will overflow 4 lines")


def check_nouns(path: Path) -> None:
    rel = str(path.relative_to(ROOT))
    seen: dict[str, str] = {}
    for no, _spk, text in bubbles(read(path), rel):
        # Capitalised words that are not sentence-initial. A beat may open on an
        # ellipsis ("…Later."), so that counts as a sentence boundary too.
        for m in re.finditer(r"(?<![.!?…—-])(?<![.!?…—-]\s)(?<!^)\b([A-Z][a-z']{2,})\b", text):
            w = m.group(1)
            # A possessive of a canon noun is still that noun ("Keeper's").
            stem = w[:-2] if w.endswith("'s") else w
            if w in CANON_NOUNS or stem in CANON_NOUNS or w in NOUN_NOISE or stem in NOUN_NOISE:
                continue
            seen.setdefault(w, f"{rel}:{no}")
    for w, where in sorted(seen.items()):
        add("NOTE", "budget/nouns", where,
            f"'{w}' is not in the canon noun list - retire one or drop it")


def check_chapters(path: Path) -> None:
    rel = str(path.relative_to(ROOT))
    lines = read(path)
    nums = [int(m.group(1)) for l in lines
            if (m := re.match(r"^## Chapter (\d+)", l))]
    expected = list(range(2, 13))  # ch 1 lives in opening-scene.md
    if nums != expected:
        add("ERROR", "ladder/continuity", rel,
            f"chapters are {nums}, expected {expected}")
    for l in lines:
        if l.startswith("## Chapter ") and "**Gate:**" not in "".join(lines):
            break
    for i, l in enumerate(lines):
        if re.match(r"^## Chapter \d+", l):
            window = "\n".join(lines[i:i + 4])
            if "**Gate:**" not in window:
                add("ERROR", "ladder/gate", f"{rel}:{i+1}",
                    f"{l.strip()} declares no **Gate:** - it can fire at any time")


def check_promises(quests: Path, script: Path, opening: Path) -> None:
    rel = str(quests.relative_to(ROOT))
    qlines = read(quests)
    corpus = "\n".join(read(script) + read(opening) + qlines)
    rows = [l for l in qlines if TABLE_ROW.match(l) and "|" in l]
    # The ledger table: | Set in | promise | Paid in |
    ledger = [r for r in rows if re.search(r"\|\s*(Ch \d+|Marginalia)\s*\|", r)]
    if not ledger:
        add("ERROR", "promises/ledger", rel, "promise ledger (section 5) has no rows")
        return
    for r in ledger:
        cells = [c.strip() for c in r.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        setup, promise, paid = cells[0], cells[1], cells[2]
        quoted = re.findall(r"[“\"']([^”\"']{6,})[”\"']", promise)
        for q in quoted:
            probe = q.strip().strip(".…").strip()
            if probe and probe not in corpus:
                add("ERROR", "promises/setup", rel,
                    f"promise {q!r} set in {setup} is not present in any script doc")
        if not paid or paid in {"-", "—"}:
            add("ERROR", "promises/payoff", rel, f"promise {promise!r} has no payoff chapter")


def check_drift(quests: Path) -> None:
    rel = str(quests.relative_to(ROOT))
    qtext = "\n".join(read(quests))
    doc_ids = set(re.findall(r'"id"\s*:\s*"([a-z0-9_]+)"', qtext))
    orders = DATA / "orders.json"
    if not orders.exists():
        add("ERROR", "drift", "src/data/orders.json", "missing - check skipped, not passed")
        return
    live = {o["id"] for o in json.loads(orders.read_text())["orders"]}
    for i in sorted(doc_ids - live):
        add("NOTE", "drift/spec-ahead", rel, f"quest id '{i}' is specified but not in orders.json")
    speakers = (ROOT / "src" / "core" / "types.ts")
    if speakers.exists():
        t = speakers.read_text()
        for who in ("eleanor", "selyna", "golden_elder"):
            if f"'{who}'" not in t:
                add("ERROR", "drift/speaker", "src/core/types.ts",
                    f"speaker '{who}' is scripted but absent from SpeakerId")


FACES = {"angry", "determined", "happy", "laughing", "neutral", "sad",
         "surprised", "worried"}
# conversation-staging.md section 3. Reserved faces stay rare or they stop meaning
# anything. Budgets are PER CHARACTER -- Selyna's one flash of anger is hers, and
# must not eat Eleanor's allowance.
FACE_BUDGET = {
    "eleanor": {"laughing": 1, "angry": 2},
    "selyna": {"laughing": 0, "angry": 1},
    "golden_elder": {f: 0 for f in ("angry", "laughing", "happy", "sad",
                                    "surprised", "worried", "determined", "neutral")},
}


def check_staging(path: Path) -> None:
    """Face assignments in the staging tables (sections 4-5), attributed by speaker."""
    rel = str(path.relative_to(ROOT))
    lines = read(path)
    if not lines:
        return
    # (speaker, face) -> count, and where it was first seen.
    counts: dict[tuple[str, str], int] = {}
    where: dict[tuple[str, str], str] = {}
    chapter_faces: dict[str, int] = {}
    live = False
    for i, l in enumerate(lines, 1):
        if re.match(r"^## 4\.", l):
            live = True
            continue
        if re.match(r"^## 6\.", l):
            live = False
        if not live or not TABLE_ROW.match(l):
            continue
        low = l.lower()
        # Chapters 2-8 table has no Speaker column; every row there is Eleanor.
        who = ("selyna" if "selyna" in low
               else "golden_elder" if "elder" in low
               else "eleanor")
        in_chapter_table = not re.search(r"\|\s*(Ledger|Day-phase|Naming|Trust)", l)
        for m in re.finditer(r"`([a-z]+)`", l):
            f = m.group(1)
            if f not in FACES:
                continue
            counts[(who, f)] = counts.get((who, f), 0) + 1
            where.setdefault((who, f), f"{rel}:{i}")
            if in_chapter_table:
                chapter_faces[f] = chapter_faces.get(f, 0) + 1

    if not counts:
        add("ERROR", "staging/coverage", rel,
            "no face assignments found in sections 4-5 - check skipped, not passed")
        return

    for who, budget in FACE_BUDGET.items():
        for f, cap in budget.items():
            got = counts.get((who, f), 0)
            if got > cap:
                add("ERROR", "staging/reserved", where.get((who, f), rel),
                    f"{who} uses '{f}' {got}x, budget is {cap} - "
                    "a reserved face stops being an event")

    # The >50% neutral floor is measured over DELIVERED LINES, and a single bank
    # row here stands for many lines. So report the chapter-beat ratio as context
    # and hand the real judgement to the model rather than claiming a number this
    # table cannot produce.
    ctotal = sum(chapter_faces.values())
    if ctotal:
        n = chapter_faces.get("neutral", 0)
        modal = max(chapter_faces.items(), key=lambda kv: kv[1])
        if modal[0] != "neutral":
            add("WARN", "staging/modal-face", rel,
                f"'{modal[0]}' ({modal[1]}) outnumbers neutral ({n}) in the chapter "
                "beats - neutral must stay the modal face or it is not the default")
        add("NOTE", "staging/neutral-share", rel,
            f"chapter beats are {n}/{ctotal} neutral ({n*100//ctotal}%) - peaks run "
            "expressive by design; the >=1/3 floor is campaign-wide, so confirm the "
            "banks by hand")

    for col in ("Speaker", "Face"):
        if col not in "\n".join(lines):
            add("ERROR", "staging/columns", rel, f"staging tables have no '{col}' column")


def main() -> int:
    script = DOCS / "script-chapters.md"
    opening = DOCS / "opening-scene.md"
    quests = DOCS / "quests.md"
    staging = DOCS / "conversation-staging.md"

    for p in (script, opening):
        check_length(p)
        check_nouns(p)
    check_chapters(script)
    check_promises(quests, script, opening)
    check_drift(quests)
    check_staging(staging)

    order = {"ERROR": 0, "WARN": 1, "NOTE": 2}
    findings.sort(key=lambda f: (order[f[0]], f[1]))
    errors = sum(1 for f in findings if f[0] == "ERROR")

    if not findings:
        print("mechanical pass: clean (judgement checks still required - see SKILL.md)")
        return 0

    w = max(len(f[2]) for f in findings)
    for sev, check, where, msg in findings:
        print(f"{sev:<5}  {check:<20}  {where:<{w}}  {msg}")
    print()
    print(f"{errors} error(s), {len(findings) - errors} other. "
          "Judgement checks (contracts, voice, reveal order, economy) still required.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
