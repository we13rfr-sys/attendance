// Посещаемость: студенческая веб-версия. Секретов и пользовательских данных здесь нет.

// protocol
function ensure(value, message = 'Повреждены данные подключения') { if (!value) throw new Error(message); }
const utf8 = new TextEncoder();
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const uid = () => crypto.randomUUID();
function b64(bytes, url = false) {
  let value = ''; for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte);
  value = btoa(value); return url ? value.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : value;
}
function unb64(value) {
  ensure(typeof value === 'string' && value.length <= 6_000_000 && /^[A-Za-z0-9+/_=-]*$/.test(value));
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
async function hash(value) { return b64(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? utf8.encode(value) : value)); }
const peerKey = () => b64(crypto.getRandomValues(new Uint8Array(32)), true);
async function sealPeer(key, bytes) {
  const raw = unb64(key); ensure(raw.length === 32);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, bytes));
  const result = new Uint8Array(iv.length + body.length); result.set(iv); result.set(body, iv.length); return result;
}
async function openPeer(key, bytes) {
  bytes = new Uint8Array(bytes); ensure(bytes.length >= 29 && bytes.length <= 4_000_000);
  const raw = unb64(key); ensure(raw.length === 32);
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), tagLength: 128 }, aes, bytes.slice(12)));
}
function publicUrl(value) {
  const u = new URL(value); ensure(u.protocol === 'https:' && ['disk.yandex.ru', 'disk.yandex.com', 'yadi.sk'].includes(u.hostname) && !u.username && !u.password && !u.hash && (!u.port || u.port === '443') && /^\/[di]\/[A-Za-z0-9_-]+\/?$/.test(u.pathname), 'Нужна ссылка приглашения из приложения преподавателя'); return u.href;
}
function transferUrl(value) {
  const u = new URL(value); ensure(u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443') && (u.hostname.endsWith('.disk.yandex.net') || u.hostname === 'downloader.disk.yandex.ru'), 'Яндекс вернул небезопасный адрес файла'); return u.href;
}
const id = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value);
function studentName(value) {
  ensure(typeof value === 'string' && !/[\x00-\x1f\x7f-\x9f]/.test(value), 'ФИО должно быть в одной строке');
  value = value.trim().replace(/\s+/g, ' '); ensure(value.length > 0 && value.length <= 200, 'Введите ФИО: от 1 до 200 символов'); return value;
}
function validateInvitation(group, now = Date.now()) {
  ensure(group && [1, 2].includes(group.version ?? 1) && id(group.id) && typeof group.bookId === 'string' && group.bookId && typeof group.name === 'string' && group.name.length <= 500);
  ensure(Number.isSafeInteger(group.expires) && group.expires > now && group.expires <= now + 1_800_000, 'Приглашение истекло. Попросите новое');
  publicUrl(group.responseUrl); ensure(unb64(group.publicKey).length >= 256);
  ensure(Array.isArray(group.students) && group.students.length <= 500 && (!group.registrations || (group.version === 2 && Array.isArray(group.registrations) && group.registrations.length <= 50)));
  const rows = [...group.students, ...(group.registrations ?? [])]; ensure(new Set(rows.map(r => r.id)).size === rows.length);
  for (const row of rows) { ensure(id(row.id) && typeof row.name === 'string' && row.name.length <= 200); const u = new URL(transferUrl(row.uploadUrl)); ensure(u.hostname.endsWith('.disk.yandex.net')); }
  ensure(group.students.every(r => r.name.trim())); return group;
}
async function sealEnrollment(group, profile, rowId, newName) {
  const key = peerKey();
  const rsa = await crypto.subtle.importKey('spki', unb64(group.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  ensure(rsa.algorithm.modulusLength === 2048);
  const enrollment = { invitationId: group.id, studentId: rowId, invite: { peerId: profile.peerId, label: profile.label, key: profile.key, requestUrl: profile.requestUrl, name: newName ?? profile.name } };
  if (newName !== undefined) enrollment.newName = studentName(newName);
  return JSON.stringify({ key: b64(await crypto.subtle.encrypt('RSA-OAEP', rsa, utf8.encode(key))), body: b64(await sealPeer(key, utf8.encode(JSON.stringify(enrollment)))) });
}
function decodeReply(code) {
  ensure(typeof code === 'string' && code.length >= 10 && code.length <= 20_000 && code.includes('.'));
  return unb64(code.slice(code.indexOf('.') + 1));
}
function addDays(start, days) {
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(start)); const d = new Date(start + 'T12:00:00Z'); ensure(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === start);
  d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function weekDates(sheet, week) { return Array.from({ length: 6 }, (_, day) => addDays(sheet.start, week * 7 + day)); }
function validateView(v, profile) {
  ensure(v && v.bookId === profile.bookId && v.studentId === profile.studentId && typeof v.name === 'string' && v.name.trim() && v.name.length <= 200 && typeof v.bookName === 'string' && v.bookName.length <= 500 && v.protocol >= 2 && Number.isSafeInteger(v.balance));
  ensure(Array.isArray(v.categories) && v.categories.length <= 100 && new Set(v.categories.map(c => c.id)).size === v.categories.length);
  for (const c of v.categories) ensure(typeof c.id === 'string' && c.id.length <= 80 && typeof c.name === 'string' && c.name.length <= 200 && /^[A-Fa-f0-9]{6}$/.test(c.color) && ['CREDIT', 'DEDUCT', 'BONUS'].includes(c.effect));
  ensure(Array.isArray(v.sheets) && v.sheets.length <= 100 && new Set(v.sheets.map(s => s.id)).size === v.sheets.length && v.receipts && typeof v.receipts === 'object');
  for (const s of v.sheets) {
    ensure(typeof s.id === 'string' && typeof s.name === 'string' && Number.isInteger(s.weeks) && s.weeks >= 1 && s.weeks <= 52 && s.norms?.length === s.weeks && s.norms.every(n => Number.isInteger(n) && n >= 0 && n <= 1_000_000));
    addDays(s.start, 0); ensure(new Date(s.start + 'T12:00:00Z').getUTCDay() === 1 && s.marks && typeof s.marks === 'object');
    ensure(!s.closedWeeks || (Array.isArray(s.closedWeeks) && s.closedWeeks.every(w => Number.isInteger(w) && w >= 0 && w < s.weeks)));
    const dates = new Set(Array.from({ length: s.weeks }, (_, w) => weekDates(s, w)).flat());
    for (const [date, m] of Object.entries(s.marks)) ensure(dates.has(date) && Number.isInteger(m.amount) && m.amount >= 1 && m.amount <= 1_000_000 && v.categories.some(c => c.id === m.categoryId));
  }
  return v;
}
function earnings(v) { return v.sheets.reduce((sum, s) => sum + Array.from({ length: s.weeks }, (_, w) => Math.max(0, weekDates(s, w).reduce((n, d) => { const m = s.marks[d], c = v.categories.find(c => c.id === m?.categoryId); return n + (c?.effect === 'CREDIT' ? m.amount : c?.effect === 'DEDUCT' ? -m.amount : 0); }, 0) - s.norms[w])).reduce((a, b) => a + b, 0), 0); }
function spent(v) { return v.sheets.reduce((n, s) => n + Object.values(s.marks).reduce((n, m) => n + (m.approved && v.categories.find(c => c.id === m.categoryId)?.effect === 'BONUS' ? m.amount : 0), 0), 0); }
function recalc(v) {
  for (const s of v.sheets) s.totals = Array.from({ length: s.weeks }, (_, w) => Math.min(s.norms[w], weekDates(s, w).reduce((n, d) => { const m = s.marks[d], c = v.categories.find(c => c.id === m?.categoryId); return n + (c?.effect === 'CREDIT' ? m.amount : c?.effect === 'DEDUCT' ? -m.amount : c?.effect === 'BONUS' && m.approved ? m.amount : 0); }, 0)));
  return v;
}
function applyRequest(v, r) {
  ensure(id(r.id));
  if (r.newName !== undefined) { ensure(v.protocol >= 3 && r.sheetId === '' && r.date === '' && r.amount === 0 && r.categoryId === undefined); v.name = studentName(r.newName); return; }
  const s = v.sheets.find(s => s.id === r.sheetId); ensure(s, 'Лист удалён');
  const week = Array.from({ length: s.weeks }, (_, w) => w).find(w => weekDates(s, w).includes(r.date));
  ensure(week !== undefined, 'Дата за пределами листа'); ensure(!s.closedWeeks?.includes(week), 'Неделя закрыта преподавателем');
  ensure(Number.isInteger(r.amount) && r.amount >= 0 && r.amount <= 1_000_000, 'Количество от 0 до 1000000');
  const c = v.categories.find(c => c.id === r.categoryId), old = s.marks[r.date]; ensure(c, 'Категория удалена');
  ensure(r.amount === 0 || !c.deleted || old?.categoryId === c.id, 'Категория удалена преподавателем');
  if (old?.amount === r.amount && old?.categoryId === c.id && (c.effect !== 'BONUS' || old.approved)) return;
  const base = v.balance - earnings(v) + spent(v), original = structuredClone(old);
  if (r.amount === 0) delete s.marks[r.date]; else s.marks[r.date] = { amount: r.amount, categoryId: c.id, approved: c.effect === 'BONUS' };
  const nextBalance = base + earnings(v) - spent(v);
  if (r.amount > 0 && c.effect === 'BONUS' && nextBalance < 0) { if (original) s.marks[r.date] = original; else delete s.marks[r.date]; throw new Error('Недостаточно бонусов для этой отметки'); }
  v.balance = nextBalance; recalc(v);
}
function pendingView(profile) {
  if (!profile?.view) return null; const v = structuredClone(profile.view);
  for (const r of profile.feed.requests) if (!(r.id in v.receipts)) { try { applyRequest(v, r); } catch { /* Teacher receipts carry the final rejection reason. */ } }
  return recalc(v);
}


// vault
const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
class Vault {
  async open() {
    ensure(globalThis.indexedDB && crypto.subtle, 'Откройте приложение в обновлённом Safari по HTTPS');
    const r = indexedDB.open('attendance-student', 1); r.onupgradeneeded = () => r.result.createObjectStore('vault');
    this.db = await request(r);
    this.key = await this.get('key');
    if (!this.key) { this.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await this.put('key', this.key); }
    return this;
  }
  async get(key) { return request(this.db.transaction('vault').objectStore('vault').get(key)); }
  async put(key, value) {
    await new Promise((resolve, reject) => { const tx = this.db.transaction('vault', 'readwrite'); tx.objectStore('vault').put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Не удалось сохранить данные на устройстве')); });
  }
  async load() {
    const record = await this.get('state'); if (!record) return { token: null, active: null, saved: [] };
    try { return JSON.parse(text(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, this.key, record.body))); }
    catch { throw new Error('Не удалось прочитать сохранённое подключение. Не очищайте данные Safari до отправки отметок'); }
  }
  async save(state) { const iv = crypto.getRandomValues(new Uint8Array(12)); await this.put('state', { iv, body: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, utf8.encode(JSON.stringify(state))) }); }
}


// disk
class DiskError extends Error { constructor(status, message, retry = 0) { super(message); this.status = status; this.retry = retry; } }
class Disk {
  constructor(token) { this.token = token; this.cache = new Map(); this.pauses = new Map(); }
  async fetch(url, options = {}, max = 4_000_000) {
    let response;
    try { response = await fetch(url, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('Не удалось связаться с Яндексом. Изменения сохранены на устройстве'); }
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'));
      throw new DiskError(response.status, ({ 401: 'Истёк вход в Яндекс. Войдите снова', 403: 'Нет доступа к файлу', 404: 'Файл на Диске не найден', 409: 'Место уже занято', 410: 'Ссылка отправки истекла. Попросите новое приглашение', 423: 'Яндекс временно заблокировал запись. Изменения сохранены', 429: 'Яндекс временно ограничил запросы. Повторим позже', 507: 'На Диске закончилось место' })[response.status] ?? 'Яндекс не выполнил запрос', [423, 429].includes(response.status) ? Math.max(60, Math.min(retry || 60, 86400)) * 1000 : 0);
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(); let length = 0; const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new Error('Файл обмена слишком большой'); } chunks.push(value); }
    const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
  }
  async api(endpoint, params = {}, method = 'GET', body) {
    const url = new URL('https://cloud-api.yandex.net/v1/disk/' + endpoint); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const headers = { Authorization: 'OAuth ' + this.token }; if (body !== undefined) headers['Content-Type'] = 'application/json';
    const bytes = await this.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  }
  async download(path) { const ticket = await this.api('resources/download', { path }); return this.fetch(transferUrl(ticket.href)); }
  async upload(path, bytes, overwrite) {
    const pause = this.pauses.get(path) ?? 0; if (pause > Date.now()) throw new DiskError(423, 'Отправка ожидает снятия ограничения Яндекса', pause - Date.now());
    try { const ticket = await this.api('resources/upload', { path, overwrite }); await this.send(ticket.href, bytes); }
    catch (e) { if (e.retry) this.pauses.set(path, Date.now() + e.retry); throw e; }
  }
  async send(url, bytes) { transferUrl(url); ensure(bytes.length <= 4_000_000); return this.fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }); }
  async folder(path) { try { await this.api('resources', { path }, 'PUT'); } catch (e) { if (e.status !== 409) throw e; const resource = await this.api('resources', { path, fields: 'type' }); ensure(resource.type === 'dir'); } }
  async publish(path) {
    await this.api('resources/publish', { path, allow_address_access: true }, 'PUT', { public_settings: { accesses: [{ type: 'macro', macros: ['all'], rights: ['read'] }] } });
    return publicUrl((await this.api('resources', { path, fields: 'public_url' })).public_url);
  }
  async publicFile(url) {
    publicUrl(url); const pause = this.pauses.get(url) ?? 0; if (pause > Date.now()) throw new DiskError(429, 'Яндекс ограничил чтение. Повторим автоматически', pause - Date.now());
    try {
      const meta = await this.api('public/resources', { public_key: url, fields: 'md5,size' }); ensure(meta.size <= 4_000_000);
      if (meta.md5 && this.cache.get(url)?.md5 === meta.md5) return this.cache.get(url).bytes;
      const ticket = await this.api('public/resources/download', { public_key: url }); const bytes = await this.fetch(transferUrl(ticket.href));
      // The file is authenticated by AES-GCM on receipt; MD5 is only a revision hint.
      if (meta.md5) { if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value); this.cache.set(url, { md5: meta.md5, bytes }); }
      return bytes;
    } catch (e) { if (e.retry) this.pauses.set(url, Date.now() + e.retry); throw e; }
  }
  async verifyUpload(path, bytes) { ensure(await hash(await this.download(path)) === await hash(bytes), 'Не удалось подтвердить отправку. Повторим при открытии приложения'); }
}


