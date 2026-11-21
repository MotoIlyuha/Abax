#!/usr/bin/env python3
"""Приём одного релиза через ограниченный SSH-ключ; файлы версий неизменяемы."""
import fcntl, hashlib, json, os, pathlib, re, shutil, sys, tarfile, tempfile

ROOT = pathlib.Path('/var/www/abax-downloads')
LIMIT = 2 * 1024**3
MAX_ARCHIVE = 450 * 1024**2
os.umask(0o022)
ROOT.mkdir(parents=True, exist_ok=True)
with open(ROOT / '.publish.lock', 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    with tempfile.TemporaryDirectory(prefix='.incoming-', dir=ROOT) as temp:
        temp = pathlib.Path(temp)
        archive = temp / 'upload.tar'
        with archive.open('wb') as dest:
            total = 0
            while True:
                chunk = sys.stdin.buffer.read(1024 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_ARCHIVE: raise ValueError('Архив слишком велик')
                dest.write(chunk)
        with tarfile.open(archive, 'r:') as tar:
            members = tar.getmembers()
            names = [m.name for m in members]
            if len(names) != len(set(names)) or any(not m.isfile() or '/' in m.name or m.name.startswith('.') for m in members):
                raise ValueError('Недопустимое содержимое архива')
            if sum(m.size for m in members) > MAX_ARCHIVE: raise ValueError('Файлы слишком велики')
            for member in members:
                with tar.extractfile(member) as source, (temp / member.name).open('wb') as dest:
                    shutil.copyfileobj(source, dest)
        manifest = json.loads((temp / 'latest.json').read_text(encoding='utf-8'))
        match = re.fullmatch(r'v(\d+\.\d+\.\d+)', manifest.get('tag_name', ''))
        if not match: raise ValueError('Неверная версия')
        version = match.group(1)
        required = {f'Abax.Setup.{version}.exe', f'Abax.{version}.exe'}
        allowed = required | {f'Abax-{version}.apk'}
        assets = manifest.get('assets')
        if not isinstance(assets, list) or any(not isinstance(a, dict) or not isinstance(a.get('name'), str) for a in assets): raise ValueError('Неверный список файлов')
        assets = {a['name'] for a in assets}
        if not required <= assets <= allowed or set(names) != assets | {'latest.json'}: raise ValueError('Неполный релиз')
        if any((temp / n).stat().st_size == 0 for n in assets): raise ValueError('Пустой файл')
        versions = ROOT / 'versions'; versions.mkdir(exist_ok=True)
        target = versions / version
        latest = ROOT / 'latest.json'
        if latest.exists():
            previous = json.loads(latest.read_text(encoding='utf-8')).get('tag_name', '')
            if re.fullmatch(r'v\d+\.\d+\.\d+', previous) and tuple(map(int, previous[1:].split('.'))) > tuple(map(int, version.split('.'))):
                raise ValueError('Нельзя заменить новую версию более старой')
        if target.exists():
            def digest(path):
                h = hashlib.sha256()
                with path.open('rb') as f:
                    for part in iter(lambda: f.read(1024 * 1024), b''): h.update(part)
                return h.digest()
            if any(not (target / n).is_file() or digest(target / n) != digest(temp / n) for n in assets):
                raise ValueError('Версия уже опубликована с другими файлами')
            os.replace(temp / 'latest.json', latest)
            print('Обновлены сведения о версии ' + version)
            sys.exit(0)
        used = sum(p.stat().st_size for p in versions.rglob('*') if p.is_file())
        if used + sum((temp / n).stat().st_size for n in assets) > LIMIT: raise ValueError('Лимит хранилища достигнут')
        stage = temp / 'version'; stage.mkdir()
        for name in assets: os.replace(temp / name, stage / name)
        shutil.copyfile(temp / 'latest.json', stage / 'latest.json')
        os.replace(stage, target)
        os.replace(temp / 'latest.json', latest)
        print('Опубликована версия ' + version)
