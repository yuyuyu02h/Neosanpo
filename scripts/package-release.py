"""ソース、配布用ビルド、引き継ぎ資料をZIPにまとめる。"""

import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text())["version"]
name = f"mayoimichi-v{version}"
if not (root / "dist" / "index.html").exists():
    raise SystemExit("先に npm run build を実行してください。")
release = root / "release"
release.mkdir(exist_ok=True)
entries = [
    "src", "public", "assets", "dist", "docs", "tests", "scripts", "index.html",
    "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts",
    "README.md", "REQUIREMENTS.md", "PLAN.md", "CONCEPT.md", "AGENTS.md",
    "THIRD_PARTY_NOTICES.md", ".gitignore", ".prettierrc.json", ".prettierignore",
]
archive_path = release / f"{name}.zip"
with ZipFile(archive_path, "w", ZIP_DEFLATED) as archive:
    for entry in entries:
        path = root / entry
        files = sorted(path.rglob("*")) if path.is_dir() else [path]
        for file in files:
            if file.is_file() and file.name != ".DS_Store" and "__pycache__" not in file.parts:
                archive.write(file, f"{name}/{file.relative_to(root)}")
with ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    print(f"{archive_path}\n{len(archive.namelist())} files / {archive_path.stat().st_size:,} bytes")
