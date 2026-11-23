import { ApiError, currentSession, getApi, saveSession, type ApiClient, type MeResponse } from './api-client';
import { type ActionResult, applyLocal, emptyBook, endpoint, makeCommand, uid, type TutorAction, type TutorBook, type TutorCommand } from './tutor-local';
import { TutorError } from './tutor-model';
import { storage, type BoardsStorage } from './storage';
import { progressOf } from './tutor-board';
import type { ProjectMeta } from './types';

interface Cache { book: TutorBook; queue: TutorCommand[] }
const blank = (): Cache => ({ book: emptyBook(), queue: [] });
const offline = (e: unknown) => e instanceof ApiError && e.isNetwork;
export class TutorStore {
  book: TutorBook = emptyBook();
  pending = 0;
  private owner = '';
  private namespace = 'doska.tutor.local';
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly api: ApiClient | null = getApi(), private boards: BoardsStorage = storage) {}
  private read(): Cache {
    const raw = localStorage.getItem(this.namespace);
    return raw ? JSON.parse(raw) as Cache : blank();
  }
  private publish(cache: Cache) { this.book = cache.book; this.pending = cache.queue.length; }
  private save(cache: Cache) { localStorage.setItem(this.namespace,JSON.stringify(cache)); this.publish(cache); }
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => navigator.locks ? await navigator.locks.request('doska.tutor.write',fn) : await fn();
    const next = this.chain.then(run,run);
    this.chain = next.catch(() => {});
    return next;
  }
  async init(initData?: string) {
    if (!this.api) {
      if (initData) throw new TutorError('telegram-needs-cloud');
      this.publish(this.read());
      return;
    }
    const marker = 'doska.tutor.account.' + this.api.base;
    let userId = '';
    try {
      if (initData) {
        const reply = await this.api.request<MeResponse & { token:string }>('POST','/api/auth/tma',{ initData },{ optionalAuth:true });
        saveSession(reply.token);
        userId = reply.user.id;
      } else {
        if (!currentSession() && this.api.base === location.origin) {
          try {
            const reply = await this.api.request<MeResponse & { token:string }>('POST','/api/auth/session',{}, { anonymous:true });
            saveSession(reply.token);
          } catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; }
        }
        userId = (await this.api.me()).user.id;
      }
      localStorage.setItem(marker,JSON.stringify({ userId,token:currentSession() }));
    } catch (e) {
      const saved = JSON.parse(localStorage.getItem(marker) ?? 'null') as { userId:string;token:string } | null;
      if (initData || !offline(e) || !saved?.token || saved.token !== currentSession()) throw e;
      userId = saved.userId;
    }
    this.owner = userId;
    this.namespace = marker + '.' + userId;
    await this.lock(async () => {
      if (!localStorage.getItem(this.namespace)) {
        const local = localStorage.getItem('doska.tutor.local');
        if (local) { localStorage.setItem(this.namespace,local); localStorage.removeItem('doska.tutor.local'); }
      }
      this.publish(this.read());
    });
    await this.refresh();
  }
  private async send(cmd: TutorCommand) {
    const [method,path] = endpoint(cmd);
    return this.api!.request<ActionResult>(method,path,{ ...cmd.body, accountId:this.owner });
  }
  private async flush(cache: Cache) {
    if (!this.api) return;
    while (cache.queue.length) {
      await this.send(cache.queue[0]);
      cache.queue.shift();
      this.save(cache);
    }
  }
  private async pull(cache: Cache) {
    const snap = await this.api!.request<TutorBook & { accountId:string }>('GET','/api/tutor/snapshot');
    if (snap.accountId !== this.owner) throw new TutorError('account-changed',409);
    cache.book = { students:snap.students,lessons:snap.lessons,payments:snap.payments };
    this.save(cache);
  }
  refresh(): Promise<void> {
    return this.lock(async () => {
      const cache = this.read();
      this.publish(cache);
      if (!this.api) return;
      try { await this.flush(cache); await this.pull(cache); }
      catch (e) { if (!offline(e)) throw e; }
    });
  }
  act(action: TutorAction, target = '', fields: Record<string,unknown> = {}): Promise<ActionResult> {
    return this.lock(async () => {
      const cache = this.read();
      const cmd = makeCommand(action,target,fields);
      if (action === 'move' && fields.scope === 'following') {
        const original = cache.book.lessons.find(l => l.id === target);
        cmd.body.followingIds = Object.fromEntries(cache.book.lessons.filter(l => original && l.student_id === original.student_id &&
          l.schedule_slot_id === original.schedule_slot_id && l.start_at >= original.start_at && l.status === 'scheduled').map(l => [l.id,uid()]));
      }
      if (this.api) {
        try {
          await this.flush(cache);
          // Квитанция позволяет безопасно повторить запрос после потери ответа.
          cache.queue.push(cmd);
          this.save(cache);
          let reply: ActionResult;
          try { reply = await this.send(cmd); }
          catch (e) {
            cache.queue.pop();
            this.save(cache);
            throw e;
          }
          try { await this.pull(cache); }
          catch (e) {
            if (!offline(e)) throw e;
            // После подтверждения сервером обновление снимка повторится при появлении связи.
            await applyLocal(cache.book,cmd,this.boards).catch(() => {});
          }
          cache.queue.shift();
          this.save(cache);
          return reply;
        } catch (e) { if (!offline(e)) throw e; }
      }
      const reply = await applyLocal(cache.book,cmd,this.boards);
      cache.queue.push(cmd);
      this.save(cache);
      return reply;
    });
  }
  async progress(id: string) {
    if (this.api) {
      try { return await this.api.request<ReturnType<typeof progressOf>>('GET','/api/tutor/students/' + encodeURIComponent(id) + '/progress'); }
      catch (e) { if (!offline(e)) throw e; }
    }
    const s = this.book.students.find(s => s.id === id);
    const p = s?.project_id ? await this.boards.load(s.project_id) : null;
    return p ? progressOf(p) : { total:0,solved:0,difficult:[] };
  }
  async projects(): Promise<ProjectMeta[]> {
    if (this.api) {
      try {
        const data = await this.api.request<{ projects:ProjectMeta[] }>('GET','/api/projects');
        return data.projects;
      } catch (e) { if (!offline(e)) throw e; }
    }
    return this.boards.list();
  }
  async invite(id: string, alias?: string) {
    if (!this.api) throw new TutorError('invite-needs-cloud');
    const path = '/api/tutor/students/' + encodeURIComponent(id) + '/invite';
    const get = () => this.api!.request<{url:string;projectId:string}>('POST',path,{ accountId:this.owner });
    let result = await get();
    if (alias) {
      await this.api.request('PUT','/api/projects/' + encodeURIComponent(result.projectId) + '/alias',{ alias });
      result = await get();
    }
    await this.refresh();
    return new URL(result.url,location.href).href;
  }
}
