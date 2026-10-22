// Приложение для Android — та же веб-сборка внутри Capacitor. Здесь то, чем оно
// отличается от браузера: скачивание файлов через <a download> в WebView не работает.

import { Capacitor } from '@capacitor/core';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** PNG — в системное меню «Поделиться»: сохранить в файлы, галерею или отправить. */
export async function sharePng(dataUrl: string, name: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const { uri } = await Filesystem.writeFile({
    path: name.replace(/[\\/:*?"<>|]/g, '_'),
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    directory: Directory.Cache,
  });
  await Share.share({ title: name, files: [uri] });
}
