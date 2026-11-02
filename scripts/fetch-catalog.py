#!/usr/bin/env python3
"""Downloads the starter catalog (catalog/katalog.json) from the Mutopia Project
into public/Katalog/, and writes the credits every Creative Commons piece
needs (public/Katalog/QUELLEN.md) plus catalog/katalog.lock.json.

Only real, published scores — nothing is generated here.

    python3 scripts/fetch-catalog.py           # download what is missing
    python3 scripts/fetch-catalog.py --force   # download everything again
"""
import html
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'catalog' / 'katalog.json'
LOCK = ROOT / 'catalog' / 'katalog.lock.json'
OUT = ROOT / 'public' / 'Katalog'
INFO_URL = 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={}'
UA = {'User-Agent': 'Pianooo catalog fetcher (https://github.com/hoai-droid/pianooo)'}


def get(url: str) -> bytes:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(url)


def text_after(label: str, page: str) -> str:
    m = re.search(re.escape(label) + r'\s*\n\s*(.+)', page)
    return m.group(1).strip() if m else ''


def piece_info(pid: int) -> dict:
    raw = get(INFO_URL.format(pid)).decode('utf-8', 'ignore')
    links = re.findall(r'href="([^"]+)"', raw)
    page = re.sub(r'(?s)<(script|style).*?</\1>', '', raw)
    page = html.unescape(re.sub(r'<[^>]+>', '\n', page))
    page = re.sub(r'\n\s*\n+', '\n', page)
    title_line = page.strip().split('\n')[0]
    return {
        'id': pid,
        'title': title_line.split(', by ')[0].strip(),
        'composer': title_line.split(', by ')[-1].strip(),
        'license': text_after('Copyright:', page),
        'maintainer': text_after('Maintainer:', page),
        'source': text_after('Source:', page),
        'url': INFO_URL.format(pid),
        'mid': next((l for l in links if l.endswith('.mid')), None),
        'midzip': next((l for l in links if l.endswith('mids.zip')), None),
    }


def safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', '-', name).strip()


def main():
    force = '--force' in sys.argv
    spec = json.loads(SPEC.read_text('utf-8'))
    infos: dict[int, dict] = {}
    zips: dict[int, zipfile.ZipFile] = {}
    lock = []
    for folder in spec['folders']:
        fdir = OUT / safe(folder['name'])
        fdir.mkdir(parents=True, exist_ok=True)
        for piece in folder['pieces']:
            pid = piece['id']
            if pid not in infos:
                infos[pid] = piece_info(pid)
                time.sleep(0.3)
            info = infos[pid]
            dest = fdir / (safe(piece['file']) + '.mid')
            member = piece.get('member')
            if force or not dest.exists():
                if member:
                    if pid not in zips:
                        if not info['midzip']:
                            raise SystemExit(f'{pid}: no MIDI zip on Mutopia')
                        zips[pid] = zipfile.ZipFile(io.BytesIO(get(info['midzip'])))
                    data = zips[pid].read(member)
                else:
                    if not info['mid']:
                        raise SystemExit(f'{pid}: no single MIDI file on Mutopia (needs "member")')
                    data = get(info['mid'])
                    time.sleep(0.2)
                if not data.startswith(b'MThd'):
                    raise SystemExit(f'{pid}: not a MIDI file')
                dest.write_bytes(data)
                print('  +', dest.relative_to(OUT))
            lock.append({
                'folder': folder['name'], 'file': dest.name, 'id': pid, 'member': member,
                'title': info['title'], 'composer': info['composer'], 'license': info['license'],
                'maintainer': info['maintainer'], 'source': info['source'], 'url': info['url'],
            })

    LOCK.write_text(json.dumps(lock, ensure_ascii=False, indent=1) + '\n', 'utf-8')

    lines = [
        '# Quellen und Lizenzen des Pianooo-Katalogs', '',
        'Alle Stücke stammen vom [Mutopia Project](https://www.mutopiaproject.org) – '
        'frei verfügbare Notensätze, gesetzt von Freiwilligen.',
        'Stücke unter Creative Commons dürfen mit Namensnennung weitergegeben werden; '
        'bei „ShareAlike“ gilt für veränderte Fassungen dieselbe Lizenz.', '',
        '| Datei | Werk | Lizenz | Notensatz | Quelle |', '|---|---|---|---|---|',
    ]
    for e in lock:
        lines.append(f"| {e['folder']} / {e['file']} | {e['title']} – {e['composer']} | {e['license']} | "
                     f"{e['maintainer']} | [Mutopia #{e['id']}]({e['url']}) |")
    (OUT / 'QUELLEN.md').write_text('\n'.join(lines) + '\n', 'utf-8')
    print(f'{len(lock)} pieces in {OUT}')


if __name__ == '__main__':
    main()