// exchange
class Exchange {
  constructor(vault, state) { this.vault = vault; this.state = state; this.disk = new Disk(state.token); }
  async save() { await this.vault.save(this.state); }
  async requireLogin() {
    const p = this.state.active;
    if (p) this.state.saved = [p, ...this.state.saved.filter(old => old.peerId !== p.peerId)];
    this.state.active = null; this.state.token = null; await this.save(); this.disk = new Disk(null);
  }
  async restore() {
    if (this.state.active || !this.state.token) return;
    for (const profile of this.state.saved) {
      let bytes; try { bytes = await this.disk.download(profile.requestPath); } catch (e) { if (e.status === 404) continue; throw e; }
      ensure(JSON.parse(text(await openPeer(profile.key, bytes))).peerId === profile.peerId);
      this.state.active = profile; this.state.saved = this.state.saved.filter(p => p.peerId !== profile.peerId); await this.save(); return;
    }
  }
  async invitation(url) { return validateInvitation(JSON.parse(text(await this.disk.publicFile(publicUrl(url.trim()))))); }
  async create(name) {
    await this.restore(); if (this.state.active) return this.state.active;
    name = studentName(name); await this.disk.folder('disk:/Посещаемость-обмен');
    const peerId = uid(), initials = name.split(' ').slice(0, 3).map(p => [...p][0].toLocaleUpperCase('ru')).join('');
    const p = { peerId, label: initials + '-' + String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0'), key: peerKey(), requestPath: `disk:/Посещаемость-обмен/ученик-${peerId}.json`, requestUrl: '', feed: { peerId, requests: [] }, feedHash: '', name };
    // Save before remote work so a failed publication retries the same private file.
    this.state.active = p; await this.save(); await this.prepare(p); return p;
  }
  async prepare(p) {
    if (p.requestUrl) return; const bytes = utf8.encode(JSON.stringify(p.feed));
    try { await this.disk.upload(p.requestPath, await sealPeer(p.key, bytes), false); } catch (e) { if (e.status !== 409) throw e; const feed = JSON.parse(text(await openPeer(p.key, await this.disk.download(p.requestPath)))); ensure(feed.peerId === p.peerId && feed.requests.length === 0); }
    p.requestUrl = await this.disk.publish(p.requestPath); p.feedHash = await hash(bytes); await this.save();
  }
  async join(group, rowId, name) {
    validateInvitation(group); if (name !== undefined) { name = studentName(name); const existing = group.students.find(r => r.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru')); if (existing) return this.join(group, existing.id); }
    const row = name === undefined ? group.students.find(r => r.id === rowId) : group.registrations?.[crypto.getRandomValues(new Uint32Array(1))[0] % group.registrations.length]; ensure(row, 'Попросите новое приглашение');
    const p = await this.create(name ?? row.name); ensure(!p.viewUrl, 'Вы уже подключены к журналу'); await this.prepare(p);
    ensure(!p.enrollment?.sent, 'Заявка уже отправлена. Дождитесь подключения');
    p.enrollment = { invitation: group, studentId: row.id, encrypted: await sealEnrollment(group, p, row.id, name), sent: false }; if (name !== undefined) p.enrollment.newName = name;
    await this.save(); await this.sync();
  }
  async accept(code) {
    const p = this.state.active, reply = JSON.parse(text(await openPeer(p.key, decodeReply(code))));
    ensure(reply.peerId === p.peerId && typeof reply.bookId === 'string' && reply.bookId && typeof reply.studentId === 'string' && reply.studentId); publicUrl(reply.viewUrl);
    p.bookId = reply.bookId; p.studentId = reply.studentId; p.viewUrl = reply.viewUrl;
    if (p.enrollment) p.feed.enrollmentId = p.enrollment.invitation.id;
    delete p.enrollment; await this.save();
  }
  async sync() {
    const p = this.state.active; if (!p || !this.state.token) return;
    if (p.enrollment) {
      const pending = p.enrollment, group = pending.invitation; let responses = {};
      try { responses = JSON.parse(text(await this.disk.publicFile(group.responseUrl))); }
      catch (e) { if (pending.sent || ![404, 429].includes(e.status)) throw e; }
      if (responses[pending.studentId]) {
        let reply; try { reply = JSON.parse(text(await openPeer(p.key, unb64(responses[pending.studentId])))); } catch { if (!pending.newName || pending.sent) throw new Error('Строка уже выбрана на другом устройстве'); }
        if (reply) { ensure(!reply.error, reply.error); ensure(reply.reply); await this.accept(reply.reply); }
      }
      if (p.enrollment && !pending.sent) {
        ensure(Date.now() < group.expires, 'Приглашение истекло. Попросите новое');
        const rows = pending.newName ? group.registrations.filter(r => !(r.id in responses)).sort((a, b) => Number(b.id === pending.studentId) - Number(a.id === pending.studentId)) : group.students.filter(r => r.id === pending.studentId);
        for (const row of rows) {
          if (row.id !== pending.studentId) { pending.studentId = row.id; pending.encrypted = await sealEnrollment(group, p, row.id, pending.newName); await this.save(); }
          try { await this.disk.send(row.uploadUrl, utf8.encode(pending.encrypted)); } catch (e) { if (e.status !== 409) throw e; if (pending.newName) continue; }
          pending.sent = true; await this.save(); break;
        }
        ensure(pending.sent, 'Места в приглашении закончились. Попросите новое');
      }
    }
    const bytes = utf8.encode(JSON.stringify(p.feed)), revision = await hash(bytes);
    if (revision !== p.feedHash) { const sealed = await sealPeer(p.key, bytes); await this.disk.upload(p.requestPath, sealed, true); await this.disk.verifyUpload(p.requestPath, sealed); p.feedHash = revision; await this.save(); }
    if (p.viewUrl) { const v = JSON.parse(text(await openPeer(p.key, await this.disk.publicFile(p.viewUrl)))); p.view = validateView(v, p); await this.save(); }
  }
  async enqueue(request) {
    const p = this.state.active; ensure(p?.view, 'Дождитесь подключения'); ensure(p.feed.requests.length < 2000, 'Достигнут лимит запросов. Обратитесь к преподавателю');
    const r = { id: uid(), ...request }; applyRequest(pendingView(p), r); p.feed.requests.push(r); await this.save();
  }
  async logout() {
    const p = this.state.active; if (p && await hash(JSON.stringify(p.feed)) !== p.feedHash) await this.sync();
    ensure(!p || await hash(JSON.stringify(p.feed)) === p.feedHash, 'Дождитесь отправки изменений перед выходом');
    delete this.state.oauth; await this.requireLogin();
  }
}


// auth
const CLIENT_ID = 'dbe63b42d3e04065a8db0bb45f5720fd';
const redirectUri = () => new URL('./', location.href).href;
async function startLogin(exchange) {
  const verifier = b64(crypto.getRandomValues(new Uint8Array(48)), true), state = b64(crypto.getRandomValues(new Uint8Array(24)), true);
  exchange.state.oauth = { verifier, state, expires: Date.now() + 600_000, redirect: redirectUri() }; await exchange.save();
  const url = new URL('https://oauth.yandex.ru/authorize');
  Object.entries({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri(), force_confirm: 'yes', state, code_challenge: b64(await crypto.subtle.digest('SHA-256', utf8.encode(verifier)), true), code_challenge_method: 'S256' }).forEach(([k, v]) => url.searchParams.set(k, v));
  location.assign(url);
}
async function finishLogin(exchange) {
  const params = new URL(location.href).searchParams; if (!params.has('code') && !params.has('error')) return false;
  const code = params.get('code'), state = params.get('state'), error = params.get('error'), pending = exchange.state.oauth;
  history.replaceState(null, '', redirectUri());
  delete exchange.state.oauth; await exchange.save();
  ensure(pending && pending.state === state && pending.expires > Date.now() && pending.redirect === redirectUri(), 'Вход не подтверждён. Повторите вход в Яндекс');
  if (error === 'access_denied') return false;
  ensure(!error && code, 'Яндекс не завершил вход. Повторите попытку');
  let response;
  try { response = await fetch('https://oauth.yandex.ru/token', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, code_verifier: pending.verifier, redirect_uri: pending.redirect }), signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Не удалось завершить вход. Проверьте интернет и войдите снова'); }
  const result = await response.json(); ensure(response.ok && typeof result.access_token === 'string' && result.access_token.trim(), 'Яндекс не подтвердил вход. Проверьте Redirect URI в настройках OAuth');
  exchange.state.token = result.access_token; return true;
}


// app

const root = document.querySelector('#app'), notice = document.querySelector('#notice'), overlay = document.querySelector('#busy'), dialog = document.querySelector('#editor');
let exchange, group, groupUrl = '', selectedSheet, week = 0, working = false, polling, timer, retryAt = 0, dirty = false, lastNotice = '', noticeTimer;
const icon = name => {
  const paths = { next: 'm9 5 7 7-7 7', exit: 'M10 4H5v16h5m4-12 4 4-4 4m-5-4h9', edit: 'm4 16 12-12 4 4L8 20H4v-4Z', external: 'M14 4h6v6m0-6L10 14m-1-9H4v15h15v-5', check: 'm5 12 4 4 10-10' };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
};
function el(tag, content, className) { const e = document.createElement(tag); if (content !== undefined) e.textContent = content; if (className) e.className = className; return e; }
function button(label, action, className = '', glyph) { const b = el('button', label, className); b.type = 'button'; if (glyph) b.prepend(icon(glyph)); b.addEventListener('click', action); return b; }
function field(label, options = {}) { const wrap = el('label', undefined, 'field'); wrap.append(el('span', label)); const input = el('input'); Object.assign(input, options); wrap.append(input); return { wrap, input }; }
function showError(message) {
  if (!message || message === lastNotice) return; lastNotice = message; clearTimeout(noticeTimer);
  notice.querySelector('p').textContent = message; notice.hidden = false;
  noticeTimer = setTimeout(() => { lastNotice = ''; }, 30_000);
}
notice.querySelector('button').onclick = () => { notice.hidden = true; lastNotice = ''; };
function setTheme(value) {
  localStorage.setItem('attendance-theme', value); document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]').content = value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? '#0e171e' : '#f8fafc';
}
function themeMenu() {
  const wrap = el('label', undefined, 'theme'); wrap.append(el('span', 'Тема')); const select = el('select'); select.setAttribute('aria-label', 'Тема приложения');
  for (const [value, name] of [['system', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная']]) { const option = el('option', name); option.value = value; select.append(option); }
  select.value = localStorage.getItem('attendance-theme') ?? 'system'; select.onchange = () => setTheme(select.value); wrap.append(select); return wrap;
}
async function operate(fn, label = 'Подождите…') {
  if (working) return; working = true; overlay.querySelector('p').textContent = label; overlay.hidden = false; root.inert = true;
  try { if (polling) await polling; await fn(); retryAt = 0; }
  catch (e) { if (e.status === 401) await exchange.requireLogin(); if (e.retry) retryAt = Date.now() + e.retry; showError(e.message ?? 'Не удалось выполнить действие'); }
  finally { root.inert = false; working = false; overlay.hidden = true; await updateDirty(); render(); schedule(); }
}
async function updateDirty() { const p = exchange?.state.active; dirty = !!p && await hash(JSON.stringify(p.feed)) !== p.feedHash; }
function dateLabel(date, mode) {
  const d = new Date(date + 'T12:00:00Z'); const day = d.getUTCDate();
  return mode === 'SHORT' ? `${day} ${['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'][d.getUTCMonth()]}` : `${String(day).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function modal(title, content, actions) {
  dialog.replaceChildren(); const header = el('h2', title); header.id = 'dialog-title'; dialog.append(header, content);
  const footer = el('div', undefined, 'dialog-actions'); footer.append(button('Отмена', () => dialog.close(), 'text-button'), ...actions); dialog.append(footer); dialog.showModal();
}
function logout() {
  modal('Выйти из Яндекса?', el('p', 'Привязка к строке сохранится на этом устройстве. После входа в тот же аккаунт приглашение не понадобится. Неотправленные отметки сначала отправятся на Диск.'), [button('Выйти', () => { dialog.close(); operate(async () => { await exchange.logout(); group = null; groupUrl = ''; }, 'Отправка изменений…'); }, 'danger')]);
}
function editName(view) {
  const { wrap, input } = field('ФИО', { value: view.name, maxLength: 200, autocomplete: 'name' });
  modal('Изменить ФИО', wrap, [button('Сохранить', () => { let name; try { name = studentName(input.value); } catch (e) { showError(e.message); return; } dialog.close(); operate(async () => { await exchange.enqueue({ sheetId: '', date: '', amount: 0, newName: name }); await exchange.sync(); }, 'Отправка изменений…'); }, 'primary')]);
}
function editMark(view, sheet, date) {
  const old = sheet.marks[date], content = el('form', undefined, 'mark-form'); content.onsubmit = e => e.preventDefault();
  const categories = view.categories.filter(c => !c.deleted || c.id === old?.categoryId); ensure(categories.length, 'Категории недоступны');
  const select = el('select', undefined, 'category-select'); select.setAttribute('aria-label', 'Вид отметки');
  for (const c of categories) { const option = el('option', c.name); option.value = c.id; select.append(option); } select.value = old?.categoryId ?? categories[0].id;
  const { wrap, input } = field('Количество пар', { type: 'number', inputMode: 'numeric', min: '1', max: '1000000', step: '1', value: String(old?.amount ?? 1), required: true });
  content.append(select, wrap);
  const save = button('Сохранить', () => { if (!content.reportValidity()) return; const amount = Number(input.value); if (!Number.isInteger(amount)) return; dialog.close(); operate(async () => { await exchange.enqueue({ sheetId: sheet.id, date, amount, categoryId: select.value }); await exchange.sync(); }, 'Отправка изменений…'); }, 'primary');
  const actions = old ? [button('Убрать', () => { dialog.close(); operate(async () => { await exchange.enqueue({ sheetId: sheet.id, date, amount: 0, categoryId: old.categoryId }); await exchange.sync(); }, 'Отправка изменений…'); }, 'danger'), save] : [save];
  modal(dateLabel(date, sheet.dateView), content, actions);
}
function render() {
  if (!exchange) return; const logged = !!exchange.state.token, p = exchange.state.active, view = pendingView(p);
  const header = el('header', undefined, 'topbar'), brand = el('div', undefined, 'brand'), logo = el('img'); logo.src = './icon.svg'; logo.alt = ''; logo.width = 36; logo.height = 36;
  brand.append(logo, el('span', view?.bookName ?? 'Посещаемость')); header.append(brand);
  if (view?.documentsUrl) {
    try { const u = new URL(view.documentsUrl); if (u.protocol === 'https:' && ['docs.yandex.ru', 'disk.yandex.ru', 'yadi.sk'].includes(u.hostname) && !u.username && !u.password) { const a = el('a', 'На Яндексе', 'document-link'); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.append(icon('external')); header.append(a); } } catch { /* Invalid remote URLs never become links. */ }
  } else header.append(themeMenu());
  const main = el('main', undefined, view ? 'journal' : 'connection');
  if (!logged) {
    main.classList.add('welcome'); main.append(el('h1', 'Войти в журнал'));
    main.append(button('Войти через Яндекс', () => operate(() => startLogin(exchange)), 'primary login-button'));
  } else if (view) {
    const aside = el('section', undefined, 'student-panel'); aside.append(el('h1', view.name));
    const balance = el('div', undefined, 'student-balance'); balance.append(el('span', 'Бонусы'), el('strong', String(view.balance))); aside.append(balance);
    aside.append(button('Изменить ФИО', () => editName(view), 'text-button', 'edit'));
    const label = el('label', undefined, 'field sheet-field'); label.append(el('span', 'Лист')); const sheets = el('select'); sheets.setAttribute('aria-label', 'Лист');
    for (const s of view.sheets) { const option = el('option', s.name); option.value = s.id; sheets.append(option); }
    const sheet = view.sheets.find(s => s.id === selectedSheet) ?? view.sheets[0];
    if (!sheet) { main.append(el('p', 'Преподаватель пока не добавил вас в лист.')); }
    else {
      selectedSheet = sheet.id; sheets.value = sheet.id; sheets.onchange = () => { selectedSheet = sheets.value; week = 0; render(); }; label.append(sheets); aside.append(label);
      week = Math.min(week, sheet.weeks - 1); const weeks = el('div', undefined, 'weeks'); weeks.setAttribute('aria-label', 'Недели');
      for (let w = 0; w < sheet.weeks; w++) { const b = button(String(w + 1), () => { week = w; render(); }, w === week ? 'week selected' : 'week'); b.setAttribute('aria-label', `Неделя ${w + 1}`); b.setAttribute('aria-pressed', String(w === week)); weeks.append(b); } aside.append(weeks);
      const status = el('p', dirty ? 'Сохранено на устройстве. Ожидает отправки' : 'Отправлено на Диск', 'delivery'); status.setAttribute('role', 'status'); aside.append(status);
      const awaiting = p.feed.requests.filter(r => !(r.id in p.view.receipts)).length; if (awaiting) aside.append(el('p', `Ожидает обработки: ${awaiting}`, 'muted'));
      const rejected = p.feed.requests.map(r => p.view.receipts[r.id]).filter(Boolean); if (rejected.length) aside.append(button('Есть отклонённая отметка', () => showError(rejected.at(-1)), 'text-button'));
      const days = el('section', undefined, 'days'); days.setAttribute('aria-label', `Посещаемость за неделю ${week + 1}`);
      const heading = el('div', undefined, 'week-heading'); heading.append(el('h2', `Неделя ${week + 1}`), el('span', `${sheet.totals[week]} / ${sheet.norms[week]}`, 'week-total')); days.append(heading);
      const closed = sheet.closedWeeks?.includes(week); if (closed) days.append(el('p', 'Неделя закрыта преподавателем', 'closed'));
      weekDates(sheet, week).forEach((date, day) => {
        const mark = sheet.marks[date], category = view.categories.find(c => c.id === mark?.categoryId);
        const row = closed ? el('div', undefined, 'day-row') : button('', () => { try { editMark(view, sheet, date); } catch (e) { showError(e.message); } }, 'day-row');
        row.append(el('span', `${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day]} ${dateLabel(date, sheet.dateView)}`, 'day-date'));
        const details = el('span', undefined, 'day-details');
        if (category) { const swatch = el('span', undefined, 'swatch'); swatch.dataset.color = category.color.toUpperCase(); details.append(swatch, el('span', `${mark.amount} · ${category.name}`)); }
        else details.append(el('span', 'Нет отметки', 'muted'));
        row.append(details); if (!closed) row.append(icon('next')); days.append(row);
      }); main.append(aside, days);
    }
  } else if (p?.enrollment?.sent || p?.viewUrl) {
    main.append(el('h1', 'Подключение к журналу'), el('p', p.enrollment?.newName ?? p.name ?? ''), el('div', 'Заявка отправлена. Подключение завершится, когда преподаватель откроет приложение.', 'waiting'));
  } else {
    main.append(el('h1', 'Подключиться к журналу'));
    const form = el('form', undefined, 'invite-form'), { wrap, input } = field('Ссылка преподавателя', { type: 'url', value: groupUrl, placeholder: 'https://yadi.sk/d/…', required: true, autocomplete: 'off', spellcheck: false });
    input.oninput = () => { groupUrl = input.value; group = null; }; form.append(wrap, button('Открыть список', () => form.requestSubmit(), 'primary')); form.onsubmit = e => { e.preventDefault(); operate(async () => { groupUrl = input.value.trim(); group = await exchange.invitation(groupUrl); }); }; main.append(form);
    if (group) {
      main.append(el('h2', group.name));
      if (group.registrations?.length) {
        const enroll = el('form', undefined, 'enroll-form'), name = field('ФИО', { required: true, maxLength: 200, autocomplete: 'name' }); enroll.append(name.wrap, button('Подключиться', () => enroll.requestSubmit(), 'primary'));
        enroll.onsubmit = e => { e.preventDefault(); operate(() => exchange.join(group, undefined, name.input.value), 'Отправка заявки…'); }; main.append(enroll);
      }
      if (group.students.length) {
        main.append(el('h2', 'Выбрать из списка')); const search = field('Поиск по ФИО', { type: 'search', autocomplete: 'off' }); main.append(search.wrap); const list = el('div', undefined, 'student-list'); main.append(list);
        function populate() { const query = search.input.value.toLocaleLowerCase('ru'); list.replaceChildren(); for (const student of [...group.students].sort((a, b) => a.name.localeCompare(b.name, 'ru')).filter(r => r.name.toLocaleLowerCase('ru').includes(query))) list.append(button(student.name, () => operate(() => exchange.join(group, student.id), 'Отправка заявки…'), 'student-option', 'next')); }
        search.input.oninput = populate; populate();
      }
    }
  }
  const footer = el('footer', undefined, 'bottom-bar'); if (logged) footer.append(button('Выйти из Яндекса', logout, 'text-button', 'exit'));
  root.replaceChildren(header, main, footer);
  for (const swatch of root.querySelectorAll('.swatch')) {
    const color = '#' + swatch.dataset.color;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(svg.namespaceURI, 'rect'); rect.setAttribute('width', '20'); rect.setAttribute('height', '20'); rect.setAttribute('rx', '4'); rect.setAttribute('fill', color); svg.append(rect); swatch.append(svg);
  }
}
function schedule(delay = 5000) { clearTimeout(timer); if (!document.hidden && exchange?.state.token) timer = setTimeout(poll, Math.max(delay, retryAt - Date.now())); }
async function poll() {
  if (document.hidden || working || !navigator.onLine || dialog.open) { schedule(); return; }
  polling = (async () => { try {
    if (!exchange.state.active) await exchange.restore();
    if (group && !exchange.state.active?.enrollment?.sent && !exchange.state.active?.viewUrl) {
      const next = await exchange.invitation(groupUrl); if (JSON.stringify(next) !== JSON.stringify(group)) { group = next; render(); }
    }
    const before = JSON.stringify(exchange.state.active); await exchange.sync(); await updateDirty(); if (before !== JSON.stringify(exchange.state.active)) render();
  } catch (e) { if (e.status === 401) { await exchange.requireLogin(); render(); } if (e.retry) retryAt = Date.now() + e.retry; showError(e.message); }
  finally { schedule(); } })();
  await polling; polling = null;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else schedule(0); });
addEventListener('online', () => schedule(0));
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
async function boot() {
  try {
    setTheme(localStorage.getItem('attendance-theme') ?? 'system');
    const vault = await new Vault().open(); exchange = new Exchange(vault, await vault.load());
    try { if (await finishLogin(exchange)) { await exchange.save(); exchange.disk = new Disk(exchange.state.token); } } catch (e) { showError(e.message); }
    render(); if (exchange.state.token) await operate(async () => { await exchange.restore(); await exchange.sync(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (e) { root.replaceChildren(el('main', undefined, 'boot')); root.firstChild.append(el('h1', 'Не удалось открыть приложение'), el('p', e.message)); }
}
if (!navigator.locks) { root.replaceChildren(el('main', 'Обновите Safari или откройте приложение в современном браузере.', 'boot')); }
else navigator.locks.request('attendance-student-session', { ifAvailable: true }, async lock => { if (!lock) { root.replaceChildren(el('main', 'Приложение уже открыто в другой вкладке. Продолжите в ней или закройте её и обновите эту страницу.', 'boot')); return; } await boot(); await new Promise(() => {}); }).catch(e => showError(e.message));

