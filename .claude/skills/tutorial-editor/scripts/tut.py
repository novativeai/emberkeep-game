#!/usr/bin/env python3
"""tut — drive the Emberkeep tutorial editor API from the shell.

Talks to the vite dev server's /__tutorial endpoint (tools/tutorial-api/server.ts),
the same door the World Builder's 📜 Tutorial tab uses. Every write is validated
server-side before it touches src/data/tutorial.json.

  tut ls                                   every script: id, trigger, beat count
  tut show <tutorial> [step]               beats with their four facets
  tut context [key]                        picker data (chains, speakers, gateEvents, allowKeys, …)
  tut add-script <id> --trigger JSON [--title T] [--allow-base nothing|everything]
  tut set-script <id> [--title T] [--trigger JSON] [--allow-base …]
  tut rm-script <id>
  tut add <tutorial> --step JSON [--after ID | --before ID | --index N]
  tut edit <tutorial> <step> --set key=JSON … [--unset key …]
  tut rm <tutorial> <step>
  tut mv <tutorial> <step> --to N
  tut reorder <tutorial> ID ID …
  tut validate                             shape check + ftuecheck.py
  tut dump [file]                          raw { scripts } JSON (stdout or file)
  tut put <file>                           replace the whole file from a { scripts } JSON

Env: TUT_API (default http://localhost:5173/__tutorial). Exit 1 on any refused write.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("TUT_API", "http://localhost:5173/__tutorial").rstrip("/")


def call(method, path="", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        try:
            doc = json.loads(payload)
        except Exception:
            doc = {"error": payload}
        sys.stderr.write(f"REFUSED ({e.code}): {doc.get('error') or doc.get('errors')}\n")
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.stderr.write(f"dev server unreachable at {API} ({e.reason}) — is `pnpm dev` running on 5173?\n")
        sys.exit(2)


def jarg(v):
    try:
        return json.loads(v)
    except json.JSONDecodeError:
        return v  # bare strings are allowed for convenience


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        val = args[i + 1]
        del args[i : i + 2]
        return val
    return default


def describe_gate(g):
    t = g.get("type")
    if t == "tap":
        return "tap to continue"
    if t == "count":
        return f"board holds {g['count']}x {g['chain']} t{g['tier']}"
    if t == "move":
        where = (f" into {g['region']}" if g.get("region") else "") + (f" to cell {g['at']}" if g.get("at") else "")
        return f"carry {g['chain']}{where}"
    if t == "event":
        return f"event {g['event']}" + (f" ({g['chain']})" if g.get("chain") else "") + (f" pay {g['currency']}" if g.get("currency") else "")
    return json.dumps(g)


def describe_trigger(t):
    k = t.get("type")
    return {
        "start": "at game start",
        "step_done": f"after step {t.get('step')} of {t.get('tutorial')}",
        "tutorial_done": f"after {t.get('tutorial')} is done",
        "event": f"when {t.get('event')}" + (f" ({t.get('chain')})" if t.get("chain") else "") + " is observed",
        "quest_done": f"when quest {t.get('quest')} is done",
        "level": f"at level {t.get('min')}",
        "world": f"on arriving in {t.get('world')}",
        "stat": f"when {t.get('key')} >= {t.get('min')}",
    }.get(k, json.dumps(t))


def show_step(sc, s, i, last):
    print(f"  [{i + 1}] {s['id']}   gate: {describe_gate(s.get('gate', {}))}")
    els = []
    for h in s.get("highlight") or []:
        els.append(f"highlight {h}")
    hand = s.get("hand")
    if hand:
        els.append(f"hand {hand.get('from', hand.get('ui', hand.get('fogRegion')))} -> {hand.get('to', '')}".rstrip(" ->"))
    for key in ("arrow", "arrowThen"):
        a = s.get(key)
        if a:
            els.append(f"{key} {a}")
    for e in s.get("effects") or []:
        if "spawn" in e:
            els.append(f"spawns {e['spawn']['count']}x {e['spawn']['chain']} t{e['spawn']['tier']}")
    print(f"      elements : {'; '.join(els) if els else '-'}")
    fx = [json.dumps(e) for e in (s.get("effects") or []) if "spawn" not in e]
    print(f"      actions  : {describe_gate(s.get('gate', {}))}" + (f"; on entry {', '.join(fx)}" if fx else ""))
    print(f"      dialogue : {s.get('speaker')}: {s.get('text')}")
    allow = s.get("allow") or {}
    base = sc.get("allowBase", "nothing" if sc["id"] == "main" else "everything")
    states = [f"base={base}"] + [f"{k}={v}" for k, v in allow.items()]
    if last:
        states.append("then hands back")
    print(f"      states   : {', '.join(states)}")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], list(argv[1:])
    if cmd == "ls":
        for sc in call("GET")["scripts"]:
            print(f"{sc['id']:18s} {len(sc['steps']):3d} beats   {describe_trigger(sc['trigger'])}   allowBase={sc.get('allowBase')}" + (f"   — {sc['title']}" if sc.get("title") else ""))
        return 0
    if cmd == "show":
        scripts = call("GET")["scripts"]
        sc = next((s for s in scripts if s["id"] == args[0]), None)
        if not sc:
            sys.exit(f"no tutorial {args[0]}")
        print(f"{sc['id']}  — {describe_trigger(sc['trigger'])}  allowBase={sc.get('allowBase')}")
        steps = sc["steps"]
        for i, s in enumerate(steps):
            if len(args) > 1 and s["id"] != args[1]:
                continue
            show_step(sc, s, i, i == len(steps) - 1)
        return 0
    if cmd == "context":
        ctx = call("GET", "/context")
        print(json.dumps(ctx[args[0]] if args else ctx, indent=2))
        return 0
    if cmd == "validate":
        r = call("POST", "/validate", {})
        for e in r.get("structural") or []:
            print("SHAPE ✗", e)
        print(r.get("ftue", {}).get("output", ""))
        return 0 if r.get("ok") else 1
    if cmd == "dump":
        doc = call("GET")
        text = json.dumps(doc, indent=2, ensure_ascii=False)
        if args:
            open(args[0], "w").write(text + "\n")
            print(f"wrote {args[0]}")
        else:
            print(text)
        return 0
    if cmd == "put":
        doc = json.load(open(args[0]))
        r = call("PUT", "", {"scripts": doc["scripts"]})
        print("saved" if r.get("ok") else r)
        return 0
    # ---- ops
    op = None
    if cmd == "add-script":
        op = {"op": "add_script", "script": {"id": args[0], "trigger": jarg(opt(args, "--trigger", '{"type":"quest_done","quest":""}'))}}
        t = opt(args, "--title")
        if t:
            op["script"]["title"] = t
        ab = opt(args, "--allow-base")
        if ab:
            op["script"]["allowBase"] = ab
    elif cmd == "set-script":
        patch = {}
        for key, name in (("title", "--title"), ("trigger", "--trigger"), ("allowBase", "--allow-base")):
            v = opt(args, name)
            if v is not None:
                patch[key] = jarg(v) if key == "trigger" else v
        op = {"op": "update_script", "tutorial": args[0], "patch": patch}
    elif cmd == "rm-script":
        op = {"op": "remove_script", "tutorial": args[0]}
    elif cmd == "add":
        step = jarg(opt(args, "--step"))
        op = {"op": "add_step", "tutorial": args[0], "step": step}
        for name, key in (("--after", "after"), ("--before", "before"), ("--index", "index")):
            v = opt(args, name)
            if v is not None:
                op[key] = int(v) if key == "index" else v
    elif cmd == "edit":
        tutorial, step = args[0], args[1]
        rest = args[2:]
        patch, unset = {}, []
        i = 0
        while i < len(rest):
            if rest[i] == "--set":
                k, v = rest[i + 1].split("=", 1)
                patch[k] = jarg(v)
                i += 2
            elif rest[i] == "--unset":
                unset.append(rest[i + 1])
                i += 2
            else:
                sys.exit(f"unexpected arg {rest[i]}")
        op = {"op": "update_step", "tutorial": tutorial, "step": step, "patch": patch, "unset": unset}
    elif cmd == "rm":
        op = {"op": "remove_step", "tutorial": args[0], "step": args[1]}
    elif cmd == "mv":
        op = {"op": "move_step", "tutorial": args[0], "step": args[1], "to": int(opt(args, "--to"))}
    elif cmd == "reorder":
        op = {"op": "reorder", "tutorial": args[0], "order": args[1:]}
    else:
        sys.exit(f"unknown command {cmd}\n{__doc__}")
    r = call("POST", "/op", op)
    sc = next((s for s in r["scripts"] if s["id"] == op.get("tutorial", op.get("script", {}).get("id"))), None)
    print(f"ok — {op['op']}" + (f"; {sc['id']} now {len(sc['steps'])} beats" if sc else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
