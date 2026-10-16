#!/usr/bin/env python3
"""Builds a release for the in-sheet updater.

Usage: python3 tools/build_bundle.py  ->  dist/release/<source files> + dist/release/release.json

Upload the changed source files to the Drive folder "Horror HQ Code", then release.json last.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "release"
EXTS = {".gs", ".html", ".json"}


def main():
    names = sorted(p.name for p in SRC.iterdir() if p.suffix in EXTS)
    for required in ("appsscript.json", "Updater.gs"):
        if required not in names:
            raise SystemExit(f"src/{required} is missing")
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.strip()
    except subprocess.CalledProcessError:
        sha = "nogit"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for n in names:
        shutil.copy(SRC / n, OUT / n)
    digests = {n: hashlib.sha256((SRC / n).read_bytes()).hexdigest() for n in names}
    release = {"version": f"{stamp}-{sha}", "files": names, "sha256": digests}
    (OUT / "release.json").write_text(json.dumps(release, indent=2), encoding="utf-8")
    print(json.dumps(release, indent=2))


if __name__ == "__main__":
    main()
