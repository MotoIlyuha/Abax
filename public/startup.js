// Экран загрузки до старта приложения. Отдельный файл, а не встроенный скрипт:
// CSP в index.html запрещает встроенные скрипты.
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
