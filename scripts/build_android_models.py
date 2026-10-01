#!/usr/bin/env python3
"""Build data/android-models.json: Android model code -> marketing name + "listed" flag.

Browsers on Android (Chrome, Samsung Internet) can report the phone's model code
(e.g. "SM-S918B") but not its marketing name ("Galaxy S23 Ultra"). This joins
Google Play's public device catalogue with data/compatibility.json so the web
page can turn a model code into a name and a yes/no answer.

Usage:
    curl -sSL -o data/raw/supported_devices.csv https://storage.googleapis.com/play_public/supported_devices.csv
    .venv/bin/python scripts/build_android_models.py
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data/raw/supported_devices.csv"
COMPAT_PATH = ROOT / "data/compatibility.json"
OUT_PATH = ROOT / "data/android-models.json"

# Abbott brand name -> "Retail Branding" values used in the Play catalogue.
BRAND_ALIASES = {
    "Samsung": ["Samsung"],
    "Asus": ["Asus"],
    "Fujitsu": ["Fujitsu", "FCNT"],
    "Google": ["Google"],
    "HONOR": ["Honor"],
    "HTC": ["HTC"],
    "Huawei": ["Huawei"],
    "Kyocera": ["Kyocera"],
    "LG": ["LGE"],
    "Motorola": ["Motorola"],
    "OPPO": ["Oppo"],
    "Sharp": ["Sharp"],
    "Sony": ["Sony"],
    "Tinno": ["Rakuten"],
    "Xiaomi": ["Xiaomi", "Redmi", "POCO"],
}

# Phones sold in Taiwan whose names we want to show even when they are NOT on
# the list ("您的手機是 OPPO A79，不在清單上"). Keys are Play "Retail Branding".
DISPLAY_BRANDS = {
    "Samsung": "Samsung", "Oppo": "OPPO", "vivo": "vivo", "Vivo": "vivo",
    "realme": "realme", "Realme": "realme", "HMD": "HMD",
    "Xiaomi": "Xiaomi", "Redmi": "Xiaomi", "POCO": "Xiaomi", "Asus": "ASUS",
    "Google": "Google", "Sony": "Sony", "Motorola": "Motorola", "HTC": "HTC",
    "Nokia": "Nokia", "Nothing": "Nothing", "OnePlus": "OnePlus",
    "Sharp": "Sharp", "Huawei": "Huawei", "Honor": "HONOR", "LGE": "LG",
}

# Japanese carrier models append a model code to the name ("AQUOS sense3 SH-02M").
# For these brands, a trailing code-like token is ignored when matching.
CARRIER_SUFFIX_BRANDS = {"Sharp", "Fujitsu", "Kyocera"}

# Listed names whose Play entry is named differently. Values match the Play
# "Marketing Name" or "Model" exactly.
MANUAL_ALIASES = {
    ("HTC", "Desire 22 Pro"): ["HTC Desire 22 5G"],
    ("Fujitsu", "Arrows 5G"): ["F-51A"],
    ("Fujitsu", "Arrows U"): ["801FJ"],
}

# Listed names with no separate Play entry; they share model codes with another
# listed device, so they're covered anyway.
NO_OWN_ENTRY = {
    ("Samsung", "Galaxy S21 5G Olympic Games Edition"),  # docomo SC-51B = Galaxy S21 5G
}

BRAND_WORDS = {"samsung", "honor", "htc", "lg", "oppo", "xiaomi", "motorola",
               "google", "asus", "sharp", "sony", "kyocera", "huawei", "fujitsu"}

# Catalogue entries that aren't phones.
NON_PHONE = re.compile(r"\b(tab|pad|watch|tv|chromebook|book|buds|fit|band)\b", re.I)


def norm(name):
    s = unicodedata.normalize("NFKC", name).lower()
    s = s.replace("+", " plus ").replace("(", " ").replace(")", " ")
    words = [w for w in re.split(r"[\s\-/]+", s) if w and w not in BRAND_WORDS]
    return words


def is_carrier_code(word):
    return bool(re.fullmatch(r"[a-z0-9]*\d[a-z0-9]*", word)) and word not in {"5g", "4g"} \
        and not re.fullmatch(r"\d{4}", word)


def matches(listed_words, play_words, brand):
    if listed_words == play_words:
        return True
    if brand in CARRIER_SUFFIX_BRANDS and play_words[:len(listed_words)] == listed_words:
        rest = play_words[len(listed_words):]
        return all(is_carrier_code(w) for w in rest)
    return False


def main():
    if not CSV_PATH.exists():
        sys.exit(f"ERROR: {CSV_PATH} missing; download it first (see docstring)")
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-16")))
    compat = json.loads(COMPAT_PATH.read_text(encoding="utf-8"))

    models = {}
    unmatched = []

    def add(model, brand, name, listed):
        prev = models.get(model)
        if prev and prev["listed"] and not listed:
            return  # never downgrade a listed model
        if prev and prev["listed"] and listed and prev["name"] != name:
            print(f"  note: {model} maps to both '{prev['name']}' and '{name}' (keeping first)")
            return
        models[model] = {"brand": brand, "name": name, "listed": listed}

    # 1) Listed devices.
    for brand, names in compat["android"]["brands"].items():
        branding = set(BRAND_ALIASES[brand])
        brand_rows = [r for r in rows if r["Retail Branding"] in branding]
        for name in names:
            aliases = MANUAL_ALIASES.get((brand, name))
            if aliases:
                hits = [r for r in brand_rows
                        if r["Marketing Name"] in aliases or r["Model"] in aliases]
            else:
                lw = norm(name)
                hits = [r for r in brand_rows if matches(lw, norm(r["Marketing Name"]), brand)]
            if not hits and (brand, name) not in NO_OWN_ENTRY:
                unmatched.append(f"{brand} {name}")
            for r in hits:
                add(r["Model"], brand, name, True)

    n_listed = len(models)

    # 2) Other phones from brands common in Taiwan, for display only.
    for r in rows:
        brand = DISPLAY_BRANDS.get(r["Retail Branding"])
        if not brand or not r["Model"] or not r["Marketing Name"]:
            continue
        if NON_PHONE.search(r["Marketing Name"]):
            continue
        add(r["Model"], brand, r["Marketing Name"], False)

    data = {
        "source": {
            "catalogue": "https://storage.googleapis.com/play_public/supported_devices.csv",
            "compatibility": compat["source"],
        },
        "models": dict(sorted(models.items())),
    }
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8")

    print(f"Wrote {OUT_PATH.relative_to(ROOT)}: {n_listed} model codes for listed devices, "
          f"{len(models) - n_listed} other phones, {OUT_PATH.stat().st_size // 1024} KB")
    if unmatched:
        print(f"\n{len(unmatched)} listed devices with no model code in the Play catalogue:")
        for u in unmatched:
            print(f"  - {u}")


if __name__ == "__main__":
    main()
