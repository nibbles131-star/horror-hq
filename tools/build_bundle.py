#!/usr/bin/env python3
"""Packs src/ into the JSON bundle the in-sheet updater installs.

Usage: python3 tools/build_bundle.py  ->  dist/horror-hq-update-bundle.json
"""
import json
import pathlib
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "horror-hq-update-bundle.json"
TYPES = {".gs": "SERVER_JS", ".html": "HTML", ".json": "JSON"}


def main():
    files = []
    for path in sorted(SRC.iterdir()):
        kind = TYPES.get(path.suffix)
        if not kind:
            continue
        files.append({"name": path.stem, "type": kind, "source": path.read_text(encoding="utf-8")})
    if not any(f["name"] == "appsscript" and f["type"] == "JSON" for f in files):
        raise SystemExit("src/appsscript.json is missing")
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.strip()
    except subprocess.CalledProcessError:
        sha = "nogit"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    bundle = {"version": f"{stamp}-{sha}", "built_at": datetime.now(timezone.utc).isoformat(), "files": files}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
    print(f"{OUT} {bundle['version']} ({len(files)} files, {OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
