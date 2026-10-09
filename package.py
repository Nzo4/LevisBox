#!/usr/bin/env python3
"""Package only public extension runtime files; never profile exports."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parent
FILES = (
    'manifest.json', 'model.js', 'network.js', 'engine.js', 'transfer.js',
    'popup.html', 'options.html', 'popup.css', 'popup.js',
)

def main():
    source = ROOT
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['name'] == 'LevisBox'
    destination = ROOT / 'dist' / 'LevisBox.zip'
    destination.parent.mkdir(exist_ok=True)
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(source / name, name)
    print(destination)

if __name__ == '__main__':
    main()
