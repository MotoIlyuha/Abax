// Счётчик сайта не запускается в приложении, открытом из локальных файлов.
function startMetrika() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  try { if (localStorage.getItem('abax.analytics-consent') !== 'accepted') return; } catch (_) { return; }
  if (/[?&#]tgWebAppData=/.test(location.href) || window.Telegram?.WebApp?.initData) return;
  if (window.ym) return;
  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) return;
    }
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    k.async = 1;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=114443432', 'ym');

  window.ym(114443432, 'init', {
    ssr: true, webvisor: false, clickmap: true, ecommerce: 'dataLayer',
    referrer: document.referrer, url: location.href, accurateTrackBounce: true, trackLinks: true
  });
}
startMetrika();
window.addEventListener('abax:analytics-accepted', startMetrika);
window.addEventListener('storage', function (event) {
  if (event.key !== 'abax.analytics-consent' && event.key !== null) return;
  if (event.newValue === 'accepted') startMetrika();
  else if (window.ym) location.reload();
});
