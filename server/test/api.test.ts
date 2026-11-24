import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { BuiltApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { RateLimiter } from '../src/lib/ratelimit';
import { api, createTestApp, register, type Session } from './helpers';

let built: BuiltApp;
let A: ReturnType<typeof api>;

beforeAll(async () => {
  built = await createTestApp();
  A = api(built);
});

afterAll(async () => {
  await built.close();
});

describe('passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('geheim123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('geheim123', h)).toBe(true);
    expect(await verifyPassword('falsch', h)).toBe(false);
  });

  it('verifies legacy PHP bcrypt ($2y$) hashes', async () => {
    // password_hash('test1234', PASSWORD_BCRYPT) from PHP
    const legacy = '$2y$10$CwTycUXWue0Thq9StjUM0uJ8Z1Q1Vn5Z8Zr8Z1Y0kqyP1pFzqkK1S';
    // That constant is not a real hash of test1234; generate one with bcryptjs to simulate.
    const bcrypt = await import('bcryptjs');
    const real = (await bcrypt.default.hash('test1234', 10)).replace(/^\$2a\$/, '$2y$');
    expect(await verifyPassword('test1234', real)).toBe(true);
    expect(await verifyPassword('nope', real)).toBe(false);
    expect(await verifyPassword('test1234', legacy)).toBe(false);
  });
});

