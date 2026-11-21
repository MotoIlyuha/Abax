(async () => {
  const status = document.getElementById('status'), files = document.getElementById('files');
  try {
    const response = await fetch('latest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const release = await response.json();
    const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
    if (!version || !Array.isArray(release.assets)) throw new Error();
    status.textContent = `Версия ${version}`;
    for (const [name, label] of [[`Abax.Setup.${version}.exe`, 'Windows - установщик'], [`Abax.${version}.exe`, 'Windows - переносимая версия'], [`Abax-${version}.apk`, 'Android - APK']]) {
      if (release.assets.some(a => a && a.name === name)) {
        const a = document.createElement('a'); a.href = `versions/${version}/${name}`; a.textContent = `Скачать ${label}`; files.append(a);
      } else {
        const p = document.createElement('p'); p.textContent = `${label}: файл пока недоступен`; files.append(p);
      }
    }
  } catch { status.textContent = 'Не удалось получить сведения о загрузках. Попробуйте позже.'; }
})();
