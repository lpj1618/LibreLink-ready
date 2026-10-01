#!/usr/bin/env python3
"""Show what changed between two compatibility.json files.

Usage: .venv/bin/python scripts/diff_compat.py old.json new.json
"""
import json
import sys


def flatten(path):
    d = json.load(open(path, encoding="utf-8"))
    return {
        "iPhone 機型": d["ios"]["devices"],
        "iOS 版本": d["ios"]["os_versions"],
        "Android 機型": [f"{b} {n}" for b, ns in d["android"]["brands"].items() for n in ns],
        "Android 版本": [v["version"] + "".join(v["flags"]) for v in d["android"]["os_versions"]],
        "App 版本 (iOS)": d["ios"]["app_versions"],
        "App 版本 (Android)": d["android"]["app_versions"],
    }


old, new = flatten(sys.argv[1]), flatten(sys.argv[2])
changed = False
for key in new:
    added = [x for x in new[key] if x not in old[key]]
    removed = [x for x in old[key] if x not in new[key]]
    if added or removed:
        changed = True
        print(f"[{key}]")
        for x in added:
            print(f"  + {x}")
        for x in removed:
            print(f"  - {x}")
if not changed:
    print("(沒有變更)")
