const express = require('express');
const session = require('express-session');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const { db, STATUSES, setting, normPhone, nextClientCode, shippingMark, upsertParcel, addEvent, numOrNull, linkOrphanParcels } = require('./db');
const { t: tr, LANGS } = require('./i18n');
const { page, esc, heroMap } = require('./layout');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin151';
// Бухгалтер: работает с посылками и накладными, но не видит телефоны клиентов и настройки.
const ACCOUNTANT_PASSWORD = process.env.ACCOUNTANT_PASSWORD || 'buh151';
const PORT = process.env.PORT || 3000;
const LEGACY_TRACK_URL = 'http://151.likerj.com';
const isOwner = (req) => req.session.admin === 'owner';

const app = express();
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.static(require('path').join(__dirname, 'public'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' },
}));

app.use((req, res, next) => {
  const m = /(?:^|;\s*)lang=(ru|zh)/.exec(req.headers.cookie || '');
  req.lang = m ? m[1] : (/^zh/i.test(req.headers['accept-language'] || '') ? 'zh' : 'ru');
  req.t = tr(req.lang);
  res.render = (title, body) => res.send(page({ title, body, t: req.t, lang: req.lang, path: req.path, session: req.session, whatsapp: setting('whatsapp') }));
  next();
});

const statusBadge = (t, s) => `<span class="badge b-${esc(s)}">${esc(t('st_' + s))}</span>`;
const statusOptions = (t, sel) => Object.keys(STATUSES).map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(t('st_' + k))}</option>`).join('');
const whName = (lang, w) => (lang === 'zh' ? w.name_zh : w.name_ru);
const money = (v) => `${(Math.round(v * 100) / 100).toLocaleString('ru-RU')} ${setting('currency')}`;
const fmtDate = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
const activeWarehouses = () => db.prepare('SELECT * FROM warehouses WHERE active = 1 ORDER BY id').all();
const getClient = (id) => db.prepare(`SELECT c.*, ci.name city_name, ci.pickup_address FROM clients c
  LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.id = ?`).get(id);

app.get('/lang/:l', (req, res) => {
  const l = LANGS.includes(req.params.l) ? req.params.l : 'ru';
  res.setHeader('Set-Cookie', `lang=${l}; Path=/; Max-Age=31536000; SameSite=Lax`);
  const back = String(req.query.back || '/');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/');
});

// ---------- Клиент: шаг 1 код, шаг 2 адрес склада ----------

const currentClient = (req) => (req.session.clientId ? getClient(req.session.clientId) : null);

// Что увидит и скопирует клиент: имя получателя, телефон склада, адрес с маркировкой.
function addressFields(w, client) {
  const mark = shippingMark(w.mark_template, client);
  const name = String(w.name_template || '{mark}').replace('{mark}', mark).replace('{receiver}', w.receiver).replace('{code}', client.code);
  const address = `${String(w.address).replace(/\s+/g, '')} 入仓唛头${mark}`;
  // Одна строка «имя телефон адрес» — её распознаёт «智能识别/粘贴地址» в 1688, Taobao, Pinduoduo.
  return { mark, name, phone: w.phone, address, all: `${name} ${w.phone} ${address}` };
}

function steps(t, n) {
  return `<div class="steps">${[t('step1'), t('step3')].map((s, i) => `<span class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}">${i + 1}. ${esc(s)}</span>`).join('')}</div>`;
}

const copyBtn = (t, id, label, primary) => `<button type="button" class="${primary ? '' : 'sec sm'}" data-copy="${id}" data-done="${esc(t('copied'))}">${esc(label || t('copy'))}</button>`;

const notice = (req) => {
  const n = setting(req.lang === 'zh' ? 'notice_zh' : 'notice_ru');
  return n ? `<div class="alert warn"><a href="/info">${esc(n)}</a></div>` : '';
};

// Простая разметка: «# заголовок», «- пункт», остальное — абзацы.
function renderInfo(text) {
  let html = ''; let list = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const isItem = line.startsWith('- ');
    if (list && !isItem) { html += '</ul>'; list = false; }
    if (!line) continue;
    if (line.startsWith('# ')) html += `<h2>${esc(line.slice(2))}</h2>`;
    else if (isItem) { if (!list) { html += '<ul>'; list = true; } html += `<li>${esc(line.slice(2))}</li>`; }
    else html += `<p>${esc(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

// Текстовые страницы, редактируются в админке → Настройки.
app.get('/info', (req, res) => {
  const t = req.t;
  const whs = activeWarehouses();
  res.render(t('nav_info'), `<div class="narrow"><div class="card"><h1>${esc(t('nav_info'))}</h1>
    <h2>${esc(t('hours'))}</h2><ul>${whs.map((w) => `<li><b>${esc(whName(req.lang, w))}</b> — ${esc(req.lang === 'zh' ? w.hours_zh : w.hours_ru)}</li>`).join('')}</ul>
    ${renderInfo(setting(req.lang === 'zh' ? 'info_zh' : 'info_ru'))}</div></div>`);
});
for (const [path, key] of [['/about', 'about'], ['/services', 'services']]) {
  app.get(path, (req, res) => {
    res.render(req.t('nav_' + key), `<div class="narrow"><div class="card">${renderInfo(setting(`${key}_${req.lang === 'zh' ? 'zh' : 'ru'}`))}</div></div>`);
  });
}

app.get('/', (req, res) => {
  const t = req.t;
  const cities = db.prepare('SELECT * FROM cities ORDER BY id').all();
  res.render(t('nav_home'), `${heroMap(t, req.lang)}<div class="narrow">${notice(req)}${steps(t, 1)}<div class="card">
    <h1>${esc(t('hero_title'))}</h1><p class="muted">${esc(t('hero_sub'))}</p>
    <form method="post" action="/register">
      <label for="f-name">${esc(t('name'))}</label><input id="f-name" name="name" required maxlength="80" autocomplete="name">
      <label for="f-phone">${esc(t('phone'))}</label><input id="f-phone" name="phone" type="tel" required placeholder="+7 777 123 45 67" autocomplete="tel">
      <div class="hint">${esc(t('phone_hint'))}</div>
      <label for="f-city">${esc(t('city'))}</label><select id="f-city" name="city_id" required><option value="">${esc(t('choose_city'))}</option>
        ${cities.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <button class="wide">${esc(t('get_code'))}</button>
    </form></div>
    <div class="card"><h3>${esc(t('have_code'))}</h3>
      <form method="post" action="/find" class="row"><div><input name="phone" type="tel" required placeholder="${esc(t('phone'))}"></div><button class="sec">${esc(t('find_by_phone'))}</button></form>
    </div></div>`);
});

app.post('/register', (req, res) => {
  const t = req.t;
  const name = String(req.body.name || '').trim().slice(0, 80);
  const phone = normPhone(req.body.phone);
  const cityId = parseInt(req.body.city_id, 10);
  if (!name || phone.length < 10 || !db.prepare('SELECT 1 FROM cities WHERE id = ?').get(cityId)) return res.redirect('/');
  const existing = db.prepare('SELECT id FROM clients WHERE phone = ?').get(phone);
  if (existing) {
    req.session.clientId = existing.id;
    req.session.flash = t('phone_exists');
    return res.redirect('/address');
  }
  const code = nextClientCode();
  const r = db.prepare('INSERT INTO clients (code, name, phone, city_id) VALUES (?, ?, ?, ?)').run(code, name, phone, cityId);
  linkOrphanParcels(r.lastInsertRowid, code);
  req.session.clientId = Number(r.lastInsertRowid);
  res.redirect('/address');
});

app.post('/find', (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE phone = ?').get(normPhone(req.body.phone));
  if (!c) return res.render(req.t('find_title'), `<div class="narrow card"><div class="alert err">${esc(req.t('not_found'))}</div><a class="btn" href="/">${esc(req.t('get_code'))}</a></div>`);
  req.session.clientId = c.id;
  res.redirect('/address');
});

// Старая ссылка на отдельную страницу кода — теперь код показан на странице склада.
app.get('/code', (req, res) => res.redirect('/address'));

// Код клиента вверху страницы склада, с кнопкой копирования.
function codeBanner(req, client) {
  const t = req.t;
  const flash = req.session.flash; delete req.session.flash;
  const w = activeWarehouses()[0];
  const mark = w ? shippingMark(w.mark_template, client) : client.code;
  return `${flash ? `<div class="alert ok">${esc(flash)}</div>` : ''}<div class="card codebar">
    <div><div class="muted">${esc(client.name)}, ${esc(t('your_code_is'))}</div><div class="code" id="c-mark">${esc(mark)}</div></div>
    ${copyBtn(t, 'c-mark', t('copy_code'))}</div>`;
}

app.get('/address', (req, res) => {
  const t = req.t;
  const client = currentClient(req);
  if (!client) return res.redirect('/');
  const whs = activeWarehouses();
  const w = whs.find((x) => x.id === parseInt(req.query.wh, 10));
  const note = (x) => (req.lang === 'zh' ? x.note_zh : x.note_ru);
  const hours = (x) => (req.lang === 'zh' ? x.hours_zh : x.hours_ru);
  if (!w) {
    return res.render(t('choose_wh'), `<div class="narrow">${steps(t, 2)}${codeBanner(req, client)}<div class="card"><h1>${esc(t('choose_wh'))}</h1>
      <div class="wh-list">${whs.map((x) => `<a class="wh" href="/address?wh=${x.id}"><b>${esc(whName(req.lang, x))}</b><span>${esc(note(x))}</span><span class="muted">🕘 ${esc(hours(x))}</span></a>`).join('')}</div>
      ${notice(req)}
      </div></div>`);
  }
  const f = addressFields(w, client);
  const row = (id, label, value) => `<div class="field"><div><div class="muted">${esc(label)}</div><div class="val" id="${id}">${esc(value)}</div></div>${copyBtn(t, id)}</div>`;
  res.render(t('china_address'), `<div class="narrow">${steps(t, 2)}${codeBanner(req, client)}<div class="card">
    <div class="row" style="align-items:center"><h1 style="margin:0">${esc(t('warehouse'))}: ${esc(whName(req.lang, w))}</h1>
      <a href="/address" class="btn sec sm" style="flex:0 0 auto">${esc(t('change_wh'))}</a></div>
    <p class="muted">🕘 ${esc(t('hours'))}: ${esc(hours(w))}</p>
    ${note(w) ? `<div class="alert warn">${esc(note(w))}</div>` : ''}
    <div class="addr" id="addr-all">${esc(f.all)}</div>
    <p>${copyBtn(t, 'addr-all', t('copy_all'), true)}</p>
    <div class="alert info">${esc(t('paste_help'))}</div>
    <h3>${esc(t('by_fields'))}</h3>
    ${row('f-n', t('receiver'), f.name)}${row('f-p', t('receiver_phone'), f.phone)}${row('f-a', t('address'), f.address)}
    <p class="muted">${esc(t('rules'))}</p>
    </div>
    <div class="card"><h3>${esc(t('pickup'))}${client.city_name ? ' · ' + esc(client.city_name) : ''}</h3>
      <div class="addr">${esc(client.pickup_address || '—')}</div>
      <p><a class="btn sec" href="/cabinet">${esc(t('goto_cabinet'))}</a></p></div></div>`);
});

// ---------- Отслеживание ----------

function parcelHistory(t, parcelId) {
  return db.prepare('SELECT * FROM parcel_events WHERE parcel_id = ? ORDER BY id DESC').all(parcelId)
    .map((e) => `<div>${esc(fmtDate(e.created_at))} — ${esc(t('st_' + e.status))}${e.comment ? ' · ' + esc(e.comment) : ''}</div>`).join('');
}

app.get('/track', (req, res) => {
  const t = req.t;
  const tracks = String(req.query.q || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  let results = '';
  if (tracks.length) {
    const rows = tracks.map((tr) => {
      const p = db.prepare('SELECT * FROM parcels WHERE track = ?').get(tr);
      if (!p) return `<tr><td>${esc(tr)}</td><td colspan="4" class="muted">${esc(t('track_none'))}</td></tr>`;
      return `<tr><td><b>${esc(p.track)}</b></td><td>${statusBadge(t, p.status)}</td><td>${p.weight || ''}</td><td>${p.places || ''}</td><td style="font-size:13px">${parcelHistory(t, p.id)}</td></tr>`;
    }).join('');
    results = `<div class="card tbl"><table><tr><th>${esc(t('track'))}</th><th>${esc(t('status'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('places'))}</th><th>${esc(t('history'))}</th></tr>${rows}</table></div>`;
  }
  res.render(t('track_title'), `<div class="card"><h1>${esc(t('track_title'))}</h1>
    <form method="get"><textarea name="q" placeholder="${esc(t('track_placeholder'))}">${esc(tracks.join('\n'))}</textarea>
    <p><button>${esc(t('track_btn'))}</button></p></form>
    <p class="muted" style="font-size:13px">151.likerj.com: <a href="${LEGACY_TRACK_URL}" target="_blank" rel="noopener">运踪查询</a> · <a href="${LEGACY_TRACK_URL}/ZXYZ.php" target="_blank" rel="noopener">运踪列表查询</a></p></div>${results}`);
});

// ---------- Личный кабинет ----------

function invoicesTable(t, invoices, base) {
  if (!invoices.length) return `<p class="muted">${esc(t('no_invoices'))}</p>`;
  return `<div class="tbl"><table><tr><th>${esc(t('invoice_no'))}</th><th>${esc(t('date'))}</th><th>${esc(t('total_weight'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('status'))}</th><th></th></tr>
  ${invoices.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(fmtDate(i.created_at))}</td><td>${i.total_weight}</td><td>${esc(money(i.amount))}</td>
  <td>${i.paid ? `<span class="badge b-arrived">${esc(t('paid'))}</span>` : `<span class="badge b-border">${esc(t('unpaid'))}</span>`}</td>
  <td><a href="${base}${i.id}">${esc(t('open'))}</a></td></tr>`).join('')}</table></div>`;
}

app.get('/cabinet', (req, res) => {
  const t = req.t;
  const client = req.session.clientId && getClient(req.session.clientId);
  if (!client) {
    return res.render(t('login_title'), `<div class="card" style="max-width:420px;margin:0 auto"><h1>${esc(t('login_title'))}</h1><p class="muted">${esc(t('login_hint'))}</p>
      ${req.query.err ? `<div class="alert err">${esc(t('login_error'))}</div>` : ''}
      <form method="post" action="/cabinet/login"><label>${esc(t('phone'))}</label><input name="phone" type="tel" required>
      <label>${esc(t('code'))}</label><input name="code" required><p><button>${esc(t('login_btn'))}</button></p></form>
      <a href="/">${esc(t('get_code'))}</a></div>`);
  }
  const parcels = db.prepare('SELECT * FROM parcels WHERE client_id = ? ORDER BY updated_at DESC').all(client.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY id DESC').all(client.id);
  const w = activeWarehouses()[0];
  const pRows = parcels.length ? `<div class="tbl"><table><tr><th>${esc(t('track'))}</th><th>${esc(t('status'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('places'))}</th><th>${esc(t('description'))}</th><th>${esc(t('date'))}</th></tr>
    ${parcels.map((p) => `<tr><td><a href="/track?q=${encodeURIComponent(p.track)}">${esc(p.track)}</a></td><td>${statusBadge(t, p.status)}</td><td>${p.weight || ''}</td><td>${p.places || ''}</td><td>${esc(p.description)}</td><td>${esc(fmtDate(p.updated_at))}</td></tr>`).join('')}</table></div>`
    : `<p class="muted">${esc(t('no_parcels'))}</p>`;
  res.render(t('nav_cabinet'), `${notice(req)}<div class="card"><div class="row" style="align-items:center"><div><div class="muted">${esc(client.name)}, ${esc(t('your_code_is'))}</div>
    <div class="code">${esc(w ? shippingMark(w.mark_template, client) : client.code)}</div></div>
    <a class="btn sec" href="/address" style="flex:0 0 auto">${esc(t('china_address'))}</a></div></div>
    <div class="card"><h2>${esc(t('my_parcels'))}</h2>${pRows}</div>
    <div class="card"><h2>${esc(t('my_invoices'))}</h2>${invoicesTable(t, invoices, '/invoice/')}</div>`);
});

app.post('/cabinet/login', (req, res) => {
  // Принимаем и «1600», и «D1600», и «D1600-4567».
  const code = String(req.body.code || '').trim().toUpperCase().replace(/^D/, '').replace(/-\d{4}$/, '');
  const c = db.prepare('SELECT id FROM clients WHERE phone = ? AND code = ?').get(normPhone(req.body.phone), code);
  if (!c) return res.redirect('/cabinet?err=1');
  req.session.clientId = c.id;
  res.redirect('/cabinet');
});

function invoicePage(req, inv) {
  const t = req.t;
  const client = getClient(inv.client_id);
  const parcels = db.prepare('SELECT * FROM parcels WHERE invoice_id = ? ORDER BY id').all(inv.id);
  return `<div class="card"><div class="row" style="align-items:start"><div><h1>${esc(t('invoice'))} № ${esc(inv.number)}</h1>
    <div class="muted">${esc(fmtDate(inv.created_at))}</div></div>
    <div style="text-align:right">${inv.paid ? `<span class="badge b-arrived">${esc(t('paid'))}</span>` : `<span class="badge b-border">${esc(t('unpaid'))}</span>`}</div></div>
    <p><b>${esc(t('client'))}:</b> ${esc(client.name)} · ${esc(client.code)}${req.session.admin === 'accountant' ? '' : ` · +${esc(client.phone)}`} · ${esc(client.city_name || '')}</p>
    <div class="tbl"><table><tr><th>#</th><th>${esc(t('track'))}</th><th>${esc(t('description'))}</th><th>${esc(t('places'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('amount'))}</th></tr>
    ${parcels.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.track)}</td><td>${esc(p.description)}</td><td>${p.places}</td><td>${p.weight}</td><td>${esc(money(p.weight * inv.rate))}</td></tr>`).join('')}
    <tr><th colspan="4">${esc(t('total'))}</th><th>${inv.total_weight}</th><th>${esc(money(inv.amount))}</th></tr></table></div>
    <p>${esc(t('rate'))}: ${esc(money(inv.rate))}${inv.note ? `<br>${esc(t('note'))}: ${esc(inv.note)}` : ''}</p>
    <p class="noprint"><button type="button" onclick="print()">${esc(t('print'))}</button></p></div>`;
}

app.get('/invoice/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv || (!req.session.admin && inv.client_id !== req.session.clientId)) return res.redirect('/cabinet');
  res.render(`${req.t('invoice')} ${inv.number}`, invoicePage(req, inv));
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// ---------- Админка ----------

const ADMIN_TABS = [['/admin', 'a_dashboard'], ['/admin/clients', 'a_clients'], ['/admin/parcels', 'a_parcels'], ['/admin/import', 'a_import'], ['/admin/invoices', 'a_invoices'], ['/admin/settings', 'a_settings']];
function adminRender(req, res, title, body) {
  const role = `<span class="badge" style="margin-left:auto">${esc(req.t(isOwner(req) ? 'role_owner' : 'role_accountant'))}</span>`;
  const tabs = ADMIN_TABS.filter(([h]) => isOwner(req) || h !== '/admin/settings').map(([h, k]) => `<a href="${h}" class="${req.path === h || (h !== '/admin' && req.path.startsWith(h)) ? 'on' : ''}">${esc(req.t(k))}</a>`).join('');
  const flash = req.session.flash; delete req.session.flash;
  res.render(title, `<div class="subnav noprint">${tabs}${role}</div>${flash ? `<div class="alert ok">${esc(flash)}</div>` : ''}${body}`);
}

app.post('/admin/login', (req, res) => {
  const same = (x, y) => { const a = Buffer.from(String(x || '')); const b = Buffer.from(y); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  if (same(req.body.password, ADMIN_PASSWORD)) req.session.admin = 'owner';
  else if (same(req.body.password, ACCOUNTANT_PASSWORD)) req.session.admin = 'accountant';
  res.redirect('/admin' + (req.session.admin ? '' : '?err=1'));
});

app.use('/admin', (req, res, next) => {
  if (req.session.admin === true) req.session.admin = 'owner';
  if (req.session.admin) {
    if (req.path.startsWith('/settings') && !isOwner(req)) return res.redirect('/admin');
    return next();
  }
  res.render(req.t('admin_login'), `<div class="card" style="max-width:380px;margin:0 auto"><h1>${esc(req.t('admin_login'))}</h1>
    ${req.query.err ? `<div class="alert err">${esc(req.t('login_error'))}</div>` : ''}
    <form method="post" action="/admin/login"><label>${esc(req.t('password'))}</label><input type="password" name="password" required autofocus><p><button>${esc(req.t('login_btn'))}</button></p></form></div>`);
});

app.get('/admin', (req, res) => {
  const t = req.t;
  const c = (sql) => db.prepare(sql).get().c;
  const byStatus = Object.keys(STATUSES).map((s) => `<a class="card" href="/admin/parcels?status=${s}" style="display:block;margin:0">${statusBadge(t, s)}<div class="stat">${c(`SELECT COUNT(*) c FROM parcels WHERE status = '${s}'`)}</div></a>`).join('');
  adminRender(req, res, t('a_dashboard'), `<div class="grid g4">
    <div class="card"><div class="muted">${esc(t('a_total_clients'))}</div><div class="stat">${c('SELECT COUNT(*) c FROM clients')}</div></div>
    <div class="card"><div class="muted">${esc(t('a_total_parcels'))}</div><div class="stat">${c('SELECT COUNT(*) c FROM parcels')}</div></div>
    <div class="card"><div class="muted">${esc(t('a_unpaid'))}</div><div class="stat">${c('SELECT COUNT(*) c FROM invoices WHERE paid = 0')}</div></div>
    <div class="card"><div class="muted">${esc(t('a_no_client'))}</div><div class="stat">${c('SELECT COUNT(*) c FROM parcels WHERE client_id IS NULL')}</div></div></div>
    <div class="grid g4">${byStatus}</div>`);
});

app.get('/admin/clients', (req, res) => {
  const t = req.t; const q = String(req.query.q || '').trim();
  const like = `%${q}%`; const owner = isOwner(req);
  const rows = db.prepare(`SELECT c.*, ci.name city_name, (SELECT COUNT(*) FROM parcels p WHERE p.client_id = c.id) pc
    FROM clients c LEFT JOIN cities ci ON ci.id = c.city_id
    WHERE ? = '' OR c.code LIKE ? OR c.name LIKE ? OR (? AND c.phone LIKE ?) ORDER BY c.id DESC LIMIT 300`).all(q, like, like, owner ? 1 : 0, like);
  adminRender(req, res, t('a_clients'), `<div class="card"><form class="row"><div><input name="q" value="${esc(q)}" placeholder="${esc(t('code'))} / ${esc(t('name'))}${owner ? ' / ' + esc(t('phone')) : ''}"></div><button>${esc(t('search'))}</button></form></div>
  <div class="card tbl"><table><tr><th>${esc(t('code'))}</th><th>${esc(t('name'))}</th>${owner ? `<th>${esc(t('phone'))}</th>` : ''}<th>${esc(t('city'))}</th><th>${esc(t('parcels_count'))}</th><th>${esc(t('registered'))}</th></tr>
  ${rows.map((r) => `<tr><td><a href="/admin/clients/${r.id}"><b>${esc(r.code)}</b></a></td><td>${esc(r.name)}</td>${owner ? `<td><a href="https://wa.me/${esc(r.phone)}" target="_blank" rel="noopener">+${esc(r.phone)}</a></td>` : ''}<td>${esc(r.city_name)}</td><td>${r.pc}</td><td>${esc(fmtDate(r.created_at))}</td></tr>`).join('')}</table></div>`);
});

app.get('/admin/clients/:id', (req, res) => {
  const t = req.t;
  const client = getClient(parseInt(req.params.id, 10));
  if (!client) return res.redirect('/admin/clients');
  const parcels = db.prepare('SELECT * FROM parcels WHERE client_id = ? ORDER BY updated_at DESC').all(client.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY id DESC').all(client.id);
  const w = activeWarehouses()[0];
  const phone = isOwner(req) ? ` · <a href="https://wa.me/${esc(client.phone)}" target="_blank" rel="noopener">+${esc(client.phone)}</a>` : '';
  adminRender(req, res, client.code, `<div class="card"><h1>${esc(client.name)}${phone}</h1>
    <div class="code">${esc(w ? shippingMark(w.mark_template, client) : client.code)}</div><div class="muted">${esc(client.city_name || '')} · ${esc(fmtDate(client.created_at))}</div></div>
    <div class="card"><h2>${esc(t('a_parcels'))}</h2>${parcelsTable(req, parcels)}</div>
    <div class="card"><h2>${esc(t('a_invoices'))}</h2>${invoicesTable(t, invoices, '/admin/invoices/')}
    <p><a class="btn" href="/admin/invoices/new?code=${encodeURIComponent(client.code)}">${esc(t('a_new_invoice'))}</a></p></div>`);
});

function parcelsTable(req, parcels) {
  const t = req.t;
  if (!parcels.length) return `<p class="muted">${esc(t('no_parcels'))}</p>`;
  return `<form method="post" action="/admin/parcels/bulk"><div class="tbl"><table><tr><th><input type="checkbox" id="checkall" style="width:auto"></th><th>${esc(t('track'))}</th><th>${esc(t('client'))}</th><th>${esc(t('status'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('places'))}</th><th>${esc(t('description'))}</th><th>${esc(t('invoice'))}</th><th>${esc(t('date'))}</th></tr>
  ${parcels.map((p) => `<tr><td><input type="checkbox" name="ids" value="${p.id}" style="width:auto"></td><td><a href="/track?q=${encodeURIComponent(p.track)}">${esc(p.track)}</a></td>
  <td>${p.client_id ? `<a href="/admin/clients/${p.client_id}">${esc(p.client_code)}</a>` : `<span class="badge b-border">${esc(p.client_code || t('a_no_client'))}</span>`}</td>
  <td>${statusBadge(t, p.status)}</td><td>${p.weight}</td><td>${p.places}</td><td>${esc(p.description)}</td><td>${p.invoice_id ? `<a href="/admin/invoices/${p.invoice_id}">#${p.invoice_id}</a>` : ''}</td><td>${esc(fmtDate(p.updated_at))}</td></tr>`).join('')}
  </table></div><div class="row" style="margin-top:12px"><div><label>${esc(t('a_bulk_status'))}</label><select name="status">${statusOptions(t)}</select></div>
  <div><label>${esc(t('note'))}</label><input name="comment"></div><button>${esc(t('apply'))}</button></div>
  <input type="hidden" name="back" value="${esc(req.originalUrl)}"></form>`;
}

app.get('/admin/parcels', (req, res) => {
  const t = req.t; const q = String(req.query.q || '').trim(); const st = STATUSES[req.query.status] ? req.query.status : '';
  const like = `%${q}%`;
  const parcels = db.prepare(`SELECT * FROM parcels WHERE (? = '' OR track LIKE ? OR client_code LIKE ? OR description LIKE ?) AND (? = '' OR status = ?)
    ORDER BY updated_at DESC LIMIT 500`).all(q, like, like, like, st, st);
  adminRender(req, res, t('a_parcels'), `<div class="card"><h2>${esc(t('a_new_parcel'))}</h2>
    <form method="post" action="/admin/parcels" class="row">
      <div><label>${esc(t('track'))}</label><input name="track" required></div><div><label>${esc(t('code'))}</label><input name="client_code"></div>
      <div><label>${esc(t('weight'))}</label><input name="weight" inputmode="decimal"></div><div><label>${esc(t('places'))}</label><input name="places" inputmode="numeric"></div>
      <div><label>${esc(t('description'))}</label><input name="description"></div><div><label>${esc(t('status'))}</label><select name="status">${statusOptions(t, 'china')}</select></div>
      <button>${esc(t('save'))}</button></form></div>
    <div class="card"><form class="row"><div><input name="q" value="${esc(q)}" placeholder="${esc(t('track'))} / ${esc(t('code'))}"></div>
      <div><select name="status"><option value="">— ${esc(t('status'))} —</option>${statusOptions(t, st)}</select></div><button>${esc(t('search'))}</button></form></div>
    <div class="card">${parcelsTable(req, parcels)}</div>`);
});

app.post('/admin/parcels', (req, res) => {
  const b = req.body;
  upsertParcel({ track: b.track, clientCode: b.client_code, weight: b.weight, places: b.places, description: b.description, status: b.status });
  req.session.flash = req.t('saved');
  res.redirect('/admin/parcels');
});

app.post('/admin/parcels/bulk', (req, res) => {
  const ids = [].concat(req.body.ids || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const status = STATUSES[req.body.status] ? req.body.status : null;
  if (status) {
    for (const id of ids) {
      db.prepare("UPDATE parcels SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
      addEvent(id, status, String(req.body.comment || '').slice(0, 200));
    }
    req.session.flash = `${req.t('saved')}: ${ids.length}`;
  }
  const back = String(req.body.back || '/admin/parcels');
  res.redirect(back.startsWith('/admin') ? back : '/admin/parcels');
});

const IMPORT_COLS = {
  track: ['трек', 'трек-номер', 'трек номер', 'track', '快递单号', '单号', '运单号'],
  clientCode: ['код', 'код клиента', 'code', '客户编码', '编码', '唛头'],
  weight: ['вес', 'weight', '重量', 'kg'],
  places: ['мест', 'места', 'places', '件数'],
  description: ['описание', 'товар', 'description', '品名'],
  status: ['статус', 'status', '状态'],
};

app.get('/admin/import', (req, res) => {
  const t = req.t;
  adminRender(req, res, t('a_import'), `<div class="card"><h2>${esc(t('a_import'))}</h2><p class="muted">${esc(t('a_import_hint'))}</p>
    <form method="post" action="/admin/import" enctype="multipart/form-data" class="row"><div><input type="file" name="file" accept=".xlsx,.xls,.csv" required></div>
    <div><label>${esc(t('status'))}</label><select name="default_status">${statusOptions(t, 'china')}</select></div><button>${esc(t('a_upload'))}</button></form>
    <p><a href="/admin/template.xlsx">${esc(t('a_template'))}</a></p></div>`);
});

app.get('/admin/template.xlsx', (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([['Трек / 快递单号', 'Код клиента / 客户编码', 'Вес / 重量', 'Мест / 件数', 'Описание / 品名', 'Статус / 状态'], ['YT1234567890', '1600', 2.5, 1, 'Обувь', 'china']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'parcels');
  res.setHeader('Content-Disposition', 'attachment; filename="cargo151-template.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// Заголовок вида "Трек / 快递单号" совпадает с любым из вариантов.
function matchColumn(header) {
  const parts = String(header || '').toLowerCase().split('/').map((s) => s.trim());
  for (const [field, names] of Object.entries(IMPORT_COLS)) if (parts.some((p) => names.includes(p))) return field;
  return null;
}

app.post('/admin/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.redirect('/admin/import');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  const map = (rows[0] || []).map(matchColumn);
  const def = STATUSES[req.body.default_status] ? req.body.default_status : 'china';
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows.slice(1)) {
      const rec = {};
      map.forEach((f, i) => { if (f) rec[f] = row[i]; });
      if (!rec.track) continue;
      rec.status = rec.status || def;
      if (upsertParcel(rec)) n++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  req.session.flash = `${req.t('a_imported')}: ${n}`;
  res.redirect('/admin/parcels');
});

app.get('/admin/invoices', (req, res) => {
  const t = req.t;
  const invoices = db.prepare(`SELECT i.*, c.code, c.name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.id DESC LIMIT 300`).all();
  adminRender(req, res, t('a_invoices'), `<div class="card"><form method="get" action="/admin/invoices/new" class="row"><div><label>${esc(t('a_pick_client'))}</label><input name="code" required></div><button>${esc(t('a_new_invoice'))}</button></form></div>
  <div class="card tbl"><table><tr><th>${esc(t('invoice_no'))}</th><th>${esc(t('client'))}</th><th>${esc(t('date'))}</th><th>${esc(t('total_weight'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('status'))}</th></tr>
  ${invoices.map((i) => `<tr><td><a href="/admin/invoices/${i.id}">${esc(i.number)}</a></td><td>${esc(i.code)} · ${esc(i.name)}</td><td>${esc(fmtDate(i.created_at))}</td><td>${i.total_weight}</td><td>${esc(money(i.amount))}</td>
  <td>${i.paid ? `<span class="badge b-arrived">${esc(t('paid'))}</span>` : `<span class="badge b-border">${esc(t('unpaid'))}</span>`}</td></tr>`).join('')}</table></div>`);
});

app.get('/admin/invoices/new', (req, res) => {
  const t = req.t;
  const client = db.prepare('SELECT * FROM clients WHERE code = ?').get(String(req.query.code || '').trim().toUpperCase().replace(/^D/, ''));
  if (!client) { req.session.flash = t('not_found'); return res.redirect('/admin/invoices'); }
  const parcels = db.prepare('SELECT * FROM parcels WHERE client_id = ? AND invoice_id IS NULL ORDER BY id').all(client.id);
  adminRender(req, res, t('a_new_invoice'), `<div class="card"><h2>${esc(t('a_new_invoice'))}: ${esc(client.code)} · ${esc(client.name)}</h2>
    <form method="post" action="/admin/invoices"><input type="hidden" name="client_id" value="${client.id}"><h3>${esc(t('a_pick_parcels'))}</h3>
    ${parcels.length ? `<div class="tbl"><table><tr><th><input type="checkbox" id="checkall" style="width:auto" checked></th><th>${esc(t('track'))}</th><th>${esc(t('status'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('places'))}</th><th>${esc(t('description'))}</th></tr>
    ${parcels.map((p) => `<tr><td><input type="checkbox" name="ids" value="${p.id}" checked style="width:auto"></td><td>${esc(p.track)}</td><td>${statusBadge(t, p.status)}</td><td>${p.weight}</td><td>${p.places}</td><td>${esc(p.description)}</td></tr>`).join('')}</table></div>` : `<p class="muted">${esc(t('no_parcels'))}</p>`}
    <div class="row" style="margin-top:12px"><div><label>${esc(t('rate'))} (${esc(setting('currency'))})</label><input name="rate" value="${esc(setting('rate_per_kg'))}" inputmode="decimal"></div>
    <div><label>${esc(t('note'))}</label><input name="note"></div><button>${esc(t('create'))}</button></div></form></div>`);
});

app.post('/admin/invoices', (req, res) => {
  const clientId = parseInt(req.body.client_id, 10);
  const ids = [].concat(req.body.ids || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const rate = numOrNull(req.body.rate) ?? numOrNull(setting('rate_per_kg')) ?? 0;
  const parcels = ids.map((id) => db.prepare('SELECT * FROM parcels WHERE id = ? AND client_id = ? AND invoice_id IS NULL').get(id, clientId)).filter(Boolean);
  if (!parcels.length) return res.redirect('/admin/invoices');
  const weight = Math.round(parcels.reduce((s, p) => s + (p.weight || 0), 0) * 100) / 100;
  db.exec('BEGIN');
  const r = db.prepare('INSERT INTO invoices (number, client_id, rate, total_weight, amount, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run('tmp-' + crypto.randomUUID(), clientId, rate, weight, Math.round(weight * rate * 100) / 100, String(req.body.note || '').slice(0, 300));
  const id = Number(r.lastInsertRowid);
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  db.prepare('UPDATE invoices SET number = ? WHERE id = ?').run(`151-${d}-${id}`, id);
  for (const p of parcels) db.prepare('UPDATE parcels SET invoice_id = ? WHERE id = ?').run(id, p.id);
  db.exec('COMMIT');
  res.redirect(`/admin/invoices/${id}`);
});

app.get('/admin/invoices/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv) return res.redirect('/admin/invoices');
  adminRender(req, res, inv.number, `${invoicePage(req, inv)}<form method="post" action="/admin/invoices/${inv.id}/paid" class="noprint">
    <input type="hidden" name="paid" value="${inv.paid ? 0 : 1}"><button class="sec">${esc(inv.paid ? req.t('unpaid') : req.t('a_mark_paid'))}</button></form>`);
});

app.post('/admin/invoices/:id/paid', (req, res) => {
  db.prepare('UPDATE invoices SET paid = ? WHERE id = ?').run(req.body.paid === '1' ? 1 : 0, parseInt(req.params.id, 10));
  res.redirect(`/admin/invoices/${parseInt(req.params.id, 10)}`);
});

app.get('/admin/settings', (req, res) => {
  const t = req.t;
  const whs = db.prepare('SELECT * FROM warehouses ORDER BY id').all();
  const cities = db.prepare('SELECT * FROM cities ORDER BY id').all();
  const whForm = (w) => `<div class="card" style="background:#fafafa"><div class="row">
    <div><label>${esc(t('wh_name_ru'))}</label><input name="wh_${w.id}_name_ru" value="${esc(w.name_ru)}"></div>
    <div><label>${esc(t('wh_name_zh'))}</label><input name="wh_${w.id}_name_zh" value="${esc(w.name_zh)}"></div>
    <div><label>${esc(t('receiver'))}</label><input name="wh_${w.id}_receiver" value="${esc(w.receiver)}"></div>
    <div><label>${esc(t('receiver_phone'))}</label><input name="wh_${w.id}_phone" value="${esc(w.phone)}"></div></div>
    <label>${esc(t('address'))}</label><input name="wh_${w.id}_address" value="${esc(w.address)}">
    <div class="row"><div><label>${esc(t('hours'))} (рус)</label><input name="wh_${w.id}_hours_ru" value="${esc(w.hours_ru)}"></div>
    <div><label>${esc(t('hours'))} (中文)</label><input name="wh_${w.id}_hours_zh" value="${esc(w.hours_zh)}"></div></div>
    <div class="row"><div><label>${esc(t('wh_note'))} (рус)</label><input name="wh_${w.id}_note_ru" value="${esc(w.note_ru)}"></div>
    <div><label>${esc(t('wh_note'))} (中文)</label><input name="wh_${w.id}_note_zh" value="${esc(w.note_zh)}"></div></div>
    <div class="row"><div><label>${esc(t('mark_tpl'))} ({code}, {last4})</label><input name="wh_${w.id}_mark_template" value="${esc(w.mark_template)}"></div>
    <div><label>${esc(t('name_tpl'))} ({mark}, {receiver})</label><input name="wh_${w.id}_name_template" value="${esc(w.name_template)}"></div>
    <div><label>${esc(t('active'))}</label><select name="wh_${w.id}_active"><option value="1" ${w.active ? 'selected' : ''}>✓</option><option value="0" ${w.active ? '' : 'selected'}>✗</option></select></div></div></div>`;
  adminRender(req, res, t('a_settings'), `<form method="post" action="/admin/settings">
    <div class="card"><h2>${esc(t('s_warehouses'))}</h2>${whs.map(whForm).join('')}${whForm({ id: 'new', name_ru: '', name_zh: '', receiver: '', phone: '', address: '', mark_template: 'D{code}-{last4}', name_template: '{mark}', hours_ru: 'Ежедневно, без выходных', hours_zh: '每天营业，无休息日', note_ru: '', note_zh: '', active: 1 }).replace('<div class="card" style="background:#fafafa">', `<div class="card" style="background:#fafafa"><h3>${esc(t('add_wh'))}</h3>`)}</div>
    <div class="card"><h2>${esc(t('s_notice'))}</h2>
      <label>рус</label><input name="notice_ru" value="${esc(setting('notice_ru'))}"><label>中文</label><input name="notice_zh" value="${esc(setting('notice_zh'))}"></div>
    ${['services', 'about'].map((k) => `<div class="card"><h2>${esc(t('nav_' + k))}</h2><p class="muted">${esc(t('s_info_hint'))}</p>
      <label>рус</label><textarea name="${k}_ru" style="min-height:220px">${esc(setting(k + '_ru'))}</textarea>
      <label>中文</label><textarea name="${k}_zh" style="min-height:220px">${esc(setting(k + '_zh'))}</textarea></div>`).join('')}
    <div class="card"><h2>${esc(t('nav_info'))}</h2><p class="muted">${esc(t('s_info_hint'))}</p>
      <label>рус</label><textarea name="info_ru" style="min-height:260px">${esc(setting('info_ru'))}</textarea>
      <label>中文</label><textarea name="info_zh" style="min-height:260px">${esc(setting('info_zh'))}</textarea></div>
    <div class="card"><h2>${esc(t('s_pickup'))}</h2>${cities.map((c) => `<label>${esc(c.name)}</label><input name="city_${c.id}" value="${esc(c.pickup_address)}">`).join('')}</div>
    <div class="card"><div class="row"><div><label>${esc(t('s_rate'))}</label><input name="rate_per_kg" value="${esc(setting('rate_per_kg'))}"></div>
    <div><label>${esc(t('s_currency'))}</label><input name="currency" value="${esc(setting('currency'))}"></div>
    <div><label>${esc(t('s_code_start'))}</label><input name="code_start" value="${esc(setting('code_start'))}"></div>
    <div><label>WhatsApp</label><input name="whatsapp" value="${esc(setting('whatsapp'))}"></div></div>
    <p class="muted">${esc(t('a_password_note'))}</p></div>
    <p><button>${esc(t('save'))}</button></p></form>`);
});

app.post('/admin/settings', (req, res) => {
  const b = req.body;
  const f = ['name_ru', 'name_zh', 'receiver', 'phone', 'address', 'mark_template', 'name_template', 'hours_ru', 'hours_zh', 'note_ru', 'note_zh'];
  db.exec('BEGIN');
  for (const w of db.prepare('SELECT id FROM warehouses').all()) {
    db.prepare(`UPDATE warehouses SET ${f.map((k) => `${k} = ?`).join(', ')}, active = ? WHERE id = ?`)
      .run(...f.map((k) => String(b[`wh_${w.id}_${k}`] ?? '').trim()), b[`wh_${w.id}_active`] === '0' ? 0 : 1, w.id);
  }
  if (String(b.wh_new_name_ru || '').trim() && String(b.wh_new_address || '').trim()) {
    db.prepare(`INSERT INTO warehouses (${f.join(', ')}) VALUES (${f.map(() => '?').join(', ')})`).run(...f.map((k) => String(b[`wh_new_${k}`] || '').trim()));
  }
  for (const c of db.prepare('SELECT id FROM cities').all()) db.prepare('UPDATE cities SET pickup_address = ? WHERE id = ?').run(String(b[`city_${c.id}`] ?? '').trim(), c.id);
  for (const k of ['rate_per_kg', 'currency', 'code_start', 'whatsapp', 'notice_ru', 'notice_zh', 'info_ru', 'info_zh', 'about_ru', 'about_zh', 'services_ru', 'services_zh']) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, String(b[k] ?? '').trim());
  db.exec('COMMIT');
  req.session.flash = req.t('saved');
  res.redirect('/admin/settings');
});

app.listen(PORT, () => console.log(`Cargo 151: http://localhost:${PORT}  (owner: ${process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD' : 'admin151'}, accountant: ${process.env.ACCOUNTANT_PASSWORD ? 'ACCOUNTANT_PASSWORD' : 'buh151'})`));
