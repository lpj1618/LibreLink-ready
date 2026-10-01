#!/usr/bin/env python3
"""Parse Abbott's "Mobile Device & OS Compatibility" PDF (ART39109-001) into JSON.

Usage:
    .venv/bin/python scripts/parse_compat.py <pdf> [-o data/compatibility.json] [--url URL]

Only the English section is parsed. The script fails loudly when the layout
looks different from what it expects, so a new PDF revision gets checked by a
human instead of silently producing a wrong list.
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

from pypdf import PdfReader

ENGLISH_HEADER = "MOBILE DEVICE & OS COMPATIBILITY"

# Brands as they appear at the start of a line in the Android column.
KNOWN_BRANDS = [
    "Samsung", "Asus", "Fujitsu", "Google", "HONOR", "HTC", "Huawei", "Kyocera",
    "LG", "Motorola", "OPPO", "Sharp", "Sony", "Tinno", "Xiaomi",
]

# The PDF writes the series name only on the first item ("Samsung Galaxy A05s, A7, ...").
SERIES_PREFIX = {
    "Samsung": "Galaxy",
    "Sharp": "AQUOS",
    "Sony": "Xperia",
    "Fujitsu": "Arrows",
}

# Words that may legitimately start a wrapped continuation line. A capitalised
# word not in this set probably means a brand we don't know about yet.
CONTINUATION_WORDS = {
    "Pixel", "Redmi", "POCO", "Note", "Pro", "Max", "Lite", "Ultra", "Edge",
    "Flip", "Fold", "Plus", "Mini", "Air", "XL", "NFC", "FE",
}


def find_english_page(reader):
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if ENGLISH_HEADER in text:
            return i, text
    sys.exit(f"ERROR: could not find '{ENGLISH_HEADER}' in the PDF")


def parse_revision(reader):
    text = reader.pages[0].extract_text()
    m = re.search(r"(ART\d+-\d+)\s+Rev\.\s*(\w+)\s+(\d{2}/\d{2})", text)
    if not m:
        sys.exit("ERROR: could not find document number / revision on page 1")
    return {"document": m.group(1), "revision": m.group(2), "date": m.group(3)}


def split_csv(s):
    return [x.strip() for x in s.split(",") if x.strip()]


def parse_app_versions(block):
    m = re.search(r"\(version\s+(.*?)\)", block, re.S)
    if not m:
        sys.exit("ERROR: app version list not found")
    return split_csv(m.group(1).replace("\n", " "))


def parse_os_versions(text):
    """'8*, 8.1*, 16†' -> [{'version': '8', 'flags': ['*']}, ...]"""
    out = []
    for item in split_csv(text):
        m = re.fullmatch(r"([\d.]+)([*†]*)", item)
        if not m:
            sys.exit(f"ERROR: unexpected OS version token: {item!r}")
        out.append({"version": m.group(1), "flags": list(m.group(2))})
    return out


def parse_ios(block):
    m = re.search(r"\)\s*\n(iPhone .*?)\niOS:(.*)", block, re.S)
    if not m:
        sys.exit("ERROR: iOS block layout not recognised")
    devices_raw = m.group(1).replace("\n", " ")
    names = split_csv(devices_raw.removeprefix("iPhone "))
    devices = [f"iPhone {n}" for n in names]
    os_versions = parse_os_versions(m.group(2).replace("\n", " "))
    return {
        "app_versions": parse_app_versions(block),
        "devices": devices,
        "os_versions": [v["version"] for v in os_versions],
    }


def parse_android(block):
    m = re.search(r"\)\s*\n(Samsung .*?)\nAndroid:(.*?)\n(Asus .*?)\nThis guide will be updated", block, re.S)
    if not m:
        sys.exit("ERROR: Android block layout not recognised")
    samsung_lines, os_raw, other_lines = m.group(1), m.group(2), m.group(3)

    # The OS list may wrap onto lines of its own ("15, 16†") before the next brand.
    os_lines = os_raw.split("\n")
    os_text = os_lines[0]
    leftover = []
    for line in os_lines[1:]:
        if re.fullmatch(r"[\d.*†,\s]+", line):
            os_text += " " + line
        else:
            leftover.append(line)
    if leftover:
        sys.exit(f"ERROR: unexpected lines inside Android OS list: {leftover}")

    brands = {}
    current = None
    for line in (samsung_lines + "\n" + other_lines).split("\n"):
        line = line.strip()
        if not line:
            continue
        brand = next((b for b in KNOWN_BRANDS if line.startswith(b + " ")), None)
        if brand:
            current = brand
            brands[brand] = line[len(brand) + 1:]
            continue
        if current is None:
            sys.exit(f"ERROR: device line before any brand: {line!r}")
        first = line.split()[0].rstrip(",")
        if re.fullmatch(r"[A-Z][a-z]{2,}", first) and first not in CONTINUATION_WORDS:
            sys.exit(f"ERROR: line looks like a new, unknown brand: {line!r}\n"
                     f"       Add it to KNOWN_BRANDS (or CONTINUATION_WORDS) and re-run.")
        brands[current] += " " + line

    result = {}
    for brand, raw in brands.items():
        items = split_csv(raw)
        prefix = SERIES_PREFIX.get(brand)
        if prefix:
            if not items[0].startswith(prefix + " "):
                sys.exit(f"ERROR: expected {brand} list to start with '{prefix}'")
            items = [f"{prefix} {i.removeprefix(prefix + ' ')}" for i in items]
        result[brand] = items

    return {
        "app_versions": parse_app_versions(block),
        "os_versions": parse_os_versions(os_text),
        "brands": result,
    }


def parse_footnotes(text):
    """Footnotes follow the table: one paragraph starting with '*', one with '†'."""
    tail = text.split("Jailbroken devices", 1)[-1]
    notes = {}
    for m in re.finditer(r"^([*†])\s+(.*?)(?=^[*†]\s|\Z)", tail, re.S | re.M):
        notes[m.group(1)] = " ".join(m.group(2).split())
    if set(notes) != {"*", "†"}:
        sys.exit(f"ERROR: footnotes not found (got {sorted(notes)})")
    return notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("-o", "--output", default="data/compatibility.json")
    ap.add_argument("--url", default="")
    args = ap.parse_args()

    reader = PdfReader(args.pdf)
    page_index, text = find_english_page(reader)

    blocks = text.split("FreeStyle LibreLink\n")
    if len(blocks) != 3:
        sys.exit(f"ERROR: expected 2 'FreeStyle LibreLink' rows, found {len(blocks) - 1}")
    ios = parse_ios(blocks[1])
    android = parse_android(blocks[2])
    footnotes = parse_footnotes(text)

    data = {
        "source": {
            **parse_revision(reader),
            "url": args.url,
            "english_page": page_index + 1,
            "parsed_on": date.today().isoformat(),
        },
        "ios": ios,
        "android": android,
        "footnotes": footnotes,
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    n_android = sum(len(v) for v in android["brands"].values())
    print(f"Wrote {out}: rev {data['source']['revision']} ({data['source']['date']}), "
          f"{len(ios['devices'])} iPhones / {len(ios['os_versions'])} iOS versions, "
          f"{n_android} Android devices in {len(android['brands'])} brands / "
          f"{len(android['os_versions'])} Android versions")


if __name__ == "__main__":
    main()
