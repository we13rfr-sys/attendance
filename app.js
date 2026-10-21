// Посещаемость. Секретов и пользовательских данных здесь нет.

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
function matchesStudentSurname(name, surname) {
  const normalize = value => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  return typeof name === 'string' && typeof surname === 'string' && !!surname.trim() && normalize(surname) === normalize(name).split(/\s+/)[0];
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
function weekDates(sheet, week) { return sheet.removedWeeks?.includes(week) ? [] : Array.from({ length: 6 }, (_, day) => addDays(sheet.start, week * 7 + day)); }
function validateView(v, profile) {
  ensure(v && v.bookId === profile.bookId && v.studentId === profile.studentId && typeof v.name === 'string' && v.name.trim() && v.name.length <= 200 && typeof v.bookName === 'string' && v.bookName.length <= 500 && v.protocol >= 2 && Number.isSafeInteger(v.balance));
  ensure(Array.isArray(v.categories) && v.categories.length <= 100 && new Set(v.categories.map(c => c.id)).size === v.categories.length);
  for (const c of v.categories) ensure(typeof c.id === 'string' && c.id.length <= 80 && typeof c.name === 'string' && c.name.length <= 200 && /^[A-Fa-f0-9]{6}$/.test(c.color) && ['CREDIT', 'DEDUCT', 'BONUS'].includes(c.effect));
  ensure(Array.isArray(v.sheets) && v.sheets.length <= 100 && new Set(v.sheets.map(s => s.id)).size === v.sheets.length && v.receipts && typeof v.receipts === 'object');
  for (const s of v.sheets) {
    ensure(typeof s.id === 'string' && typeof s.name === 'string' && Number.isInteger(s.weeks) && s.weeks >= 1 && s.weeks <= 52 && s.norms?.length === s.weeks && s.norms.every(n => Number.isInteger(n) && n >= 0 && n <= 1_000_000));
    addDays(s.start, 0); ensure(new Date(s.start + 'T12:00:00Z').getUTCDay() === 1 && s.marks && typeof s.marks === 'object');
    ensure(!s.closedWeeks || (Array.isArray(s.closedWeeks) && s.closedWeeks.every(w => Number.isInteger(w) && w >= 0 && w < s.weeks)));
    ensure(!s.removedWeeks || (Array.isArray(s.removedWeeks) && s.removedWeeks.every(w => Number.isInteger(w) && w >= 0 && w < s.weeks && s.norms[w]===0)));
    const dates = new Set(Array.from({ length: s.weeks }, (_, w) => weekDates(s, w)).flat());
    for (const [date, m] of Object.entries(s.marks)) ensure(dates.has(date) && Number.isInteger(m.amount) && m.amount >= 1 && m.amount <= 1_000_000 && v.categories.some(c => c.id === m.categoryId));
  }
  return v;
}
function weekCredit(v, s, w) { return weekDates(s, w).reduce((n, d) => { const m = s.marks[d], c = v.categories.find(c => c.id === m?.categoryId); return n + (c?.effect === 'CREDIT' ? m.amount : c?.effect === 'DEDUCT' ? -m.amount : 0); }, 0); }
function earnings(v) { return v.sheets.reduce((sum, s) => sum + Array.from({ length: s.weeks }, (_, w) => Math.max(0, weekCredit(v, s, w) - s.norms[w])).reduce((a, b) => a + b, 0), 0); }
function spent(v) { return v.sheets.reduce((n, s) => n + Object.values(s.marks).reduce((n, m) => n + (m.approved && v.categories.find(c => c.id === m.categoryId)?.effect === 'BONUS' ? m.amount : 0), 0), 0); }
function refundUnusedBonuses(v, s, w) {
  let remaining = Math.max(0, s.norms[w] - weekCredit(v, s, w));
  for (const date of weekDates(s, w)) {
    const m = s.marks[date]; if (!m?.approved || v.categories.find(c => c.id === m.categoryId)?.effect !== 'BONUS') continue;
    const used = Math.min(m.amount, remaining); remaining -= used;
    if (!used) delete s.marks[date]; else if (used !== m.amount) s.marks[date] = { ...m, amount: used };
  }
}
function recalc(v) {
  const before = spent(v);
  for (const s of v.sheets) for (let w = 0; w < s.weeks; w++) refundUnusedBonuses(v, s, w);
  v.balance += before - spent(v);
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
  const base = v.balance - earnings(v) + spent(v), original = s.marks;
  s.marks = structuredClone(s.marks);
  if (r.amount === 0) delete s.marks[r.date]; else s.marks[r.date] = { amount: r.amount, categoryId: c.id, approved: c.effect === 'BONUS' };
  if (r.amount > 0 && c.effect === 'BONUS') {
    const other = weekDates(s, week).reduce((n, d) => { const m = s.marks[d]; return n + (d !== r.date && m?.approved && v.categories.find(c => c.id === m.categoryId)?.effect === 'BONUS' ? m.amount : 0); }, 0);
    const room = Math.max(0, s.norms[week] - weekCredit(v, s, week) - other);
    if (r.amount > room) { s.marks = original; throw new Error(`До нормы недели осталось ${room} пар. Бонусы сверх нормы не списываются`); }
  }
  refundUnusedBonuses(v, s, week);
  const nextBalance = base + earnings(v) - spent(v);
  if (r.amount > 0 && c.effect === 'BONUS' && nextBalance < 0) { s.marks = original; throw new Error('Недостаточно бонусов для этой отметки'); }
  v.balance = nextBalance; recalc(v);
}
function pendingView(profile) {
  if (!profile?.view) return null; const v = recalc(structuredClone(profile.view));
  for (const r of profile.feed.requests) if (!(r.id in v.receipts)) { try { applyRequest(v, r); } catch { /* Teacher receipts carry the final rejection reason. */ } }
  return recalc(v);
}

function temporaryEnrollmentError(error) {
  return typeof error === 'string' && (error.startsWith('Редактирование открыто') || error.startsWith('Не удалось связаться с Яндексом.'));
}
function enrollmentReply(response) {
  // Older teachers persisted temporary device or network failures as permanent rejections.
  if (temporaryEnrollmentError(response.error)) return null;
  ensure(!response.error, response.error);
  ensure(typeof response.reply === 'string' && response.reply.length > 0, 'Повреждён ответ преподавателя');
  return response.reply;
}


// vault
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
class Vault {
  async open() {
    ensure(
      globalThis.indexedDB && crypto.subtle,
      "Откройте приложение в обновлённом Safari по HTTPS",
    );
    const r = indexedDB.open("attendance-student", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("vault");
    this.db = await request(r);
    this.key = await this.get("key");
    if (!this.key) {
      this.key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await this.put("key", this.key);
    }
    return this;
  }
  async get(key) {
    return request(this.db.transaction("vault").objectStore("vault").get(key));
  }
  async put(key, value) {
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction("vault", "readwrite");
      tx.objectStore("vault").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          tx.error ?? new Error("Не удалось сохранить данные в этом браузере"),
        );
    });
  }
  async load() {
    const record = await this.get("state");
    if (!record) return { token: null, active: null, saved: [] };
    try {
      return JSON.parse(
        text(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: record.iv },
            this.key,
            record.body,
          ),
        ),
      );
    } catch {
      throw new Error(
        "Не удалось прочитать сохранённое подключение. Не очищайте данные Safari до отправки отметок",
      );
    }
  }
  save(state) {
    const snapshot = JSON.stringify(state);
    // Keep a slow earlier write from replacing a newer edit.
    this.saving = (this.saving ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        await this.put("state", {
          iv,
          body: await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            this.key,
            utf8.encode(snapshot),
          ),
        });
      });
    return this.saving;
  }
}


// disk
class DiskError extends Error {
  constructor(status, message, retry = 0, storageUnavailable = false) {
    super(message);
    this.status = status;
    this.retry = retry;
    this.storageUnavailable = storageUnavailable;
  }
}
function diskRetryDelay(value, now = Date.now()) {
  const seconds = Number(value);
  const delay = value && !Number.isFinite(seconds) ? Date.parse(value) - now : seconds * 1000;
  return Math.max(60_000, Math.min(Number.isFinite(delay) ? delay : 60_000, 86_400_000));
}
class Disk {
  constructor(token) {
    this.token = token;
    this.cache = new Map();
    this.pauses = new Map();
    this.reads = new Map();
    this.readPauseUntil = 0;
    this.readBackoff = 60_000;
  }
  async fetch(url, options = {}, max = 4_000_000) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw Object.assign(new Error(
        "Не удалось связаться с Яндексом. Изменения сохранены в этом браузере",
      ), {network: true});
    }
    if (!response.ok) {
      const retry = diskRetryDelay(response.headers.get("Retry-After"));
      let storageUnavailable=false;
      if(response.status>=500 && response.status<=504 && response.body) {
        const reader=response.body.getReader(),chunks=[];let size=0;
        try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>200)break;chunks.push(part.value);}}
        finally {await reader.cancel();}
        if(size<=200){const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
          storageUnavailable=["file IO failure: no more reliable hosts","file IO failure: no successful lookup result"].includes(text(bytes).trim());}
      }
      throw new DiskError(
        response.status,
        {
          401: "Истёк вход в Яндекс. Войдите снова",
          403: "Нет доступа к файлу",
          404: "Файл на Диске не найден",
          409: "Место уже занято",
          410: "Ссылка отправки истекла. Попросите новое приглашение",
          423: "Яндекс временно заблокировал запись. Изменения сохранены",
          429: "Яндекс временно ограничил запросы. Повторим позже",
          507: "На Диске закончилось место",
        }[response.status] ?? "Яндекс не выполнил запрос",
        [423, 429].includes(response.status)
          ? retry
          : 0,
        storageUnavailable,
      );
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    let length = 0;
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) {
        await reader.cancel();
        throw new Error("Файл обмена слишком большой");
      }
      chunks.push(value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  async api(endpoint, params = {}, method = "GET", body) {
    const url = new URL("https://cloud-api.yandex.net/v1/disk/" + endpoint);
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, String(v)),
    );
    const headers = { Authorization: "OAuth " + this.token };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const bytes = await this.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  }
  async download(path, max = 4_000_000) {
    return this.downloadFile("resources/download", {path}, max);
  }
  async downloadFile(endpoint, params, max = 4_000_000) {
    for (let attempt = 0; ; attempt++) {
      try {
        const ticket = await this.api(endpoint, params);
        return await this.fetch(transferUrl(ticket.href), {cache: "no-store"}, max);
      } catch (e) {
        // A stale download redirect can lack CORS headers; retry a fresh ticket once.
        if (!e.network || attempt > 0) throw e;
      }
    }
  }
  async upload(path, bytes, overwrite) {
    const pause = this.pauses.get(path) ?? 0;
    if (pause > Date.now())
      throw new DiskError(
        423,
        "Отправка ожидает снятия ограничения Яндекса",
        pause - Date.now(),
      );
    try {
      const ticket = await this.api("resources/upload", { path, overwrite });
      await this.send(ticket.href, bytes);
    } catch (e) {
      if (e.retry) this.pauses.set(path, Date.now() + e.retry);
      throw e;
    }
  }
  async send(url, bytes) {
    transferUrl(url);
    ensure(bytes.length <= 20_000_000);
    return this.fetch(url, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  async folder(path) {
    try {
      await this.api("resources", { path }, "PUT");
    } catch (e) {
      if (e.status !== 409) throw e;
      const resource = await this.api("resources", { path, fields: "type" });
      ensure(resource.type === "dir");
    }
  }
  async publish(path) {
    await this.api(
      "resources/publish",
      { path, allow_address_access: true },
      "PUT",
      {
        public_settings: {
          accesses: [{ type: "macro", macros: ["all"], rights: ["read"] }],
        },
      },
    );
    return publicUrl(
      (await this.api("resources", { path, fields: "public_url" })).public_url,
    );
  }
  async publicFile(url) {
    publicUrl(url);
    const pause = Math.max(this.readPauseUntil, this.pauses.get(url) ?? 0);
    if (pause > Date.now())
      throw new DiskError(
        429,
        "Яндекс ограничил чтение. Повторим автоматически",
        pause - Date.now(),
      );
    if (this.reads.has(url)) return this.reads.get(url);
    const read = this.readPublicFile(url);
    this.reads.set(url, read);
    try { return await read; }
    finally { this.reads.delete(url); }
  }
  async readPublicFile(url) {
    try {
      const meta = await this.api("public/resources", {
        public_key: url,
        fields: "md5,size",
      });
      ensure(meta.size <= 4_000_000);
      if (meta.md5 && this.cache.get(url)?.md5 === meta.md5) {
        this.readBackoff = 60_000;
        return this.cache.get(url).bytes;
      }
      const bytes = await this.downloadFile("public/resources/download", {public_key: url});
      // The file is authenticated by AES-GCM on receipt; MD5 is only a revision hint.
      if (meta.md5) {
        this.cache.delete(url);
        while (this.cache.size && [...this.cache.values()].reduce((n, item) => n + item.bytes.length, bytes.length) > 16_000_000)
          this.cache.delete(this.cache.keys().next().value);
        this.cache.set(url, { md5: meta.md5, bytes });
      }
      this.readBackoff = 60_000;
      return bytes;
    } catch (e) {
      if (e.status === 429) {
        e.retry = Math.max(e.retry || 0, this.readBackoff);
        this.readPauseUntil = Date.now() + e.retry;
        this.readBackoff = Math.min(e.retry * 2, 900_000);
      }
      if (e.retry) this.pauses.set(url, Date.now() + e.retry);
      throw e;
    }
  }
  async verifyUpload(path, bytes) {
    ensure(
      (await hash(
        await this.download(path, Math.max(4_000_000, bytes.length)),
      )) === (await hash(bytes)),
      "Не удалось подтвердить отправку. Повторим при открытии приложения",
    );
  }
  async list(path) {
    const result = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const page = await this.api(
        path ? "resources" : "resources/files",
        path ? { path, limit: 500, offset } : { limit: 500, offset },
      );
      const items = path ? page._embedded?.items : page.items;
      ensure(Array.isArray(items), "Яндекс не вернул список файлов");
      result.push(...items.filter((f) => f.type === "file"));
      if (items.length < 500) return result;
    }
    throw new Error("На Диске слишком много файлов для одного списка");
  }
  async trash(path) {
    ensure(
      typeof path === "string" &&
        path.startsWith("disk:/") &&
        !path.split("/").includes(".."),
      "Некорректный путь",
    );
    let operation;
    try {
      operation = await this.api(
        "resources",
        { path, permanently: false, force_async: false },
        "DELETE",
      );
    } catch (e) {
      if (e.status === 404) return;
      throw e;
    }
    await this.waitOperation(operation);
  }
  async move(from, path) {
    await this.waitOperation(
      await this.api(
        "resources/move",
        { from, path, overwrite: false },
        "POST",
      ),
    );
  }
  async waitOperation(operation) {
    if (!operation.href) return;
    const url = new URL(operation.href);
    ensure(
      url.origin === "https://cloud-api.yandex.net" &&
        url.pathname.startsWith("/v1/disk/operations/"),
      "Некорректный ответ Яндекса",
    );
    for (let i = 0; i < 40; i++) {
      const state = JSON.parse(
        text(
          await this.fetch(url.href, {
            headers: { Authorization: "OAuth " + this.token },
          }),
        ),
      );
      if (state.status === "success") return;
      ensure(state.status === "in-progress", "Яндекс не смог удалить файл");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Удаление ещё выполняется на Диске. Повторите проверку позже",
    );
  }
}


// student-binding

async function readStudentFeed(disk, p) {
  try { return await disk.download(p.requestPath); }
  catch (error) {
    if (!(error.storageUnavailable || error.network) || !p.enrollment || p.viewUrl || p.revoked || p.feed.requests.length) throw error;
    const empty = utf8.encode(JSON.stringify({peerId:p.peerId, requests:[]}));
    const before = await disk.api('resources', {path:p.requestPath, fields:'size,sha256'});
    // Only the initial empty feed has this size; never replace attendance or an accepted connection.
    if (before.size !== empty.length + 28 || !/^[a-f0-9]{64}$/i.test(before.sha256 ?? '')) throw error;
    const bookId = p.enrollment.invitation.bookId;
    const current = validateStudentBinding(JSON.parse(text(await disk.download(studentBindingPath(bookId)))), bookId);
    if (current.peerId !== p.peerId || current.key !== p.key || !current.enrollment || current.viewUrl || current.revoked) throw error;
    const latest = await disk.api('resources', {path:p.requestPath, fields:'size,sha256'});
    if (latest.sha256 !== before.sha256 || latest.size !== before.size) throw error;
    const bytes = await sealPeer(p.key, empty);
    await disk.upload(p.requestPath, bytes, true);
    await disk.verifyUpload(p.requestPath, bytes);
    return bytes;
  }
}

function studentBindingPath(bookId) {
  ensure(typeof bookId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(bookId));
  return `disk:/Посещаемость-обмен/студент-${bookId}.json`;
}
function validateStudentBinding(record, bookId) {
  const p = record?.profile;
  ensure(record?.version === 1 && record.bookId === bookId && p && (p.bookId ?? p.enrollment?.invitation?.bookId) === bookId, 'Повреждена привязка аккаунта');
  ensure(/^[A-Za-z0-9-]{1,80}$/.test(p.peerId) && unb64(p.key).length === 32 && p.requestPath === `disk:/Посещаемость-обмен/ученик-${p.peerId}.json`, 'Повреждена привязка аккаунта');
  publicUrl(p.requestUrl);
  if (p.viewUrl) { publicUrl(p.viewUrl); ensure(typeof p.studentId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(p.studentId)); }
  else ensure(p.revoked || (p.enrollment && typeof p.enrollment.encrypted === 'string' && p.enrollment.encrypted.length <= 20_000));
  return p;
}
async function readStudentBinding(disk, bookId) {
  let bytes;
  try { bytes = await disk.download(studentBindingPath(bookId)); } catch (e) { if (e.status === 404) return null; throw e; }
  const p = validateStudentBinding(JSON.parse(text(bytes)), bookId);
  if (p.revoked) { p.bindingHash = await hash(bytes); return p; }
  const feed = JSON.parse(text(await openPeer(p.key, await readStudentFeed(disk, p))));
  ensure(feed.peerId === p.peerId && Array.isArray(feed.requests) && feed.requests.length <= 2000, 'Повреждены изменения студента');
  p.feed = feed; p.feedHash = await hash(JSON.stringify(feed)); p.bindingHash = await hash(bytes);
  return p;
}
async function writeStudentBinding(disk, p) {
  const bookId = p.bookId ?? p.enrollment?.invitation?.bookId;
  if (!bookId || (!p.viewUrl && !p.enrollment && !p.revoked)) return;
  const { view, feed, feedHash, bindingHash, ...profile } = p;
  const record = { version: 1, bookId, profile: { ...profile, feed: { peerId: p.peerId, requests: [] }, feedHash: '' } };
  validateStudentBinding(record, bookId);
  const bytes = utf8.encode(JSON.stringify(record)), revision = await hash(bytes), path = studentBindingPath(bookId);
  if (revision === p.bindingHash) return;
  if (p.bindingHash) {
    const old = validateStudentBinding(JSON.parse(text(await disk.download(path))), bookId);
    ensure(old.peerId === p.peerId && old.key === p.key, 'Привязка аккаунта изменилась на другом устройстве. Откройте приглашение заново');
  }
  try { await disk.upload(path, bytes, !!p.bindingHash); }
  catch (e) {
    if (e.status !== 409) throw e;
    const old = validateStudentBinding(JSON.parse(text(await disk.download(path))), bookId);
    ensure(old.revoked || (old.peerId === p.peerId && old.key === p.key), 'Этот аккаунт уже подключён к другой строке этой таблицы. Обратитесь к преподавателю');
    await disk.upload(path, bytes, true);
  }
  p.bindingHash = revision;
}

