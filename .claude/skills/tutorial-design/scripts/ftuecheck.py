#!/usr/bin/env python3
"""Mechanical half of the tutorial-design audit.

Checks the things a script can prove about src/data/tutorial.json:
gate<->allow consistency, gate events the director never subscribes to,
objects a step points at that do not exist yet, dead stock revealed by a
region, the XP tune, skip affordability, bubble length, one-verb-per-beat,
and coverage against docs/tutorial-coverage.md.

Judgement checks (does the line teach the verb, voice, reward legibility)
are in SKILL.md and are NOT here. A clean run is not a pass.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))

BUBBLE_MAX = 180

# Law 5: the verb each gate needs in its OWN step's allow-list.
GATE_REQUIRES: dict[str, list[str]] = {
    "item:merged": ["drag"],
    "item:hatched": ["drag"],
    "item:harvested": ["tapGenerators"],
    "chest:open": ["tapGenerators"],
    "generator:skipped": ["tapGenerators"],
    "dragon:working": ["dragonWork", "drag"],
    "region:unlocked": ["fog"],
    "marketplace:purchased": ["marketplace"],
    "ui:cookbook_opened": ["cookbook"],
    "ui:cookbook_closed": ["cookbook"],
    "ui:ledger_opened": ["ledger"],
    "order:completed": ["ledger", "deliver"],
    "bag:stored": ["bag"],
    "item:sold": ["sell"],
    "character:action_used": ["character"],
}

# Sentence-initial imperatives that ask the player to DO something (law 6).
VERBS = ("tap", "drag", "merge", "press", "spend", "open", "close", "sell", "deliver", "pocket")

findings: list[tuple[str, str, str, str]] = []


def add(sev: str, law: str, where: str, msg: str) -> None:
    findings.append((sev, law, where, msg))


def read(*parts: str) -> str:
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def load(*parts: str):
    return json.loads(read(*parts))


def const_num(src: str, name: str, default: float) -> float:
    m = re.search(rf"export const {name}\s*=\s*([0-9_.]+)", src)
    return float(m.group(1).replace("_", "")) if m else default


def skip_warmth_cost(remaining: float, total: float, max_gold: float, mult: float) -> int:
    if remaining <= 0:
        return 0
    frac = min(1.0, max(0.0, remaining / total)) if total > 0 else 1.0
    gold = min(max_gold, max(1, math.ceil(max_gold * frac)))
    return max(1, round(gold * mult))


# --------------------------------------------------------------------------- #
# corpus
# --------------------------------------------------------------------------- #
steps = load("src", "data", "tutorial.json")["steps"]
chains = {c["id"]: c for c in load("src", "data", "chains.json")["chains"]}
game_map = load("src", "data", "map.json")
orders = load("src", "data", "orders.json")
types_src = read("src", "core", "types.ts")
director_src = read("src", "systems", "TutorialDirector.ts")
constants_src = read("src", "core", "Constants.ts")

allow_block = re.search(r"export interface TutorialAllow \{(.*?)\n\}", types_src, re.S)
KNOWN_ALLOW = set(re.findall(r"^\s*(\w+)\??:", allow_block.group(1), re.M)) if allow_block else set()

gate_union = re.search(r"type: 'event'; event: ([^;]+);", types_src)
KNOWN_GATE_EVENTS = set(re.findall(r"'([^']+)'", gate_union.group(1))) if gate_union else set()

SUBSCRIBED = set(re.findall(r"onGateEvent\('([^']+)'", director_src))

ENERGY_START = const_num(constants_src, "ENERGY_START", 28)
SKIP_MAX_GOLD = const_num(constants_src, "GENERATOR_SKIP_MAX_ENERGY", 20)
SKIP_MULT = const_num(constants_src, "SKIP_WARMTH_MULTIPLIER", 1.5)
lvl = re.search(r"export const LEVEL_XP\s*=\s*\[([^\]]+)\]", constants_src)
LEVEL_XP = [int(x) for x in re.findall(r"\d+", lvl.group(1))] if lvl else [0, 60, 220]


# --------------------------------------------------------------------------- #
# 1. gate <-> allow, and gate events the director actually hears
# --------------------------------------------------------------------------- #
def chains_in(ref) -> set[str]:
    """Chain ids a TileRef mentions."""
    if isinstance(ref, dict) and "chain" in ref:
        return {ref["chain"]}
    return set()


for step in steps:
    sid = f"step {step['id']}"
    gate = step.get("gate", {})
    allow = step.get("allow", {}) or {}

    for key in allow:
        if key not in KNOWN_ALLOW:
            add("ERROR", "5", sid, f"allow.{key} is not in TutorialAllow — it is silently ignored")

    if gate.get("type") != "event":
        continue
    ev = gate.get("event")
    if ev not in KNOWN_GATE_EVENTS:
        add("ERROR", "5", sid, f"gate event '{ev}' is not in the TutorialGate union")
    if ev not in SUBSCRIBED:
        add("ERROR", "4", sid, f"gate event '{ev}' is never subscribed in TutorialDirector — the step can never advance")

    for need in GATE_REQUIRES.get(ev, []):
        if need == "drag":
            wanted = gate.get("chain")
            got = allow.get("drag") or []
            if wanted and "*" not in got and wanted not in got:
                add("ERROR", "5", sid, f"gate wants a '{wanted}' {ev.split(':')[1]} but allow.drag is {got} — unwinnable")
            elif not got:
                add("ERROR", "5", sid, f"gate '{ev}' needs allow.drag and none is set — unwinnable")
        elif not allow.get(need):
            add("ERROR", "5", sid, f"gate '{ev}' needs allow.{need} — unwinnable without it")


# --------------------------------------------------------------------------- #
# 2. does the thing a step points at exist yet?
# --------------------------------------------------------------------------- #
def with_produce(present: set[str]) -> set[str]:
    """Close a set of on-board chains over what its generators MAKE.

    A harvest beat points at the thing the tap yields, and that thing is never
    seeded or spawned — the Emberberry Plant is placed and the *berry* is what
    appears. Without this the only way to satisfy the check would be to spawn a
    berry nobody picked, which is the opposite of the lesson. Fixpoint, because
    a produced chain can itself hold a generator.
    """
    grown = set(present)
    changed = True
    while changed:
        changed = False
        for chain in list(grown):
            for tier in chains.get(chain, {}).get("tiers", []):
                produces = (tier.get("generator") or {}).get("produces")
                if produces and produces["chain"] not in grown:
                    grown.add(produces["chain"])
                    changed = True
    return grown


on_board: set[str] = {i["chain"] for i in game_map.get("startingItems", [])}
for region in game_map.get("regions", []):
    if not region.get("unlock"):  # level_1 and anything open from the start
        on_board |= {c["chain"] for c in region.get("contents", [])}
revealable = with_produce(
    {c["chain"] for r in game_map.get("regions", []) for c in r.get("contents", [])}
)

for step in steps:
    sid = f"step {step['id']}"
    # A step's own effects fire on the advance INTO it, before its pointers are
    # resolved (TutorialDirector.advance) — so they count for this step too.
    for effect in step.get("effects", []) or []:
        if "spawn" in effect:
            on_board.add(effect["spawn"]["chain"])
    # Placing a generator makes its produce available to the very next pointer —
    # that IS the harvest beat (plant spawns, tap yields a berry).
    on_board = with_produce(on_board)
    referenced: set[str] = set()
    for ref in step.get("highlight", []) or []:
        referenced |= chains_in(ref)
    hand = step.get("hand") or {}
    if "from" in hand:
        referenced |= chains_in(hand["from"]) | chains_in(hand["to"])
    arrow = step.get("arrow") or {}
    if "tile" in arrow:
        referenced |= chains_in(arrow["tile"])
    gate = step.get("gate", {})
    if gate.get("type") == "event" and gate.get("chain") and gate.get("event") != "item:sold":
        referenced.add(gate["chain"])

    for chain in sorted(referenced):
        if chain not in chains:
            add("ERROR", "4", sid, f"references chain '{chain}' which is not in chains.json")
        elif chain not in on_board and chain not in revealable:
            add("ERROR", "4", sid, f"points at '{chain}' but nothing has put one on the board yet")


# --------------------------------------------------------------------------- #
# 3. dead stock: a region reveals a merge set the player cannot finish
# --------------------------------------------------------------------------- #
touched_by_tutorial: set[str] = set()
for step in steps:
    gate = step.get("gate", {})
    if gate.get("chain"):
        touched_by_tutorial.add(gate["chain"])
    for ref in (step.get("highlight") or []):
        touched_by_tutorial |= chains_in(ref)
    arrow = step.get("arrow") or {}
    if "tile" in arrow:
        touched_by_tutorial |= chains_in(arrow["tile"])

produced: set[tuple[str, int]] = set()
for chain in chains.values():
    for tier in chain["tiers"]:
        gen = tier.get("generator")
        if gen and "produces" in gen:
            produced.add((gen["produces"]["chain"], gen["produces"]["tier"]))

for region in game_map.get("regions", []):
    unlock = region.get("unlock") or {}
    # only regions a Chapter One player can actually open
    if unlock.get("level", 1) > len(LEVEL_XP):
        continue
    counts: dict[tuple[str, int], int] = {}
    for c in region.get("contents", []):
        counts[(c["chain"], c.get("tier", 1))] = counts.get((c["chain"], c.get("tier", 1)), 0) + 1
    for (chain, tier), n in sorted(counts.items()):
        if n >= 3 or chain not in chains:
            continue
        cfg = next((t for t in chains[chain]["tiers"] if t["tier"] == tier), None)
        if cfg and cfg.get("generator"):
            continue  # a producer is useful on its own
        if (chain, tier) in produced or chain in touched_by_tutorial:
            continue
        add(
            "WARN", "2", f"map region {region['id']}",
            f"reveals {n}x {chain} t{tier} — a merge needs 3, nothing produces it, "
            f"and no tutorial beat gives it a second verb: dead stock",
        )


# --------------------------------------------------------------------------- #
# 4. the XP tune (law 7)
# --------------------------------------------------------------------------- #
order_ids = [o["id"] for o in orders["orders"]]
levelup_at = next((i for i, s in enumerate(steps) if s["id"] == "levelup"), None)
delivered = 0
for i, step in enumerate(steps):
    gate = step.get("gate", {})
    if gate.get("type") == "event" and gate.get("event") == "order:completed":
        oid = order_ids[delivered] if delivered < len(order_ids) else None
        xp = next((o["rewards"].get("xp", 0) for o in orders["orders"] if o["id"] == oid), 0)
        delivered += 1
        if levelup_at is not None and i < levelup_at and xp:
            add(
                "ERROR", "7", f"step {step['id']}",
                f"delivers order '{oid}' (+{xp} XP) before the scripted 'levelup' beat — "
                f"the tutorial is tuned to hit exactly {LEVEL_XP[1]} XP there, so Level 2 fires early",
            )

granted = sum(e["grantXp"] for s in steps for e in (s.get("effects") or []) if "grantXp" in e)
if granted and levelup_at is not None:
    add("NOTE", "7", "tutorial.json", f"scripted grantXp totals {granted} — LEVEL_XP[1] is {LEVEL_XP[1]}")


# --------------------------------------------------------------------------- #
# 5. can the player afford a scripted skip?
# --------------------------------------------------------------------------- #
for step in steps:
    gate = step.get("gate", {})
    if gate.get("type") != "event" or gate.get("event") != "generator:skipped":
        continue
    if gate.get("currency") != "warmth":
        continue
    timer = next((e["setTimer"] for e in (step.get("effects") or []) if "setTimer" in e), None)
    if not timer:
        add("WARN", "4", f"step {step['id']}", "scripted warmth skip with no setTimer effect — the cost is whatever the live timer happens to be")
        continue
    cfg = next(
        (t.get("generator") for t in chains.get(timer["chain"], {}).get("tiers", []) if t["tier"] == timer["tier"]),
        None,
    ) or {}
    total = cfg.get("passiveMs") or cfg.get("cooldownMs") or timer["remainingMs"]
    max_gold = cfg.get("skipMaxGold", SKIP_MAX_GOLD)
    cost = skip_warmth_cost(timer["remainingMs"], total, max_gold, SKIP_MULT)
    where = f"step {step['id']}"
    if cost > ENERGY_START:
        add("ERROR", "4", where, f"skip costs {cost} Warmth but the player starts with {ENERGY_START} — hard lock")
    else:
        add("NOTE", "4", where, f"skip costs {cost} Warmth ({timer['remainingMs']}/{total}ms of max {max_gold} gold x{SKIP_MULT}); start is {ENERGY_START}")


# --------------------------------------------------------------------------- #
# 6. bubble budget and one-verb-per-beat
# --------------------------------------------------------------------------- #
for step in steps:
    sid = f"step {step['id']}"
    text = step.get("text", "")
    if len(text) > BUBBLE_MAX:
        add("ERROR", "6", sid, f"bubble is {len(text)} chars (max {BUBBLE_MAX})")
    asks = {
        m.group(1).lower()
        for m in re.finditer(r"(?:^|[.!?—]\s+)([A-Z]\w+)", text)
        if m.group(1).lower() in VERBS
    }
    if len(asks) > 1:
        add("WARN", "6", sid, f"asks for {len(asks)} actions in one bubble ({', '.join(sorted(asks))}) — split the beat")


# --------------------------------------------------------------------------- #
# 7. coverage against the ledger
# --------------------------------------------------------------------------- #
LEDGER = os.path.join(ROOT, "docs", "tutorial-coverage.md")
if not os.path.exists(LEDGER):
    add("ERROR", "1", "docs/tutorial-coverage.md", "the concept ledger is missing — coverage cannot be checked")
else:
    taught_ids = {s["id"] for s in steps} | set(load("src", "data", "dialogue.json").get("hints", {}))
    rows = 0
    for line in read("docs", "tutorial-coverage.md").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")] if line.strip().startswith("|") else []
        if len(cells) < 4 or cells[0].lower().startswith(("concept", "---", ":--")):
            continue
        rows += 1
        concept, taught = cells[0], cells[2]
        if taught in ("", "—", "-", "none", "NONE"):
            add("ERROR", "1", f"ledger '{concept}'", "no teach-point — the player meets this untaught")
            continue
        for ref in re.findall(r"`([^`]+)`", taught):
            if ref not in taught_ids:
                add("NOTE", "1", f"ledger '{concept}'", f"teach-point `{ref}` is not a tutorial step id or a hint key")
    if rows == 0:
        add("ERROR", "1", "docs/tutorial-coverage.md", "the ledger has no rows — coverage cannot be checked")


# --------------------------------------------------------------------------- #
RANK = {"ERROR": 0, "WARN": 1, "NOTE": 2}
findings.sort(key=lambda f: RANK[f[0]])
for sev, law, where, msg in findings:
    print(f"{sev:<6} law {law:<3} {where:<34} {msg}")

errors = sum(1 for f in findings if f[0] == "ERROR")
warns = sum(1 for f in findings if f[0] == "WARN")
print(f"\n{errors} error(s), {warns} warn(s), {len(findings) - errors - warns} note(s).")
print("Judgement checks (teaches-the-verb, voice, reward legibility) still required.")
sys.exit(1 if errors else 0)
