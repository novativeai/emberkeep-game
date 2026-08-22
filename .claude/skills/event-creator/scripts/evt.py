#!/usr/bin/env python3
"""evt — drive the Emberkeep Event Creator API from the shell.

Talks to the vite dev server's /__events endpoint (tools/events-api/server.ts),
the same door the World Builder's ⚡ Events tab uses. Every write is validated
server-side (src/core/gameEvents.ts) before it touches src/data/events.json.

  evt ls                                   the tree: id, latch, triggers (children indented)
  evt show <id>                            one event as WHEN / IF / THEN (+ children)
  evt context [key]                        picker data (triggerEvents, properties, commands, chains, …)
  evt add --event JSON [--parent ID] [--after ID]
  evt edit <id> --set key=JSON … [--unset key …]      (keys: title when if then once limit cooldownMs children)
  evt rm <id>
  evt mv <id> --parent ID|root --to N
  evt reorder [--parent ID] ID ID …
  evt validate                             the committed file, checked
  evt dump [file]                          raw { events } JSON (stdout or file)
  evt put <file>                           replace the whole file from a { events } JSON
  evt fire <id>                            prints the console command that runs it in the game

Env: EVT_API (default http://localhost:5173/__events). Exit 1 on any refused write.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("EVT_API", "http://localhost:5173/__events").rstrip("/")


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
        return v


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def flat(events, parent=None, depth=0, out=None):
    out = [] if out is None else out
    for e in events:
        out.append((e, parent, depth))
        flat(e.get("children") or [], e, depth + 1, out)
    return out


def trigger_text(t):
    k = t.get("type")
    if k == "event":
        m = t.get("match") or {}
        return f"on {t['event']}" + (" where " + ", ".join(f"{a} = {b}" for a, b in m.items()) if m else "")
    if k == "tap":
        return f"tap {t.get('target')}"
    if k == "property":
        return f"when {t.get('prop')} becomes {t.get('op')} {t.get('value')}"
    if k == "time":
        return f"{t.get('afterMs')} ms after armed"
    if k == "manual":
        return "manual (fire / Run only)"
    return json.dumps(t)


def action_text(a, indent=""):
    if "add" in a:
        return f"{a['add']} {'+' if a['amount'] >= 0 else ''}{a['amount']}"
    if "set" in a:
        return f"{a['set']} = {a['value']}"
    if "say" in a:
        return f"{a['say']['speaker']} says: " + " / ".join(a["say"]["lines"])
    if "prompt" in a:
        p = a["prompt"]
        lines = [f"{p['speaker']} asks \"{p['text']}\" (prompt {p['id']})"]
        for c in p.get("choices", []):
            lines.append(f"{indent}    [{c['id']}] {c['label']}")
            for x in c.get("then", []):
                lines.append(f"{indent}        → {action_text(x, indent + '        ')}")
        return "\n".join(lines)
    if "spawn" in a:
        s = a["spawn"]
        return f"spawn {s['count']}× {s['chain']} t{s['tier']}" + (f" at {s['at']}" if s.get("at") else "")
    if "retier" in a:
        r = a["retier"]
        return f"retier {r['chain']} t{r['fromTier']} → t{r['toTier']}"
    if "open" in a:
        return f"open {a['open']}"
    if "tutorial" in a:
        return f"start tutorial {a['tutorial']}"
    if "fire" in a:
        return f"fire {a['fire']}"
    if "emit" in a:
        return f"emit {a['emit']} {json.dumps(a.get('payload', {}))}"
    return json.dumps(a)


def latch(e):
    if e.get("once"):
        return "once"
    parts = []
    if e.get("limit"):
        parts.append(f"×{e['limit']}")
    if e.get("cooldownMs"):
        parts.append(f"every ≥{e['cooldownMs']}ms")
    return " ".join(parts) or "∞"


def show(e, depth=0):
    pad = "  " * depth
    print(f"{pad}{e['id']}" + (f" — {e['title']}" if e.get("title") else "") + f"   [{latch(e)}]")
    print(f"{pad}  WHEN (any):")
    for t in e.get("when", []):
        print(f"{pad}    • {trigger_text(t)}")
    if e.get("if"):
        print(f"{pad}  IF (all):")
        for c in e["if"]:
            print(f"{pad}    • {c['prop']} {c['op']} {c['value']}")
    print(f"{pad}  THEN (in order):")
    for i, a in enumerate(e.get("then", []), 1):
        print(f"{pad}    {i}. {action_text(a, pad + '      ')}")
    if e.get("children"):
        print(f"{pad}  CHILDREN (armed once this fires):")
        for c in e["children"]:
            show(c, depth + 2)


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    if cmd == "ls":
        for e, parent, depth in flat(call("GET")["events"]):
            print("  " * depth + f"{e['id']:<32} {latch(e):<16} " + " | ".join(trigger_text(t) for t in e.get("when", [])))
        return
    if cmd == "show":
        events = call("GET")["events"]
        hit = [e for e, _, _ in flat(events) if e["id"] == args[0]]
        if not hit:
            sys.exit(f"no event {args[0]}")
        show(hit[0])
        return
    if cmd == "context":
        ctx = call("GET", "/context")
        print(json.dumps(ctx[args[0]] if args else ctx, indent=2))
        return
    if cmd == "add":
        event = jarg(opt(args, "--event"))
        op = {"op": "add_event", "event": event}
        parent = opt(args, "--parent")
        after = opt(args, "--after")
        if parent:
            op["parent"] = parent
        if after:
            op["after"] = after
    elif cmd == "edit":
        eid = args.pop(0)
        patch = {}
        while "--set" in args:
            kv = opt(args, "--set")
            k, v = kv.split("=", 1)
            patch[k] = jarg(v)
        while "--unset" in args:
            patch[opt(args, "--unset")] = None
        op = {"op": "update_event", "id": eid, "patch": patch}
    elif cmd == "rm":
        op = {"op": "remove_event", "id": args[0]}
    elif cmd == "mv":
        eid = args.pop(0)
        parent = opt(args, "--parent", "root")
        op = {"op": "move_event", "id": eid, "parent": None if parent == "root" else parent, "to": int(opt(args, "--to", "0"))}
    elif cmd == "reorder":
        parent = opt(args, "--parent")
        op = {"op": "reorder", "parent": parent, "order": args}
    elif cmd == "validate":
        r = call("POST", "/validate", {})
        print("OK — events.json is valid." if r.get("ok") else "INVALID:\n  " + "\n  ".join(r.get("errors", [])))
        sys.exit(0 if r.get("ok") else 1)
    elif cmd == "dump":
        doc = call("GET")
        text = json.dumps(doc, indent=2)
        if args:
            open(args[0], "w").write(text + "\n")
            print(f"wrote {args[0]}")
        else:
            print(text)
        return
    elif cmd == "put":
        doc = json.load(open(args[0]))
        r = call("PUT", "", {"events": doc["events"]})
        print("saved" if r.get("ok") else r)
        return
    elif cmd == "fire":
        print(f"__emberkeep.fireEvent({json.dumps(args[0])})   # paste in the running game's console; returns true if it fired")
        return
    else:
        sys.exit(f"unknown command {cmd}\n{__doc__}")
    r = call("POST", "/op", op)
    print("ok" if r.get("ok") else r)


if __name__ == "__main__":
    main(sys.argv[1:])
