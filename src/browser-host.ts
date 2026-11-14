import type { PlanTier } from './types';
import { createRoomHub, type RoomHub, type UserSnapshot } from './room-host';
import { connectHost, stopCollab } from './collab';
import { listenLocalGuests, memoryChannel } from './local-transport';
import { createRelayHost, cloudGuestUrl, normalizeRelayUrl, type RelayHost, type RelayStatus } from './relay-host';
import { linkBaseUrl } from './link-view';
import { limitsEnforced } from './plan';
import { planOf } from './limits';
import { state } from './state';

// Автор в браузере: комната живёт прямо во вкладке (хаб room-host.ts), автор подключён к ней через память,
// гости приходят через облачный ретранслятор или из соседних вкладок (для тестов).

interface Active {
  hub: RoomHub;
  code: string;
  relay: RelayHost | null;
  stopLocal: (() => void) | null;
}
let active: Active | null = null;

export function browserHostActive(): boolean {
  return active !== null;
}

/** Тариф владельца: на free гость один, на pro и tutor — без ограничений. Пока лимиты выключены — без ограничений у всех. */
function hubLimits(): { plan: PlanTier; maxGuests?: number; maxEditors?: number } {
  const plan = planOf(state.project);
  return limitsEnforced() ? { plan } : { plan, maxGuests: Infinity, maxEditors: Infinity };
}

function newCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Открывает комнату во вкладке и подключает к ней автора. */
export async function startBrowserHost(name = 'Автор'): Promise<string> {
  if (active) return active.code;
  const code = newCode();
  const hub = createRoomHub({ code, ...hubLimits() });
  active = { hub, code, relay: null, stopLocal: null };
  const { client, socket } = memoryChannel();
  const connected = connectHost(client);
  hub.attach(socket, { isHost: true, name });
  await connected;
  return code;
}

/** Принимать гостей из других вкладок этого браузера по коду (для тестов и демонстрации). */
export async function startLocalRoom(code: string): Promise<void> {
  await startBrowserHost();
  const a = active!;
  a.stopLocal?.();
  a.stopLocal = listenLocalGuests(code, (sock, opts) => a.hub.attach(sock, opts));
}

export function stopBrowserHost(): void {
  const a = active;
  if (!a) return;
  active = null;
  a.relay?.stop();
  a.stopLocal?.();
  stopCollab();
  a.hub.closeAll();
}

export function browserHostUsers(): UserSnapshot[] {
  return active ? active.hub.users() : [];
}

export async function startBrowserCloud(relayUrl: string): Promise<void> {
  const a = active;
  if (!a) throw new Error('Совместная работа не включена');
  const url = normalizeRelayUrl(relayUrl);
  a.relay?.stop();
  const relay = createRelayHost({ relayUrl: url, attach: (s, o) => a.hub.attach(s, o), refresh: s => a.hub.refresh(s) });
  a.relay = relay;
  try {
    await relay.start();
  } catch (e) {
    if (a.relay === relay) a.relay = null;
    throw e;
  }
}

export function stopBrowserCloud(): void {
  active?.relay?.stop();
  if (active) active.relay = null;
}

export function browserCloudStatus(): (RelayStatus & { url: string | null }) | null {
  const relay = active?.relay;
  if (!relay) return null;
  const s = relay.status();
  return { ...s, url: s.room ? cloudGuestUrl(linkBaseUrl(location), s.relayUrl, s.room, s.key) : null };
}

export function browserSetRights(uid: number, patch: Parameters<RoomHub['setRights']>[1]): { ok: boolean; error?: string } {
  return active ? active.hub.setRights(uid, patch) : { ok: false, error: 'Совместная работа не включена' };
}

/** Состояние для окна «Совместная работа» в тех же полях, что отдаёт приложение. */
export interface BrowserCloudStatus {
  state: 'connecting' | 'online' | 'reconnecting' | 'failed' | 'stopped';
  url: string | null;
  error: string | null;
  guests: number;
  relayUrl: string;
}

export function browserShareStatus(): { active: boolean; users?: UserSnapshot[]; cloud?: BrowserCloudStatus | null } {
  if (!active) return { active: false };
  const c = browserCloudStatus();
  return {
    active: true,
    users: active.hub.users(),
    cloud: c ? { state: c.state === 'idle' ? 'connecting' : c.state, url: c.url, error: c.error, guests: c.guests, relayUrl: c.relayUrl } : null,
  };
}
