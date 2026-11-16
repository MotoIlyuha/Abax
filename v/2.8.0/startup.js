// Экран загрузки до старта приложения. Отдельный файл, а не встроенный скрипт:
// CSP в index.html разрешает только скрипты из самого приложения (script-src 'self').
(function () {
  var retry = document.getElementById('startup-retry');
  if (retry) retry.addEventListener('click', function () { location.reload(); });
  window.setTimeout(function () {
    if (!document.getElementById('startup').hidden) {
      document.getElementById('startup-message').textContent = 'Загрузка занимает больше времени, чем обычно.';
      retry.hidden = false;
    }
  }, 15000);
})();
