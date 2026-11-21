#!/usr/bin/env python3
import datetime, json, os, pathlib, re, tarfile
v = os.environ['VERSION']
if not re.fullmatch(r'\d+\.\d+\.\d+', v): raise ValueError('Неверная версия')
out = pathlib.Path('out')
files = [f'Abax.Setup.{v}.exe', f'Abax.{v}.exe']
if (out / f'Abax-{v}.apk').is_file(): files.append(f'Abax-{v}.apk')
for name in files:
    if not (out / name).is_file() or not (out / name).stat().st_size: raise ValueError(f'Нет файла {name}')
release = {'tag_name': 'v' + v, 'published_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'body': pathlib.Path(f'release-notes/{v}.md').read_text(encoding='utf-8'), 'assets': [{'name': name} for name in files]}
(out / 'latest.json').write_text(json.dumps(release, ensure_ascii=False), encoding='utf-8')
with tarfile.open('downloads.tar', 'w') as tar:
    for name in files + ['latest.json']: tar.add(out / name, arcname=name)
