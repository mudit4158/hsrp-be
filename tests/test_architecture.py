"""Architecture rule 7 (module table ownership) holds for the app code."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_modules_use_only_their_own_tables():
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "check_module_tables.py")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout
