// Адреса компьютера в локальной сети и код комнаты (Ночь №6, SPEC_NIGHT6 §6.3, дефекты D4 и D5).
// Чистые функции: список интерфейсов передаётся снаружи (os.networkInterfaces()), поэтому их легко проверить тестом.
const crypto = require('crypto');

/** Имена виртуальных адаптеров: через них гость из той же Wi-Fi-сети обычно не достучится. */
const VIRTUAL_IFACE = /(vEthernet|WSL|docker|br-|veth|VirtualBox|VMware|vmnet|Hyper-V|tun|tap|utun|wg|zt|tailscale)/i;

/**
 * Все IPv4-адреса компьютера с видом: lan — обычная сеть, virtual — виртуальный адаптер, link-local — 169.254.x.x
 * (сети нет, адрес выдан самим компьютером), loopback — только этот компьютер. Сначала — lan.
 */
function lanAddresses(ifaces) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      const kind = i.internal ? 'loopback' : i.address.startsWith('169.254.') ? 'link-local' : VIRTUAL_IFACE.test(name) ? 'virtual' : 'lan';
      out.push({ iface: name, address: i.address, kind });
    }
  }
  const rank = { lan: 0, virtual: 1, 'link-local': 2, loopback: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * Адреса для гостей: основной — первый обычный (иначе любой не-loopback); только loopback — localOnly:
 * адрес работает лишь на этом компьютере и за адрес для гостей не выдаётся.
 */
function shareUrls(ifaces, port, code) {
  const all = lanAddresses(ifaces);
  const guestUsable = all.filter(a => a.kind !== 'loopback');
  const urls = guestUsable.map(a => ({ iface: a.iface, address: a.address, kind: a.kind, url: `http://${a.address}:${port}/?room=${code}` }));
  if (urls.length > 0) return { url: urls[0].url, urls, localOnly: false };
  return { url: `http://127.0.0.1:${port}/?room=${code}`, urls: [], localOnly: true };
}

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Код комнаты: 8 символов A–Z0–9 из криптостойкого генератора, без смещения (отбор байтов < 252). */
function newRoomCode(len = 8, random = crypto.randomBytes) {
  let out = '';
  while (out.length < len) {
    for (const b of random(len * 2)) {
      if (b >= 252) continue; // 252 = 36 × 7: остальные байты дали бы смещение
      out += CODE_ALPHABET[b % 36];
      if (out.length === len) break;
    }
  }
  return out;
}

module.exports = { lanAddresses, shareUrls, newRoomCode, CODE_ALPHABET };