function requireSameStudent(p, rowId, name) {
  const same = rowId !== undefined ? (p.studentId ?? p.enrollment?.studentId) === rowId :
    (p.view?.name ?? p.enrollment?.newName ?? p.name)?.toLocaleLowerCase('ru') === name?.toLocaleLowerCase('ru');
  ensure(same, 'Этот аккаунт уже подключён к другой строке этой таблицы. Обратитесь к преподавателю');
}


// exchange
function studentSyncDelay(profile) {
  return profile?.enrollment || profile?.feed?.requests.some(r => !(r.id in (profile.view?.receipts ?? {}))) ? 5_000 : 15_000;
}
class Exchange {
  constructor(vault, state) { this.vault = vault; this.state = state; this.disk = new Disk(state.token); }
  async save() { await this.vault.save(this.state); }
  async requireLogin() {
    const p = this.state.active;
    if (p) this.state.saved = [p, ...this.state.saved.filter(old => old.peerId !== p.peerId)];
    this.state.active = null; this.state.token = null; await this.save(); this.disk = new Disk(null);
  }
  async restore() {
    if (this.state.active || !this.state.token || this.state.chooseTable) return;
    for (const profile of this.state.saved.filter(p => !p.revoked)) {
      let bytes; try { bytes = await readStudentFeed(this.disk, profile); } catch (e) { if (e.status === 404) continue; throw e; }
      ensure(JSON.parse(text(await openPeer(profile.key, bytes))).peerId === profile.peerId);
      this.state.active = profile; this.state.saved = this.state.saved.filter(p => p.peerId !== profile.peerId); await this.save(); return;
    }
  }
  async invitation(url) { return validateInvitation(JSON.parse(text(await this.disk.publicFile(publicUrl(url.trim()))))); }
  async ownedSaved(bookId) {
    const remote = await readStudentBinding(this.disk, bookId);
    const profiles = [];
    if (remote) {
      const local = [this.state.active, ...this.state.saved].find(p => p?.peerId === remote.peerId);
      const p = { ...remote, ...(local && { feed: local.feed, feedHash: local.feedHash, view: local.view }) };
      if (remote.revoked) { await this.retire(p); return []; }
      profiles.push(p);
    } else for (const p of this.state.saved.filter(p => !p.revoked && (p.bookId ?? p.enrollment?.invitation?.bookId) === bookId && (p.viewUrl || p.enrollment?.sent))) {
      let bytes; try { bytes = await readStudentFeed(this.disk, p); } catch (e) { if (e.status === 404) continue; throw e; }
      ensure(JSON.parse(text(await openPeer(p.key, bytes))).peerId === p.peerId, 'Не удалось проверить сохранённое подключение'); profiles.push(p);
    }
    for (const p of profiles) if (await this.savedAvailable(p)) { await writeStudentBinding(this.disk, p); return [p]; }
    return [];
  }
  async savedAvailable(p) {
    if (p.enrollment?.sent) {
      const responses = JSON.parse(text(await this.disk.publicFile(p.enrollment.invitation.responseUrl)));
      if (responses[p.enrollment.studentId]) {
        const reply = JSON.parse(text(await openPeer(p.key, unb64(responses[p.enrollment.studentId]))));
        const code = enrollmentReply(reply); if (code) await this.accept(code, p);
      }
    }
    if (p.viewUrl) {
      try { p.view = await this.readView(p); }
      catch (e) { if (e.bindingRevoked) return false; throw e; }
    }
    return true;
  }
  async resumeInvited(group, rowId, name) {
    const active = this.state.active;
    const p = active && (active.bookId ?? active.enrollment?.invitation?.bookId) === group.bookId ? active : (await this.ownedSaved(group.bookId))[0];
    if (!p) return false;
    if (p === active && !await this.savedAvailable(p)) return false;
    if (rowId !== undefined || name !== undefined) requireSameStudent(p, rowId, name);
    const next = { ...this.state, active: p, saved: this.state.saved.filter(old => old.peerId !== p.peerId), chooseTable: false };
    await writeStudentBinding(this.disk, p); await this.vault.save(next); this.state = next;
    if (p.enrollment && !p.enrollment.sent) await this.sync();
    return true;
  }
  async create(name) {
    await this.restore(); if (this.state.active) return this.state.active;
    name = studentName(name); await this.disk.folder('disk:/Посещаемость-обмен');
    const peerId = uid(), initials = name.split(' ').slice(0, 3).map(p => [...p][0].toLocaleUpperCase('ru')).join('');
    const p = { peerId, label: initials + '-' + String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0'), key: peerKey(), requestPath: `disk:/Посещаемость-обмен/ученик-${peerId}.json`, requestUrl: '', feed: { peerId, requests: [] }, feedHash: '', name };
    // Save before remote work so a failed publication retries the same private file.
    this.state.active = p; this.state.chooseTable = false; await this.save(); await this.prepare(p); return p;
  }
  async prepare(p) {
    if (p.requestUrl) return; const bytes = utf8.encode(JSON.stringify(p.feed));
    try { await this.disk.upload(p.requestPath, await sealPeer(p.key, bytes), false); } catch (e) { if (e.status !== 409) throw e; const feed = JSON.parse(text(await openPeer(p.key, await this.disk.download(p.requestPath)))); ensure(feed.peerId === p.peerId && feed.requests.length === 0); }
    p.requestUrl = await this.disk.publish(p.requestPath); p.feedHash = await hash(bytes); await this.save();
  }
  async join(group, rowId, name, surname) {
    validateInvitation(group); if (name !== undefined) name = studentName(name);
    if (await this.resumeInvited(group, rowId, name)) return;
    if (name !== undefined) { const existing = group.students.find(r => r.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru')); if (existing) return this.join(group, existing.id, undefined, name.split(' ')[0]); }
    const row = name === undefined ? group.students.find(r => r.id === rowId) : group.registrations?.[crypto.getRandomValues(new Uint32Array(1))[0] % group.registrations.length]; ensure(row, 'Попросите новое приглашение');
    if (name === undefined) ensure(matchesStudentSurname(row.name, surname), 'Фамилия не совпадает с выбранной строкой');
    const p = await this.create(name ?? row.name); ensure(!p.viewUrl, 'Вы уже подключены к журналу'); await this.prepare(p);
    ensure(!p.enrollment?.sent, 'Заявка уже отправлена. Дождитесь подключения');
    p.enrollment = { invitation: group, studentId: row.id, encrypted: await sealEnrollment(group, p, row.id, name), sent: false }; if (name !== undefined) p.enrollment.newName = name;
    await this.save(); await this.sync();
  }
  async accept(code, p = this.state.active) {
    const reply = JSON.parse(text(await openPeer(p.key, decodeReply(code))));
    ensure(reply.peerId === p.peerId && typeof reply.bookId === 'string' && reply.bookId && typeof reply.studentId === 'string' && reply.studentId); publicUrl(reply.viewUrl);
    p.bookId = reply.bookId; p.studentId = reply.studentId; p.viewUrl = reply.viewUrl;
    if (p.enrollment) p.feed.enrollmentId = p.enrollment.invitation.id;
    delete p.enrollment; await this.save(); await writeStudentBinding(this.disk, p);
  }
  async sync() {
    const p = this.state.active; if (!p || !this.state.token) return;
    await writeStudentBinding(this.disk, p);
    this.checkedPendingFeeds ??= new Set();
    if (p.enrollment && !this.checkedPendingFeeds.has(p.peerId)) {
      await readStudentFeed(this.disk, p); this.checkedPendingFeeds.add(p.peerId);
    }
    if (p.enrollment) {
      const pending = p.enrollment, group = pending.invitation; let responses = {};
      try { responses = JSON.parse(text(await this.disk.publicFile(group.responseUrl))); }
      catch (e) { if (pending.sent || ![404, 429].includes(e.status)) throw e; }
      if (responses[pending.studentId]) {
        let reply; try { reply = JSON.parse(text(await openPeer(p.key, unb64(responses[pending.studentId])))); } catch { if (!pending.newName || pending.sent) throw new Error('Строка уже выбрана на другом устройстве'); }
        if (reply) { const code = enrollmentReply(reply); if (code) await this.accept(code); else { pending.sent = true; await this.save(); } }
      }
      if (p.enrollment && !pending.sent) {
        ensure(Date.now() < group.expires, 'Приглашение истекло. Попросите новое');
        const rows = pending.newName ? group.registrations.filter(r => !(r.id in responses)).sort((a, b) => Number(b.id === pending.studentId) - Number(a.id === pending.studentId)) : group.students.filter(r => r.id === pending.studentId);
        for (const row of rows) {
          if (row.id !== pending.studentId) { pending.studentId = row.id; pending.encrypted = await sealEnrollment(group, p, row.id, pending.newName); await this.save(); await writeStudentBinding(this.disk, p); }
          try { await this.disk.send(row.uploadUrl, utf8.encode(pending.encrypted)); } catch (e) { if (e.status !== 409) throw e; if (pending.newName) continue; }
          pending.sent = true; await this.save(); await writeStudentBinding(this.disk, p); break;
        }
        ensure(pending.sent, 'Места в приглашении закончились. Попросите новое');
      }
    }
    const bytes = utf8.encode(JSON.stringify(p.feed)), revision = await hash(bytes);
    if (revision !== p.feedHash) { const sealed = await sealPeer(p.key, bytes); await this.disk.upload(p.requestPath, sealed, true); await this.disk.verifyUpload(p.requestPath, sealed); p.feedHash = revision; await this.save(); }
    if (p.viewUrl) p.view = await this.readView(p); await this.save();
  }
  async readView(p) {
    let v;
    try { v = JSON.parse(text(await openPeer(p.key, await this.disk.publicFile(p.viewUrl)))); }
    catch (e) { if (e.status === 404) return this.unavailable(p); throw e; }
    ensure(v.bookId === p.bookId && v.studentId === p.studentId);
    if (v.removed) return this.unavailable(p);
    return validateView(v, p);
  }
  async retire(p) {
    const retired = { ...p, view: null, viewUrl: null, enrollment: null, revoked: true };
    const next = { ...this.state, active: this.state.active?.peerId === p.peerId ? null : this.state.active, saved: [retired, ...this.state.saved.filter(old => old.peerId !== p.peerId)], chooseTable: true };
    await this.vault.save(next); this.state = next; this.disk.cache.delete(p.viewUrl); await writeStudentBinding(this.disk, retired);
  }
  async unavailable(p) {
    await this.retire(p);
    throw Object.assign(new Error('Таблица удалена или доступ к ней закрыт. Подключитесь по новой ссылке'), { bindingRevoked: true });
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
  async leaveTable() {
    const p = this.state.active; if (p && await hash(JSON.stringify(p.feed)) !== p.feedHash) await this.sync();
    ensure(!p || await hash(JSON.stringify(p.feed)) === p.feedHash, 'Дождитесь отправки изменений перед выходом');
    const next = { ...this.state, active: null, saved: p ? [p, ...this.state.saved.filter(old => old.peerId !== p.peerId)] : this.state.saved, chooseTable: true };
    await this.vault.save(next); this.state = next;
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
  if (error === 'access_denied') {
    if (!exchange.state.token) delete exchange.state.role;
    await exchange.save(); return false;
  }
  ensure(!error && code, 'Яндекс не завершил вход. Повторите попытку');
  let response;
  try { response = await fetch('https://oauth.yandex.ru/token', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, code_verifier: pending.verifier, redirect_uri: pending.redirect }), signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Не удалось завершить вход. Проверьте интернет и войдите снова'); }
  const result = await response.json(); ensure(response.ok && typeof result.access_token === 'string' && result.access_token.trim(), 'Яндекс не подтвердил вход. Проверьте Redirect URI в настройках OAuth');
  exchange.state.token = result.access_token; return true;
}


// journal

const teacherDefaults = () => [
  { id: "visit", name: "Посещение", color: "FFFFFF", effect: "CREDIT" },
  {
    id: "children",
    name: "Работа с детьми",
    color: "00B0F0",
    effect: "CREDIT",
  },
  { id: "certificate", name: "Справка", color: "0070C0", effect: "CREDIT" },
  { id: "absence", name: "Прогул", color: "000000", effect: "DEDUCT" },
  {
    id: "project",
    name: "Работа над проектом",
    color: "FF0000",
    effect: "CREDIT",
  },
  {
    id: "bonus",
    name: "Использованные бонусы",
    color: "B36BFF",
    effect: "BONUS",
  },
];
async function hexHash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function teacherNewBook(name, start) {
  name = teacherBookName(name);
  ensure(
    new Date(start + "T12:00:00Z").getUTCDay() === 1,
    "Первая дата должна быть понедельником",
  );
  return {
    id: uid(),
    name,
    students: [],
    sheets: [
      {
        id: uid(),
        name: "1–4 недели",
        start,
        weeks: 4,
        dateView: "NUMBER",
        students: [],
        norms: [3, 3, 3, 3],
        marks: {},
        closedWeeks: [],
      },
    ],
    categories: teacherDefaults(),
    bonus: [],
    dirty: true,
    migrationDone: true,
    studentReceipts: {},
    localRevision: 0,
    syncedRevision: 0,
    status: "Сохранено в этом браузере",
  };
}
function teacherBookName(value) {
  value = studentName(value);
  ensure(
    value.length <= 200 &&
      !/[<>:"/\\|?*]/.test(value) &&
      !value.endsWith(".") &&
      value !== "." &&
      value !== "..",
    "Проверьте название таблицы",
  );
  return value;
}
function teacherSort(book) {
  book.students.sort(
    (a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id),
  );
  const order = new Map(book.students.map((s, i) => [s.id, i]));
  for (const s of book.sheets)
    s.students.sort((a, b) => order.get(a) - order.get(b));
}
function teacherAddStudent(book, name, id = uid()) {
  name = studentName(name);
  let row = book.students.find(
    (s) => s.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"),
  );
  if (!row) {
    row = { id, name };
    book.students.push(row);
  }
  for (const s of book.sheets)
    if (!s.students.includes(row.id)) s.students.push(row.id);
  teacherSort(book);
  return row;
}
function teacherRemoveStudent(book, id) {
  ensure(book.students.some(s=>s.id===id), "Студент не найден");
  book.students=book.students.filter(s=>s.id!==id);
  for(const sheet of book.sheets) {
    sheet.students=sheet.students.filter(student=>student!==id);
    for(const key of Object.keys(sheet.marks))if(key.startsWith(id+"|"))delete sheet.marks[key];
  }
  book.bonus=book.bonus.filter(operation=>operation.studentId!==id);
}
function teacherEarnings(book, id) {
  return book.sheets.reduce(
    (sum, s) =>
      sum +
      Array.from({ length: s.weeks }, (_, w) =>
        Math.max(
          0,
          weekDates(s, w).reduce((n, d) => {
            const m = s.marks[id + "|" + d],
              c = book.categories.find((c) => c.id === m?.categoryId);
            return (
              n +
              (c?.effect === "CREDIT"
                ? m.amount
                : c?.effect === "DEDUCT"
                  ? -m.amount
                  : 0)
            );
          }, 0) - s.norms[w],
        ),
      ).reduce((a, b) => a + b, 0),
    0,
  );
}
function teacherBalance(book, id) {
  return (
    book.bonus
      .filter((o) => o.studentId === id)
      .reduce((a, o) => a + o.amount, 0) + teacherEarnings(book, id)
  );
}
function teacherView(book, id, peerId = "") {
  const student = book.students.find((s) => s.id === id);
  ensure(student, "Студент удалён");
  const v = {
    bookId: book.id,
    studentId: id,
    name: student.name,
    bookName: book.name,
    balance: teacherBalance(book, id),
    categories: structuredClone(book.categories),
    protocol: 3,
    receipts: Object.fromEntries(
      Object.entries(book.studentReceipts ?? {})
        .filter(([k]) => k.startsWith(peerId + "|"))
        .map(([k, v]) => [k.slice(peerId.length + 1), v]),
    ),
    documentsUrl: book.documentsUrl ?? null,
    sheets: book.sheets
      .filter((s) => s.students.includes(id))
      .map((s) => ({
        ...structuredClone(s),
        marks: Object.fromEntries(
          Object.entries(s.marks)
            .filter(([k]) => k.startsWith(id + "|"))
            .map(([k, v]) => [k.slice(id.length + 1), v]),
        ),
      })),
  };
  // Totals are computed without settling here; mutations settle and record refunds in the journal.
  for (const s of v.sheets)
    s.totals = Array.from({ length: s.weeks }, (_, w) =>
      Math.min(
        s.norms[w],
        weekDates(s, w).reduce((n, d) => {
          const m = s.marks[d],
            c = v.categories.find((c) => c.id === m?.categoryId);
          return (
            n +
            (c?.effect === "CREDIT"
              ? m.amount
              : c?.effect === "DEDUCT"
                ? -m.amount
                : c?.effect === "BONUS" && m.approved
                  ? m.amount
                  : 0)
          );
        }, 0),
      ),
    );
  return v;
}
function teacherApplyView(book, id, v, markKey) {
  book.students.find((s) => s.id === id).name = studentName(v.name);
  for (const next of v.sheets) {
    const s = book.sheets.find((s) => s.id === next.id);
    for (const key of Object.keys(s.marks))
      if (key.startsWith(id + "|")) delete s.marks[key];
    for (const [date, m] of Object.entries(next.marks))
      s.marks[id + "|" + date] = m;
  }
  const delta = v.balance - teacherBalance(book, id);
  if (delta)
    book.bonus.push({
      id: uid(),
      studentId: id,
      amount: delta,
      reason: "Изменение отметок",
      markKey,
      created: Date.now(),
    });
  teacherSort(book);
}
function teacherMark(
  book,
  id,
  sheetId,
  date,
  amount,
  categoryId,
  student = false,
  requestId = uid(),
) {
  const v = teacherView(book, id),
    s = v.sheets.find((s) => s.id === sheetId);
  ensure(s, "Лист удалён");
  if (!student) {
    ensure(
      !amount ||
        book.categories.find((c) => c.id === categoryId)?.effect !== "BONUS",
      "Использовать бонусы может только студент",
    );
    s.closedWeeks = [];
  }
  applyRequest(v, { id: requestId, sheetId, date, amount, categoryId });
  teacherApplyView(book, id, v, `${sheetId}|${id}|${date}`);
}
function teacherSettle(book) {
  for (const row of book.students) {
    const v = teacherView(book, row.id);
    for (const s of v.sheets) {
      const single = { ...v, sheets: [s] };
      recalc(single);
      v.balance = single.balance;
      teacherApplyView(book, row.id, v, `${s.id}|${row.id}|refund`);
    }
  }
}
function teacherSetNorm(book, sheetId, week, value) {
  ensure(
    Number.isInteger(value) && value >= 0 && value <= 1_000_000,
    "Норма: от 0 до 1000000",
  );
  const s = book.sheets.find((s) => s.id === sheetId);
  ensure(s && week >= 0 && week < s.weeks);
  s.norms[week] = value;
  teacherSettle(book);
}
function teacherRows(
  book,
  sheet,
  week,
  query = "",
  below = false,
  deficit = false,
) {
  const normalized = query.toLocaleLowerCase("ru").trim().split(/\s+/);
  const rows = sheet.students
    .map((id) => {
      const row = book.students.find((s) => s.id === id),
        v = teacherView(book, id);
      return {
        ...row,
        total: v.sheets.find((s) => s.id === sheet.id).totals[week],
        balance: v.balance,
      };
    })
    .filter(
      (s) =>
        normalized.every((q) => s.name.toLocaleLowerCase("ru").includes(q)) &&
        (!below || s.total < sheet.norms[week]),
    );
  return rows.sort(
    (a, b) =>
      (deficit
        ? sheet.norms[week] - b.total - (sheet.norms[week] - a.total)
        : 0) || a.name.localeCompare(b.name, "ru"),
  );
}
function teacherPeriodStats(book, sheet, studentId, week = null) {
  const weeks = week === null ? Array.from({length:sheet.weeks}, (_, i) => i) : [week];
  const totals = teacherView(book, studentId).sheets.find((s) => s.id === sheet.id).totals;
  const norm = weeks.reduce((n, w) => n + sheet.norms[w], 0);
  const completed = weeks.reduce((n, w) => n + totals[w], 0);
  const categories = book.categories.map((category) => ({
    ...category,
    amount: weeks.flatMap((w) => weekDates(sheet, w)).reduce((n, date) => {
      const mark = sheet.marks[studentId + "|" + date];
      return n + (mark?.categoryId === category.id ? mark.amount : 0);
    }, 0),
  })).filter((c) => c.amount > 0);
  return {norm, completed, remaining:weeks.reduce((n, w) => n + Math.max(0, sheet.norms[w] - totals[w]), 0), categories};
}
function teacherValidate(book) {
  ensure(
    book &&
      typeof book.id === "string" &&
      /^[A-Za-z0-9-]{1,80}$/.test(book.id) &&
      typeof book.name === "string" &&
      book.name.trim() &&
      book.name.length <= 200,
    "Повреждена таблица",
  );
  ensure(
    Array.isArray(book.students) &&
      book.students.length <= 500 &&
      new Set(book.students.map((s) => s.id)).size === book.students.length,
  );
  for (const s of book.students)
    ensure(/^[A-Za-z0-9-]{1,80}$/.test(s.id) && studentName(s.name) === s.name);
  ensure(
    Array.isArray(book.categories) &&
      book.categories.length <= 100 &&
      new Set(book.categories.map((c) => c.id)).size ===
        book.categories.length &&
      book.categories.some((c) => c.id === "visit"),
  );
  for (const c of book.categories)
    ensure(
      typeof c.id === "string" &&
        c.id.length <= 80 &&
        studentName(c.name) === c.name &&
        /^[0-9A-F]{6}$/i.test(c.color) &&
        ["CREDIT", "DEDUCT", "BONUS"].includes(c.effect),
    );
  ensure(
    Array.isArray(book.sheets) &&
      book.sheets.length >= 1 &&
      book.sheets.length <= 100 &&
      new Set(book.sheets.map((s) => s.id)).size === book.sheets.length &&
      new Set(book.sheets.map((s) => s.name.toLocaleLowerCase("ru"))).size ===
        book.sheets.length,
  );
  book.bonus ??= [];
  ensure(book.bonus.length <= 100000);
  for (const o of book.bonus)
    ensure(
      book.students.some((s) => s.id === o.studentId) &&
        Number.isSafeInteger(o.amount) &&
        Math.abs(o.amount) <= 1_000_000,
    );
  for (const s of book.sheets) {
    ensure(!s.removedWeeks || (Array.isArray(s.removedWeeks) && s.removedWeeks.every(w=>Number.isInteger(w) && w>=0 && w<s.weeks && s.norms[w]===0)));
    ensure(
      Number.isInteger(s.weeks) &&
        s.weeks >= 1 &&
        s.weeks <= 52 &&
        s.norms?.length === s.weeks &&
        s.norms.every((n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000) &&
        Array.isArray(s.students) &&
        new Set(s.students).size === s.students.length &&
        s.students.every((id) => book.students.some((r) => r.id === id)),
    );
    ensure(
      typeof s.id === "string" &&
        /^[A-Za-z0-9-]{1,80}$/.test(s.id) &&
        typeof s.name === "string" &&
        s.name.length <= 31 &&
        s.name.trim(),
    );
    addDays(s.start, 0);
    ensure(new Date(s.start + "T12:00:00Z").getUTCDay() === 1);
    ensure(
      !s.closedWeeks ||
        s.closedWeeks.every(
          (w) => Number.isInteger(w) && w >= 0 && w < s.weeks,
        ),
    );
    const dates = new Set(
      Array.from({ length: s.weeks }, (_, w) => weekDates(s, w)).flat(),
    );
    ensure(s.marks && typeof s.marks === "object");
    for (const [k, m] of Object.entries(s.marks))
      ensure(
        book.students.some((r) => r.id === k.split("|")[0]) &&
          dates.has(k.split("|")[1]) &&
          Number.isInteger(m.amount) &&
          m.amount >= 1 &&
          m.amount <= 1_000_000 &&
          book.categories.some((c) => c.id === m.categoryId),
      );
  }
  teacherSort(book);
  return book;
}


// calendar

function monthTitle(key) {
  const value=new Date(key+'-01T12:00:00Z').toLocaleDateString('ru',{month:'long',year:'numeric',timeZone:'UTC'}).replace(/ г\.$/,'');
  return value[0].toLocaleUpperCase('ru')+value.slice(1);
}
function calendarMonths(sheets) {
  const weeks=sheets.flatMap(sheet=>Array.from({length:sheet.weeks},(_,index)=>({sheetId:sheet.id,index,start:addDays(sheet.start,index*7)})).filter(ref=>!sheet.removedWeeks?.includes(ref.index))).sort((a,b)=>a.start.localeCompare(b.start));
  const grouped=new Map();
  for(const week of weeks) {const key=week.start.slice(0,7);if(!grouped.has(key))grouped.set(key,{key,title:monthTitle(key),weeks:[]});grouped.get(key).weeks.push(week);}
  return [...grouped.values()];
}
function currentMonth(months,sheetId,week) {return months.find(m=>m.weeks.some(ref=>ref.sheetId===sheetId&&ref.index===week))??months[0];}
function weekRange(ref) {const short=date=>date.slice(8,10)+'.'+date.slice(5,7);return short(ref.start)+'–'+short(addDays(ref.start,5));}
function monthSheet(key,students=[]) {
  ensure(/^\d{4}-\d{2}$/.test(key)&&new Date(key+'-01T12:00:00Z').toISOString().slice(0,7)===key,'Выберите месяц');
  const first=key+'-01',start=addDays(first,(8-new Date(first+'T12:00:00Z').getUTCDay())%7);
  let weeks=0;while(addDays(start,weeks*7).slice(0,7)===key)weeks++;
  return {id:uid(),name:monthTitle(key),start,weeks,dateView:'NUMBER',students:[...students],norms:Array(weeks).fill(3),marks:{},closedWeeks:[]};
}
function addCalendarMonth(book,key) {
  ensure(!calendarMonths(book.sheets).some(m=>m.key===key),'Этот месяц уже есть в журнале');
  const sheet=monthSheet(key,book.students.map(s=>s.id));let suffix=2;
  while(book.sheets.some(s=>s.name.toLocaleLowerCase('ru')===sheet.name.toLocaleLowerCase('ru')))sheet.name=monthTitle(key)+' ('+(suffix++)+')';
  book.sheets.push(sheet);return sheet;
}
function teacherMonthStats(book,refs,studentId) {
  const parts=refs.map(ref=>{const s=book.sheets.find(s=>s.id===ref.sheetId);return s.students.includes(studentId)?teacherPeriodStats(book,s,studentId,ref.index):null;}).filter(Boolean);
  return {completed:parts.reduce((n,s)=>n+s.completed,0),norm:parts.reduce((n,s)=>n+s.norm,0),remaining:parts.reduce((n,s)=>n+s.remaining,0),categories:book.categories.map(c=>({...c,amount:parts.reduce((n,s)=>n+(s.categories.find(x=>x.id===c.id)?.amount??0),0)})).filter(c=>c.amount>0)};
}
function deleteCalendarMonth(book,key) {
  const months=calendarMonths(book.sheets);ensure(months.length>1,'В группе должен остаться хотя бы один месяц');
  const month=months.find(m=>m.key===key);ensure(month);
  for(const ref of month.weeks) {
    const sheet=book.sheets.find(s=>s.id===ref.sheetId),days=new Set(weekDates(sheet,ref.index));
    for(const key of Object.keys(sheet.marks))if(days.has(key.split('|')[1]))delete sheet.marks[key];
    book.bonus=book.bonus.filter(op=>!(op.markKey?.startsWith(sheet.id+'|')&&days.has(op.markKey.split('|').at(-1))));
    sheet.norms[ref.index]=0;sheet.removedWeeks=[...new Set([...(sheet.removedWeeks??[]),ref.index])];sheet.closedWeeks=[...new Set([...(sheet.closedWeeks??[]),ref.index])];
  }
}



// journal-data

const journalFolder = "disk:/Посещаемость";
const isJournalData = (path) => path?.endsWith(".attendance.json") === true;
function journalDataPath(id) {
  ensure(/^[A-Za-z0-9-]{1,80}$/.test(id));
  return journalFolder + "/" + id + ".attendance.json";
}
function journalPayload(book) {
  const result = structuredClone(book);
  for (const key of ["pendingUploadHash", "baseData", "baseModel", "remoteHash", "status", "dirty", "diskPath", "accessWarning", "documentsUrl", "localRevision", "syncedRevision"])
    delete result[key];
  result.studentReceipts ??= {};
  result.deletedSheetNames ??= [];
  for (const sheet of result.sheets) {
    for (const key of Object.keys(sheet)) if (key.startsWith("source")) delete sheet[key];
    sheet.closedWeeks ??= [];
    sheet.removedWeeks ??= [];
  }
  return result;
}
function writeJournalData(book) {
  teacherValidate(book);
  return utf8.encode(JSON.stringify({format:"attendance-journal", version:1, journal:journalPayload(book)}));
}
function readJournalData(bytes) {
  ensure(bytes.length <= 20_000_000, "Журнал слишком большой");
  const root = JSON.parse(text(bytes));
  ensure(root.format === "attendance-journal" && root.version === 1, "Неподдерживаемый формат журнала");
  const book = root.journal;
  delete book.pendingUploadHash;
  teacherValidate(book);
  return Object.assign(book, {dirty:false, status:"Синхронизировано с Диском"});
}
async function readJournalFile(bytes, path) {
  ensure(isJournalData(path), "Неподдерживаемый файл группы");
  return readJournalData(bytes);
}


// recovery
class RecoveryAttempts {
  reset(){this.path=null;this.count=0;this.retryAt=0;}
  failed(now=Date.now()){this.retryAt=now+60_000;}
  ready(path,error,now=Date.now()) {
    if(!error.storageUnavailable){this.reset();return false;}
    if(this.path!==path){this.path=path;this.first=now;this.count=0;}
    this.count++;
    if(this.count<3 || now-this.first<30_000 || now<(this.retryAt??0))return false;
    this.retryAt=now+1_800_000;return true;
  }
}
async function recoverWebJournal(book,disk,backup,publish) {
  const original=book.diskPath,metadata=await disk.api('resources',{path:original}),revision=metadata.sha256?.toLowerCase();
  let base;try{base=book.baseData?unb64(book.baseData):null;}catch{}
  const output=writeJournalData(book);
  ensure(revision && (revision===book.pendingUploadHash || (base && await hexHash(base)===book.remoteHash && revision===book.remoteHash) || revision===await hexHash(output)),
    'На Диске другая версия. Автовосстановление остановлено, локальные правки сохранены');
  await backup();
  const destination=journalDataPath(uid()),data=JSON.parse(text(output));data.storageRevision=uid();
  const bytes=utf8.encode(JSON.stringify(data)),hash=await hexHash(bytes);
  await disk.upload(destination,bytes,false);
  ensure(await hexHash(await disk.download(destination,20_000_000))===hash,'Новый файл не прошёл проверку. Группа остаётся подключена к исходному файлу');
  ensure((await disk.api('resources',{path:original})).sha256?.toLowerCase()===revision,'Исходный файл изменился. Восстановление остановлено');
  const next={...book,diskPath:destination,remoteHash:hash,baseData:b64(bytes),baseModel:JSON.stringify(journalPayload(book)),dirty:false,pendingUploadHash:null,syncedRevision:book.localRevision,status:'Синхронизировано с Диском'};
  await publish(next);return next;
}


// registry-recovery
function registryContent(bytes){const value=JSON.parse(text(bytes));delete value.storageRevision;return value;}
async function readTeacherRegistry(path,id,copies,disk,requireWriter,remember){
 try {const bytes=await disk.download(path);await remember(bytes);return bytes;}
 catch(error){
  if(!error.storageUnavailable)throw error;
  const revision=(await disk.api('resources',{path})).sha256?.toLowerCase();
  let original;for(const bytes of copies)if(await hexHash(bytes)===revision){original=bytes;break;}
  ensure(original,'Подключения группы недоступны в Яндексе; нет точной копии этой версии в этом браузере. Привязки сохранены');
  const root=registryContent(original);ensure(root.version===1&&root.bookId===id,'Копия подключений относится к другой группе');
  await requireWriter();
  ensure((await disk.api('resources',{path})).sha256?.toLowerCase()===revision,'Подключения изменились на другом устройстве. Повторим синхронизацию');
  const bytes=utf8.encode(JSON.stringify({...root,storageRevision:uid()}));
  await remember(original);await remember(bytes);await disk.upload(path,bytes,true);await disk.verifyUpload(path,bytes);
  return bytes;
 }
}


// teacher-device
const exchangeFolder = 'disk:/Посещаемость-обмен';
const teacherLeasePath = exchangeFolder + '/сеанс-преподавателя.json';
// shortcut: Disk leases coordinate updated clients; strict atomic exclusion needs a transactional service.
function teacherMayClaim(lease, owner, kind, now = Date.now()) {
  return !lease || lease.expires <= now || lease.owner === owner || (kind === 'android' && lease.kind === 'web');
}
function expiredUnreadableTeacherLease(modified, now = Date.now()) {
  return typeof modified === 'string' && Date.parse(modified) <= now - 60_000;
}
function teacherCatalogRecord(value) {
  ensure(value?.version === 2 && typeof value.id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value.id) && typeof value.deleted === 'boolean' && typeof value.path === 'string' && value.path.startsWith('disk:/') && /\.attendance\.json$/.test(value.path) && !value.path.split('/').includes('..'), 'Повреждён список таблиц преподавателя');
  return value;
}
class TeacherDevice {
  constructor(disk, owner = uid()) { this.disk = disk; this.owner = owner; this.kind = 'web'; this.writable = false; this.checked = 0; }
  async refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.checked < 5000) return this.writable;
    let lease;
    try { lease = JSON.parse(text(await this.disk.download(teacherLeasePath))); }
    catch (e) {
      if (e.status !== 404) {
        this.writable = false;
        if (globalThis.document?.hidden || !(e.status >= 500 && e.status <= 504)) throw e;
        const metadata = await this.disk.api('resources', {path:teacherLeasePath, fields:'type,modified'});
        // A 20-second lease cannot keep blocking devices after a minute without a write.
        if (metadata.type !== 'file' || !expiredUnreadableTeacherLease(metadata.modified, now)) throw e;
      }
    }
    if (lease) ensure(lease.version === 1 && typeof lease.owner === 'string' && ['android','web'].includes(lease.kind) && Number.isFinite(lease.expires), 'Повреждён сеанс преподавателя');
    this.kindOfOwner = lease?.kind;
    if (globalThis.document?.hidden || !teacherMayClaim(lease, this.owner, this.kind, now)) { this.writable = false; this.checked = now; return false; }
    if (lease?.owner !== this.owner || lease.expires - now < 10000) {
      await this.disk.folder(exchangeFolder);
      await this.disk.upload(teacherLeasePath, utf8.encode(JSON.stringify({version:1,owner:this.owner,kind:this.kind,expires:now+20000})), true);
      lease = JSON.parse(text(await this.disk.download(teacherLeasePath)));
    }
    this.writable = lease.owner === this.owner && lease.expires > Date.now(); this.checked = Date.now();
    return this.writable;
  }
  async requireWriter() { if (!await this.refresh(true)) throw Object.assign(new Error(this.kindOfOwner === 'android' ? 'Редактирование открыто в приложении. На сайте доступен просмотр' : 'Редактирование открыто на другом устройстве. Здесь доступен просмотр'), {retry:5000}); }
  async catalog() {
    let files;
    try { files = await this.disk.list(exchangeFolder); } catch (e) { if (e.status === 404) return []; throw e; }
    return Promise.all(files.filter(f => /\/группа-[A-Za-z0-9-]+\.json$/.test(f.path)).map(async f => teacherCatalogRecord(JSON.parse(text(await this.disk.download(f.path))))));
  }
  async publishBook(book, deleted = false) {
    if (!book.diskPath) return;
    await this.requireWriter();
    await this.disk.folder(exchangeFolder);
    await this.disk.upload(exchangeFolder+'/группа-'+book.id+'.json',utf8.encode(JSON.stringify(teacherCatalogRecord({version:book.diskPath.endsWith(".attendance.json")?2:1,id:book.id,path:book.diskPath,deleted}))),true);
  }
}


// teacher

const teacherFolder = "disk:/Посещаемость-обмен";
const teacherClean = journalPayload;
const teacherEqual = (a, b) => {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && teacherEqual(a[k], b[k]))
  );
};
function teacherMerge(base, local, remote, path = "таблица") {
  if (teacherEqual(local, remote) || teacherEqual(remote, base))
    return structuredClone(local);
  if (teacherEqual(local, base)) return structuredClone(remote);
  if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base)) {
    if (path.endsWith("/bonus")) {
      const added = local.filter(
        (o) => o.markKey && !base.some((old) => old.id === o.id),
      );
      ensure(
        !remote.some(
          (o) =>
            !base.some((old) => old.id === o.id) &&
            added.some(
              (p) =>
                p.id !== o.id &&
                p.studentId === o.studentId &&
                p.markKey === o.markKey,
            ),
        ),
        "Конфликт списания бонусов. Выберите версию в параметрах таблицы",
      );
    }
    if (
      [...base, ...local, ...remote].every(
        (x) => x && typeof x === "object" && typeof x.id === "string",
      )
    ) {
      const ids = new Set([...base, ...local, ...remote].map((x) => x.id));
      return [...ids]
        .map((id) =>
          teacherMerge(
            base.find((x) => x.id === id),
            local.find((x) => x.id === id),
            remote.find((x) => x.id === id),
            path + "/" + id,
          ),
        )
        .filter((x) => x !== undefined);
    }
    if (
      /(students|closedWeeks|removedWeeks|deletedSheetNames)$/.test(path) &&
      [...base, ...local, ...remote].every(
        (x) => typeof x === "string" || typeof x === "number",
      )
    )
      return [...new Set([...local, ...remote])].filter(
        (id) =>
          !base.includes(id) || (local.includes(id) && remote.includes(id)),
      );
    if (
      path.endsWith("norms") &&
      local.length === remote.length &&
      base.length === local.length
    )
      return local.map((v, i) =>
        teacherMerge(base[i], v, remote[i], path + "/" + i),
      );
  }
  if (
    local &&
    remote &&
    base &&
    !Array.isArray(local) &&
    typeof local === "object" &&
    typeof remote === "object" &&
    typeof base === "object"
  ) {
    const out = {};
    for (const k of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      if (k.startsWith("source")) {
        out[k] = remote[k];
        continue;
      }
      const value = teacherMerge(base[k], local[k], remote[k], path + "/" + k);
      if (value !== undefined) out[k] = value;
    }
    return out;
  }
  throw new Error(
    "Конфликт изменений: " + path + ". Выберите версию в параметрах таблицы",
  );
}
async function teacherBatch(items, action) {
  const out = [];
  for (let i = 0; i < items.length; i += 4)
    out.push(...(await Promise.all(items.slice(i, i + 4).map(action))));
  return out;
}
// Android UUID.nameUUIDFromBytes uses MD5 (UUID v3), including for retried enrollments.
function teacherEnrollmentId(value) {
  const bytes = utf8.encode(value),
    length = Math.ceil((bytes.length + 9) / 64) * 64,
    padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const data = new DataView(padded.buffer);
  data.setUint32(length - 8, bytes.length * 8, true);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let offset = 0; offset < length; offset += 64) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const n =
          (a +
            f +
            Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) +
            data.getUint32(offset + g * 4, true)) |
          0,
        s = shifts[Math.floor(i / 16) * 4 + (i % 4)];
      a = d;
      d = c;
      c = b;
      b = (b + ((n << s) | (n >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16),
    view = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((n, i) => view.setInt32(i * 4, n, true));
  out[6] = (out[6] & 15) | 48;
  out[8] = (out[8] & 63) | 128;
  const h = [...out].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
class Teacher {
  constructor(exchange, deviceOwner) {
    this.exchange = exchange;
    this.disk = exchange.disk;
    this.account = null;
    this.verified = false;
    this.syncing = false;
    this.device = new TeacherDevice(this.disk, deviceOwner);
    this.catalogAt = 0;
  }
  get writable() { return this.verified && this.device.writable; }
  async restoreCached() {
    const cached=this.exchange.state.teacherSession;
    if(!this.exchange.state.token || !cached || cached.tokenHash!==await hexHash(utf8.encode(this.exchange.state.token)))return;
    const account=this.exchange.state.teacherGroupAccounts?.[cached.owner];
    if(account){this.owner=cached.owner;this.account=account;}
  }
  async syncCatalog() {
    if (Date.now() < this.catalogAt) return;
    const records = await this.device.catalog();
    for (const record of records.filter(r => r.deleted)) {
      const existing = this.books.find(b => b.id === record.id);
      if (!existing) continue;
      if (existing.dirty) existing.status = "Таблица удалена на другом устройстве. Локальные правки сохранены";
      else {
        this.account.books = this.books.filter(b => b.id !== record.id);
        this.registry(record.id).closed = true;
      }
    }
    for (const record of records.filter(r => !r.deleted && !this.account.hiddenBooks?.includes(r.id))) {
      const existing = this.books.find(b => b.id === record.id);
      if (!existing) {
        const bytes = await this.disk.download(record.path, 20_000_000);
        const b = await readJournalFile(bytes, record.path);
        ensure(b.id === record.id, "Идентификатор таблицы изменился");
        Object.assign(b, {diskPath:record.path, remoteHash:await hexHash(bytes), baseData:b64(bytes), baseModel:JSON.stringify(teacherClean(b)),dirty:false,status:"Синхронизировано с Диском"});
        this.books.push(b);
      } else if (existing.diskPath !== record.path) existing.diskPath = record.path;
    }
    if (this.writable) for (const b of this.books.filter(b => b.diskPath)) {
      const record = records.find(r => r.id === b.id);
      if (!record) await this.device.publishBook(b);
      else if (record.deleted) b.status = "Таблица удалена на другом устройстве";
    }
    await this.save(); this.catalogAt = Date.now() + 15_000;
  }
  async open() {
    let owner;
    try {
      owner = (await this.disk.api("")).user?.uid;
    } catch (e) {
      if (e.status !== 403) throw e;
    }
    if (!owner) {
      // Older OAuth tokens have file access without the optional Disk-info scope.
      const path = teacherFolder + "/аккаунт-преподавателя.json";
      await this.disk.folder(teacherFolder);
      let bytes;
      try {
        bytes = await this.disk.download(path);
      } catch (e) {
        if (e.status !== 404) throw e;
        const candidate = utf8.encode(
          JSON.stringify({ version: 1, id: uid() }),
        );
        try {
          await this.disk.upload(path, candidate, false);
        } catch (error) {
          if (error.status !== 409) throw error;
        }
        bytes = await this.disk.download(path);
      }
      ensure(bytes.length <= 1024, "Повреждён профиль преподавателя");
      const profile = JSON.parse(text(bytes));
      ensure(
        profile.version === 1 &&
          typeof profile.id === "string" &&
          /^[a-f0-9-]{36}$/i.test(profile.id),
        "Повреждён профиль преподавателя",
      );
      owner = profile.id;
    }
    ensure(typeof owner === "string" && owner, "Яндекс не вернул аккаунт");
    this.owner = owner;
    this.exchange.state.teacherGroupAccounts ??= {};
    this.account = this.exchange.state.teacherGroupAccounts[owner] ??= {
      books: [],
      registries: {},
      closures: [],
      conflicts: {},
    };
    this.exchange.state.teacherSession={owner,tokenHash:await hexHash(utf8.encode(this.exchange.state.token))};
    this.verified = true;
    await this.save();
  }
  get books() {
    return this.account?.books ?? [];
  }
  get(id) {
    const book = this.books.find((b) => b.id === id);
    ensure(book, "Таблица не найдена");
    return book;
  }
  async save() {
    await this.exchange.save();
  }
  async change(id, action) {
    await this.device.requireWriter();
    const original = this.get(id),
      next = structuredClone(original);
    action(next);
    teacherValidate(next);
    next.dirty = true;
    next.localRevision = (original.localRevision ?? 0) + 1;
    next.status = next.diskPath
      ? "Ожидает синхронизации"
      : "Сохранено в этом браузере";
    this.account.books[this.books.indexOf(original)] = next;
    try {
      await this.save();
    } catch (e) {
      const index = this.books.indexOf(next);
      if (index >= 0) this.account.books[index] = original;
      throw e;
    }
  }
  async add(book) {
    await this.device.requireWriter();
    teacherValidate(book);
    this.account.books.push(book);
    await this.save();
    return book;
  }
  async rename(id, name) {
    await this.device.requireWriter();
    const b = this.get(id);
    if (b.name === name) return;
    let path = b.diskPath;
    await this.change(id, (b) => {
      b.name = name;
      b.diskPath = path;
    });
    await this.device.publishBook(this.get(id));
  }
  async acceptRemote(id) {
    await this.device.requireWriter();
    const old = this.get(id),
      bytes = await this.disk.download(old.diskPath, 20_000_000),
      next = await readJournalFile(bytes, old.diskPath);
    ensure(next.id === id, "На Диске другая таблица");
    Object.assign(next, {
      diskPath: old.diskPath,
      remoteHash: await hexHash(bytes),
      baseModel: JSON.stringify(teacherClean(next)),
      dirty: false,
      status: "Синхронизировано с Диском",
    });
    this.account.books.splice(this.books.indexOf(old), 1, next);
    delete this.account.conflicts[id];
    await this.save();
  }
  async createOnDisk(id) {
    await this.device.requireWriter();
    const b = this.get(id);
    ensure(!b.diskPath);
    await this.disk.folder(journalFolder);
    const path = journalDataPath(b.id),
      snapshot = structuredClone(b),
      bytes = writeJournalData(snapshot);
    await this.disk.upload(path, bytes, false);
    await this.disk.verifyUpload(path, bytes);
    Object.assign(this.get(id), snapshot, {
      diskPath: path,
      remoteHash: await hexHash(bytes),
      baseData: b64(bytes),
      baseModel: JSON.stringify(teacherClean(snapshot)),
      dirty: false,
      status: "Синхронизировано с Диском",
    });
    await this.save();
    await this.device.publishBook(this.get(id));
    await this.pushRegistry(id);
  }
  registry(id) {
    return (this.account.registries[id] ??= {
      version: 1,
      bookId: id,
      teachers: [],
      invitations: [],
      revoked: [],
      retiredInvitations: [],
      closed: false,
    });
  }
  registryPath(id) {
    ensure(/^[A-Za-z0-9-]{1,80}$/.test(id));
    return `${teacherFolder}/привязки-${id}.json`;
  }
  async rememberRegistry(id,bytes) {
    this.account.registryCopies??={};const copies=this.account.registryCopies[id]??[],encoded=b64(bytes);
    if(copies[0]===encoded)return;
    this.account.registryCopies[id]=[encoded,...copies.filter(c=>c!==encoded)].slice(0,2);await this.save();
  }
  async readRegistry(id) {
    const copies=(this.account.registryCopies?.[id]??[]).map(unb64);
    copies.push(utf8.encode(JSON.stringify(this.registry(id))));
    return readTeacherRegistry(this.registryPath(id),id,copies,this.disk,()=>this.device.requireWriter(),bytes=>this.rememberRegistry(id,bytes));
  }
  async pullRegistry(id) {
    let bytes;
    try {
      bytes = await this.readRegistry(id);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
    const remote = JSON.parse(text(bytes));
    ensure(
      remote.version === 1 &&
        remote.bookId === id &&
        Array.isArray(remote.teachers) &&
        remote.teachers.length <= 500 &&
        Array.isArray(remote.invitations) &&
        remote.invitations.length <= 100 &&
        Array.isArray(remote.revoked) &&
        remote.revoked.length <= 5000 &&
        (remote.retiredInvitations === undefined || (Array.isArray(remote.retiredInvitations) && remote.retiredInvitations.length <= 5000 && remote.retiredInvitations.every(value=>typeof value==='string' && /^[A-Za-z0-9-]{1,80}$/.test(value)))),
      "Повреждены подключения таблицы",
    );
    const r = this.registry(id);
    r.revoked = [...new Set([...r.revoked, ...remote.revoked])];
    r.retiredInvitations = [...new Set([...(r.retiredInvitations ?? []), ...(remote.retiredInvitations ?? [])])];
    r.invitations = r.invitations.filter(g => !r.retiredInvitations.includes(g.invitation.id));
    r.closed = remote.closed || this.account.closures.includes(id);
    for (const p of remote.teachers.filter(
      (p) => !r.revoked.includes(p.peerId),
    )) {
      ensure(
        p.bookId === id &&
          /^[A-Za-z0-9-]{1,80}$/.test(p.studentId) &&
          /^[A-Za-z0-9-]{1,80}$/.test(p.peerId) &&
          unb64(p.key).length === 32 &&
          p.viewPath ===
            `${teacherFolder}/преподаватель-${id}-${p.peerId}.json`,
      );
      publicUrl(p.requestUrl);
      publicUrl(p.viewUrl);
      const old = r.teachers.find(
        (x) => x.studentId === p.studentId && !r.revoked.includes(x.peerId),
      );
      ensure(
        !old ||
          (old.peerId === p.peerId &&
            old.key === p.key &&
            old.requestUrl === p.requestUrl),
        "Подключение студента изменилось на другом устройстве",
      );
      if (!old) r.teachers.push(p);
    }
    r.teachers = r.teachers.filter((p) => !r.revoked.includes(p.peerId));
    for (const g of remote.invitations) {
      if (r.retiredInvitations.includes(g.invitation?.id)) continue;
      if (
        g.collected &&
        Date.now() > g.invitation.expires + 900_000 &&
        Object.keys(g.responses).every((k) => g.acknowledged?.includes(k)) &&
        g.responseHash ===
          (await hexHash(utf8.encode(JSON.stringify(g.responses))))
      )
        continue;
      ensure(
        g.invitation?.bookId === id &&
          /^[A-Za-z0-9-]{1,80}$/.test(g.invitation.id) &&
          g.folder === `${teacherFolder}/приглашение-${g.invitation.id}` &&
          typeof g.privateKey === "string" &&
          unb64(g.privateKey).length < 4000 &&
          g.responses &&
          Object.keys(g.responses).length <= 600,
      );
      publicUrl(g.url);
      const old = r.invitations.find(
        (x) => x.invitation.id === g.invitation.id,
      );
      ensure(!old || old.privateKey === g.privateKey);
      if (!old) r.invitations.push(g);
      else {
        // A completed local connection must not be replaced by an older remote rejection.
        for (const [slot, response] of Object.entries(g.responses)) {
          if (old.responsePeers?.[slot] && old.responses[slot]) continue;
          if (old.responses[slot] !== response) old.responseHash = "";
          old.responses[slot] = response;
          if (g.responsePeers?.[slot]) (old.responsePeers ??= {})[slot] = g.responsePeers[slot];
        }
        old.acknowledged = [
          ...new Set([...(old.acknowledged ?? []), ...(g.acknowledged ?? [])]),
        ];
        old.collected ||= g.collected;
      }
    }
    await this.save();
    return bytes;
  }
  async pushRegistry(id) {
    await this.device.requireWriter();
    const before = await this.pullRegistry(id),
      bytes = utf8.encode(JSON.stringify(this.registry(id)));
    if (before && teacherEqual(registryContent(before),registryContent(bytes))) return;
    if (!before) await this.disk.folder(teacherFolder);
    let current;
    try {
      current = await this.readRegistry(id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    ensure(
      (current ? await hexHash(current) : null) ===
        (before ? await hexHash(before) : null),
      "Подключения изменились на другом устройстве. Повторим автоматически",
    );
    await this.rememberRegistry(id,bytes);
    await this.disk.upload(this.registryPath(id), bytes, !!before);
    await this.disk.verifyUpload(this.registryPath(id), bytes);
  }
  async ticket(path) {
    const result = await this.disk.api("resources/upload", {
      path,
      overwrite: false,
    });
    return transferUrl(result.href);
  }
  async invite(id) {
    await this.device.requireWriter();
    const book = this.get(id);
    ensure(book.diskPath, "Сначала создайте таблицу на Диске");
    await this.syncBook(id);
    await this.disk.folder(teacherFolder);
    const code = uid(),
      folder = `${teacherFolder}/приглашение-${code}`;
    await this.disk.folder(folder);
    await this.disk.folder(folder + "/заявки");
    await this.disk.upload(folder + "/ответы.json", utf8.encode("{}"), false);
    const responseUrl = await this.disk.publish(folder + "/ответы.json");
    const keys = await crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
      ),
      publicKey = b64(await crypto.subtle.exportKey("spki", keys.publicKey)),
      privateKey = b64(await crypto.subtle.exportKey("pkcs8", keys.privateKey)),
      r = this.registry(id);
    const students = [], slots=Array.from({length:32},()=>({id:uid(),name:""})),
      rows=await teacherBatch(slots,async s=>({...s,uploadUrl:await this.ticket(folder+"/заявки/"+s.id+".json")}));
    const invitation = {
        id: code,
        bookId: id,
        name: book.name,
        expires: Date.now() + 1_800_000,
        publicKey,
        responseUrl,
        students: rows.slice(0, students.length),
        version: 2,
        registrations: rows.slice(students.length),
      },
      payload = utf8.encode(JSON.stringify(invitation));
    await this.disk.upload(folder + "/приглашение.json", payload, false);
    const url = await this.disk.publish(folder + "/приглашение.json");
    r.invitations.unshift({
      invitation,
      privateKey,
      folder,
      url,
      responses: {},
      responseHash: await hexHash(utf8.encode("{}")),
      collected: false,
      responsePeers: {},
      acknowledged: [],
      retiredStudents: [],
      publishedHash: await hexHash(payload),
    });
    await this.save();
    await this.pushRegistry(id);
    return url;
  }
  async refreshInvitations(book) {
    for (const g of this.registry(book.id).invitations.filter(
      (g) => g.invitation.expires > Date.now(),
    )) {
      g.invitation.students = [];
      g.invitation.name = book.name;
      const bytes = utf8.encode(JSON.stringify(g.invitation)),
        h = await hexHash(bytes);
      if (h !== g.publishedHash) {
        await this.save();
        await this.disk.upload(g.folder + "/приглашение.json", bytes, true);
        g.publishedHash = h;
        await this.save();
      }
    }
  }
  async enrollment(g, bytes) {
    const envelope = JSON.parse(text(bytes));
    ensure(
      bytes.length < 16000 &&
        typeof envelope.key === "string" &&
        typeof envelope.body === "string",
    );
    const key = await crypto.subtle.importKey(
      "pkcs8",
      unb64(g.privateKey),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
    const shared = text(
      new Uint8Array(
        await crypto.subtle.decrypt("RSA-OAEP", key, unb64(envelope.key)),
      ),
    );
    const request = JSON.parse(
      text(await openPeer(shared, unb64(envelope.body))),
    );
    ensure(
      request.invitationId === g.invitation.id &&
        request.invite &&
        /^[A-Za-z0-9-]{1,80}$/.test(request.invite.peerId) &&
        unb64(request.invite.key).length === 32 &&
        typeof request.invite.label === "string" &&
        request.invite.label.length <= 80,
    );
    publicUrl(request.invite.requestUrl);
    return request;
  }
  async connect(id, studentId, invite) {
    await this.device.requireWriter();
    const r = this.registry(id),
      old = r.teachers.find((p) => p.studentId === studentId);
    ensure(
      !r.teachers.some(
        (p) => p.peerId === invite.peerId && p.studentId !== studentId,
      ),
      "Это подключение уже связано с другой строкой",
    );
    ensure(
      !old || old.peerId === invite.peerId,
      "Эта строка уже подключена. Обратитесь к преподавателю",
    );
    if (old) {
      ensure(old.key === invite.key && old.requestUrl === invite.requestUrl);
      return old;
    }
    const feed = JSON.parse(
      text(
        await openPeer(
          invite.key,
          await this.disk.publicFile(invite.requestUrl),
        ),
      ),
    );
    ensure(
      feed.peerId === invite.peerId &&
        Array.isArray(feed.requests) &&
        feed.requests.length === 0,
      "Код уже используется",
    );
    const path = `${teacherFolder}/преподаватель-${id}-${invite.peerId}.json`,
      view = teacherView(this.get(id), studentId, invite.peerId),
      bytes = utf8.encode(JSON.stringify(view));
    await this.disk.upload(path, await sealPeer(invite.key, bytes), true);
    const peer = {
      bookId: id,
      studentId,
      peerId: invite.peerId,
      label: invite.label,
      key: invite.key,
      requestUrl: invite.requestUrl,
      viewPath: path,
      viewUrl: await this.disk.publish(path),
      viewHash: await hexHash(bytes),
    };
    r.teachers.push(peer);
    await this.save();
    return peer;
  }
  async collect(id) {
    const r = this.registry(id);
    for (const g of [...r.invitations]) {
      // Older clients stored a temporary writer lease loss as a permanent enrollment rejection.
      this.checkedEnrollmentErrors ??= new Set();
      for (const [rowId, encoded] of Object.entries(g.responses)) {
        if (!encoded || g.acknowledged?.includes(rowId) || this.checkedEnrollmentErrors.has(encoded)) continue;
        let request;
        try { request = await this.enrollment(g, await this.disk.download(g.folder + "/заявки/" + rowId + ".json")); }
        catch (e) { if (e.status === 404) continue; throw e; }
        const response = JSON.parse(text(await openPeer(request.invite.key, unb64(encoded))));
        if (temporaryEnrollmentError(response.error)) {
          delete g.responses[rowId]; if(g.responsePeers) delete g.responsePeers[rowId]; g.collected = false; await this.save();
        } else this.checkedEnrollmentErrors.add(encoded);
      }
      const rows = [
        ...g.invitation.students,
        ...(g.invitation.registrations ?? []),
        ...(g.retiredStudents ?? []),
      ].filter((row, i, all) => all.findIndex((p) => p.id === row.id) === i);
      if (!g.collected) {
        let files;
        try { files = await this.disk.list(g.folder + "/заявки"); }
        catch (e) {
          if (e.status !== 404 || Date.now() <= g.invitation.expires + 900_000) throw e;
          let removed = false;
          try { await this.disk.api("resources", {path:g.folder,fields:"type"}); }
          catch (missing) { if (missing.status !== 404) throw missing; removed = true; }
          if (!removed) throw e;
          // Another device already removed this expired invitation; keep its student connections.
          r.retiredInvitations = [...new Set([...(r.retiredInvitations ?? []),g.invitation.id])];
          r.invitations = r.invitations.filter(old => old.invitation.id !== g.invitation.id);
          await this.save();
          continue;
        }
        for (const row of rows.filter(
          (row) =>
            !(row.id in g.responses) &&
            files.some(
              (f) => f.path === g.folder + "/заявки/" + row.id + ".json",
            ),
        )) {
          let req;
          try {
            req = await this.enrollment(
              g,
              await this.disk.download(
                g.folder + "/заявки/" + row.id + ".json",
              ),
            );
            ensure(req.studentId === row.id);
          } catch (e) {
            if (e.status || e.retry || e.network || e.name === "TypeError") throw e;
            g.responses[row.id] = "";
            continue;
          }
          let response;
          try {
            const fresh = g.invitation.registrations?.some(
              (s) => s.id === row.id,
            );
            ensure(!!fresh === (req.newName !== undefined));
            let studentId = row.id;
            if (fresh) {
              const feed = JSON.parse(
                text(
                  await openPeer(
                    req.invite.key,
                    await this.disk.publicFile(req.invite.requestUrl),
                  ),
                ),
              );
              const existing = r.teachers.find(
                (p) => p.peerId === req.invite.peerId,
              );
              ensure(
                feed.peerId === req.invite.peerId &&
                  Array.isArray(feed.requests) &&
                  (!feed.requests.length ||
                    (existing?.key === req.invite.key &&
                      existing?.requestUrl === req.invite.requestUrl)),
              );
              studentId = existing?.studentId;
              if (!studentId)
                await this.change(id, (b) => {
                  studentId = teacherAddStudent(
                    b,
                    req.newName,
                    teacherEnrollmentId(id + ":" + req.invite.peerId),
                  ).id;
                });
            }
            ensure(
              this.get(id).students.some((s) => s.id === studentId) &&
                this.get(id).sheets.some((s) => s.students.includes(studentId)),
              "Студент больше не входит в таблицу",
            );
            const peer = await this.connect(id, studentId, req.invite),
              reply = {
                peerId: peer.peerId,
                label: peer.label,
                bookId: id,
                studentId,
                viewUrl: peer.viewUrl,
              };
            response = {
              reply:
                peer.label +
                "." +
                b64(
                  await sealPeer(peer.key, utf8.encode(JSON.stringify(reply))),
                  true,
                ),
            };
            g.responsePeers ??= {};
            g.responsePeers[row.id] = peer.peerId;
          } catch (e) {
            if (
              (e.status && ![400, 404, 410].includes(e.status)) ||
              e.retry || e.network ||
              e.name === "TypeError"
            )
              throw e;
            response = { error: e.message || "Не удалось проверить заявку" };
          }
          g.responses[row.id] = b64(
            await sealPeer(
              req.invite.key,
              utf8.encode(JSON.stringify(response)),
            ),
          );
          await this.save();
        }
        if (
          Date.now() > g.invitation.expires + 900_000 ||
          Object.keys(g.responses).length === rows.length
        )
          g.collected = true;
      }
      const bytes = utf8.encode(JSON.stringify(g.responses)),
        h = await hexHash(bytes);
      if (h !== g.responseHash) {
        await this.disk.upload(g.folder + "/ответы.json", bytes, true);
        await this.disk.verifyUpload(g.folder + "/ответы.json", bytes);
        g.responseHash = h;
        await this.save();
      }
    }
  }
  async applyFeeds(id) {
    await this.device.requireWriter();
    const r = this.registry(id);
    let error;
    const entries = await teacherBatch(r.teachers, async (peer) => {
      try {
        return {
          peer,
          feed: JSON.parse(
            text(
              await openPeer(
                peer.key,
                await this.disk.publicFile(peer.requestUrl),
              ),
            ),
          ),
        };
      } catch (e) {
        return { peer, error: e };
      }
    });
    for (const entry of entries) {
      if (entry.error) {
        error ??= entry.error;
        continue;
      }
      const { peer, feed } = entry;
      ensure(
        feed.peerId === peer.peerId &&
          Array.isArray(feed.requests) &&
          feed.requests.length <= 2000 &&
          new Set(feed.requests.map((r) => r.id)).size === feed.requests.length,
        "Повреждены запросы студента",
      );
      const book = this.get(id);
      if (!book.students.some((s) => s.id === peer.studentId)) continue;
      const pending = feed.requests.filter(
        (req) => !(peer.peerId + "|" + req.id in (book.studentReceipts ?? {})),
      );
      if (pending.length)
        await this.change(id, (b) => {
          b.studentReceipts ??= {};
          for (const req of pending) {
            ensure(/^[A-Za-z0-9-]{1,80}$/.test(req.id));
            let reason = "";
            try {
              if (req.newName !== undefined) {
                ensure(
                  req.sheetId === "" &&
                    req.date === "" &&
                    req.amount === 0 &&
                    req.categoryId === undefined,
                );
                b.students.find((s) => s.id === peer.studentId).name =
                  studentName(req.newName);
                teacherSort(b);
              } else
                teacherMark(
                  b,
                  peer.studentId,
                  req.sheetId,
                  req.date,
                  req.amount,
                  req.categoryId ?? "bonus",
                  true,
                  req.id,
                );
            } catch (e) {
              reason = e.message || "Отметка отклонена";
            }
            b.studentReceipts[peer.peerId + "|" + req.id] = reason;
          }
        });
      if (feed.enrollmentId)
        for (const g of r.invitations.filter(
          (g) => g.invitation.id === feed.enrollmentId,
        )) {
          g.acknowledged ??= [];
          for (const [slot, p] of Object.entries(g.responsePeers ?? {}))
            if (p === peer.peerId && !g.acknowledged.includes(slot))
              g.acknowledged.push(slot);
        }
    }
    await this.save();
    return error;
  }
  async publishViews(id) {
    await this.device.requireWriter();
    const b = this.get(id);
    if (b.dirty) return;
    await teacherBatch(this.registry(id).teachers, async (peer) => {
      if (!b.students.some((s) => s.id === peer.studentId)) return;
      const bytes = utf8.encode(
          JSON.stringify(teacherView(b, peer.studentId, peer.peerId)),
        ),
        h = await hexHash(bytes);
      if (h !== peer.viewHash) {
        const sealed = await sealPeer(peer.key, bytes);
        await this.disk.upload(peer.viewPath, sealed, true);
        await this.disk.verifyUpload(peer.viewPath, sealed);
        peer.viewHash = h;
      }
    });
    await this.save();
  }
  async automaticRecovery(id,error) {
    if(!this.writable)return false;
    this.recoveryAttempts??=new Map();
    if(!this.recoveryAttempts.has(id))this.recoveryAttempts.set(id,new RecoveryAttempts());
    const book=this.get(id);
    if(!this.recoveryAttempts.get(id).ready(book.diskPath,error))return false;
    try {
    await this.device.requireWriter();
    const snapshot=structuredClone(book);
    const checkCatalog=async()=>{const record=(await this.device.catalog()).find(r=>r.id===id);ensure(record&&!record.deleted&&record.path===snapshot.diskPath,'Подключение группы изменилось. Обновите список групп');};
    await checkCatalog();
    const next=await recoverWebJournal(snapshot,this.disk,async()=>{
      this.account.recovery??={};this.account.recovery[id]=snapshot;await this.save();
    },async recovered=>{
      await this.device.requireWriter();await checkCatalog();
      await this.device.publishBook(recovered);
      const record=(await this.device.catalog()).find(r=>r.id===id);
      ensure(record&&!record.deleted&&record.path===recovered.diskPath,'Не удалось подтвердить обновление списка групп');
    });
    const current=this.get(id);
    const pending=current.localRevision!==snapshot.localRevision;
    Object.assign(current,{pendingUploadHash:null,diskPath:next.diskPath,remoteHash:next.remoteHash,baseData:next.baseData,baseModel:next.baseModel,syncedRevision:next.syncedRevision,dirty:pending,status:pending?'Ожидает синхронизации':next.status});
    await this.save();return true;
    } catch(e) {this.recoveryAttempts.get(id).failed();throw e;}
  }
  async syncBook(id) {
    let b = this.get(id);
    if (!b.diskPath) return;
    const path = b.diskPath;
    let bytes;
    try {
      bytes = await this.disk.download(path, 20_000_000);
    } catch (e) {
      if (e.status === 404) {
        this.catalogAt = 0;
        throw new Error("Таблица недоступна по прежнему пути. Обновим список таблиц автоматически");
      }
      if(await this.automaticRecovery(id,e))return this.syncBook(id);
      throw e;
    }
    const revision = await hexHash(bytes);
    b = this.get(id);
    if (revision !== b.remoteHash) {
      const remote = await readJournalFile(
        bytes,
        path,
      );
      ensure(remote.id === b.id, "Идентификатор таблицы на Диске изменился");
      if (b.dirty) {
        try {
          const merged = teacherMerge(
            JSON.parse(b.baseModel),
            teacherClean(b),
            teacherClean(remote),
          );
          Object.assign(b, merged);
        } catch (e) {
          this.account.conflicts[id] = {
            remote: b64(bytes),
            message: e.message,
          };
          await this.save();
          throw e;
        }
      } else {
        const index = this.books.indexOf(b);
        this.books[index] = remote;
        b = remote;
      }
      Object.assign(b, {
        diskPath: path,
        remoteHash: revision,
        baseData: b64(bytes),
        baseModel: JSON.stringify(teacherClean(remote)),
      });
      await this.save();
    }
    const status = b.dirty ? "Ожидает синхронизации" : "Синхронизировано с Диском";
    if (b.status !== status) { b.status = status; await this.save(); }
    await this.pullRegistry(id);
    if (this.registry(id).closed) {
      this.get(id).status = "Обмен таблицей закрыт";
      await this.save();
      return;
    }
    if (!this.writable) return;
    await this.device.requireWriter();
    await this.refreshInvitations(this.get(id));
    await this.collect(id);
    const feedError = await this.applyFeeds(id);
    b = this.get(id);
    if (b.dirty) {
      await this.device.requireWriter();
      const snapshot = structuredClone(b),
        output = writeJournalData(snapshot);
      ensure(
        (await hexHash(await this.disk.download(b.diskPath, 20_000_000))) ===
          b.remoteHash,
        "Таблица изменилась на Диске. Повторим синхронизацию",
      );
      const destination = b.diskPath;
      try {
        b.pendingUploadHash=await hexHash(output);await this.save();
        await this.disk.upload(destination, output, true);
        await this.disk.verifyUpload(destination, output);
      } catch(e) {if(await this.automaticRecovery(id,e))return this.syncBook(id);throw e;}
      await this.device.publishBook({...b, diskPath:destination});
      const current = this.get(id);
      Object.assign(current, {
        remoteHash: await hexHash(output),
        pendingUploadHash:null,
        baseData: b64(output),
        baseModel: JSON.stringify(teacherClean(snapshot)),
        diskPath:destination,
        documentsUrl:null,
        accessWarning:null,
        dirty: (current.localRevision ?? 0) !== (snapshot.localRevision ?? 0),
      });
      current.status = current.dirty
        ? "Ожидает синхронизации"
        : "Синхронизировано с Диском";
      await this.save();
    }
    await this.publishViews(id);
    await this.cleanup(id);
    await this.pushRegistry(id);
    this.recoveryAttempts?.get(id)?.reset();
    if (feedError) throw feedError;
  }
  async cleanup(id) {
    const r = this.registry(id);
    for (const g of [...r.invitations])
      if (
        g.collected &&
        Date.now() > g.invitation.expires + 900_000 &&
        Object.keys(g.responses).every((k) => g.acknowledged?.includes(k)) &&
        g.responseHash ===
          (await hexHash(utf8.encode(JSON.stringify(g.responses))))
      ) {
        await this.disk.trash(g.folder);
        r.retiredInvitations = [...new Set([...(r.retiredInvitations ?? []),g.invitation.id])];
        r.invitations.splice(r.invitations.indexOf(g), 1);
        await this.save();
      }
  }
  async close(id) {
    await this.device.requireWriter();
    this.registry(id).closed = true;
    if (!this.account.closures.includes(id)) this.account.closures.push(id);
    await this.save();
    await this.flushClosures();
  }
  async flushClosures() {
    if (this.account.closures.length) await this.device.requireWriter();
    for (const id of [...this.account.closures]) {
      await this.pullRegistry(id);
      const r = this.registry(id);
      r.closed = true;
      await teacherBatch(r.teachers, async (peer) => {
        const sealed = await sealPeer(
          peer.key,
          utf8.encode(
            JSON.stringify({
              bookId: id,
              studentId: peer.studentId,
              removed: true,
            }),
          ),
        );
        await this.disk.upload(peer.viewPath, sealed, true);
        await this.disk.verifyUpload(peer.viewPath, sealed);
      });
      await this.pushRegistry(id);
      this.account.closures = this.account.closures.filter((x) => x !== id);
      await this.save();
    }
  }
  async remove(id, fromDisk) {
    await this.device.requireWriter();
    const b = this.get(id);
    if (fromDisk) {
      ensure(
        (await hexHash(await this.disk.download(b.diskPath, 20_000_000))) ===
          b.remoteHash,
        "Таблица изменилась. Сначала дождитесь синхронизации",
      );
      await this.disk.trash(b.diskPath);
      await this.device.publishBook(b, true);
    }
    this.account.hiddenBooks = [...new Set([...(this.account.hiddenBooks ?? []),id])];
    if (
      !b.diskPath &&
      !this.registry(id).teachers.length &&
      !this.registry(id).invitations.length
    ) {
      this.account.books = this.books.filter((b) => b.id !== id);
      await this.save();
      return;
    }
    this.registry(id).closed = true;
    if (!this.account.closures.includes(id)) this.account.closures.push(id);
    this.account.books = this.books.filter((b) => b.id !== id);
    await this.save();
    await this.flushClosures();
  }
  async removeStudent(id, studentId) {
    ensure(this.get(id).students.some(s=>s.id===studentId), "Студент не найден");
    if(this.registry(id).teachers.some(p=>p.studentId===studentId))await this.disconnect(id,studentId);
    await this.change(id,book=>teacherRemoveStudent(book,studentId));
  }
  async disconnect(id, studentId) {
    await this.device.requireWriter();
    const r = this.registry(id),
      peers = r.teachers.filter((p) => p.studentId === studentId);
    for (const p of peers)
      await this.disk.api("resources/unpublish", { path: p.viewPath }, "PUT");
    r.revoked = [...new Set([...r.revoked, ...peers.map((p) => p.peerId)])];
    r.teachers = r.teachers.filter((p) => p.studentId !== studentId);
    await this.save();
    await this.pushRegistry(id);
  }
  async sync() {
    if(!this.verified)await this.open();
    if (this.syncing || !this.account) return;
    if (this.retryAt > Date.now())
      throw Object.assign(
        new Error(
          "Яндекс временно ограничил синхронизацию. Изменения сохранены",
        ),
        { retry: this.retryAt - Date.now() },
      );
    this.syncing = true;
    try {
      await this.device.refresh();
      await this.syncCatalog();
      if (this.writable) await this.flushClosures();
      let failure;
      for (const b of [...this.books].filter(
        (b) => b.diskPath,
      ))
        try {
          await this.syncBook(b.id);
        } catch (e) {
          if (e.status === 401) throw e;
          this.get(b.id).status = this.registry(b.id).closed
            ? "Таблица недоступна"
            : this.get(b.id).dirty
              ? "Ожидает синхронизации"
              : "Не удалось обновить таблицу";
          failure ??= e;
          if (e.retry)
            this.retryAt = Math.max(this.retryAt ?? 0, Date.now() + e.retry);
          await this.save();
        }
      if (failure) throw failure;
    } finally {
      this.syncing = false;
    }
  }
}


// teacher-ui

function teacherInterface(api) {
  const { el, button, field, modal, showError, dateLabel, themeMenu, icon } =
    api;
  let bookId = null,
    sheetId = null,
    week = 0,
    tab = "journal",
    wholeSheet = false,
    query = "",
    below = false,
    deficit = false,
    detail = null,
    positionOwner = null, tablePosition = {top:0,left:0}, tableOverride = null, openActions = null;
  const desktop = matchMedia("(min-width: 900px)");
  const closeActions = () => {if(openActions?.matches(":popover-open"))openActions.hidePopover();openActions=null;};
  desktop.addEventListener("change",()=>{closeActions();if(tableOverride===null && bookId)render();});
  window.addEventListener("resize",closeActions);
  document.addEventListener("scroll",event=>{if(openActions && !openActions.contains(event.target))closeActions();},true);
  const service = () => api.service(),
    book = () => (bookId ? service().books.find((b) => b.id === bookId) : null);
  const savePosition = () => {
    try {
      if (bookId)
        localStorage.setItem(
          "attendance-teacher-page:" + bookId,
          JSON.stringify({ sheetId, week, tab, wholeSheet, detail, tableOverride }),
        );
    } catch {
      showError("Не удалось запомнить месяц и неделю");
    }
  };
  const readPosition = () => {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("attendance-teacher-page:" + bookId)); } catch {}
    sheetId = saved?.sheetId;
    week = Number.isInteger(saved?.week) ? saved.week : 0;
    tab = saved?.tab === "settings" ? "settings" : "journal";
    wholeSheet = saved?.wholeSheet === true;
    detail = saved?.detail?.studentId ? saved.detail : null;
    tableOverride = typeof saved?.tableOverride === "boolean" ? saved.tableOverride : null;
  };
  const rememberBook = () => {
    try {
      const key = "attendance-teacher-book:" + positionOwner;
      if (bookId) localStorage.setItem(key, bookId);
      else localStorage.removeItem(key);
    } catch { showError("Не удалось запомнить открытую группу"); }
  };
  const navigationState = () => ({owner:positionOwner,bookId,sheetId,week,tab,wholeSheet,detail,tableOverride,scroll:scrollY});
  const writeNavigation = (push=false) => {
    const previous=history.state?.attendanceTeacher;
    const depth=previous?.owner===positionOwner ? previous.depth : 0;
    history[push?"pushState":"replaceState"]({...history.state,attendanceTeacher:{...navigationState(),depth:depth+(push?1:0)}},"");
  };
  const restoreNavigation = saved => {
    ({bookId,sheetId,week,tab,wholeSheet,detail,tableOverride}=saved);
  };
  window.addEventListener("popstate",event=>{
    const saved=event.state?.attendanceTeacher;
    if(!service()?.account || saved?.owner!==positionOwner)return;
    restoreNavigation(saved);
    rememberBook();
    render();
    requestAnimationFrame(()=>scrollTo(0,saved.scroll??0));
  });
  const goBook = (id) => {
    writeNavigation();
    bookId = id;
    detail = null;
    tab = "journal";
    query = "";
    rememberBook();
    readPosition();
    detail = null;
    writeNavigation(true);
    render();
    scrollTo(0, 0);
  };
  const back = () => {
    if(history.state?.attendanceTeacher?.owner===positionOwner && history.state.attendanceTeacher.depth>0) {
      history.back();
      return;
    }
    if (detail) {
      const y = detail.scroll;
      detail = null;
      render();
      requestAnimationFrame(() => scrollTo(0, y));
    } else {
      bookId = null;
      rememberBook();
      render();
      scrollTo(0, 0);
    }
  };
  const run = (fn, label) => {
    if(!service().writable){showError("Сейчас доступен только просмотр. Дождитесь проверки устройства");return;}
    return api.operate(fn, label);
  };
  async function change(action) {
    const y = scrollY;
    await run(async () => {
      await service().change(bookId, action);
    }, "Сохранение…");
    requestAnimationFrame(() => scrollTo(0, y));
  }
  function textEdit(title, label, value, action, type = "text") {
    const f = field(label, {
      value,
      type,
      required: true,
      maxLength: type === "text" ? 200 : undefined,
    });
    if (type === "number") {
      f.input.min = "0";
      f.input.max = "1000000";
      f.input.step = "1";
      f.input.inputMode = "numeric";
      f.wrap.classList.add("count-field");
    }
    modal(title, f.wrap, [
      button(
        "Сохранить",
        () => {
          if (!f.input.reportValidity()) return;
          try {
            const value = f.input.value;
            document.querySelector("#editor").close();
            action(value);
          } catch (e) {
            showError(e.message);
          }
        },
        "primary",
      ),
    ]);
  }
  function monthField(label, value) {
    const f=field(label,{type:"month",value,required:true});
    if(f.input.type==="month")return {...f,valid:()=>f.input.reportValidity()};
    const wrap=el("div",undefined,"stack"),monthLabel=el("label",undefined,"field"),month=el("select"),
      year=field("Год",{type:"number",value:value.slice(0,4),min:"1",max:"9999",step:"1",required:true,inputMode:"numeric"});
    for(let i=1;i<=12;i++) {
      const key=String(i).padStart(2,"0"),option=el("option",new Date('2000-'+key+'-01T12:00:00Z').toLocaleDateString('ru',{month:'long',timeZone:'UTC'}));
      option.value=key;month.append(option);
    }
    month.value=value.slice(5,7);monthLabel.append(el("span",label),month);f.input.type="hidden";
    const update=()=>{f.input.value=year.input.value.padStart(4,"0")+'-'+month.value;};
    month.onchange=update;year.input.oninput=update;wrap.append(monthLabel,year.wrap,f.input);
    return {wrap,input:f.input,valid:()=>year.input.reportValidity()};
  }
  function confirm(title, copy, action, label = "Удалить") {
    modal(title, el("p", copy), [
      button(
        label,
        () => {
          document.querySelector("#editor").close();
          action();
        },
        "danger",
      ),
    ]);
  }
  function confirmStudent(title, name, action, label = "Удалить", description = "") {
    const form = el("form", undefined, "stack"), surname = field("Фамилия", {required:true, autocomplete:"family-name", maxLength:200});
    form.append(el("p", name));
    if(description)form.append(el("p",description));
    form.append(surname.wrap);
    const submit = button(label, () => form.requestSubmit(), "danger");
    submit.disabled = true;
    surname.input.oninput = () => {submit.disabled = !matchesStudentSurname(name, surname.input.value);};
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!matchesStudentSurname(name, surname.input.value)) return;
      document.querySelector("#editor").close(); action();
    };
    modal(title, form, [submit]);
  }
  function renameStudent(row) {
    textEdit("Изменить ФИО", "ФИО", row.name, (value) =>
      change((b) => {
        b.students.find((s) => s.id === row.id).name = studentName(value);
        teacherSort(b);
      }),
    );
  }
  function award(row) {
    textEdit(
      "Начислить бонусы",
      "Количество пар",
      "1",
      (value) =>
        change((b) => {
          const amount = Number(value);
          ensure(
            Number.isInteger(amount) && amount >= 1 && amount <= 1_000_000,
            "Количество от 1 до 1000000",
          );
          b.bonus.push({
            id: uid(),
            studentId: row.id,
            amount,
            reason: "Начисление преподавателем",
            created: Date.now(),
          });
        }),
      "number",
    );
  }
  function studentMenu(row) {
    const menu = el("div", undefined, "row-menu"),
      summary = button("",()=>{},"student-menu-trigger","more");
    summary.setAttribute("aria-label", "Действия: " + row.name);
    summary.setAttribute("aria-expanded","false");
    const actions = el("div", undefined, "student-actions");
    actions.setAttribute("popover","auto");
    const isOpen=()=>typeof actions.showPopover==="function" && actions.matches(":popover-open");
    const dismiss=()=>{if(isOpen())actions.hidePopover();else document.querySelector("#editor").close();};
    summary.onclick=()=>{
      if(isOpen()){actions.hidePopover();return;}
      if(!actions.showPopover){actions.removeAttribute("popover");modal(row.name,actions,[]);return;}
      actions.showPopover();openActions=actions;
      const anchor=summary.getBoundingClientRect(),box=actions.getBoundingClientRect(),gap=12;
      actions.style.left=Math.max(gap,Math.min(anchor.right-box.width,innerWidth-box.width-gap))+"px";
      actions.style.top=(desktop.matches?Math.max(gap,Math.min(anchor.bottom+6,innerHeight-box.height-gap)):Math.max(gap,innerHeight-box.height-gap))+"px";
    };
    actions.addEventListener("toggle",()=>{summary.setAttribute("aria-expanded",String(isOpen()));});
    actions.append(el("p",row.name,"menu-student-name"));
    actions.append(
      button(
        "Изменить ФИО",
        () => {
          dismiss();
          renameStudent(row);
        },
        "text-button",
      ),
      button(
        "Начислить бонусы",
        () => {
          dismiss();
          award(row);
        },
        "text-button",
      ),
      button(
        "Убрать из группы",
        () => {
          dismiss();
          confirmStudent("Убрать из группы?", row.name, () =>
            run(() => service().removeStudent(bookId,row.id)),
            "Удалить", "Отметки и бонусы за все месяцы будут удалены, привязка отключена.",
          );
        },
        "text-button danger",
      ),
    );
    menu.append(summary, actions);
    return menu;
  }
  function markEditor(row, sheet, date) {
    const b = book(),
      old = sheet.marks[row.id + "|" + date],
      content = el("form", undefined, "mark-form");
    content.onsubmit = (e) => e.preventDefault();
    const categories = b.categories.filter(
        (c) => c.effect !== "BONUS" && (!c.deleted || c.id === old?.categoryId),
      ),
      select = el("select");
    select.setAttribute("aria-label", "Вид отметки");
    for (const c of categories) {
      const option = el("option", c.name);
      option.value = c.id;
      select.append(option);
    }
    select.value = categories.some((c) => c.id === old?.categoryId)
      ? old.categoryId
      : categories[0]?.id;
    const count = field("Количество пар", {
      type: "number",
      inputMode: "numeric",
      min: "1",
      max: "1000000",
      step: "1",
      value: String(old?.amount ?? 1),
      required: true,
    });
    count.wrap.classList.add("count-field");
    content.append(select, count.wrap);
    const actions = [];
    if (old)
      actions.push(
        button(
          "Убрать",
          () => {
            document.querySelector("#editor").close();
            change((b) =>
              teacherMark(b, row.id, sheet.id, date, 0, old.categoryId),
            );
          },
          "danger",
        ),
      );
    const save = button(
      "Сохранить",
      () => {
        if (!content.reportValidity()) return;
        document.querySelector("#editor").close();
        change((b) =>
          teacherMark(
            b,
            row.id,
            sheet.id,
            date,
            Number(count.input.value),
            select.value,
          ),
        );
      },
      "primary",
    );
    save.disabled = !categories.length;
    actions.push(save);
    modal(dateLabel(date, sheet.dateView), content, actions);
  }
  function createBook() {
    const form = el("form", undefined, "stack"),
      name = field("Название группы", {
        value: "Посещаемость",
        required: true,
        maxLength: 200,
      });
    const now = new Date(),
      start = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
      );
    const date = monthField("Первый месяц",start.toISOString().slice(0,7));
    form.append(name.wrap, date.wrap);
    form.onsubmit = (e) => e.preventDefault();
    modal("Создать группу", form, [
      button(
        "Создать",
        () => {
          if (!form.reportValidity()) return;
          try {
            const next = teacherNewBook(name.input.value, monthSheet(date.input.value).start);
            document.querySelector("#editor").close();
            run(async () => {
              next.sheets=[monthSheet(date.input.value)];
              await service().add(next);
              goBook(next.id);
              await service().createOnDisk(next.id);
            });
          } catch (e) {
            showError(e.message);
          }
        },
        "primary",
      ),
    ]);
  }
  function inviteBlock(b) {
    const wrap = el("section", undefined, "invitation-block");
    const current = service()
      .registry(b.id)
      .invitations.filter((g) => g.invitation.expires > Date.now())
      .sort((a, b) => b.invitation.expires - a.invitation.expires)[0];
    wrap.append(
      button(
        !b.diskPath
          ? "Сохранить группу на Диске"
          : current
            ? "Новое приглашение"
            : "Пригласить студентов",
        () =>
          run(
            async () => {
              if (!b.diskPath) await service().createOnDisk(b.id);
              else await service().invite(b.id);
            },
            !b.diskPath ? "Создание группы…" : "Подготовка приглашения…",
          ),
        "primary",
        !b.diskPath ? "external" : "next",
      ),
    );
    if (current) {
      const time = new Date(current.invitation.expires).toLocaleTimeString(
          "ru",
          { hour: "2-digit", minute: "2-digit" },
        ),
        url = el("a", current.url, "invite-url");
      url.href = current.url;
      url.target = "_blank";
      url.rel = "noopener noreferrer";
      wrap.append(
        el("p", "Приглашение до " + time),
        url,
        button(
          "Отправить ссылку",
          async () => {
            try {
              if (navigator.share)
                await navigator.share({ title: b.name, url: current.url });
              else {
                await navigator.clipboard.writeText(current.url);
                showError("Ссылка скопирована");
              }
            } catch (e) {
              if (e.name !== "AbortError")
                showError("Не удалось отправить ссылку");
            }
          },
          "text-button",
          "external",
        ),
      );
    }
    return wrap;
  }
  function selectors(b,sheet,currentWeek,detailMode=false,onlyWeeks=false) {
    const source=detailMode?b.sheets.filter(s=>s.students.includes(detail.studentId)):b.sheets;
    const months=calendarMonths(source),month=currentMonth(months,sheet.id,currentWeek);
    const panel=el("section",undefined,"teacher-controls");
    const choose=ref=>{
      if(detailMode){detail.sheetId=ref.sheetId;detail.week=ref.index;}
      else {sheetId=ref.sheetId;week=ref.index;tablePosition={top:0,left:0};savePosition();}
      render();
    };
    if(!onlyWeeks) {
      const label=el("label",undefined,"field month-picker");label.append(el("span","Месяц"));
      const select=el("select");select.setAttribute("aria-label","Месяц");
      for(const m of months){const option=el("option",m.title);option.value=m.key;select.append(option);}
      select.value=month.key;select.onchange=()=>choose(months.find(m=>m.key===select.value).weeks[0]);label.append(select);panel.append(label);
    }
    if(detailMode && detail.wholeSheet)return panel;
    const weeks=el("div",undefined,"weeks week-picker");weeks.setAttribute("role","group");weeks.setAttribute("aria-label","Неделя");
    for(const ref of month.weeks) {
      const selected=ref.sheetId===sheet.id&&ref.index===currentWeek;
      const item=button(weekRange(ref),()=>{if(!detailMode)wholeSheet=false;choose(ref);},`week${selected?" selected":""}`);
      item.setAttribute("aria-pressed",String(selected));weeks.append(item);
    }
    panel.append(weeks);return panel;
  }
  function renderJournal(main, b, sheet) {
    const month=currentMonth(calendarMonths(b.sheets),sheet.id,week);
    main.append(inviteBlock(b));
    const controls = selectors(b, sheet, week, false, true),
      actions = el("div", undefined, "week-actions"),
      norm = button(
        "",
        () =>
          textEdit(
            "Норма недели",
            "Количество пар",
            String(sheet.norms[week]),
            (value) =>
              change((b) => teacherSetNorm(b, sheet.id, week, Number(value))),
            "number",
          ),
        "norm-button",
      );
    norm.append(
      el("span", "Норма недели"),
      el("strong", String(sheet.norms[week])),
    );
    const closed = sheet.closedWeeks?.includes(week);
    actions.append(
      norm,
      button(closed ? "Открыть неделю" : "Закрыть неделю", () =>
        change((b) => {
          const s = b.sheets.find((s) => s.id === sheet.id);
          s.closedWeeks = closed
            ? s.closedWeeks.filter((w) => w !== week)
            : [...(s.closedWeeks ?? []), week];
        }),
      ),
    );
    controls.append(actions);
    const modes = el("div", undefined, "filter-bar");
    for (const [value, title] of [[false,"Неделя"],[true,"Месяц"]]) {
      const mode = button(title, () => {wholeSheet=value;render();}, "filter-chip");
      mode.setAttribute("aria-pressed", String(wholeSheet===value)); modes.append(mode);
    }
    main.append(modes);if(!wholeSheet)main.append(controls);
    const header = el("div", undefined, "section-heading");
    const fullTable=tableOverride??desktop.matches;
    header.append(el("h2","Студенты"),button(fullTable?"Компактный список":"Полная таблица",()=>{tableOverride=!fullTable;render();},"text-button"));
    main.append(header);
    const search = field("Поиск студентов", {
        type: "search",
        placeholder: "Поиск студентов",
        value: query,
        autocomplete: "off",
      }),
      filters = el("div", undefined, "filter-bar"),
      rows = el("div", undefined, "compact-students");
    const belowButton = button(
        "Ниже нормы",
        () => {
          below = !below;
          belowButton.setAttribute("aria-pressed", String(below));
          populate();
        },
        "filter-chip",
      ),
      sortButton = button(
        "Сначала недостающие пары",
        () => {
          deficit = !deficit;
          sortButton.setAttribute("aria-pressed", String(deficit));
          populate();
        },
        "filter-chip",
      );
    belowButton.setAttribute("aria-pressed", String(below));
    sortButton.setAttribute("aria-pressed", String(deficit));
    filters.append(belowButton, sortButton);
    main.append(search.wrap, filters, rows);
    function populate() {
      rows.replaceChildren();
      const source = book(), currentSheet = source.sheets.find((s) => s.id === sheet.id);
      const roster=wholeSheet?{...currentSheet,students:[...new Set(month.weeks.flatMap(ref=>source.sheets.find(s=>s.id===ref.sheetId).students))]}:currentSheet;
      const visible = teacherRows(source, roster, week, query, false, false)
        .map(row => ({...row, stats:wholeSheet?teacherMonthStats(source,month.weeks,row.id):teacherPeriodStats(source,currentSheet,row.id,week)}))
        .filter(row => !below || row.stats.remaining>0);
      if(deficit) visible.sort((a,b) => b.stats.remaining-a.stats.remaining);
      const openStudent=row=>{writeNavigation();detail={studentId:row.id,sheetId:sheet.id,week,wholeSheet,scroll:scrollY};writeNavigation(true);render();scrollTo(0,0);};
      if(!fullTable) {
        const list=el("ul",undefined,"student-list");rows.append(list);
        for(const row of visible) {
          const item=el("li"),open=button("",()=>openStudent(row),"student-list-open"),name=el("span",row.name,"student-list-name"),counts=el("span",undefined,"student-list-counts");
          counts.append(el("strong",row.stats.completed+" / "+row.stats.norm),el("span","Бонусы: "+row.balance));
          open.append(name,counts);item.append(open,studentMenu(row));list.append(item);
        }
      } else {
      const viewport=el("div",undefined,"attendance-scroll"), table=el("table",undefined,`attendance-grid${wholeSheet?" month-grid":""}`);
      viewport.tabIndex=0;viewport.setAttribute("aria-label",wholeSheet?"Посещаемость за месяц":"Посещаемость за неделю");
      const head=el("thead"), headRow=el("tr"), nameHeading=el("th","Студент");nameHeading.scope="col";headRow.append(nameHeading);
      const headings=wholeSheet?month.weeks.map(weekRange):weekDates(sheet,week).map((date,i)=>["Пн","Вт","Ср","Чт","Пт","Сб"][i]+" "+dateLabel(date,sheet.dateView));
      for(const title of headings) {const th=el("th",title);th.scope="col";headRow.append(th);}
      head.append(headRow);const body=el("tbody");table.append(head,body);viewport.append(table);rows.append(viewport);
      requestAnimationFrame(()=>{viewport.scrollTop=tablePosition.top;viewport.scrollLeft=tablePosition.left;viewport.onscroll=()=>{tablePosition={top:viewport.scrollTop,left:viewport.scrollLeft};};});
      for(const row of visible) {
        const tr=el("tr"), nameCell=el("th");nameCell.scope="row";
        const open=button("",()=>openStudent(row),"student-name-link");
        open.append(el("span",row.name,"grid-student-name"));
        const nameWrap=el("div",undefined,"grid-name");nameWrap.append(open,studentMenu(row));
        const counts=el("span",undefined,"grid-counts");counts.append(el("strong",row.stats.completed+" / "+row.stats.norm),el("span","Бонусы: "+row.balance));
        open.append(counts);nameCell.append(nameWrap);tr.append(nameCell);
        if(wholeSheet) {
          const view=teacherView(source,row.id);
          for(const ref of month.weeks) {
            const target=view.sheets.find(s=>s.id===ref.sheetId),td=el("td");
            const label=target?target.totals[ref.index]+" / "+target.norms[ref.index]:"—";
            const cell=button(label,()=>{sheetId=ref.sheetId;week=ref.index;wholeSheet=false;tablePosition={top:0,left:0};savePosition();render();},"grid-mark");
            cell.setAttribute("aria-label",row.name+", "+weekRange(ref)+": "+label);td.append(cell);tr.append(td);
          }
        } else for(const date of weekDates(sheet,week)) {
          const td=el("td"),mark=sheet.marks[row.id+"|"+date],category=source.categories.find(c=>c.id===mark?.categoryId);
          const cell=button("",()=>markEditor(row,sheet,date),"grid-mark");
          cell.setAttribute("aria-label",row.name+", "+dateLabel(date,sheet.dateView)+": "+(category?category.name+", "+mark.amount:"поставить отметку"));
          if(category) {const swatch=el("span",undefined,"swatch");swatch.style.backgroundColor="#"+category.color;cell.append(swatch,el("strong",String(mark.amount)),el("small",category.name));}
          else {const add=icon("add");add.classList.add("grid-add");cell.append(add,el("span","Отметить","grid-empty-label muted"));}td.append(cell);tr.append(td);
        }
        body.append(tr);
      }
      }
      if (!visible.length)
        rows.append(
          el(
            "p",
            query
              ? "Студенты не найдены"
              : below
                ? "Все студенты выполнили норму"
                : "В этом месяце пока нет студентов",
            "empty-copy",
          ),
        );
    }
    search.wrap.classList.add("journal-search");
    search.input.oninput = () => {
      query = search.input.value;
      populate();
    };
    populate();
  }
  function renderDetail(main,b) {
    const row=b.students.find(s=>s.id===detail.studentId);if(!row){detail=null;render();return;}
    const months=calendarMonths(b.sheets.filter(s=>s.students.includes(row.id)));
    const month=currentMonth(months,detail.sheetId,detail.week);
    const ref=month?.weeks.find(r=>r.sheetId===detail.sheetId&&r.index===detail.week)??month?.weeks[0];
    const heading=el("div",undefined,"section-heading");heading.append(el("h1",row.name));main.append(heading);
    if(!ref){main.append(el("p","Студент пока не добавлен в журнал"));return;}
    detail.sheetId=ref.sheetId;detail.week=ref.index;
    const sheet=b.sheets.find(s=>s.id===ref.sheetId);heading.append(studentMenu(row));
    main.append(selectors(b,sheet,ref.index,true));
    const periods=el("div",undefined,"filter-bar");
    for(const [value,title] of [[false,"Неделя"],[true,"Месяц"]]) {
      const toggle=button(title,()=>{detail.wholeSheet=value;render();},"filter-chip");toggle.setAttribute("aria-pressed",String(!!detail.wholeSheet===value));periods.append(toggle);
    }
    main.append(periods);
    const refs=detail.wholeSheet?month.weeks:[ref],stats=teacherMonthStats(b,refs,row.id),summary=el("section",undefined,"attendance-summary pinned-summary");
    summary.setAttribute("aria-label",detail.wholeSheet?"Статистика за месяц":"Статистика за неделю");
    summary.append(el("p",`Норма пар ${stats.completed} / ${stats.norm} · осталось ${stats.remaining}`),el("p","Бонусы: "+teacherBalance(b,row.id)));
    main.append(summary);
    if(stats.categories.length) {
      const breakdown=el("div",undefined,"category-breakdown");const list=el("dl",undefined,"category-statistics");
      for(const category of stats.categories)list.append(el("dt",category.name),el("dd",String(category.amount)));breakdown.append(list);summary.append(breakdown);
    }
    const days=el("section",undefined,"days");
    for(const selected of refs) {
      const target=b.sheets.find(s=>s.id===selected.sheetId);
      if(detail.wholeSheet)days.append(el("h2",weekRange(selected)));
      weekDates(target,selected.index).forEach((date,index)=>{
        const mark=target.marks[row.id+"|"+date],category=b.categories.find(c=>c.id===mark?.categoryId),item=button("",()=>markEditor(row,target,date),"day-row");
        item.append(el("span",["Пн","Вт","Ср","Чт","Пт","Сб"][index]+" "+dateLabel(date,target.dateView),"day-date"));
        const description=el("span",undefined,"day-details");
        if(category){const swatch=el("span",undefined,"swatch");swatch.style.backgroundColor="#"+category.color;description.append(swatch,el("span",mark.amount+" · "+category.name));}
        else description.append(el("span","Нет отметки","muted"));item.append(description,icon("next"));days.append(item);
      });
    }
    main.append(days);
  }
  function categoryEditor(category) {
    const content = el("form", undefined, "stack"),
      name = field("Название", {
        value: category?.name ?? "",
        required: true,
        maxLength: 200,
      }),
      color = field("Цвет", {
        type: "color",
        value: "#" + (category?.color ?? "00B0F0"),
      }),
      effect = el("select");
    effect.setAttribute("aria-label", "Расчёт");
    for (const [value, title] of [
      ["CREDIT", "Прибавлять к посещаемости"],
      ["DEDUCT", "Вычитать из посещаемости"],
      ["BONUS", "Использовать бонусы — студент"],
    ]) {
      const o = el("option", title);
      o.value = value;
      effect.append(o);
    }
    effect.value = category?.effect ?? "CREDIT";
    content.onsubmit = (e) => e.preventDefault();
    content.append(name.wrap, color.wrap, effect);
    const actions = [];
    if (category)
      actions.push(
        button(
          "Удалить категорию",
          () => {
            document.querySelector("#editor").close();
            change((b) => {
              ensure(
                b.categories.filter((c) => !c.deleted).length > 1,
                "Оставьте хотя бы одну категорию",
              );
              b.categories.find((c) => c.id === category.id).deleted = true;
            });
          },
          "danger",
        ),
      );
    actions.push(
      button(
        "Сохранить",
        () => {
          if (!content.reportValidity()) return;
          document.querySelector("#editor").close();
          change((b) => {
            const value = {
              id: category?.id ?? uid(),
              name: studentName(name.input.value),
              color: color.input.value.slice(1).toUpperCase(),
              effect: effect.value,
              deleted: false,
            };
            if (category)
              Object.assign(
                b.categories.find((c) => c.id === category.id),
                value,
              );
            else b.categories.push(value);
          });
        },
        "primary",
      ),
    );
    modal(category ? "Категория" : "Добавить категорию", content, actions);
  }
  function addMonth() {
    const next=new Date(calendarMonths(book().sheets).at(-1).key+'-01T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
    const date=monthField("Месяц",next.toISOString().slice(0,7));
    modal("Добавить месяц",date.wrap,[button("Добавить",()=>{
      if(!date.valid())return;
      document.querySelector("#editor").close();
      change(b=>{const sheet=addCalendarMonth(b,date.input.value);sheetId=sheet.id;week=0;tablePosition={top:0,left:0};savePosition();});
    },"primary")]);
  }
  function renderSettings(main, b, sheet) {
    const grid = el("div", undefined, "settings-grid"),
      table = el("section", undefined, "settings-section");
    table.append(
      el("h2", "Группа"),
      button("Переименовать группу", () =>
        textEdit("Переименовать группу", "Название", b.name, (value) =>
          run(() => service().rename(b.id, teacherBookName(value))),
        ),
      ),

    );
    grid.append(table);
    const months=calendarMonths(b.sheets),month=currentMonth(months,sheet.id,week),current=el("section",undefined,"settings-section");
    current.append(el("h2",month.title),button("Добавить месяц",addMonth));
    const remove=button("Удалить месяц",()=>confirm("Удалить месяц?",month.title+". Отметки месяца удалятся; начисления преподавателя сохранятся.",()=>change(b=>{
      deleteCalendarMonth(b,month.key);const next=calendarMonths(b.sheets)[0].weeks[0];sheetId=next.sheetId;week=next.index;savePosition();
    })),"danger");remove.disabled=months.length===1;current.append(remove);grid.append(current);
    const cats = el("section", undefined, "settings-section categories");
    cats.append(el("h2", "Категории"));
    for (const c of b.categories.filter((c) => !c.deleted)) {
      const item = button("", () => categoryEditor(c), "category-option"),
        swatch = el("span", undefined, "swatch");
      swatch.style.backgroundColor = "#" + c.color;
      item.append(swatch, el("span", c.name), icon("next"));
      cats.append(item);
    }
    cats.append(
      button(
        "Добавить категорию",
        () => categoryEditor(null),
        "text-button",
        "add",
      ),
    );
    grid.append(cats);
    main.append(grid);
    const conflict = service().account.conflicts[b.id];
    if (conflict) {
      const card = el("section", undefined, "conflict-panel");
      card.append(
        el("h2", "Нужна сверка изменений"),
        el("p", conflict.message),
        button("Принять версию с Диска", () =>
          confirm(
            "Принять версию с Диска?",
            "Локальные правки этой группы будут заменены версией с Диска.",
            () => run(() => service().acceptRemote(b.id)),
            "Принять",
          ),
        ),
      );
      main.append(card);
    }
    main.append(
      button(
        "Удалить группу",
        () => {
          const content = el("div", undefined, "stack");
          content.append(el("p", "Студенты будут отключены от группы."));
          const label = el("label", undefined, "check-field"),
            check = el("input");
          check.type = "checkbox";
          check.checked = !!b.diskPath;
          check.disabled = !b.diskPath;
          label.append(check, el("span", "Также удалить данные группы с Диска"));
          content.append(label);
          modal("Удалить группу «" + b.name + "»?", content, [
            button(
              "Удалить",
              () => {
                document.querySelector("#editor").close();
                run(async () => {
                  try {
                    await service().remove(b.id, check.checked);
                  } finally {
                    if (!service().books.some((x) => x.id === b.id))
                      bookId = null;
                  }
                });
              },
              "danger",
            ),
          ]);
        },
        "danger delete-table",
      ),
    );
  }
  function render() {
    if (!service()?.account) return;
    closeActions();
    if (positionOwner !== service().owner) {
      positionOwner = service().owner;
      try { bookId = localStorage.getItem("attendance-teacher-book:" + positionOwner); } catch { bookId = null; }
      readPosition();
      const saved=history.state?.attendanceTeacher;
      if(saved?.owner===positionOwner)restoreNavigation(saved);
      else {
        // Reopened journals need parent entries so phone Back stays inside the app.
        const current=navigationState();
        bookId=null;detail=null;writeNavigation();
        if(current.bookId){restoreNavigation({...current,detail:null});writeNavigation(true);}
        if(current.bookId && current.detail){restoreNavigation(current);writeNavigation(true);}
      }
    }
    if(detail && !book()?.students.some(s=>s.id===detail.studentId))detail=null;
    const b = book(),
      header = el("header", undefined, "topbar"),
      brand = el("div", undefined, "brand");
    if (b) {
      const backButton = button("", back, "text-button", "back");
      backButton.setAttribute(
        "aria-label",
        detail ? "Назад в журнал" : "Группы",
      );
      brand.append(backButton);
    }
    if (b) {
      const select = el("select", undefined, "book-picker");
      select.setAttribute("aria-label", "Группа");
      for (const row of service().books) {
        const option = el("option", row.name);
        option.value = row.id;
        select.append(option);
      }
      select.value = b.id;
      select.onchange = () => goBook(select.value);
      brand.append(select);
    } else brand.append(el("span", "Группы"));
    header.append(brand);
    if (!b) header.append(themeMenu());
    const main = el(
        "main",
        undefined,
        b ? "teacher-main" : "connection teacher-home",
      ),
      footer = el("footer", undefined, "bottom-bar");
    if (!b) {
      main.append(el("h1", "Группы", "sr-only"));
      const list = el("div", undefined, "table-list");
      for (const item of service().books)
        list.append(
          button(item.name, () => goBook(item.id), "table-card", "next"),
        );
      main.append(
        list,
        button("Создать группу", createBook, "primary", "add"),
      );
      footer.append(
        button("Выйти из Яндекса", () => api.logout(), "text-button", "exit"),
      );
    } else {
      const months=calendarMonths(b.sheets),month=currentMonth(months,sheetId,week);
      const ref=month.weeks.find(r=>r.sheetId===sheetId&&r.index===week)??month.weeks[0];
      const sheet=b.sheets.find(s=>s.id===ref.sheetId);week=ref.index;
      if (!detail) main.append(el("h1", b.name, "sr-only"));
      sheetId = sheet.id;
      week = Math.max(0, Math.min(week, sheet.weeks - 1));
      if (detail) renderDetail(main, b);
      else {
        const journalHeader=el("section",undefined,"journal-header");
        journalHeader.append(selectors(b, sheet, week).firstElementChild);
        const statusRow = el("div", undefined, "table-status");
        const closed = month.weeks.every(ref=>b.sheets.find(s=>s.id===ref.sheetId).closedWeeks?.includes(ref.index));
        statusRow.append(
          button(
            closed ? "Открыть месяц" : "Закрыть месяц",
            () =>
              change((b) => {
                for(const ref of month.weeks){const target=b.sheets.find(s=>s.id===ref.sheetId);target.closedWeeks=closed?(target.closedWeeks??[]).filter(w=>w!==ref.index):[...new Set([...(target.closedWeeks??[]),ref.index])];}
              }),
            "text-button",
            closed ? "unlock" : "lock",
          ),
        );
        const status = el(
          "p",
          b.status ??
            (b.dirty ? "Ожидает синхронизации" : "Синхронизировано с Диском"),
          "delivery",
        );
        status.setAttribute("role", "status");
        statusRow.append(status);
        journalHeader.append(statusRow);
        const tabs = el("nav", undefined, "tabs");
        tabs.setAttribute("aria-label", "Разделы группы");
        for (const [value, title] of [
          ["journal", "Журнал"],
          ["settings", "Параметры"],
        ]) {
          const item = button(
            title,
            () => {
              tab = value;
              savePosition();
              render();
            },
            tab === value ? "tab selected" : "tab",
          );
          item.setAttribute("aria-current", tab === value ? "page" : "false");
          tabs.append(item);
        }
        journalHeader.append(tabs);main.append(journalHeader);
        if (tab === "journal") renderJournal(main, b, sheet);
        else {
          renderSettings(main, b, sheet);
        }
      }
    }
    api.root.replaceChildren(header, main, footer);
    savePosition();
    writeNavigation();
    if (!service().writable) {
      for(const control of main.querySelectorAll('.student-menu-trigger,.day-row,.attendance-grid:not(.month-grid) .grid-mark,.week-actions button,.table-status>button,.settings-grid button,.delete-table,.conflict-panel button,.invitation-block>.primary,.teacher-home>.primary'))control.disabled=true;
      const status = el("p", !service().device.checked ? "Проверяем устройство. Сохранённый журнал доступен для просмотра." : service().device.kindOfOwner === "android" ? "Редактирование в приложении. Здесь доступен просмотр." : "Редактирование на другом устройстве. Здесь доступен просмотр.", "delivery");
      status.setAttribute("role", "status"); main.prepend(status);
    }
  }
  return {
    render,
    reset() {
      bookId = null;
      rememberBook();
      positionOwner = null, tablePosition = {top:0,left:0};
      tableOverride = null;
      detail = null;
      if(history.state?.attendanceTeacher)history.replaceState({...history.state,attendanceTeacher:null},"");
    },
    hasChanges() {
      return service()?.books.some((b) => b.dirty && b.diskPath);
    },
  };
}


// app

const root = document.querySelector("#app"),
  notice = document.querySelector("#notice"),
  overlay = document.querySelector("#busy"),
  dialog = document.querySelector("#editor");
let exchange,
  teacher,
  group,
  groupUrl = "",
  registering = false,
  registrationName = "",
  selectedSheet,
  week = 0,
  wholeMonth = false,
  pageKey = "",
  working = false,
  polling,
  timer,
  retryAt = 0,
  dirty = false,
  lastNotice = "",
  noticeTimer;
let sessionHeld = false;
let teacherDeviceOwner = uid();
try {
  teacherDeviceOwner = sessionStorage.getItem("attendance-teacher-device") || teacherDeviceOwner;
  sessionStorage.setItem("attendance-teacher-device", teacherDeviceOwner);
} catch {}
const icon = (name) => {
  const paths = {
    back: "m12 5-7 7 7 7M5 12h15",
    next: "m9 5 7 7-7 7",
    exit: "M10 4H5v16h5m4-12 4 4-4 4m-5-4h9",
    edit: "m4 16 12-12 4 4L8 20H4v-4Z",
    external: "M14 4h6v6m0-6L10 14m-1-9H4v15h15v-5",
    check: "m5 12 4 4 10-10",
    add: "M12 5v14M5 12h14",
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
    unlock: "M7 10V7a5 5 0 0 1 10-1M5 10h14v11H5zM12 14v3",
    teacher: "M3 3h18v13H3zM8 21h8M12 16v5M7 7h10M7 11h6",
    more: "M12 5h.01M12 12h.01M12 19h.01",
    student: "M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M4 21v-2a8 8 0 0 1 16 0v2",
    linked: "M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2m3 5a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
};
function el(tag, content, className) {
  const e = document.createElement(tag);
  if (content !== undefined) e.textContent = content;
  if (className) e.className = className;
  return e;
}
function button(label, action, className = "", glyph) {
  const b = el("button", label, className);
  b.type = "button";
  if (glyph) b.prepend(icon(glyph));
  b.addEventListener("click", action);
  return b;
}
function field(label, options = {}) {
  const wrap = el("label", undefined, "field");
  wrap.append(el("span", label));
  const input = el("input");
  Object.assign(input, options);
  wrap.append(input);
  return { wrap, input };
}
function showError(message, network = false) {
  if (!message || message === lastNotice) return;
  lastNotice = message;
  clearTimeout(noticeTimer);
  notice.querySelector("p").textContent = message;
  notice.dataset.network = String(network);
  notice.hidden = false;
  noticeTimer = setTimeout(() => {
    lastNotice = "";
  }, 30_000);
}
function clearNetworkNotice() {
  if (notice.dataset.network !== "true") return;
  notice.hidden = true;
  notice.dataset.network = "false";
  lastNotice = "";
  clearTimeout(noticeTimer);
}
notice.querySelector("button").onclick = () => {
  notice.hidden = true;
  lastNotice = "";
};
function setTheme(value) {
  localStorage.setItem("attendance-theme", value);
  document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]').content =
    value === "dark" ||
    (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "#0e171e"
      : "#f8fafc";
}
function themeMenu() {
  const wrap = el("label", undefined, "theme");
  wrap.append(el("span", "Тема"));
  const select = el("select");
  select.setAttribute("aria-label", "Тема приложения");
  for (const [value, name] of [
    ["system", "Системная"],
    ["light", "Светлая"],
    ["dark", "Тёмная"],
  ]) {
    const option = el("option", name);
    option.value = value;
    select.append(option);
  }
  select.value = localStorage.getItem("attendance-theme") ?? "system";
  select.onchange = () => setTheme(select.value);
  wrap.append(select);
  return wrap;
}
async function operate(fn, label = "Подождите…") {
  if (working) return;
  working = true;
  overlay.querySelector("p").textContent = label;
  overlay.hidden = false;
  root.inert = true;
  try {
    if (polling) await polling;
    await fn();
    clearNetworkNotice();
    retryAt = 0;
  } catch (e) {
    if (e.status === 401) {
      await exchange.requireLogin();
      teacher = null;
    }
    if (e.retry) retryAt = Date.now() + e.retry;
    showError(e.message ?? "Не удалось выполнить действие", e.network);
  } finally {
    root.inert = false;
    working = false;
    overlay.hidden = true;
    await updateDirty();
    render();
    schedule();
  }
}
async function updateDirty() {
  const p = exchange?.state.active;
  dirty =
    exchange?.state.role === "teacher"
      ? !!teacherUi.hasChanges() || !!teacher?.account?.closures.length
      : !!p && (await hash(JSON.stringify(p.feed))) !== p.feedHash;
}
function dateLabel(date) {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDate();
  return `${String(day).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function modal(title, content, actions) {
  dialog.replaceChildren();
  const header = el("h2", title);
  header.id = "dialog-title";
  dialog.append(header, content);
  const footer = el("div", undefined, "dialog-actions");
  footer.append(
    button("Отмена", () => dialog.close(), "text-button"),
    ...actions,
  );
  dialog.append(footer);
  dialog.showModal();
}
function logout() {
  if (exchange.state.role === "teacher") {
    modal(
      "Выйти из Яндекса?",
      el(
        "p",
        "Изменения групп сначала отправятся на Диск. Сохранённые группы останутся на этом устройстве для вашего аккаунта.",
      ),
      [
        button(
          "Выйти",
          () => {
            dialog.close();
            operate(async () => {
              await teacher.sync();
              ensure(
                !teacherUi.hasChanges() && !teacher.account.closures.length,
                "Не все изменения отправлены. Дождитесь синхронизации перед выходом",
              );
              await exchange.requireLogin();
              delete exchange.state.role;
              await exchange.save();
              teacher = null;
              teacherUi.reset();
            }, "Отправка изменений…");
          },
          "danger",
        ),
      ],
    );
    return;
  }
  modal(
    "Выйти из Яндекса?",
    el(
      "p",
      "Привязка к строке сохранится на этом устройстве. После входа в тот же аккаунт приглашение не понадобится. Неотправленные отметки сначала отправятся на Диск.",
    ),
    [
      button(
        "Выйти",
        () => {
          dialog.close();
          operate(async () => {
            await exchange.logout();
            delete exchange.state.role;
            await exchange.save();
            group = null;
            groupUrl = "";
          }, "Отправка изменений…");
        },
        "danger",
      ),
    ],
  );
}
const teacherUi = teacherInterface({
  root,
  el,
  button,
  field,
  modal,
  showError,
  dateLabel,
  themeMenu,
  icon,
  service: () => teacher,
  operate,
  schedule,
  logout,
});
function chooseRole(role) {
  operate(async () => {
    exchange.state.role = role;
    await startLogin(exchange);
  });
}
function renderWelcome() {
  const header = el("header", undefined, "topbar");
  header.append(themeMenu());
  const main = el("main", undefined, "connection welcome");
  const logo = el("img");
  logo.src = "./icon.svg";
  logo.alt = "";
  logo.width = 56;
  logo.height = 56;
  main.append(logo, el("h1", "Посещаемость"));
  const cards = el("div", undefined, "role-choices");
  for (const [role, title, glyph] of [
    ["teacher", "Преподаватель", "teacher"],
    ["student", "Студент", "student"],
  ]) {
    const card = button(title, () => chooseRole(role), "role-card", glyph);
    card.append(icon("next"));
    cards.append(card);
  }
  main.append(cards);
  root.replaceChildren(header, main);
}
function leaveTable() {
  modal(
    "Выйти из группы?",
    el(
      "p",
      "Вы вернётесь к вводу ссылки. В этой группе аккаунт останется привязан к вашей строке. Можно подключиться к другой группе. Вход в Яндекс сохранится. Неотправленные отметки сначала отправятся на Диск.",
    ),
    [
      button(
        "Выйти",
        () => {
          dialog.close();
          operate(async () => {
            await exchange.leaveTable();
            group = null;
            groupUrl = "";
            registering = false;
            registrationName = "";
            pageKey = "";
          }, "Отправка изменений…");
        },
        "primary",
      ),
    ],
  );
}
function savePage() {
  try {
    localStorage.setItem(
      pageKey,
      JSON.stringify({ sheetId: selectedSheet, week, wholeMonth }),
    );
  } catch {
    showError("Не удалось запомнить лист и неделю в этом браузере");
  }
}
function confirmStudent(group, student) {
  const content = el("form", undefined, "stack");
  const surname = field("Фамилия", { required: true, maxLength: 200, autocomplete: "family-name", spellcheck: false });
  content.append(el("p", student.name), surname.wrap);
  const confirm = button("Подключиться", () => content.requestSubmit(), "primary");
  confirm.disabled = true;
  surname.input.oninput = () => { confirm.disabled = !matchesStudentSurname(student.name, surname.input.value); };
  content.onsubmit = (e) => {
    e.preventDefault();
    if (!matchesStudentSurname(student.name, surname.input.value)) return;
    dialog.close();
    operate(() => exchange.join(group, student.id, undefined, surname.input.value), "Отправка заявки…");
  };
  modal("Подтвердите выбор", content, [confirm]);
}
function editName(view) {
  const { wrap, input } = field("ФИО", {
    value: view.name,
    maxLength: 200,
    autocomplete: "name",
  });
  modal("Изменить ФИО", wrap, [
    button(
      "Сохранить",
      () => {
        let name;
        try {
          name = studentName(input.value);
        } catch (e) {
          showError(e.message);
          return;
        }
        dialog.close();
        operate(async () => {
          await exchange.enqueue({
            sheetId: "",
            date: "",
            amount: 0,
            newName: name,
          });
          await exchange.sync();
        }, "Отправка изменений…");
      },
      "primary",
    ),
  ]);
}
function editMark(view, sheet, date) {
  const old = sheet.marks[date],
    content = el("form", undefined, "mark-form");
  content.onsubmit = (e) => e.preventDefault();
  const categories = view.categories.filter(
    (c) => !c.deleted || c.id === old?.categoryId,
  );
  ensure(categories.length, "Категории недоступны");
  const select = el("select", undefined, "category-select");
  select.setAttribute("aria-label", "Вид отметки");
  for (const c of categories) {
    const option = el("option", c.name);
    option.value = c.id;
    select.append(option);
  }
  select.value = old?.categoryId ?? categories[0].id;
  const { wrap, input } = field("Количество пар", {
    type: "number",
    inputMode: "numeric",
    min: "1",
    max: "1000000",
    step: "1",
    value: String(old?.amount ?? 1),
    required: true,
  });
  content.append(select, wrap);
  const save = button(
    "Сохранить",
    () => {
      if (!content.reportValidity()) return;
      const amount = Number(input.value);
      if (!Number.isInteger(amount)) return;
      dialog.close();
      operate(async () => {
        await exchange.enqueue({
          sheetId: sheet.id,
          date,
          amount,
          categoryId: select.value,
        });
        await exchange.sync();
      }, "Отправка изменений…");
    },
    "primary",
  );
  const actions = old
    ? [
        button(
          "Убрать",
          () => {
            dialog.close();
            operate(async () => {
              await exchange.enqueue({
                sheetId: sheet.id,
                date,
                amount: 0,
                categoryId: old.categoryId,
              });
              await exchange.sync();
            }, "Отправка изменений…");
          },
          "danger",
        ),
        save,
      ]
    : [save];
  modal(dateLabel(date, sheet.dateView), content, actions);
}
function render() {
  if (!exchange) return;
  const logged = !!exchange.state.token,
    p = exchange.state.active,
    view = pendingView(p);
  if (!logged) {
    renderWelcome();
    return;
  }
  if (logged && exchange.state.role === "teacher") {
    if (teacher?.account) teacherUi.render();
    else root.replaceChildren(el("main", "Открываем ваши группы…", "boot"));
    return;
  }
  const header = el("header", undefined, "topbar"),
    brand = el("div", undefined, "brand"),
    logo = el("img");
  logo.src = "./icon.svg";
  logo.alt = "";
  logo.width = 36;
  logo.height = 36;
  if (view || p?.enrollment?.sent || p?.viewUrl) {
    const back = button("", leaveTable, "text-button", "back");
    back.setAttribute("aria-label", "Выйти из группы");
    brand.append(back);
  } else brand.append(logo);
  brand.append(el("span", view?.bookName ?? "Посещаемость"));
  header.append(brand);
  header.append(themeMenu());
  const main = el("main", undefined, view ? "journal" : "connection");
  if (view) {
    const key = `attendance-student-page:${view.bookId}:${view.studentId}`;
    if (pageKey !== key) {
      pageKey = key;
      let saved;
      try {
        saved = JSON.parse(localStorage.getItem(key));
      } catch {
        /* A broken display preference must not block attendance. */
      }
      selectedSheet =
        typeof saved?.sheetId === "string" ? saved.sheetId : undefined;
      week = Number.isInteger(saved?.week) ? saved.week : 0;
      wholeMonth = saved?.wholeMonth === true;
    }
    const aside = el("section", undefined, "student-panel");
    aside.append(el("h1", view.name));
    const balance = el("div", undefined, "student-balance");
    balance.append(el("span", "Бонусы"), el("strong", String(view.balance)));

    aside.append(
      button("Изменить ФИО", () => editName(view), "text-button", "edit"),
    );
    const months=calendarMonths(view.sheets),month=currentMonth(months,selectedSheet,week);
    const ref=month?.weeks.find(r=>r.sheetId===selectedSheet&&r.index===week)??month?.weeks[0];
    const sheet=view.sheets.find(s=>s.id===ref?.sheetId);
    if (!sheet) main.append(el("p","Преподаватель пока не добавил месяц."));
    else {
      selectedSheet=ref.sheetId;week=ref.index;savePage();
      const choose=ref=>{selectedSheet=ref.sheetId;week=ref.index;savePage();render();};
      const label=el("label",undefined,"field sheet-field"),select=el("select");label.append(el("span","Месяц"));
      months.forEach(m=>{const option=el("option",m.title);option.value=m.key;select.append(option);});
      select.value=month.key;select.onchange=()=>choose(months.find(m=>m.key===select.value).weeks[0]);label.append(select);aside.append(label);
      const weeks=el("div",undefined,"weeks");weeks.setAttribute("role","group");weeks.setAttribute("aria-label","Неделя");
      for(const r of month.weeks) {
        const selected=r.sheetId===ref.sheetId&&r.index===ref.index;
        const item=button(weekRange(r),()=>choose(r),`week${selected?" selected":""}`);
        item.setAttribute("aria-pressed",String(selected));weeks.append(item);
      }
      const mode=el("div",undefined,"weeks");mode.setAttribute("aria-label","Период просмотра");
      for(const [title,all] of [["Неделя",false],["Месяц",true]]) {
        const control=button(title,()=>{wholeMonth=all;savePage();render();},`week${wholeMonth===all?" selected":""}`);
        control.setAttribute("aria-pressed",String(wholeMonth===all));mode.append(control);
      }
      aside.append(mode);if(!wholeMonth)aside.append(weeks);
      const period=wholeMonth?month.weeks:[ref];
      const completed=period.reduce((n,r)=>n+view.sheets.find(s=>s.id===r.sheetId).totals[r.index],0);
      const norm=period.reduce((n,r)=>n+view.sheets.find(s=>s.id===r.sheetId).norms[r.index],0);
      const awaiting = p.feed.requests.filter(
        (r) => !(r.id in p.view.receipts),
      ).length;
      const status = el(
        "p",
        dirty
          ? "Сохранено в этом браузере. Ожидает отправки"
          : awaiting
            ? "Отправлено преподавателю"
            : "Синхронизировано",
        "delivery",
      );
      status.setAttribute("role", "status");
      aside.append(status);
      if (awaiting)
        aside.append(el("p", `Ожидает обработки: ${awaiting}`, "muted"));
      const rejected = p.feed.requests
        .map((r) => p.view.receipts[r.id])
        .filter(Boolean);
      if (rejected.length)
        aside.append(
          button(
            "Есть отклонённая отметка",
            () => showError(rejected.at(-1)),
            "text-button",
          ),
        );
      const days = el("section", undefined, "days");
      days.setAttribute("aria-label", `Посещаемость за ${wholeMonth?month.title:weekRange(ref)}`);
      const heading = el("div", undefined, "week-heading");
      heading.append(
        el(
          "span",
          `Норма пар ${completed} / ${norm}`,
          "week-total",
        ),
      );
      heading.append(balance);
      days.append(heading);
      for(const target of period) {
      const sheet=view.sheets.find(s=>s.id===target.sheetId),week=target.index;
      if(wholeMonth)days.append(el("h2",weekRange(target)));
      const closed = sheet.closedWeeks?.includes(week);
      if (closed)
        days.append(el("p", "Неделя закрыта преподавателем", "closed"));
      weekDates(sheet, week).forEach((date, day) => {
        const mark = sheet.marks[date],
          category = view.categories.find((c) => c.id === mark?.categoryId);
        const row = closed
          ? el("div", undefined, "day-row")
          : button(
              "",
              () => {
                try {
                  editMark(view, sheet, date);
                } catch (e) {
                  showError(e.message);
                }
              },
              "day-row",
            );
        row.append(
          el(
            "span",
            `${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][day]} ${dateLabel(date, sheet.dateView)}`,
            "day-date",
          ),
        );
        const details = el("span", undefined, "day-details");
        if (category) {
          const swatch = el("span", undefined, "swatch");
          swatch.dataset.color = category.color.toUpperCase();
          details.append(
            swatch,
            el("span", `${mark.amount} · ${category.name}`),
          );
        } else details.append(el("span", "Нет отметки", "muted"));
        row.append(details);
        if (!closed) row.append(icon("next"));
        days.append(row);
      });
      }
      main.append(aside, days);
    }
  } else if (p?.enrollment?.sent || p?.viewUrl) {
    main.append(
      el("h1", "Подключение к журналу"),
      el("p", p.enrollment?.newName ?? p.name ?? ""),
      el(
        "div",
        "Заявка отправлена. Подключение завершится, когда преподаватель откроет приложение или сайт и завершится синхронизация.",
        "waiting",
      ),
    );
  } else {
    main.append(el("h1", "Подключиться к журналу"));
    const form = el("form", undefined, "invite-form"),
      { wrap, input } = field("Ссылка преподавателя", {
        type: "url",
        value: groupUrl,
        placeholder: "https://yadi.sk/d/…",
        required: true,
        autocomplete: "off",
        spellcheck: false,
      });
    input.oninput = () => {
      groupUrl = input.value;
      group = null;
      registering = false;
      registrationName = "";
    };
    form.append(
      wrap,
      button("Открыть", () => form.requestSubmit(), "primary"),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      operate(async () => {
        groupUrl = input.value.trim();
        const next = await exchange.invitation(groupUrl);
        const resumed = await exchange.resumeInvited(next);
        registering = false;
        registrationName = "";
        group = resumed ? null : next;
      }, "Открытие журнала…");
    };
    main.append(form);
    if (group) {
      main.append(el("h2", group.name));
      if (group.registrations?.length) {
        const enroll = el("form", undefined, "enroll-form");
        enroll.id = "registration-form";

        const name = field("ФИО", { required: true, maxLength: 200, autocomplete: "name", value: registrationName });
        name.input.oninput = () => { registrationName = name.input.value; };
        enroll.append(name.wrap, button("Подключиться", () => enroll.requestSubmit(), "primary"));
        enroll.onsubmit = (e) => {
          e.preventDefault();
          operate(() => exchange.join(group, undefined, name.input.value), "Отправка заявки…");
        };
        main.append(enroll);
      }
    }
  }
  const footer = el("footer", undefined, "bottom-bar");
  if (logged)
    footer.append(button("Выйти из Яндекса", logout, "text-button", "exit"));
  root.replaceChildren(header, main, footer);
  for (const swatch of root.querySelectorAll(".swatch")) {
    const color = "#" + swatch.dataset.color;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("width", "20");
    rect.setAttribute("height", "20");
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", color);
    svg.append(rect);
    swatch.append(svg);
  }
}
function schedule(delay = exchange?.state.role === "teacher" ? 2000 : studentSyncDelay(exchange?.state.active)) {
  clearTimeout(timer);
  if (!document.hidden && exchange?.state.token)
    timer = setTimeout(poll, Math.max(delay, retryAt - Date.now()));
}
async function poll() {
  if (polling) {
    schedule();
    return;
  }
  if (document.hidden || working || !navigator.onLine || dialog.open) {
    schedule();
    return;
  }
  polling = (async () => {
    try {
      if (exchange.state.role === "teacher") {
        const wasVerified=!!teacher?.verified;
        if (!teacher) {
          teacher = new Teacher(exchange, teacherDeviceOwner);
        }
        if (!teacher.verified) {
          await teacher.open();
        }
        const before = JSON.stringify(teacher.account);
        const couldWrite = teacher.writable;
        await teacher.device.refresh();
        if((!wasVerified || couldWrite!==teacher.writable) && !dialog.open && !["INPUT","SELECT"].includes(document.activeElement?.tagName))render();
        await teacher.sync();
        clearNetworkNotice();
        await updateDirty();
        if (
          (before !== JSON.stringify(teacher.account) || couldWrite !== teacher.writable) &&
          !["INPUT", "SELECT"].includes(document.activeElement?.tagName)
        ) {
          const y = scrollY;
          render();
          requestAnimationFrame(() => scrollTo(0, y));
        }
        return;
      }
      if (!exchange.state.active) await exchange.restore();
      if (
        group &&
        !exchange.state.active?.enrollment?.sent &&
        !exchange.state.active?.viewUrl
      ) {
        const next = await exchange.invitation(groupUrl);
        if (JSON.stringify(next) !== JSON.stringify(group)) {
          group = next;
          render();
        }
      }
      const before = JSON.stringify(exchange.state.active);
      await exchange.sync();
      clearNetworkNotice();
      await updateDirty();
      if (before !== JSON.stringify(exchange.state.active)) render();
    } catch (e) {
      if (e.status === 401) {
        await exchange.requireLogin();
        teacher = null;
      }
      if (!exchange.state.active) render();
      if (e.retry) retryAt = Date.now() + e.retry;
      showError(e.message, e.network);
    } finally {
      schedule();
    }
  })();
  await polling;
  polling = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(timer);
  else if (!sessionHeld && exchange) location.reload();
  else schedule(0);
});
addEventListener("online", () => schedule(0));
addEventListener("beforeunload", (e) => {
  if (dirty || teacherUi.hasChanges()) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function boot() {
  try {
    setTheme(localStorage.getItem("attendance-theme") ?? "system");
    const vault = await new Vault().open();
    exchange = new Exchange(vault, await vault.load());
    try {
      if (await finishLogin(exchange)) {
        await exchange.save();
        exchange.disk = new Disk(exchange.state.token);
      }
    } catch (e) {
      showError(e.message);
    }
    if (exchange.state.token && !exchange.state.role) {
      exchange.state.role = "student";
      await exchange.save();
    }
    if(exchange.state.token && exchange.state.role==="teacher") {
      teacher=new Teacher(exchange,teacherDeviceOwner);
      await teacher.restoreCached();
      render();
      schedule(0);
    } else {
      render();
      if (exchange.state.token)
        await operate(async () => {
          await exchange.restore();
          await exchange.sync();
        });
    }
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (e) {
    root.replaceChildren(el("main", undefined, "boot"));
    root.firstChild.append(
      el("h1", "Не удалось открыть приложение"),
      el("p", e.message),
    );
  }
}
async function holdSession() {
  sessionHeld = true;
  await boot();
  await new Promise(resolve => {
    const release = async () => {
      if (!document.hidden) return;
      document.removeEventListener("visibilitychange", release);
      clearTimeout(timer);
      while (working || polling) await new Promise(done => setTimeout(done, 50));
      await exchange?.vault.saving;
      if (!document.hidden) {
        document.addEventListener("visibilitychange", release);
        schedule(0);
        return;
      }
      root.inert = true;
      sessionHeld = false;
      resolve();
    };
    document.addEventListener("visibilitychange", release);
    release();
  });
}
if (!navigator.locks) {
  root.replaceChildren(
    el(
      "main",
      "Обновите Safari или откройте приложение в современном браузере.",
      "boot",
    ),
  );
} else
  navigator.locks
    .request(
      "attendance-student-session",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          root.replaceChildren(
            el(
              "main",
              "Приложение открыто в другой вкладке или окне. Закройте его там — эта страница откроется автоматически.",
              "boot",
            ),
          );
          return navigator.locks.request("attendance-student-session", holdSession);
        }
        await holdSession();
      },
    )
    .catch((e) => showError(e.message));

document.addEventListener("click", (e) => {
  for (const menu of document.querySelectorAll("details[open]"))
    if (!menu.contains(e.target)) menu.open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    for (const menu of document.querySelectorAll("details[open]"))
      menu.open = false;
});