describe('auth', () => {
  let alice: Session;

  it('registers the first user as owner and sets a session cookie', async () => {
    alice = await register(built, 'alice');
    expect(alice.user.username).toBe('alice');
    expect(alice.user.role).toBe(3);
    const me = await A.get('/api/auth/me', alice.cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(alice.user.id);
    expect(me.body.config.version).toBeTruthy();
  });

  it('rejects duplicate (case-insensitive) usernames and weak passwords', async () => {
    const dup = await A.post('/api/auth/register', { username: 'ALICE', password: 'password123' });
    expect(dup.status).toBe(409);
    const weak = await A.post('/api/auth/register', { username: 'bob2', password: 'short' });
    expect(weak.status).toBe(400);
    const badName = await A.post('/api/auth/register', { username: 'x y', password: 'password123' });
    expect(badName.status).toBe(400);
  });

  it('logs in and out', async () => {
    const bad = await A.post('/api/auth/login', { username: 'alice', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const ok = await A.post('/api/auth/login', { username: 'Alice', password: 'password123' });
    expect(ok.status).toBe(200);
    const cookie = ok.raw.cookies.find((c) => c.name === 'gc_session')!;
    expect(cookie.httpOnly).toBe(true);
    const sess = `${cookie.name}=${cookie.value}`;
    const out = await A.post('/api/auth/logout', {}, sess);
    expect(out.status).toBe(200);
    const me = await A.get('/api/auth/me', sess);
    expect(me.status).toBe(401);
  });

  it('locks an account after repeated failures without a successful login clearing the IP budget', async () => {
    built.ctx.limits.login = new RateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect((await A.post('/api/auth/login', { username: 'alice', password: 'wrong' })).status).toBe(401);
    }
    expect((await A.post('/api/auth/login', { username: 'alice', password: 'password123' })).status).toBe(429);
    // Parallel attempts cannot slip past the limit either (counted before the password check).
    built.ctx.limits.login = new RateLimiter(2, 60_000);
    const parallel = await Promise.all([1, 2, 3, 4].map(() => A.post('/api/auth/login', { username: 'alice', password: 'wrong' })));
    expect(parallel.filter((r) => r.status === 429).length).toBe(2);
    built.ctx.limits.login = new RateLimiter(10_000, 60_000);
  });

  it('blocks mutating requests without the CSRF header', async () => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'password123' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires auth for protected routes', async () => {
    const res = await A.get('/api/contacts');
    expect(res.status).toBe(401);
  });
});

describe('direct messages, read receipts, scores', () => {
  let alice: Session;
  let bob: Session;
  let convId: number;
  let msgId: number;

  beforeAll(async () => {
    alice = await register(built, 'dm_alice');
    bob = await register(built, 'dm_bob');
  });

  it('opens a dm conversation lazily', async () => {
    const r = await A.get(`/api/conversations/with/${bob.user.id}`, alice.cookie);
    expect(r.status).toBe(200);
    convId = r.body.conversation.id;
    expect(r.body.conversation.kind).toBe('dm');
    expect(r.body.conversation.name).toBe('dm_bob');
    const again = await A.get(`/api/conversations/with/${alice.user.id}`, bob.cookie);
    expect(again.body.conversation.id).toBe(convId);
  });

  it('sends a message, both scores increase, receiver sees unread', async () => {
    const r = await A.post(`/api/conversations/${convId}/messages`, { kind: 'text', body: 'Hallo Bob!', clientId: 'c1' }, alice.cookie);
    expect(r.status).toBe(201);
    msgId = r.body.message.id;
    expect(r.body.clientId).toBe('c1');

    const list = await A.get(`/api/conversations/${convId}/messages`, bob.cookie);
    expect(list.status).toBe(200);
    expect(list.body.messages).toHaveLength(1);
    expect(list.body.messages[0].body).toBe('Hallo Bob!');

    const contacts = await A.get('/api/contacts', bob.cookie);
    const fromAlice = contacts.body.contacts.find((c: any) => c.kind === 'user' && c.id === alice.user.id);
    expect(fromAlice.unread).toBe(1);
    expect(fromAlice.lastMessagePreview).toBe('Hallo Bob!');
    expect(fromAlice.gigascore).toBe(1);

    const meBob = await A.get('/api/auth/me', bob.cookie);
    expect(meBob.body.user.gigascore).toBe(1);
  });

  it('marks as read and exposes the cursor to the sender', async () => {
    const r = await A.post(`/api/conversations/${convId}/read`, { lastReadMessageId: msgId }, bob.cookie);
    expect(r.status).toBe(200);
    const detail = await A.get(`/api/conversations/${convId}`, alice.cookie);
    const bobMember = detail.body.conversation.members.find((m: any) => m.userId === bob.user.id);
    expect(bobMember.lastReadMessageId).toBe(msgId);
    const contacts = await A.get('/api/contacts', bob.cookie);
    const fromAlice = contacts.body.contacts.find((c: any) => c.kind === 'user' && c.id === alice.user.id);
    expect(fromAlice.unread).toBe(0);
  });

  it('edits and deletes only own messages', async () => {
    const forbidden = await A.patch(`/api/messages/${msgId}`, { body: 'hacked' }, bob.cookie);
    expect(forbidden.status).toBe(403);
    const edited = await A.patch(`/api/messages/${msgId}`, { body: 'Hallo Bob! (edit)' }, alice.cookie);
    expect(edited.status).toBe(200);
    expect(edited.body.message.editedAt).toBeTruthy();
    const del = await A.del(`/api/messages/${msgId}`, {}, alice.cookie);
    expect(del.status).toBe(200);
    expect(del.body.message.deletedAt).toBeTruthy();
    expect(del.body.message.body).toBe('');
  });

  it('paginates older messages', async () => {
    for (let i = 0; i < 30; i++) {
      await A.post(`/api/conversations/${convId}/messages`, { kind: 'text', body: `msg ${i}` }, alice.cookie);
    }
    const page1 = await A.get(`/api/conversations/${convId}/messages?limit=10`, bob.cookie);
    expect(page1.body.messages).toHaveLength(10);
    expect(page1.body.hasMore).toBe(true);
    const oldest = page1.body.messages[0].id;
    const page2 = await A.get(`/api/conversations/${convId}/messages?limit=10&before=${oldest}`, bob.cookie);
    expect(page2.body.messages).toHaveLength(10);
    expect(page2.body.messages.at(-1).id).toBeLessThan(oldest);
  });

  it('accepts giphy gifs only', async () => {
    const ok = await A.post(`/api/conversations/${convId}/messages`, { kind: 'gif', gifUrl: 'https://media2.giphy.com/media/abc/giphy.gif' }, alice.cookie);
    expect(ok.status).toBe(201);
    expect(ok.body.message.kind).toBe('gif');
    const bad = await A.post(`/api/conversations/${convId}/messages`, { kind: 'gif', gifUrl: 'https://evil.example/x.gif' }, alice.cookie);
    expect(bad.status).toBe(400);
  });

  it('supports alias / pin / archive on contacts', async () => {
    const r = await A.patch(`/api/contacts/${bob.user.id}`, { alias: 'Bobby', pinned: true }, alice.cookie);
    expect(r.status).toBe(200);
    const contacts = await A.get('/api/contacts', alice.cookie);
    const c = contacts.body.contacts.find((c: any) => c.kind === 'user' && c.id === bob.user.id);
    expect(c.name).toBe('Bobby');
    expect(c.pinned).toBe(true);
    expect(contacts.body.contacts[0].id).toBe(bob.user.id);
  });
});

describe('groups', () => {
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let groupId: number;

  beforeAll(async () => {
    alice = await register(built, 'g_alice');
    bob = await register(built, 'g_bob');
    carol = await register(built, 'g_carol');
  });

  it('creates a group with members and a system message', async () => {
    const r = await A.post('/api/groups', { name: 'Klasse 10b', memberIds: [bob.user.id] }, alice.cookie);
    expect(r.status).toBe(201);
    groupId = r.body.conversation.id;
    expect(r.body.conversation.members.map((m: any) => m.username).sort()).toEqual(['g_alice', 'g_bob']);
    const msgs = await A.get(`/api/conversations/${groupId}/messages`, bob.cookie);
    expect(msgs.body.messages[0].kind).toBe('system');
  });

  it('rejects non-members and lets the creator add/remove members', async () => {
    const forbidden = await A.post(`/api/conversations/${groupId}/messages`, { kind: 'text', body: 'hi' }, carol.cookie);
    expect(forbidden.status).toBe(403);
    const notOwner = await A.post(`/api/groups/${groupId}/members`, { userId: carol.user.id }, bob.cookie);
    expect(notOwner.status).toBe(403);
    const added = await A.post(`/api/groups/${groupId}/members`, { userId: carol.user.id }, alice.cookie);
    expect(added.status).toBe(200);
    expect(added.body.conversation.members).toHaveLength(3);
    const sent = await A.post(`/api/conversations/${groupId}/messages`, { kind: 'text', body: 'Hallo Gruppe' }, carol.cookie);
    expect(sent.status).toBe(201);
  });

  it('gives every member +1 score per group message', async () => {
    const me = await A.get('/api/auth/me', bob.cookie);
    expect(me.body.user.gigascore).toBe(1);
    const detail = await A.get(`/api/conversations/${groupId}`, alice.cookie);
    expect(detail.body.conversation.score).toBe(1);
  });

  it('shows the group with unread count in contacts', async () => {
    const contacts = await A.get('/api/contacts', bob.cookie);
    const g = contacts.body.contacts.find((c: any) => c.kind === 'group' && c.id === groupId);
    expect(g.unread).toBe(1);
    expect(g.memberCount).toBe(3);
    expect(g.name).toBe('Klasse 10b');
  });

  it('removes a member and lets members leave (ownership transfers)', async () => {
    const removed = await A.del(`/api/groups/${groupId}/members/${carol.user.id}`, {}, alice.cookie);
    expect(removed.status).toBe(200);
    expect(removed.body.conversation.members).toHaveLength(2);
    const gone = await A.get(`/api/conversations/${groupId}`, carol.cookie);
    expect(gone.status).toBe(403);
    const leave = await A.post(`/api/groups/${groupId}/leave`, {}, alice.cookie);
    expect(leave.status).toBe(200);
    const detail = await A.get(`/api/conversations/${groupId}`, bob.cookie);
    expect(detail.body.conversation.createdBy).toBe(bob.user.id);
  });
});

describe('profile, notes, bugs, push', () => {
  let alice: Session;

  beforeAll(async () => {
    alice = await register(built, 'p_alice');
  });

  it('updates profile and theme', async () => {
    const r = await A.patch('/api/users/me', { color: '#ff0000', emoji: '🔥', theme: 'ocean', username: 'p_alice2' }, alice.cookie);
    expect(r.status).toBe(200);
    expect(r.body.user.theme).toBe('ocean');
    expect(r.body.user.username).toBe('p_alice2');
    const bad = await A.patch('/api/users/me', { theme: 'nope' }, alice.cookie);
    expect(bad.status).toBe(400);
  });

  it('changes password with current password', async () => {
    const wrong = await A.post('/api/users/me/password', { currentPassword: 'nope', newPassword: 'newpassword1' }, alice.cookie);
    expect(wrong.status).toBe(401);
    const ok = await A.post('/api/users/me/password', { currentPassword: 'password123', newPassword: 'newpassword1' }, alice.cookie);
    expect(ok.status).toBe(200);
    const login = await A.post('/api/auth/login', { username: 'p_alice2', password: 'newpassword1' });
    expect(login.status).toBe(200);
  });

  it('stores private notes', async () => {
    const put = await A.put('/api/notes', { content: 'merken: 42' }, alice.cookie);
    expect(put.status).toBe(200);
    const get = await A.get('/api/notes', alice.cookie);
    expect(get.body.content).toBe('merken: 42');
  });

  it('files a bug report', async () => {
    const r = await A.post('/api/bugs', { type: 'bug', title: 'Knopf kaputt', description: 'Der Knopf tut nichts', priority: 'high' }, alice.cookie);
    expect(r.status).toBe(201);
    const mine = await A.get('/api/bugs/mine', alice.cookie);
    expect(mine.body.reports).toHaveLength(1);
    const admin = await A.get('/api/bugs', alice.cookie);
    expect(admin.status).toBe(403);
  });

  it('manages push subscriptions', async () => {
    const sub = await A.post(
      '/api/push/subscribe',
      { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
      alice.cookie,
    );
    expect(sub.status).toBe(200);
    const status = await A.get('/api/push/status', alice.cookie);
    expect(status.body.subscriptions).toBe(1);
    const un = await A.post('/api/push/unsubscribe', { endpoint: 'https://push.example/abc' }, alice.cookie);
    expect(un.status).toBe(200);
    const status2 = await A.get('/api/push/status', alice.cookie);
    expect(status2.body.subscriptions).toBe(0);
  });

  it('deletes own account with password', async () => {
    const wrong = await A.del('/api/users/me', { password: 'nope' }, alice.cookie);
    expect(wrong.status).toBe(401);
    const ok = await A.del('/api/users/me', { password: 'newpassword1' }, alice.cookie);
    expect(ok.status).toBe(200);
    const me = await A.get('/api/auth/me', alice.cookie);
    expect(me.status).toBe(401);
  });
});

describe('admin & stats', () => {
  let owner: Session;
  let user: Session;

  beforeAll(async () => {
    const login = await A.post('/api/auth/login', { username: 'alice', password: 'password123' });
    const cookie = login.raw.cookies.find((c) => c.name === 'gc_session')!;
    owner = { cookie: `${cookie.name}=${cookie.value}`, user: login.body.user };
    user = await register(built, 'adm_user');
  });

  it('lists users for admins only', async () => {
    expect((await A.get('/api/admin/users', user.cookie)).status).toBe(403);
    const r = await A.get('/api/admin/users', owner.cookie);
    expect(r.status).toBe(200);
    expect(r.body.users.length).toBeGreaterThan(1);
    const detail = await A.get(`/api/admin/users/${user.user.id}`, owner.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.user.username).toBe('adm_user');
  });

  it('resets passwords, changes roles, deletes users', async () => {
    const reset = await A.post(`/api/admin/users/${user.user.id}/reset-password`, { newPassword: 'resetpass123' }, owner.cookie);
    expect(reset.status).toBe(200);
    const oldSession = await A.get('/api/auth/me', user.cookie);
    expect(oldSession.status).toBe(401);
    const login = await A.post('/api/auth/login', { username: 'adm_user', password: 'resetpass123' });
    expect(login.status).toBe(200);

    const role = await A.post(`/api/admin/users/${user.user.id}/role`, { role: 2 }, owner.cookie);
    expect(role.status).toBe(200);
    // The (now admin) user may not delete the owner …
    const adminLogin = await A.post('/api/auth/login', { username: 'adm_user', password: 'resetpass123' });
    const adminCookie = adminLogin.raw.cookies.find((c) => c.name === 'gc_session')!;
    const asAdmin = `${adminCookie.name}=${adminCookie.value}`;
    const noDelete = await A.post(`/api/admin/users/${owner.user.id}/delete`, {}, asAdmin);
    expect(noDelete.status).toBe(403);
    const noReset = await A.post(`/api/admin/users/${owner.user.id}/reset-password`, { newPassword: 'hijacked123' }, asAdmin);
    expect(noReset.status).toBe(403);
    const noRevoke = await A.post(`/api/admin/users/${owner.user.id}/revoke-sessions`, {}, asAdmin);
    expect(noRevoke.status).toBe(403);
    // … but the owner may delete the admin.
    const del = await A.post(`/api/admin/users/${user.user.id}/delete`, {}, owner.cookie);
    expect(del.status).toBe(200);
    expect((await A.get('/api/auth/me', user.cookie)).status).toBe(401);
  });

  it('records visits and returns stats', async () => {
    await A.post('/api/stats/visit', { page: 'app' }, owner.cookie);
    await A.post('/api/stats/visit', { page: 'app' }, owner.cookie);
    const r = await A.get('/api/stats', owner.cookie);
    expect(r.status).toBe(200);
    expect(r.body.viewsToday).toBeGreaterThanOrEqual(2);
    expect(r.body.uniqueToday).toBeGreaterThanOrEqual(1);
    expect(r.body.messagesTotal).toBeGreaterThan(0);
    expect(r.body.messagesPerDay).toHaveLength(31);
    expect(r.body.extended).not.toBeNull();
  });
});

describe('r/place', () => {
  let alice: Session;

  beforeAll(async () => {
    alice = await register(built, 'place_alice');
  });

  it('sets a pixel, enforces cooldown, serves the canvas', async () => {
    const ok = await A.post('/api/place/pixel', { x: 3, y: 4, color: '#ff0000' }, alice.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.pixelsSet).toBe(1);
    const again = await A.post('/api/place/pixel', { x: 3, y: 5, color: '#00ff00' }, alice.cookie);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('cooldown');
    const canvas = await built.app.inject({ method: 'GET', url: '/api/place/canvas', headers: { cookie: alice.cookie } });
    expect(canvas.statusCode).toBe(200);
    const buf = canvas.rawPayload;
    expect(buf.length).toBe(200 * 200 * 3);
    const i = (4 * 200 + 3) * 3;
    expect([buf[i], buf[i + 1], buf[i + 2]]).toEqual([255, 0, 0]);
    const lb = await A.get('/api/place/leaderboard', alice.cookie);
    expect(lb.body.leaderboard[0].username).toBe('place_alice');
  });
});

describe('websocket realtime', () => {
  it('delivers message.new, read and presence events', async () => {
    const alice = await register(built, 'ws_alice');
    const bob = await register(built, 'ws_bob');
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    const address = built.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const events: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: bob.cookie } });
    ws.on('message', (data) => events.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no hello within 3s')), 3000);
      ws.on('message', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on('close', (code, reason) => reject(new Error(`socket closed early: ${code} ${reason.toString()}`)));
      ws.on('error', reject);
    });

    const conv = await A.get(`/api/conversations/with/${bob.user.id}`, alice.cookie);
    const convId = conv.body.conversation.id;
    await A.post(`/api/conversations/${convId}/messages`, { kind: 'text', body: 'ping über ws' }, alice.cookie);
    await A.post(`/api/conversations/${convId}/read`, { lastReadMessageId: 1 }, alice.cookie);

    await new Promise((r) => setTimeout(r, 300));
    const hello = events.find((e) => e.t === 'hello');
    expect(hello?.userId).toBe(bob.user.id);
    const msg = events.find((e) => e.t === 'message.new');
    expect(msg?.message.body).toBe('ping über ws');
    expect(msg?.conversationId).toBe(convId);
    expect(events.some((e) => e.t === 'score')).toBe(true);

    // unauthenticated sockets are rejected
    const anon = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => anon.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(built.ctx.hub.isOnline(bob.user.id)).toBe(false);
  });
});
