const express = require('express');
const session = require('express-session');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const { db, dispCode, codeKey, STATUSES, setting, normPhone, nextClientCode, shippingMark, upsertParcel, addEvent, numOrNull, linkOrphanParcels } = require('./db');
const { t: tr, LANGS } = require('./i18n');
const { page, esc, heroMap, statusLine } = require('./layout');
const { goodsRu } = require('./goods-ru');
const { readScanFile, parseScan } = require('./scanner');

// Владелец входит логином admin и паролем из /etc/cargo151.env — так доступ не потеряется никогда.
// Остальным сотрудникам владелец сам заводит логин и пароль в «Настройках» → «Сотрудники».
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin151';
// Владелец — всё. Бухгалтер — всё, кроме номеров клиентов, настроек и удаления.
// Менеджер и кладовщик — только фото с весов к накладным.
const ROLES = ['owner', 'accountant', 'manager', 'keeper'];
const PORT = process.env.PORT || 3000;
const isOwner = (req) => req.session.admin === 'owner';
// Кто куда может зайти в админке: первое совпавшее правило, иначе — владелец и бухгалтер.
const ALL = ROLES; const MONEY = ['owner', 'accountant']; const OWNER = ['owner'];
const ACL = [
  [/^(GET|POST) \/(settings|backup)/, OWNER], [/^POST \/clients\/(import|add)$/, OWNER], [/^POST \/invoices\/\d+\/delete$/, OWNER],
  [/^GET \/photos$/, ALL],
  [/^POST \/import-scan$/, ALL], [/^POST \/invoices\/\d+\/photos(\/\d+\/delete)?$/, ALL],
];
const can = (req, method, path) => { const k = `${method} ${path}`; const r = ACL.find(([re]) => re.test(k)); return (r ? r[1] : MONEY).includes(req.session.admin); };
const photosOnly = (req) => ['manager', 'keeper'].includes(req.session.admin);
const canMoney = (req) => MONEY.includes(req.session.admin);
// Код для людей: цифровые коды пишем с D (D1600), старые буквенные (Y58, AB016) как есть.

const app = express();
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// Фото посылок лежат рядом с базой (на сервере /var/lib/cargo151/photos), имена случайные.
const fs = require('fs');
const PHOTO_DIR = process.env.PHOTO_DIR || require('path').join(require('path').dirname(process.env.DB_PATH || require('path').join(__dirname, 'cargo151.db')), 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
// Файл сканера с фото в ячейках бывает большим.
const scanUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
app.use(express.static(require('path').join(__dirname, 'public'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' },
}));

app.use((req, res, next) => {
  const m = /(?:^|;\s*)lang=(ru|kk|zh)/.exec(req.headers.cookie || '');
  const al = req.headers['accept-language'] || '';
  req.lang = m ? m[1] : /^zh/i.test(al) ? 'zh' : /^kk/i.test(al) ? 'kk' : 'ru';
  req.t = tr(req.lang);
  res.render = (title, body) => res.send(page({ title, body, t: req.t, lang: req.lang, path: req.path, session: req.session, whatsapp: setting('whatsapp') }));
  next();
});

const statusBadge = (t, s) => `<span class="badge b-${esc(s)}">${esc(t('st_' + s))}</span>`;
const statusOptions = (t, sel) => Object.keys(STATUSES).map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(t('st_' + k))}</option>`).join('');
const whName = (lang, w) => (lang === 'zh' ? w.name_zh : w.name_ru);
const money = (v) => `${(Math.round(v * 100) / 100).toLocaleString('ru-RU')} ${setting('currency')}`;
// «26.10 11:10» для приёмки.
const fmtDT = (s) => (s ? `${String(s).slice(8, 10)}.${String(s).slice(5, 7)} ${String(s).slice(11, 16)}` : '');
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

// Плашка «поможем оплатить» — на главных страницах клиента; текст меняется в настройках.
const promo = (req) => {
  const zh = req.lang === 'zh';
  const title = setting(zh ? 'promo_title_zh' : 'promo_title_ru'); const text = setting(zh ? 'promo_text_zh' : 'promo_text_ru');
  if (!title) return '';
  const wa = setting('whatsapp');
  const msg = zh ? '您好！需要帮忙付款/充值人民币。' : 'Здравствуйте! Нужна помощь с оплатой поставщику / пополнением юаней.';
  return `<div class="promo noprint"><div class="promo-ic">¥</div><div class="promo-tx"><b>${esc(title)}</b><span>${esc(text)}</span></div>
    ${wa ? `<a class="btn promo-btn" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${esc(req.t('promo_btn'))}</a>` : ''}</div>`;
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
// Каждый раздел «# …» — отдельная карточка, чтобы блоки появлялись по очереди.
function renderInfoCards(text) {
  return String(text || '').split(/\n(?=# )/).map((part) => `<div class="card">${renderInfo(part)}</div>`).join('');
}

app.get('/info', (req, res) => {
  const t = req.t;
  const whs = activeWarehouses();
  res.render(t('nav_info'), `<div class="narrow fade"><div class="card"><h1>${esc(t('nav_info'))}</h1>
    <h2>${esc(t('hours'))}</h2><ul>${whs.map((w) => `<li><b>${esc(whName(req.lang, w))}</b> — ${esc(req.lang === 'zh' ? w.hours_zh : w.hours_ru)}</li>`).join('')}</ul>
    ${renderInfo(setting(req.lang === 'zh' ? 'info_zh' : 'info_ru'))}</div></div>`);
});
for (const [path, key] of [['/about', 'about'], ['/services', 'services'], ['/insurance', 'insurance']]) {
  app.get(path, (req, res) => {
    const wa = setting('whatsapp');
    // С «Услуг» ведём на страховку, со страховки — сразу в WhatsApp.
    const more = key === 'services' ? `<a class="btn sec" href="/insurance">🛡 ${esc(req.t('nav_insurance'))} →</a>`
      : key === 'insurance' && wa ? `<a class="btn" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(req.t('ins_wa_msg'))}" target="_blank" rel="noopener">${esc(req.t('write_wa'))}</a>` : '';
    res.render(req.t('nav_' + key), `<div class="narrow fade">${renderInfoCards(setting(`${key}_${req.lang === 'zh' ? 'zh' : 'ru'}`))}${more ? `<p>${more}</p>` : ''}</div>`);
  });
}

app.get('/', (req, res) => {
  // Клиент уже вошёл — регистрация ему не нужна, сразу в кабинет.
  if (req.session.clientId && getClient(req.session.clientId)) return res.redirect('/cabinet');
  const t = req.t;
  const cities = db.prepare('SELECT * FROM cities ORDER BY id').all();
  res.render(t('nav_home'), `<div class="narrow"><div class="card login-top"><b>${esc(t('have_code'))}</b>
      <form method="post" action="/cabinet/login" class="row" style="margin-top:8px"><div><input name="phone" type="tel" placeholder="+7 747 123 45 67" autocomplete="tel"></div>
      <div style="min-width:110px"><input name="code" required placeholder="${esc(t('code'))}: D1600" autocomplete="off" autocapitalize="characters"></div><button class="sec">${esc(t('login_btn'))}</button></form><p class="muted" style="font-size:14px;margin:6px 0 0">${esc(t('login_rules'))} <a href="/forgot">${esc(t('forgot_code_short'))}</a></p></div>
    ${steps(t, 1)}<div class="card">
    <h1>${esc(t('hero_title'))}</h1><p class="muted">${esc(t('hero_sub'))}</p>
    <form method="post" action="/register">
      <label for="f-name">${esc(t('name'))}</label><input id="f-name" name="name" required maxlength="80" autocomplete="name">
      <label for="f-phone">${esc(t('phone'))}</label><input id="f-phone" name="phone" type="tel" required placeholder="+7 777 123 45 67" autocomplete="tel">
      <div class="hint">${esc(t('phone_hint'))}</div>
      <label>${esc(t('city'))}</label><div class="pick" id="f-city">
        ${cities.map((c, i) => `<label><input type="radio" name="city_id" value="${c.id}" data-name="${esc(c.name)}" required${i === 0 ? ' id="f-city-first"' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
      <div class="hint">${esc(t('city_hint'))}</div>
      <button class="wide">${esc(t('get_code'))}</button>
    </form></div>${promo(req)}
</div>${heroMap(t, req.lang)}`);
});

app.post('/register', (req, res) => {
  const t = req.t;
  const name = String(req.body.name || '').trim().slice(0, 80);
  const phone = normPhone(req.body.phone);
  const cityId = parseInt(req.body.city_id, 10);
  if (!name || phone.length < 10 || !db.prepare('SELECT 1 FROM cities WHERE id = ?').get(cityId)) return res.redirect('/');
  const existing = db.prepare('SELECT id FROM clients WHERE phone = ?').get(phone);
  // Номер уже есть — не пускаем без кода, иначе по чужому номеру можно было бы зайти через регистрацию.
  if (existing) return res.redirect('/cabinet?exists=1');
  const code = nextClientCode();
  const r = db.prepare('INSERT INTO clients (code, name, phone, city_id) VALUES (?, ?, ?, ?)').run(code, name, phone, cityId);
  linkOrphanParcels(r.lastInsertRowid, code);
  req.session.clientId = Number(r.lastInsertRowid);
  res.redirect('/address');
});

app.post('/find', (req, res) => res.redirect('/cabinet'));

// Телефоны складов внизу страницы — для вопросов клиентов.
function keepers(req, whs) {
  const fmt = (p) => { const d = String(p).replace(/\D/g, ''); return d.length === 11 ? `+86 ${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` : p; };
  return `<div class="keepers"><b>${esc(req.t('keepers'))}</b>${whs.map((w) => `<div>${esc(whName(req.lang, w))}: ${esc(w.receiver)} <span class="val">${esc(fmt(w.phone))}</span></div>`).join('')}</div>`;
}

// Старая ссылка на отдельную страницу кода — теперь код показан на странице склада.
app.get('/code', (req, res) => res.redirect('/address'));

// Код клиента вверху страницы склада, с кнопкой копирования.
function codeBanner(req, client) {
  const t = req.t;
  const flash = req.session.flash; delete req.session.flash;
  const w = activeWarehouses()[0];
  const mark = w ? shippingMark(w.mark_template, client) : client.code;
  return `${flash ? `<div class="alert ok">${esc(flash)}</div>` : ''}<div class="card codebar">
    <div><div class="muted">${esc(client.name)}, ${esc(t('your_code_is'))}</div><div class="code" id="c-mark" data-flip>${esc(mark)}</div></div>
    ${copyBtn(t, 'c-mark', t('copy_code'))}</div>`;
}

app.get('/address', (req, res) => {
  const t = req.t;
  const client = currentClient(req);
  if (!client) return res.redirect('/');
  const whs = activeWarehouses();
  // По умолчанию открыт первый склад (Гуанчжоу); переключатель сверху меняет склад одним касанием.
  const w = whs.find((x) => x.id === parseInt(req.query.wh, 10)) || whs[0];
  const note = (x) => (req.lang === 'zh' ? x.note_zh : x.note_ru);
  const hours = (x) => (req.lang === 'zh' ? x.hours_zh : x.hours_ru);
  if (!w) return res.redirect('/');
  const seg = whs.length > 1 ? `<div class="seg" role="tablist">${whs.map((x) => `<a role="tab" href="/address?wh=${x.id}" class="${x.id === w.id ? 'on' : ''}" aria-selected="${x.id === w.id}">${esc(whName(req.lang, x))}</a>`).join('')}</div>` : '';
  const f = addressFields(w, client);
  const row = (id, label, value) => `<div class="field"><div><div class="muted">${esc(label)}</div><div class="val" id="${id}">${esc(value)}</div></div>${copyBtn(t, id)}</div>`;
  res.render(t('china_address'), `<div class="narrow">${steps(t, 2)}${codeBanner(req, client)}<div class="card">
    <h1 style="margin:0 0 4px">${esc(t('china_address'))}</h1><p class="muted" style="margin:0 0 10px">${esc(t('wh_switch_hint'))}</p>${seg}
    <p class="muted">🕘 ${esc(t('hours'))}: ${esc(hours(w))}</p>
    ${note(w) ? `<div class="alert warn">${esc(note(w))}</div>` : ''}
    <div class="addr" id="addr-all">${esc(f.all)}</div>
    <p>${copyBtn(t, 'addr-all', t('copy_all'), true)}</p>
    <div class="alert info">${esc(t('paste_help'))}</div>
    <h3>${esc(t('by_fields'))}</h3>
    ${row('f-n', t('receiver'), f.name)}${row('f-p', t('receiver_phone'), f.phone)}${row('f-a', t('address'), f.address)}
    <p class="muted">${esc(t('rules'))}</p>
    ${keepers(req, whs)}
    </div>${promo(req)}
    <div class="card"><h3>${esc(t('pickup'))}${client.city_name ? ' · ' + esc(client.city_name) : ''}</h3>
      <p class="muted" style="margin:0 0 8px">${esc(t('pickup_info'))}</p>
      <p><a class="btn sec" href="/cabinet">${esc(t('goto_cabinet'))}</a></p></div></div>`);
});

// ---------- Отслеживание ----------

function parcelHistory(t, parcelId) {
  return db.prepare('SELECT * FROM parcel_events WHERE parcel_id = ? ORDER BY id DESC').all(parcelId)
    .map((e) => `<div>${esc(fmtDate(e.created_at))} — ${esc(t('st_' + e.status))}${e.comment ? ' · ' + esc(e.comment) : ''}</div>`).join('');
}

// Статус накладной идёт сам по дням от загрузки в базу: 0 — отправлено, +3 — едет на таможню, +5 — на таможне,
// +7 — оформляется, +8 — ждёт выезда (и стоит так). «Прибыло» и «Выдано» ставят вручную.
const INV_STAGES = [['sent', 0], ['to_customs', 3], ['at_customs', 5], ['clearing', 7], ['queue', 8], ['arrived'], ['delivered']];
const INV_STATUSES = ['auto', ...INV_STAGES.map(([k]) => k)];
const invStatusOptions = (t, sel) => INV_STATUSES.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(t('ist_' + k))}</option>`).join('');
// Дни считаем по календарю Алматы (UTC+5).
const almatyDay = (d) => Math.floor((d.getTime() + 5 * 3600e3) / 86400e3);
const invStart = (i) => new Date(String(i.created_at || '').replace(' ', 'T') + 'Z');
function invStage(i) {
  if (INV_STATUSES.includes(i.inv_status) && i.inv_status !== 'auto') return i.inv_status;
  const days = almatyDay(new Date()) - almatyDay(invStart(i));
  return INV_STAGES.filter(([, d]) => d !== undefined && days >= d).pop()[0];
}
const invBadge = (t, i) => { const s = invStage(i); return `<span class="badge b-${s === 'sent' ? 'china' : s === 'arrived' || s === 'delivered' ? s : s === 'to_customs' ? 'transit' : 'border'}">${esc(t('ist_' + s))}</span>`; };
// Этапы: пройденные — с датой, текущий выделен, будущие — серые и без дат (сроки не обещаем).
function invTimeline(t, i) {
  const cur = INV_STAGES.findIndex(([k]) => k === invStage(i));
  const start = almatyDay(invStart(i));
  const day = (n) => fmtDay(new Date((start + n) * 86400e3).toISOString().slice(0, 10));
  const when = (d, n) => (d !== undefined && n <= cur ? day(d) : '');
  return `<ol class="tl">${INV_STAGES.map(([k, d], n) => `<li class="${n < cur ? 'done' : n === cur ? 'on' : ''}"><b>${esc(t('ist_' + k))}${k === 'arrived' && i.destination ? ` · ${esc(destName(i.destination))}` : ''}</b>${when(d, n) ? `<div class="muted" style="font-size:13px">${esc(when(d, n))}</div>` : ''}${k === 'arrived' && n === cur ? `<div class="alert info" style="margin:6px 0 0">${esc(t('pickup_wait'))}</div>` : ''}</li>`).join('')}</ol>`;
}
// Номер накладной без учёта регистра и пробелов: d1601-1030-4 → D1601-1030-4.
const findInvoice = (no) => db.prepare('SELECT * FROM invoices WHERE number = ?').get(String(no || '').trim().toUpperCase().replace(/\s+/g, ''));

app.get('/track', (req, res) => {
  const t = req.t;
  const tracks = String(req.query.q || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  let results = '';
  const card = (i, top) => `<div class="card parcel"><div class="row" style="align-items:center"><b style="font-size:18px">${esc(i.number)}</b><div style="flex:0 0 auto">${invBadge(t, i)}</div></div>
        ${invTimeline(t, i)}
        <div class="muted">${esc(t('inv_sent'))}: ${esc(fmtDay(i.inv_date || i.created_at))}${i.origin || i.destination ? ` · ${esc(i.origin)} → ${esc(destName(i.destination))}` : ''}</div>
        <div class="muted">${esc(cargoSummary(t, i))}${i.cargo_status ? ` · ${esc(cargoStatus(t, i.cargo_status))}` : ''}</div>
        ${(() => { const ph = invoicePhotos(i.id); return ph.length ? `<div class="thumbs" style="margin-top:8px">${ph.map((f) => `<a href="/photo/${esc(f.file)}" target="_blank"><img src="/photo/${esc(f.file)}" loading="lazy" alt=""></a>`).join('')}</div>` : ''; })()}
        ${isMsk(i.destination) && top !== 'msk' ? `<p class="muted" style="font-size:14px;margin:6px 0 0">${esc(t('track_eta_msk'))}</p>` : ''}
        <p style="margin:10px 0 0"><a class="btn sec sm" href="/invoice/${i.id}">${esc(t('inv_view'))}</a></p></div>`;
  const client = req.session.clientId && getClient(req.session.clientId);
  if (tracks.length) {
    const found = tracks.map(findInvoice);
    const eta = etaFor(t, found.filter(Boolean)); const top = eta === t('track_eta_msk') ? 'msk' : '';
    results = `<div class="fade"><div class="alert info">${esc(eta)}</div>${tracks.map((no, n) => {
      const i = found[n];
      return i ? card(i, top) : `<div class="card"><b>${esc(no)}</b><p class="muted" style="margin:4px 0 0">${esc(t('track_none'))}</p></div>`;
    }).join('')}</div>`;
  } else if (client) {
    // Клиент вошёл — сразу показываем его грузы: сначала те, что ещё в пути, потом последние выданные.
    const all = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY id DESC LIMIT 100').all(client.id);
    const live = all.filter((i) => invStage(i) !== 'delivered');
    const list = live.length ? live : all.slice(0, 5);
    results = `<div class="fade"><h2>${esc(t('track_mine'))} · ${esc(dispCode(client.code))}</h2><div class="alert info">${esc(etaFor(t, list, client.city_name))}</div>
      ${list.length ? list.map((i) => card(i, etaFor(t, list, client.city_name) === t('track_eta_msk') ? 'msk' : '')).join('') : `<div class="card"><p class="muted" style="margin:0">${esc(t('track_mine_none'))}</p></div>`}${myParcels(req, client, '/track')}</div>`;
  }
  res.render(t('track_title'), `${client && !tracks.length ? results : ''}<div class="card"><h1>${esc(t('track_title'))}</h1>
    <form method="get"><textarea name="q" placeholder="${esc(t('track_placeholder'))}">${esc(tracks.join('\n'))}</textarea>
    <p><button>${esc(t('track_btn'))}</button></p></form>
    </div>${client && !tracks.length ? '' : results}${promo(req)}`);
});

// ---------- Фото груза на весах к накладной ----------

const invoicePhotos = (id) => db.prepare('SELECT * FROM invoice_photos WHERE invoice_id = ? ORDER BY id').all(id);
// Выбор фото на телефоне: сжимаем до 1600 px и сразу отправляем форму — бухгалтеру хватает одного нажатия.
const PHOTO_JS = `<script>document.querySelectorAll('input[data-photo]').forEach((inp)=>inp.addEventListener('change',async()=>{const out=new DataTransfer();
for(const f of inp.files){try{const b=await createImageBitmap(f);const k=Math.min(1,1600/Math.max(b.width,b.height));const c=document.createElement('canvas');c.width=b.width*k;c.height=b.height*k;c.getContext('2d').drawImage(b,0,0,c.width,c.height);
const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));out.items.add(new File([blob],'p.jpg',{type:'image/jpeg'}))}catch(e){out.items.add(f)}}
try{inp.files=out.files}catch(e){}inp.closest('form').submit()}))</script>`;
const photoForm = (t, id, back) => `<form method="post" action="/admin/invoices/${id}/photos" enctype="multipart/form-data" class="noprint" style="display:inline-block;margin:0">
  <input type="hidden" name="back" value="${esc(back)}"><label class="btn sec sm" style="margin:0;cursor:pointer">📷 ${esc(t('a_add_photo'))}<input type="file" name="photos" accept="image/*" multiple data-photo hidden></label></form>`;
const photoGrid = (photos) => `<div class="photos">${photos.map((f) => `<a href="/photo/${esc(f.file)}" target="_blank"><img src="/photo/${esc(f.file)}" loading="lazy" alt=""></a>`).join('')}</div>`;

app.get('/photo/:file', (req, res) => {
  const f = String(req.params.file);
  if (!/^[a-f0-9-]{36}\.(jpg|png)$/.test(f) || !(db.prepare('SELECT 1 FROM invoice_photos WHERE file = ?').get(f) || db.prepare('SELECT 1 FROM parcel_photos WHERE file = ?').get(f))) return res.sendStatus(404);
  res.sendFile(require('path').join(PHOTO_DIR, f), { maxAge: '30d' });
});

// Объявления: клиент видит их в кабинете, свежие сверху. Удаляются в админке, когда неактуальны.
const newsText = (lang, n) => (lang === 'zh' && n.text_zh) || (lang === 'kk' && n.text_kk) || n.text_ru;
function newsBlock(req) {
  const rows = db.prepare('SELECT * FROM news ORDER BY id DESC LIMIT 5').all();
  if (!rows.length) return '';
  return `<div class="card news"><h2>📢 ${esc(req.t('news_title'))}</h2>${rows.map((n) => `<div class="news-i"><span class="muted">${esc(fmtDay(n.created_at))}</span> ${esc(newsText(req.lang, n))}</div>`).join('')}</div>`;
}

// ---------- Личный кабинет ----------

function invoicesTable(t, invoices, base, withPaid = true, canDelete = false) {
  if (!invoices.length) return `<p class="muted">${esc(t('no_invoices'))}</p>`;
  // Клиенту — карточками, чтобы на телефоне всё помещалось без прокрутки вбок.
  if (base === '/invoice/') return `<div class="invlist">${invoices.map((i) => `<div class="inv">
    <div class="row" style="align-items:center"><b style="font-size:17px">${esc(i.number)}</b><span class="muted" style="flex:0 0 auto">${esc(fmtDay(i.inv_date || i.created_at))}</span></div>
    <div class="muted" style="margin:4px 0">${esc(cargoSummary(t, i))}${i.cargo_status ? ` · ${esc(cargoStatus(t, i.cargo_status))}` : ''}${i.pc ? ` · 📷 ${i.pc}` : ''}</div>
    <div class="row" style="align-items:center"><div style="flex:0 0 auto">${invBadge(t, i)}
      ${i.paid ? `<span class="badge b-arrived">${esc(t('paid'))}</span>` : `<span class="badge b-border">${esc(t('unpaid'))}</span>`}</div>
      <b style="font-size:20px;color:var(--brand);text-align:right">${esc(money(i.amount))}</b></div>
    <a class="btn sec" style="display:block;text-align:center;margin-top:10px" href="${base}${i.id}">${esc(t('inv_view'))}</a></div>`).join('')}</div>`;
  // Галочки привязаны к отдельной форме (form="bulkinv"), потому что в строках уже есть формы загрузки фото.
  return `<div class="tbl"><table><tr><th><input type="checkbox" id="inv-all" style="width:auto"></th><th>${esc(t('date'))}</th><th>${esc(t('invoice_no'))}</th><th>${esc(t('inv_cargo'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('status'))}</th><th></th></tr>
  ${invoices.map((i) => `<tr><td><input type="checkbox" name="ids" value="${i.id}" form="bulkinv" style="width:auto"></td><td>${esc(fmtDay(i.inv_date || i.created_at))}</td><td><b>${esc(i.number)}</b>${i.code ? `<div class="muted" style="font-size:13px">${esc(i.name)}</div>` : ''}</td>
  <td>${esc(cargoSummary(t, i))}</td><td><b>${esc(money(i.amount))}</b></td>
  <td><div style="margin-bottom:4px">${invBadge(t, i)}</div>${i.cargo_status ? `<div style="font-size:13px;margin-bottom:4px">${esc(cargoStatus(t, i.cargo_status))}</div>` : ''}${i.paid ? `<span class="badge b-arrived">${esc(t('paid'))}</span>` : `<span class="badge b-border">${esc(t('unpaid'))}</span>`}</td>
  <td style="white-space:nowrap"><a class="btn sec sm" href="${base}${i.id}">${esc(t('inv_view'))}</a> ${photoForm(t, i.id, '/admin/invoices')}${i.pc ? ` <span class="muted">📷 ${i.pc}</span>` : ''}</td></tr>`).join('')}</table></div>
  <form method="post" action="/admin/invoices/bulk" id="bulkinv" class="row" style="margin-top:12px"><div><label>${esc(t('a_bulk_inv'))}</label><select name="inv_status">${invStatusOptions(t, 'arrived')}</select></div>
    ${withPaid ? `<div><label>${esc(t('paid'))}</label><select name="paid"><option value="">—</option><option value="1">${esc(t('paid'))}</option><option value="0">${esc(t('unpaid'))}</option></select></div>` : ''}
    <button>${esc(t('apply'))}</button>${canDelete ? `<button class="sec" name="del" value="1" onclick="return confirm('${esc(t('a_bulk_del_confirm'))}')">${esc(t('a_bulk_del'))}</button>` : ''}</form>
  <script>document.getElementById('inv-all').addEventListener('change',(e)=>document.querySelectorAll('input[form=bulkinv][name=ids]').forEach((c)=>c.checked=e.target.checked))</script>${PHOTO_JS}`;
}

// Мои трек-номера: клиент добавляет треки заранее; когда склад отсканирует коробку, тут появятся фото и «Принят на складе».
const normTrack = (x) => String(x || '').trim().toUpperCase().replace(/\s+/g, '');
function myParcels(req, client, back = '/cabinet') {
  const t = req.t;
  const list = db.prepare('SELECT * FROM parcels WHERE client_id = ? ORDER BY (status = \'expected\'), COALESCE(scanned_at, updated_at) DESC LIMIT 200').all(client.id);
  const ph = db.prepare('SELECT file FROM parcel_photos WHERE parcel_id = ? ORDER BY id');
  const rows = list.map((p) => { const f = ph.all(p.id); return `<div class="parcel" style="border-top:1px solid var(--line);padding:10px 0">
    <div class="row" style="align-items:center"><b>${esc(p.track)}</b><div style="flex:0 0 auto">${statusBadge(t, p.status)}</div></div>
    <div class="muted" style="font-size:14px">${p.status === 'expected' ? esc(t('trk_wait')) : `${esc(t('trk_received'))}${p.scanned_at ? ': ' + esc(fmtDay(p.scanned_at)) : ''}${p.places ? ` · ${p.places} ${esc(t('places').toLowerCase())}` : ''}`}</div>
    ${f.length ? `<div class="thumbs" style="margin-top:6px">${f.map((x) => `<a href="/photo/${esc(x.file)}" target="_blank"><img src="/photo/${esc(x.file)}" loading="lazy" alt=""></a>`).join('')}</div>` : ''}
    <form method="post" action="/cabinet/tracks/${p.id}/desc" class="row" style="margin:6px 0 0;align-items:center;gap:6px"><input type="hidden" name="back" value="${back}"><div><input name="description" maxlength="120" value="${esc(p.description || '')}" placeholder="${esc(t('trk_desc_ph'))}"></div><button class="sec sm" style="flex:0 0 auto">${esc(t('save'))}</button></form>
    ${p.status === 'expected' ? `<form method="post" action="/cabinet/tracks/${p.id}/delete" style="margin:6px 0 0"><input type="hidden" name="back" value="${back}"><button class="sec sm">${esc(t('trk_remove'))}</button></form>` : ''}</div>`; }).join('');
  const msg = req.session.trkMsg; delete req.session.trkMsg;
  return `<div class="card" id="tracks"><h2>${esc(t('trk_title'))}</h2><p class="muted">${esc(t('trk_hint'))}</p>
    ${msg ? `<div class="alert info">${esc(msg)}</div>` : ''}
    <form method="post" action="/cabinet/tracks"><input type="hidden" name="back" value="${back}"><textarea name="tracks" required placeholder="KY4001168305249&#10;YT1234567890"></textarea><p><button>${esc(t('trk_add'))}</button></p></form>
    ${rows || `<p class="muted">${esc(t('trk_none'))}</p>`}</div>`;
}
app.post('/cabinet/tracks', (req, res) => {
  const client = req.session.clientId && getClient(req.session.clientId);
  if (!client) return res.redirect('/cabinet');
  const tracks = [...new Set(String(req.body.tracks || '').split(/[\s,;]+/).map(normTrack).filter((x) => /^[A-Z0-9-]{6,40}$/.test(x)))].slice(0, 100);
  let added = 0; const taken = [];
  for (const tr of tracks) {
    const p = db.prepare("SELECT * FROM parcels WHERE upper(replace(track, ' ', '')) = ?").get(tr);
    if (!p) { const id = db.prepare("INSERT INTO parcels (track, client_id, client_code, status) VALUES (?, ?, ?, 'expected')").run(tr, client.id, client.code).lastInsertRowid; addEvent(id, 'expected'); added++; }
    else if (!p.client_id) { db.prepare("UPDATE parcels SET client_id = ?, client_code = ?, updated_at = datetime('now') WHERE id = ?").run(client.id, client.code, p.id); added++; }
    else if (p.client_id === client.id) added++;
    else taken.push(tr);
  }
  req.session.trkMsg = `${req.t('trk_added')}: ${added}${taken.length ? `. ${req.t('trk_taken')}: ${taken.join(', ')}` : ''}`;
  res.redirect(`${req.body.back === '/track' ? '/track' : '/cabinet'}#tracks`);
});
// Клиент подписывает, что в посылке (видно и складу в «Посылках»).
app.post('/cabinet/tracks/:id/desc', (req, res) => {
  if (req.session.clientId) db.prepare("UPDATE parcels SET description = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ?").run(String(req.body.description || '').trim().slice(0, 120), parseInt(req.params.id, 10), req.session.clientId);
  res.redirect(`${req.body.back === '/track' ? '/track' : '/cabinet'}#tracks`);
});
app.post('/cabinet/tracks/:id/delete', (req, res) => {
  if (req.session.clientId) {
    const p = db.prepare("SELECT id FROM parcels WHERE id = ? AND client_id = ? AND status = 'expected'").get(parseInt(req.params.id, 10), req.session.clientId);
    if (p) { db.prepare('DELETE FROM parcel_events WHERE parcel_id = ?').run(p.id); db.prepare('DELETE FROM parcels WHERE id = ?').run(p.id); }
  }
  res.redirect(`${req.body.back === '/track' ? '/track' : '/cabinet'}#tracks`);
});

app.get('/cabinet', (req, res) => {
  const t = req.t;
  const client = req.session.clientId && getClient(req.session.clientId);
  if (!client) {
    return res.render(t('login_title'), `<div class="card" style="max-width:420px;margin:0 auto"><h1>${esc(t('login_title'))}</h1><p class="muted">${esc(t('login_rules'))}</p>
      ${req.query.exists ? `<div class="alert info">${esc(t('phone_exists'))}</div>` : ''}${req.query.err ? `<div class="alert err">${esc(t(req.query.err === 'many' ? 'login_many' : 'login_error'))}</div>` : ''}
      <form method="post" action="/cabinet/login"><label>${esc(t('phone'))}</label><input name="phone" type="tel" placeholder="+7 747 123 45 67" autocomplete="tel">
      <label>${esc(t('code'))}</label><input name="code" required placeholder="D1600" autocomplete="off" autocapitalize="characters">
      <p><button>${esc(t('login_btn'))}</button></p></form>
      <p style="font-size:14px"><a href="/forgot">${esc(t('forgot_code_short'))}</a></p>
      <a href="/">${esc(t('get_code'))}</a></div>`);
  }
  const invoices = db.prepare('SELECT i.*, (SELECT COUNT(*) FROM invoice_photos ph WHERE ph.invoice_id = i.id) pc FROM invoices i WHERE client_id = ? ORDER BY id DESC').all(client.id);
  const w = activeWarehouses()[0];
  res.render(t('nav_cabinet'), `<div class="card"><div class="row" style="align-items:center"><div><div class="muted">${esc(client.name)}, ${esc(t('your_code_is'))}</div>
    <div class="code" data-flip>${esc(w ? shippingMark(w.mark_template, client) : client.code)}</div></div>
    <a class="btn sec" href="/address" style="flex:0 0 auto">${esc(t('china_address'))}</a></div></div>${newsBlock(req)}${promo(req)}
    <div class="card"><h2>${esc(t('my_invoices'))}</h2>${invoicesTable(t, invoices, '/invoice/')}</div>
    ${myParcels(req, client)}
`);
});

// Не больше 10 неверных попыток за 15 минут с одного адреса — чтобы коды не перебирали.
const loginFails = new Map();

// Забыли код: клиент вводит свой номер и видит код. Те же 10 попыток за 15 минут, что и при входе.
const forgotHits = new Map();
const forgotPage = (req, inner) => req.res.render(req.t('forgot_title'), `<div class="card" style="max-width:420px;margin:0 auto"><h1>${esc(req.t('forgot_title'))}</h1>${inner}</div>`);
const forgotForm = (t, phone = '') => `<p class="muted">${esc(t('forgot_hint'))}</p><form method="post" action="/forgot"><label>${esc(t('phone'))}</label><input name="phone" type="tel" required placeholder="+7 747 123 45 67" autocomplete="tel" value="${esc(phone)}"><p><button>${esc(t('forgot_btn'))}</button></p></form>`;
app.get('/forgot', (req, res) => forgotPage(req, forgotForm(req.t)));
app.post('/forgot', (req, res) => {
  const t = req.t; const ip = req.ip; const now = Date.now();
  const f = forgotHits.get(ip);
  if (f && f.until > now && f.n >= 10) return forgotPage(req, `<div class="alert err">${esc(t('login_many'))}</div>`);
  forgotHits.set(ip, { n: (f && f.until > now ? f.n : 0) + 1, until: f && f.until > now ? f.until : now + 15 * 60 * 1000 });
  const phone = normPhone(req.body.phone);
  const c = phone.length >= 10 && db.prepare('SELECT phone, code FROM clients WHERE phone = ?').get(phone);
  if (!c) return forgotPage(req, `<div class="alert err">${esc(t('forgot_none'))}</div>${forgotForm(t, req.body.phone)}<a href="/">${esc(t('get_code'))}</a>`);
  const shown = dispCode(c.code);
  forgotPage(req, `<p class="muted">${esc(t('forgot_found'))}</p><div class="code">${esc(shown)}</div>
    <form method="post" action="/cabinet/login"><input type="hidden" name="phone" value="${esc(c.phone)}"><input type="hidden" name="code" value="${esc(c.code)}"><p><button>${esc(t('login_btn'))}</button></p></form>`);
});
app.post('/cabinet/login', (req, res) => {
  const ip = req.ip; const now = Date.now();
  const f = loginFails.get(ip);
  if (f && f.until > now && f.n >= 10) return res.redirect('/cabinet?err=many');
  // Код принимаем в любом виде: 1600, D1600, d1600, D1600-4567, Y7.
  const raw = String(req.body.code || '').trim().toUpperCase().replace(/\s+/g, '').replace(/-\d{4}$/, '');
  // «1600» без буквы — это и D1600 с сайта, и код из одних цифр (#1600): пробуем оба.
  const codes = [...new Set([codeKey(raw), /^\d/.test(raw) ? raw : null].filter(Boolean))];
  // Старые клиенты, у которых в базе нет номера (stub-…), входят по одному коду.
  let c = null;
  for (const code of codes) c ||= db.prepare('SELECT id FROM clients WHERE phone = ? AND code = ?').get(normPhone(req.body.phone), code);
  for (const code of codes) c ||= db.prepare("SELECT id FROM clients WHERE code = ? AND phone LIKE 'stub-%'").get(code);
  if (!c) {
    loginFails.set(ip, { n: (f && f.until > now ? f.n : 0) + 1, until: now + 15 * 60 * 1000 });
    return res.redirect('/cabinet?err=1');
  }
  loginFails.delete(ip);
  req.session.clientId = c.id;
  res.redirect('/cabinet');
});

// Накладная повторяет бумажный 货运单: подписи на двух языках сразу, внизу правила перевозки.
const num = (v) => (v ? String(Math.round(v * 1000) / 1000) : '0');
const fmtDay = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '');
const cargoSummary = (t, i) => [goodsRu(i.goods), i.pieces ? `${i.pieces} ${t('inv_pcs')}` : '', i.total_weight ? `${num(i.total_weight)} ${t('kg')}` : '', i.volume ? `${num(i.volume)} м³` : '']
  .filter(Boolean).join(' · ');
// «3.13到» из таблицы склада → «Прибыл 13.03».
const cargoStatus = (t, s) => String(s || '').trim().replace(/^(\d{1,2})\.(\d{1,2})\s*到$/, (m, mo, d) => `${t('inv_arrived')} ${d.padStart(2, '0')}.${mo.padStart(2, '0')}`);
const CITY_ZH = { Алматы: '阿拉木图', Москва: '莫斯科', Бишкек: '比什凯克' };
const INV_HEAD = [
  ['origin', '始发地', 'Пункт отправки'], ['destination', '目的地', 'Пункт назначения'], ['transport', '运输方式', 'Способ перевозки'],
  ['number', '货号', 'Код груза'], ['inv_date', '发货日期', 'Дата отправки'],
  ['sender', '发货人', 'Грузоотправитель'],
];
const INV_GOODS = [
  ['goods', '品名', 'Перечень товаров'], ['pieces', '件数', 'Количество'], ['total_weight', '重量', 'Вес'], ['volume', '体积', 'Объём'],
  ['rate', '单价', 'Цена'], ['freight', '运费 $', 'Фрахт'], ['goods_value', '货值 $', 'Стоимость товара'], ['ins_rate', '保率 (%)', 'Страховка %'],
  ['ins_fee', '保险费 $', 'Страховка $'], ['packing', '打包方式', 'Упаковка'], ['pack_fee', '包装费 $', 'Плата за упаковку'],
  ['advance', '垫付款 $', 'Оплачено за вас в Китае'], ['unload_fee', '落地费 $', 'Плата за разгрузку'], ['other_fee', '其他款项 $', 'Другие платежи'],
];
const NUM_FIELDS = ['pieces', 'total_weight', 'volume', 'rate', 'freight', 'goods_value', 'ins_rate', 'ins_fee', 'pack_fee', 'advance', 'unload_fee', 'other_fee'];
const FEES = ['freight', 'ins_fee', 'pack_fee', 'advance', 'unload_fee', 'other_fee'];

// 19公里 — рынок «Южные ворота» на 19 км МКАД; старые накладные хранят «19 МКАД».
const destName = (d) => String(d || '').replace(/19\s*МКАД/i, 'Москва, Южные ворота');
// В Москву везут дольше — свой средний срок.
const isMsk = (d) => /москв|мәскеу|莫斯科|19公里/i.test(destName(d));
const etaFor = (t, invs, city) => t((invs.length ? invs.every((i) => isMsk(i.destination)) : isMsk(city)) ? 'track_eta_msk' : 'track_eta');
function invoiceValue(inv, k) {
  if (k === 'destination') return destName(inv.destination);
  if (k === 'goods') return goodsRu(inv.goods);
  if (k === 'inv_date') return fmtDay(inv.inv_date || inv.created_at);
  if (k === 'rate') return inv.rate ? `${num(inv.rate)}\u00a0$/${inv.price_basis === 'kg' ? 'кг' : 'м³'}` : '0';
  if (k === 'ins_rate') return `${num(inv.ins_rate)}%`;
  return NUM_FIELDS.includes(k) ? num(inv[k]) : inv[k] || '';
}

// Владельцу — кнопка сразу в WhatsApp клиента по этой накладной (например, отправить фото с весов).
function waClient(req, inv) {
  if (!isOwner(req)) return '';
  const c = db.prepare('SELECT phone FROM clients WHERE id = ?').get(inv.client_id);
  if (!c || isStub(c)) return '';
  const msg = `${req.t('wa_inv_msg')} ${inv.number}`;
  return `<a class="btn sm" style="flex:0 0 auto;background:#25d366" href="https://wa.me/${esc(c.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp +${esc(c.phone)}</a>`;
}
function invoicePage(req, inv) {
  const t = req.t;
  const cell = ([k, zh, ru]) => `<div class="c"><div class="l">${esc(zh)}<br>${esc(ru)}</div><div class="v${k === 'rate' ? ' nw' : k === 'goods' ? ' gd' : ''}">${esc(invoiceValue(inv, k))}</div></div>`;
  const rules = String(setting('invoice_rules') || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const parcels = db.prepare('SELECT track FROM parcels WHERE invoice_id = ? ORDER BY id').all(inv.id);
  const photos = invoicePhotos(inv.id);
  return `<div class="row noprint" style="align-items:center;margin-bottom:12px"><a href="${req.session.admin ? '/admin/invoices' : '/cabinet'}">← ${esc(t('back'))}</a>
    ${waClient(req, inv)}<span style="margin-left:auto">${inv.paid ? `<span class="badge b-arrived">${esc(t('paid'))}</span>` : `<span class="badge b-border">${esc(t('unpaid'))}</span>`}</span>
    <button type="button" class="sec" onclick="print()" style="flex:0 0 auto">${esc(t('print'))}</button></div>
  <p class="muted only-m noprint" style="font-size:13px;margin:0 0 8px">${esc(t('inv_zoom_hint'))}</p>
  <div class="wb-fit"><div class="wb wb-sheet">
    <div class="wb-top"><img src="/logo.png" alt="Карго 151"><div><div class="co">${esc(setting('invoice_company'))}</div><div class="ti">${esc(setting('invoice_title'))}</div></div></div>
    <div class="g head">${INV_HEAD.map(cell).join('')}</div>
    <div class="g goods">${INV_GOODS.map(cell).join('')}</div>
    <div class="g sum"><div class="c"><div class="l">备注<br>Замечание</div><div class="v">${esc(inv.note || '')}</div></div>
      <div class="c"><div class="l">总计<br>Сумма</div><div class="v big">${esc(money(inv.amount))}</div></div></div>
    ${inv.cargo_status ? `<div class="wb-tracks"><b>运踪 · ${esc(t('inv_cargo_status'))}:</b> ${esc(cargoStatus(t, inv.cargo_status))}</div>` : ''}
    ${parcels.length ? `<div class="wb-tracks"><b>${esc(t('track'))}:</b> ${parcels.map((p) => esc(p.track)).join(', ')}</div>` : ''}
  </div></div>
  ${photos.length || req.session.admin ? `<div class="card"><h2 style="margin-top:0">${esc(t('inv_photos'))}</h2>
    ${photos.length ? `<div class="photos">${photos.map((f) => `<div style="position:relative"><a href="/photo/${esc(f.file)}" target="_blank"><img src="/photo/${esc(f.file)}" loading="lazy" alt=""></a>${req.session.admin ? `<form method="post" action="/admin/invoices/${inv.id}/photos/${f.id}/delete" class="noprint" style="position:absolute;top:4px;right:4px;margin:0" onsubmit="return confirm('${esc(t('confirm_delete_photo'))}')"><button class="sec sm" style="padding:2px 8px">✕</button></form>` : ''}</div>`).join('')}</div>` : `<p class="muted">${esc(t('inv_no_photos'))}</p>`}
    ${req.session.admin ? photoForm(t, inv.id, `/admin/invoices/${inv.id}`) + PHOTO_JS : ''}</div>` : ''}
  <div class="card noprint"><div class="row" style="align-items:center"><h2 style="margin:0">${esc(t('status'))}</h2><div style="flex:0 0 auto">${invBadge(t, inv)}</div></div>${invTimeline(t, inv)}<p class="muted" style="font-size:14px;margin:0">${esc(etaFor(t, [inv]))}</p></div>
  ${forwardCard(req, inv)}
  <div class="wb wb-rules"><div class="rh">承运、托运双方特别约定事项 · Замечание</div>
      ${rules.map((l, i) => (i === 0 && !/^\d/.test(l) ? `<p><b>${esc(l)}</b></p>` : `<p>${esc(l)}</p>`)).join('')}</div>
  <p class="muted" style="font-size:13px">${esc(t('inv_rules_agree'))} <a href="/insurance">🛡 ${esc(t('nav_insurance'))}</a></p>
  <style>@page{size:A4 landscape;margin:10mm}</style>
  <script>// Накладная всегда как бумажный лист в альбомной ориентации: на узком экране уменьшаем её целиком.
  (function(){const fit=()=>document.querySelectorAll('.wb-fit').forEach((w)=>{const s=w.firstElementChild;s.style.transform='';const k=Math.min(1,w.clientWidth/s.offsetWidth);s.style.transform='scale('+k+')';w.style.height=s.offsetHeight*k+'px'});
  fit();addEventListener('resize',fit);addEventListener('load',fit);addEventListener('beforeprint',fit);addEventListener('afterprint',fit)})();</script>`;
}

// Отправка дальше по Казахстану: клиент оставляет заявку прямо из накладной, менеджер видит её в «Заявках».
const FWD_METHODS = ['truck', 'tk', 'any'];
function forwardCard(req, inv) {
  const t = req.t;
  const reqs = db.prepare('SELECT * FROM forward_requests WHERE invoice_id = ? ORDER BY id DESC').all(inv.id);
  const list = reqs.map((r) => `<div class="news-i"><b>${esc(r.city)}</b> · ${esc(t('fwd_m_' + r.method))} · ${esc(fmtDay(r.created_at))}
    <span class="badge ${r.status === 'done' ? 'b-arrived' : 'b-transit'}">${esc(t(r.status === 'done' ? 'fwd_done' : 'fwd_new'))}</span></div>`).join('');
  if (req.session.admin) return reqs.length ? `<div class="card noprint"><h2 style="margin-top:0">🚚 ${esc(t('fwd_title'))}</h2>${list}<p><a href="/admin/forward">${esc(t('a_forward'))} →</a></p></div>` : '';
  if (reqs.some((r) => r.status === 'new')) return `<div class="card noprint"><h2 style="margin-top:0">🚚 ${esc(t('fwd_title'))}</h2>${list}</div>`;
  return `<details class="card noprint"${reqs.length ? '' : ''}><summary><b>🚚 ${esc(t('fwd_title'))}</b> <span class="muted">${esc(t('fwd_hint'))}</span></summary>${list}
    <form method="post" action="/invoice/${inv.id}/forward"><div class="row"><div><label>${esc(t('fwd_city'))}</label><input name="city" required maxlength="80" placeholder="${esc(t('fwd_city_ph'))}"></div>
    <div><label>${esc(t('fwd_method'))}</label><select name="method">${FWD_METHODS.map((m) => `<option value="${m}">${esc(t('fwd_m_' + m))}</option>`).join('')}</select></div></div>
    <div class="row"><div><label>${esc(t('fwd_receiver'))}</label><input name="receiver" maxlength="80"></div><div><label>${esc(t('fwd_phone'))}</label><input name="receiver_phone" type="tel" maxlength="30"></div></div>
    <label>${esc(t('note'))}</label><input name="note" maxlength="300"><p><button>${esc(t('fwd_send'))}</button></p></form></details>`;
}
app.post('/invoice/:id/forward', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv || inv.client_id !== req.session.clientId) return res.redirect('/cabinet');
  const b = req.body; const city = String(b.city || '').trim().slice(0, 80);
  if (city) db.prepare('INSERT INTO forward_requests (invoice_id, client_id, city, method, receiver, receiver_phone, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(inv.id, inv.client_id, city, FWD_METHODS.includes(b.method) ? b.method : 'any', String(b.receiver || '').trim().slice(0, 80), String(b.receiver_phone || '').trim().slice(0, 30), String(b.note || '').trim().slice(0, 300));
  res.redirect(`/invoice/${inv.id}`);
});

app.get('/invoice/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv || (!req.session.admin && inv.client_id !== req.session.clientId)) return res.redirect('/cabinet');
  if (photosOnly(req)) return res.redirect('/admin/photos');
  res.render(`${req.t('invoice')} ${inv.number}`, invoicePage(req, inv));
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// ---------- Админка ----------

const ADMIN_TABS = [['/admin', 'a_dashboard'], ['/admin/clients', 'a_clients'], ['/admin/parcels', 'a_parcels'], ['/admin/import', 'a_import'], ['/admin/invoices', 'a_invoices'], ['/admin/forward', 'a_forward'], ['/admin/report', 'a_report'], ['/admin/news', 'a_news'], ['/admin/settings', 'a_settings']];
function adminRender(req, res, title, body) {
  const role = `<span class="badge" style="margin-left:auto">${esc(req.session.staffName ? `${req.session.staffName} · ` : '')}${esc(req.t('role_' + req.session.admin))}</span>`;
  const list = photosOnly(req) ? [['/admin/photos', 'a_scale_photos']] : ADMIN_TABS.filter(([h]) => can(req, 'GET', h.slice(6) || '/'));
  const tabs = list.map(([h, k]) => `<a href="${h}" class="${req.path === h || (h !== '/admin' && req.path.startsWith(h)) ? 'on' : ''}">${esc(req.t(k))}</a>`).join('');
  const flash = req.session.flash; delete req.session.flash;
  res.render(title, `<div class="subnav noprint">${tabs}${role}</div>${flash ? `<div class="alert ok">${esc(flash)}</div>` : ''}${body}`);
}

const pwHash = (pw, salt = crypto.randomBytes(12).toString('hex')) => `${salt}:${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`;
const pwOk = (stored, pw) => { const [salt] = String(stored).split(':'); const a = Buffer.from(pwHash(pw, salt)); const b = Buffer.from(String(stored)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sameStr = (x, y) => { const a = Buffer.from(String(x || '')); const b = Buffer.from(y); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const adminFails = new Map();
app.post('/admin/login', (req, res) => {
  const ip = req.ip; const now = Date.now(); const f = adminFails.get(ip);
  if (f && f.until > now && f.n >= 10) return res.redirect('/admin?err=many');
  const login = String(req.body.login || '').trim().toLowerCase(); const pw = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM staff WHERE login = ? AND active = 1').get(login);
  if (login === 'admin' && sameStr(pw, ADMIN_PASSWORD)) Object.assign(req.session, { admin: 'owner', staffId: 0, staffName: '', pwTag: 'env' });
  else if (u && pwOk(u.pw, pw)) Object.assign(req.session, { admin: u.role, staffId: u.id, staffName: u.name, pwTag: u.pw });
  else { adminFails.set(ip, { n: (f && f.until > now ? f.n : 0) + 1, until: now + 15 * 60 * 1000 }); return res.redirect('/admin?err=1'); }
  adminFails.delete(ip);
  res.redirect('/admin');
});

app.use('/admin', (req, res, next) => {
  if (req.session.admin === true) req.session.admin = 'owner';
  // Сотрудника отключили, сменили ему пароль или роль — он сразу выходит.
  if (req.session.admin && req.session.staffId) {
    const u = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.session.staffId);
    if (!u || !u.active || u.pw !== req.session.pwTag || u.role !== req.session.admin) delete req.session.admin;
  } else if (req.session.admin && req.session.staffId !== 0) delete req.session.admin;
  if (req.session.admin) {
    if (can(req, req.method, req.path)) return next();
    if (photosOnly(req)) return res.redirect('/admin/photos');
    req.session.flash = req.t('a_no_access');
    return res.redirect('/admin');
  }
  res.render(req.t('admin_login'), `<div class="card" style="max-width:380px;margin:0 auto"><h1>${esc(req.t('admin_login'))}</h1>
    ${req.query.err ? `<div class="alert err">${esc(req.t(req.query.err === 'many' ? 'login_many' : 'a_login_error'))}</div>` : ''}
    <form method="post" action="/admin/login"><label>${esc(req.t('a_login'))}</label><input name="login" required autofocus autocapitalize="none" autocomplete="username">
    <label>${esc(req.t('password'))}</label><input type="password" name="password" required autocomplete="current-password"><p><button>${esc(req.t('login_btn'))}</button></p></form></div>`);
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
    WHERE ? = '' OR c.code LIKE ? OR c.code = ? OR c.code = ? OR c.name LIKE ? OR (? AND c.phone LIKE ?) ORDER BY c.id DESC LIMIT 300`).all(q, like, codeKey(q), q.toUpperCase().replace(/^D(?=\d)/, ''), like, owner ? 1 : 0, like);
  const cities = db.prepare('SELECT * FROM cities ORDER BY id').all();
  adminRender(req, res, t('a_clients'), `<div class="card"><form class="row"><div><input name="q" value="${esc(q)}" placeholder="${esc(t('code'))} / ${esc(t('name'))}${owner ? ' / ' + esc(t('phone')) : ''}"></div><button>${esc(t('search'))}</button></form></div>
  <details class="card" id="add" ${req.query.code ? 'open' : ''}><summary><b>${esc(t('a_add_client'))}</b></summary><p class="muted">${esc(t('a_add_client_hint'))}</p>
    <form method="post" action="/admin/clients/add" class="row"><div><label>${esc(t('code'))}</label><input name="code" required value="${esc(req.query.code || '')}" placeholder="D185"></div>
    <div><label>${esc(t('name'))}</label><input name="name" required></div><div><label>WhatsApp</label><input name="phone" type="tel" required></div>
    <div><label>${esc(t('city'))}</label><select name="city_id">${cities.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><button>${esc(t('add'))}</button></form></details>
  ${owner ? `<details class="card"><summary><b>${esc(t('a_clients_import'))}</b></summary><p class="muted">${esc(t('a_clients_import_hint'))}</p>
    <form method="post" action="/admin/clients/import" enctype="multipart/form-data" class="row"><div><input type="file" name="file" accept=".xlsx,.xls,.csv" required></div><button>${esc(t('a_upload'))}</button></form></details>` : ''}
  <div class="card tbl"><table><tr><th>${esc(t('code'))}</th><th>${esc(t('name'))}</th>${owner ? `<th>${esc(t('phone'))}</th>` : ''}<th>${esc(t('city'))}</th><th>${esc(t('parcels_count'))}</th><th>${esc(t('registered'))}</th></tr>
  ${rows.map((r) => `<tr><td><a href="/admin/clients/${r.id}"><b>${esc(dispCode(r.code))}</b></a></td><td>${esc(r.name)}</td>${owner ? `<td>${isStub(r) ? `<a href="/admin/clients?code=${encodeURIComponent(dispCode(r.code))}#add" class="badge b-border">${esc(t('a_no_phone'))}</a>` : `<a href="https://wa.me/${esc(r.phone)}" target="_blank" rel="noopener">+${esc(r.phone)}</a>`}</td>` : ''}<td>${esc(r.city_name)}</td><td>${r.pc}</td><td>${esc(fmtDate(r.created_at))}</td></tr>`).join('')}</table></div>`);
});

// ---------- База клиентов из Excel (только владелец: там телефоны) ----------
// Колонки по заголовкам «Код / Имя / Телефон / Город»; без заголовков — угадываем: код вида D15, Y7, X100; телефон — 10+ цифр.
const CLIENT_COLS = { code: ['код', 'код клиента', 'code', '编码', '客户编码', '唛头'], name: ['имя', 'фио', 'клиент', 'name', '姓名', '名字', '客户'],
  phone: ['телефон', 'номер', 'whatsapp', 'ватсап', 'phone', '电话', '手机'], city: ['город', 'city', '城市'] };
const matchClientCol = (h) => { const v = String(h || '').toLowerCase().trim(); return Object.keys(CLIENT_COLS).find((k) => CLIENT_COLS[k].includes(v)) || null; };
const looksCode = (v) => /^[A-Z]{1,3}-?\d{1,5}$/i.test(String(v || '').trim());

app.post('/admin/clients/import', upload.single('file'), (req, res) => {
  if (!isOwner(req) || !req.file) return res.redirect('/admin/clients');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const cities = db.prepare('SELECT * FROM cities').all();
  const findCity = (v) => { const s = String(v || ''); return cities.find((c) => s && (s.includes(c.name) || (CITY_ZH[c.name] && s.includes(CITY_ZH[c.name])))); };
  let added = 0; let updated = 0; const dup = [];
  db.exec('BEGIN');
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    let hi = rows.findIndex((r) => r.map(matchClientCol).includes('code'));
    let map = hi >= 0 ? rows[hi].map(matchClientCol) : null;
    if (!map) {
      const sample = rows.filter((r) => r.some((v) => looksCode(v))).slice(0, 30);
      if (!sample.length) continue;
      const width = Math.max(...sample.map((r) => r.length));
      const score = (test) => [...Array(width).keys()].map((i) => sample.filter((r) => test(r[i])).length);
      const best = (arr) => arr.indexOf(Math.max(...arr));
      const ci = best(score(looksCode)); const pi = best(score((v) => String(v || '').replace(/\D/g, '').length >= 10));
      const ni = best(score((v) => /[A-Za-zА-Яа-яЁё一-鿿]{2,}/.test(String(v || '')) && !looksCode(v)).map((x, i) => (i === ci || i === pi ? -1 : x)));
      map = []; map[ci] = 'code'; if (pi !== ci) map[pi] = 'phone'; if (ni >= 0 && ni !== ci && ni !== pi) map[ni] = 'name';
      hi = -1;
    }
    for (const row of rows.slice(hi + 1)) {
      const rec = {}; map.forEach((f, i) => { if (f) rec[f] = String(row[i] ?? '').trim(); });
      if (!looksCode(rec.code)) continue;
      const code = codeKey(rec.code.replace('-', ''));
      const phone = normPhone(rec.phone); const city = findCity(rec.city);
      const ex = db.prepare('SELECT * FROM clients WHERE code = ?').get(code);
      const taken = phone.length >= 10 ? db.prepare('SELECT id FROM clients WHERE phone = ?').get(phone) : null;
      if (taken && (!ex || taken.id !== ex.id)) { dup.push(dispCode(code)); continue; }
      const ph = phone.length >= 10 ? phone : null;
      if (ex) {
        db.prepare('UPDATE clients SET name = COALESCE(NULLIF(?, \'\'), name), phone = COALESCE(?, phone), city_id = COALESCE(?, city_id) WHERE id = ?').run(rec.name || '', ph, city ? city.id : null, ex.id);
        updated++;
      } else {
        const r = db.prepare('INSERT INTO clients (code, name, phone, city_id, legacy) VALUES (?, ?, ?, ?, 1)').run(code, rec.name || dispCode(code), ph || `stub-${code}`, city ? city.id : null);
        linkOrphanParcels(r.lastInsertRowid, code);
        added++;
      }
    }
  }
  db.exec('COMMIT');
  req.session.flash = `${req.t('a_clients_added')}: ${added}, ${req.t('a_clients_updated')}: ${updated}${dup.length ? `. ${req.t('a_clients_dup')}: ${dup.slice(0, 30).join(', ')}` : ''}`;
  res.redirect('/admin/clients');
});

app.post('/admin/clients/add', (req, res) => {
  const code = codeKey(String(req.body.code || '').trim().replace(/-\d{4}$/, ''));
  const phone = normPhone(req.body.phone); const name = String(req.body.name || '').trim().slice(0, 80);
  const cityId = parseInt(req.body.city_id, 10) || null;
  if (!code || !name || phone.length < 10) { req.session.flash = req.t('a_add_client_err'); return res.redirect('/admin/clients#add'); }
  const stub = db.prepare("SELECT id FROM clients WHERE code = ? AND phone LIKE 'stub-%'").get(code);
  if (stub && !db.prepare('SELECT 1 FROM clients WHERE phone = ?').get(phone)) {
    db.prepare('UPDATE clients SET name = ?, phone = ?, city_id = COALESCE(?, city_id) WHERE id = ?').run(name, phone, cityId, stub.id);
    return res.redirect(`/admin/clients/${stub.id}`);
  }
  if (db.prepare('SELECT 1 FROM clients WHERE code = ? OR phone = ?').get(code, phone)) { req.session.flash = req.t('a_add_client_dup'); return res.redirect('/admin/clients#add'); }
  const r = db.prepare('INSERT INTO clients (code, name, phone, city_id, legacy) VALUES (?, ?, ?, ?, 1)').run(code, name, phone, cityId);
  linkOrphanParcels(r.lastInsertRowid, code);
  res.redirect(`/admin/clients/${r.lastInsertRowid}`);
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
    <div class="card"><h2>${esc(t('a_invoices'))}</h2>${invoicesTable(t, invoices, '/admin/invoices/', canMoney(req))}
    ${canMoney(req) ? `<p><a class="btn" href="/admin/invoices/new?code=${encodeURIComponent(client.code)}">${esc(t('a_new_invoice'))}</a></p>` : ''}</div>`);
});

function parcelsTable(req, parcels) {
  const t = req.t;
  if (!parcels.length) return `<p class="muted">${esc(t('no_parcels'))}</p>`;
  return `<form method="post" action="/admin/parcels/bulk"><div class="tbl"><table><tr><th><input type="checkbox" id="checkall" style="width:auto"></th><th>${esc(t('track'))}</th><th>${esc(t('client'))}</th><th>${esc(t('status'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('places'))}</th><th>${esc(t('description'))}</th><th>${esc(t('invoice'))}</th><th>${esc(t('date'))}</th></tr>
  ${parcels.map((p) => `<tr><td><input type="checkbox" name="ids" value="${p.id}" style="width:auto"></td><td>${esc(p.track)}</td>
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
  // Одна форма: ежедневная таблица склада → накладные и отслеживание сразу. Остальное спрятано в «Дополнительно».
  adminRender(req, res, t('a_import'), `<div class="card" id="inv"><h2>${esc(t('a_one_title'))}</h2><p class="muted">${esc(t('a_one_hint'))}</p>
    <form method="post" action="/admin/import-invoices" enctype="multipart/form-data"><input type="file" name="file" accept=".xlsx,.xls,.csv" required style="margin-bottom:12px">
    <button class="wide">${esc(t('a_upload'))}</button>
    <details style="margin-top:12px"><summary class="muted">${esc(t('a_more'))}</summary><div class="row" style="margin-top:8px">
    <div><label>${esc(t('a_inv_default_date'))}</label><input type="date" name="inv_date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div><label>始发地 · Пункт отправки</label><select name="origin">${activeWarehouses().map((x) => `<option>${esc(`${x.name_zh}/${x.name_ru}`)}</option>`).join('')}</select></div></div>
    <p class="muted" style="font-size:14px">${esc(t('a_inv_import_hint'))} <a href="/admin/invoice-template.xlsx">${esc(t('a_template'))}</a></p></details></form></div>
    ${scanForm(t)}
    <details class="card"><summary class="muted">${esc(t('a_parcels_import'))}</summary><p class="muted">${esc(t('a_import_hint'))}</p>
    <form method="post" action="/admin/import" enctype="multipart/form-data" class="row"><div><input type="file" name="file" accept=".xlsx,.xls,.csv" required></div>
    <div><label>${esc(t('status'))}</label><select name="default_status">${statusOptions(t, 'china')}</select></div><button>${esc(t('a_upload'))}</button></form>
    <p><a href="/admin/template.xlsx">${esc(t('a_template'))}</a></p></details>`);
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
  // Ежедневную таблицу накладных по ошибке загрузили в форму посылок — загружаем её как накладные.
  if (!map.includes('track')) return importInvoices(req, res);
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

// ---------- Загрузка накладных из ежедневной таблицы: одна строка = одна накладная ----------

const INV_IMPORT_COLS = {
  code: ['код клиента', 'код', 'клиент', 'грузоотправитель', '客户编码', '客户', '发货人', '唛头'],
  number: ['номер накладной', 'код груза', 'номер', '货号', '单号', '编号'],
  inv_date: ['дата отправки', 'дата', '发货日期', '日期', '发货时间'],
  goods: ['перечень товаров', 'товар', 'груз', 'наименование', '品名', '货物', '货名', '名称'],
  pieces: ['количество', 'мест', 'кол-во', '件数'],
  total_weight: ['вес', 'вес, кг', '重量', '实重', '毛重'],
  volume: ['объём', 'объем', 'объём, м³', '体积', '方数'],
  rate: ['цена', 'тариф', '单价', '价格'],
  price_basis: ['цена за', '计价'],
  freight: ['фрахт', '运费'],
  amount: ['сумма', 'итого', '总计', '合计', '金额', '总价', '总运费', '运费合计'],
  goods_value: ['стоимость товара', 'общая стоимость', '货值'],
  ins_rate: ['страховка %', 'страховой %', '保率', '保率 (%)'],
  ins_fee: ['страховка $', 'страховка', '保险费'],
  packing: ['упаковка', '打包方式', '包装', '包装方式'],
  pack_fee: ['плата за упаковку', 'за упаковку', '包装费', '打包费'],
  advance: ['перевод на заказ', 'оплачено за вас в китае', '垫付款', '国内垫付', '垫付'],
  unload_fee: ['плата за разгрузку', 'за разгрузку', '落地费'],
  other_fee: ['другие платежи', '其他款项'],
  origin: ['пункт вылета', 'откуда', '始发地', '发货地', '起运地'],
  destination: ['пункт назначения', 'куда', '目的地'],
  transport: ['способ перевозки', '运输方式'],
  delivery_time: ['время доставки', 'срок', '运输时间'],
  consignee: ['грузополучатель', '提货联系电话', '收货人'],
  note: ['замечание', 'примечание', '备注'],
  cargo_status: ['отслеживание', 'статус', '运踪', '状态'],
  pay_note: ['оплата', '付款', '收款'],
};
// Если заголовки не распознались, читаем колонки по порядку как в ежедневной таблице склада:
// 品名, 货号, 目的地, 始发地, 重量, 体积, 密度, 单价, 打包费, -, -, -, 包装, 总计, 备注, 运踪, 付款.
// J 保险% · K 保险费用 · L 国内垫付 (оплатили за клиента доставку/разгрузку внутри Китая — добавляется к итогу).
const DAILY_LAYOUT = ['goods', 'number', 'destination', 'origin', 'total_weight', 'volume', null, 'rate', 'pack_fee', 'ins_rate', 'ins_fee', 'advance', 'packing', 'amount', 'note', 'cargo_status', 'pay_note'];
function matchInvColumn(header) {
  const parts = String(header || '').toLowerCase().replace(/\s*\$\s*/g, '').split(/[\/\n]/).map((x) => x.trim()).filter(Boolean);
  for (const [field, names] of Object.entries(INV_IMPORT_COLS)) if (parts.some((p) => names.includes(p))) return field;
  return null;
}
// Дата из Excel: настоящая дата, «16.10.2026», «16.10», «2026-10-16».
function parseDay(v, fallback) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(s);
  if (m) return `${m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : fallback.slice(0, 4)}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return fallback;
}

app.get('/admin/invoice-template.xlsx', (req, res) => {
  const head = [['code', 'Код клиента / 客户编码'], ['inv_date', 'Дата отправки / 发货日期'], ['goods', 'Перечень товаров / 品名'], ['pieces', 'Количество / 件数'],
    ['total_weight', 'Вес / 重量'], ['volume', 'Объём / 体积'], ['rate', 'Цена / 单价'], ['price_basis', 'Цена за / 计价 (м3 / кг)'], ['packing', 'Упаковка / 打包方式'],
    ['pack_fee', 'Плата за упаковку / 包装费'], ['goods_value', 'Стоимость товара / 货值'], ['ins_rate', 'Страховка % / 保率'], ['advance', 'Оплачено за вас в Китае / 垫付款'],
    ['unload_fee', 'Плата за разгрузку / 落地费'], ['other_fee', 'Другие платежи / 其他款项'], ['destination', 'Пункт назначения / 目的地'], ['transport', 'Способ перевозки / 运输方式'],
    ['note', 'Замечание / 备注']];
  const ex = { code: 'D1600', inv_date: '16.10.2026', goods: '汽配 Автозапчасти', pieces: 4, total_weight: 75.2, volume: 1.183, rate: 190, price_basis: 'м3', packing: '木架 Обрешётка', pack_fee: 35, goods_value: 0, ins_rate: 0, advance: 0, unload_fee: 0, other_fee: 0, destination: '阿拉木图 Алматы', transport: '陆运 Авто', note: '' };
  const ws = XLSX.utils.aoa_to_sheet([head.map((h) => h[1]), head.map((h) => ex[h[0]])]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'invoices');
  res.setHeader('Content-Disposition', 'attachment; filename="cargo151-invoices.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// Номер склада вида D185-0301-2 или AB016-3D-0302-2: код клиента, ММДД отправки, мест.
const parseCargoNo = (no) => /^(.+?)-(\d{2})(\d{2})-(\d+)/.exec(String(no || '').trim());
const DEST_RU = { 阿拉木图: 'Алматы', 比什凯克: 'Бишкек', 莫斯科: 'Москва', '19公里': 'Москва, Южные ворота', 莫斯科外送: 'Москва, доставка' };
// Клиент без WhatsApp, созданный из таблицы склада: телефон-заглушка «stub-код», войти в кабинет пока не может.
const isStub = (client) => String(client.phone || '').startsWith('stub-');
function stubClient(code, dest) {
  const cities = db.prepare('SELECT * FROM cities').all();
  const d = String(dest || '');
  const city = cities.find((x) => d.includes(x.name) || (CITY_ZH[x.name] && d.includes(CITY_ZH[x.name]))) || (/19公里|МКАД/i.test(d) ? cities.find((x) => x.name === 'Москва') : null);
  const r = db.prepare('INSERT INTO clients (code, name, phone, city_id, legacy) VALUES (?, ?, ?, ?, 1)').run(code, dispCode(code), `stub-${code}`, city ? city.id : null);
  linkOrphanParcels(r.lastInsertRowid, code);
  return { id: Number(r.lastInsertRowid) };
}

function importInvoiceRow(req, rec, dayDefault, bad, skipped) {
  const cno = parseCargoNo(rec.number);
  if (!rec.code && cno) rec.code = cno[1];
  if (!rec.code) { if (rec.number) skipped.push(rec.number); return 0; }
  // В номере после кода может идти пометка (AB016-3D-0302-2): пробуем код целиком, потом короче.
  const parts = String(rec.code).split('-');
  let c = null;
  for (let k = parts.length; k > 0 && !c; k--) c = findClientByCode(parts.slice(0, k).join('-'));
  // Нового клиента из таблицы заводим сразу (без номера), чтобы его накладные не потерялись; номер добавят потом.
  if (!c) { const code = codeKey(parts[0]); c = stubClient(code, rec.destination); bad.push(dispCode(code)); }
  const client = getClient(c.id);
  if (!rec.inv_date && cno) {
    // Год берём из даты по умолчанию; если месяц из номера ещё не наступил, это прошлый год.
    let y = +dayDefault.slice(0, 4);
    if (`${y}-${cno[2]}-${cno[3]}` > dayDefault) y--;
    rec.inv_date = `${y}-${cno[2]}-${cno[3]}`;
  }
  rec.inv_date = parseDay(rec.inv_date, dayDefault);
  if (!numOrNull(rec.pieces) && cno) rec.pieces = cno[4];
  const n = (k) => numOrNull(String(rec[k] ?? '').replace(',', '.')) || 0;
  // Цена за кг или за м³ по самой цене: за кг — до ~5 $, за м³ — от 100 $. Между ними смотрим, что сходится с итогом.
  if (!rec.price_basis) {
    const total = n('amount') || n('freight');
    const byKg = n('rate') * n('total_weight'); const byM3 = n('rate') * n('volume');
    rec.price_basis = n('rate') <= 10 ? 'kg' : n('rate') >= 50 ? 'm3'
      : total && byKg && byM3 ? (Math.abs(total - byKg) < Math.abs(total - byM3) ? 'kg' : 'm3') : 'm3';
  } else rec.price_basis = /кг|kg|公斤/i.test(rec.price_basis) ? 'kg' : 'm3';
  // Итог из таблицы — главный: фрахт = итог минус остальные платежи.
  const others = n('ins_fee') + n('pack_fee') + n('advance') + n('unload_fee') + n('other_fee');
  if (n('amount') && !String(rec.freight ?? '').trim()) rec.freight = Math.round((n('amount') - others) * 100) / 100;
  else if (n('freight') && !n('amount')) {
    const calc = n('rate') * (rec.price_basis === 'kg' ? n('total_weight') : n('volume'));
    if (calc && Math.abs(n('freight') - (calc + others)) < Math.abs(n('freight') - calc)) rec.freight = Math.round((n('freight') - others) * 100) / 100;
  }
  delete rec.amount;
  const w = activeWarehouses()[0];
  const ORIGIN_RU = Object.fromEntries(db.prepare('SELECT name_zh, name_ru FROM warehouses').all().map((x) => [x.name_zh, x.name_ru]));
  const zh = (v, map) => { const k = String(v || '').trim(); return map[k] ? `${k} ${map[k]}` : k; };
  rec.origin = zh(rec.origin, ORIGIN_RU) || req.body.origin || (w ? `${w.name_zh}/${w.name_ru}` : '');
  rec.destination = zh(rec.destination, DEST_RU) || (client.city_name ? `${CITY_ZH[client.city_name] || ''} ${client.city_name}`.trim() : '');
  rec.transport ||= req.body.transport || '陆运 Авто';
  rec.sender = dispCode(client.code);
  rec.client_id = client.id;
  // Без номера в файле собираем D1601-1030-4: повторная загрузка того же файла обновит накладные, а не задвоит.
  const number = String(rec.number || '').trim().toUpperCase() || (n('pieces') ? invoiceNumber(client, rec.inv_date, n('pieces')) : '');
  rec.number = number;
  const existing = number ? db.prepare('SELECT * FROM invoices WHERE number = ? AND client_id = ?').get(number, client.id) : null;
  if (existing && !n('pieces')) rec.pieces = existing.pieces;
  const id = saveInvoice(rec, existing);
  if (id && rec.pay_note !== undefined) db.prepare('UPDATE invoices SET paid = ? WHERE id = ?').run(/付|оплач|paid/i.test(rec.pay_note) && !/未付|не\s*оплач|unpaid/i.test(rec.pay_note) ? 1 : existing ? existing.paid : 0, id);
  return id ? 1 : 0;
}

app.post('/admin/import-invoices', upload.single('file'), (req, res) => importInvoices(req, res));
function importInvoices(req, res) {
  if (!req.file) return res.redirect('/admin/import');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  const dayDefault = /^\d{4}-\d{2}-\d{2}$/.test(req.body.inv_date) ? req.body.inv_date : new Date().toISOString().slice(0, 10);
  // Листы по месяцам (1月 … 10月): берём все или только выбранный.
  const sheets = req.body.sheet && wb.SheetNames.includes(req.body.sheet) ? [req.body.sheet] : wb.SheetNames;
  let n = 0; let heads = 0; const bad = []; const skipped = [];
  for (const name of sheets) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    // Строка заголовков — первая, где есть код клиента или 货号 (сверху может быть шапка).
    let hi = rows.findIndex((r) => r.map(matchInvColumn).some((f) => f === 'code' || f === 'number'));
    let map;
    // Если почти во всех строках в колонке B номер вида D185-0301-2 — это ежедневная таблица склада, даже если
    // сверху чужие заголовки (например, данные вставили в шаблон посылок). Читаем по порядку колонок с первой такой строки.
    const firstNo = rows.findIndex((r) => parseCargoNo(r[1]));
    const filled = rows.slice(Math.max(firstNo, 0)).filter((r) => String(r[1] ?? '').trim());
    if (firstNo >= 0 && filled.filter((r) => parseCargoNo(r[1])).length >= filled.length * 0.7) { map = DAILY_LAYOUT; hi = firstNo - 1; } else
    if (hi >= 0) {
      map = rows[hi].map(matchInvColumn);
      if (map.filter((f) => ['total_weight', 'volume', 'rate', 'amount', 'freight'].includes(f)).length < 2 && map[1] === 'number') map = DAILY_LAYOUT;
    } else if (rows.some((r) => parseCargoNo(r[1]))) {
      // Таблица без заголовков, как ежедневная выгрузка склада: колонки по порядку.
      map = DAILY_LAYOUT; hi = -1;
    } else continue;
    heads++;
    for (const row of rows.slice(hi + 1)) {
      const rec = {};
      // Excel превращает «25.4» и «1.4» в даты (25 апреля, 1 апреля): в числовых колонках возвращаем число день.месяц.
      const cell = (f, v) => (v instanceof Date && f !== 'inv_date' ? Number(`${new Date(v.getTime() + 432e5).getUTCDate()}.${new Date(v.getTime() + 432e5).getUTCMonth() + 1}`) : v instanceof Date ? v : String(v ?? '').trim());
      map.forEach((f, i) => { if (f && rec[f] == null && i < row.length) rec[f] = cell(f, row[i]); });
      n += importInvoiceRow(req, rec, dayDefault, bad, skipped);
    }
  }
  const unknown = [...new Set(bad)];
  req.session.flash = `${req.t('a_inv_imported')}: ${n}${unknown.length ? `. ${req.t('a_inv_new_clients')} (${unknown.length}): ${unknown.slice(0, 40).join(', ')}${unknown.length > 40 ? '…' : ''}` : ''}${skipped.length ? `. ${req.t('a_inv_skipped')}: ${skipped.slice(0, 20).join(', ')}` : ''}${heads ? '' : `. ${req.t('a_inv_nohead')}`}`;
  res.redirect('/admin/invoices');
}

app.get('/admin/invoices', (req, res) => {
  const t = req.t;
  const invoices = db.prepare(`SELECT i.*, c.code, c.name, (SELECT COUNT(*) FROM invoice_photos ph WHERE ph.invoice_id = i.id) pc FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.id DESC LIMIT 300`).all();
  adminRender(req, res, t('a_invoices'), `${canMoney(req) ? `<div class="card"><form method="get" action="/admin/invoices/new" class="row"><div><label>${esc(t('a_pick_client'))}</label><input name="code" required placeholder="D1600"></div><button>${esc(t('a_new_invoice'))}</button><a class="btn sec" href="/admin/import#inv">${esc(t('a_inv_import'))}</a></form></div>` : ''}
  <div class="card">${invoicesTable(t, invoices, '/admin/invoices/', canMoney(req), isOwner(req))}</div>`);
});

// Номер накладной: D{код}-{ММДД даты отправки}-{мест}, например D1601-1030-4.
const invoiceNumber = (client, date, pieces) => `${dispCode(client.code)}-${String(date || '').slice(5, 7)}${String(date || '').slice(8, 10)}-${pieces || 0}`;

function invoiceForm(req, client, inv) {
  const t = req.t;
  const w = activeWarehouses()[0];
  const today = new Date().toISOString().slice(0, 10);
  const v = inv || {
    origin: w ? `${w.name_zh}/${w.name_ru}` : '', destination: client.city_name ? `${CITY_ZH[client.city_name] || ''} ${client.city_name}`.trim() : '',
    transport: '陆运 Авто', sender: dispCode(client.code),
    inv_date: today, rate: 0, price_basis: 'm3', ins_rate: 0, number: '',
  };
  const parcels = db.prepare('SELECT * FROM parcels WHERE client_id = ? AND (invoice_id IS NULL OR invoice_id = ?) ORDER BY id').all(client.id, inv ? inv.id : 0);
  const inp = (k, zh, ru, extra = '') => `<div><label>${esc(zh)} · ${esc(ru)}</label><input name="${k}" id="i-${k}" value="${esc(v[k] ?? '')}" ${NUM_FIELDS.includes(k) ? 'inputmode="decimal"' : ''} ${extra}></div>`;
  const whs = activeWarehouses();
  return `<div class="card"><h2>${esc(inv ? `${t('invoice')} ${inv.number}` : t('a_new_invoice'))}: D${esc(client.code)} · ${esc(client.name)}</h2>
  <form method="post" action="${inv ? `/admin/invoices/${inv.id}` : '/admin/invoices'}" id="invform"><input type="hidden" name="client_id" value="${client.id}">
  <datalist id="dl-origin">${whs.map((x) => `<option value="${esc(`${x.name_zh}/${x.name_ru}`)}">`).join('')}</datalist>
  <datalist id="dl-dest">${Object.entries(CITY_ZH).map(([ru, zh]) => `<option value="${esc(`${zh} ${ru}`)}">`).join('')}</datalist>
  <datalist id="dl-tr"><option value="陆运 Авто"><option value="铁路 ЖД"><option value="空运 Авиа"></datalist>
  <datalist id="dl-pack"><option value="编织袋 Мешок"><option value="纸箱 Коробка"><option value="木架 Обрешётка"><option value="木架+加固 Обрешётка+усиление"></datalist>
  <div class="row">${inp('origin', '始发地', 'Пункт отправки', 'list="dl-origin"')}${inp('destination', '目的地', 'Пункт назначения', 'list="dl-dest"')}${inp('transport', '运输方式', 'Способ перевозки', 'list="dl-tr"')}</div>
  <div class="row"><div><label>发货日期 · Дата отправки</label><input type="date" name="inv_date" id="i-inv_date" value="${esc(String(v.inv_date || today).slice(0, 10))}"></div>
    ${inp('sender', '发货人', 'Грузоотправитель')}</div>
  ${parcels.length ? `<h3>${esc(t('a_pick_parcels'))}</h3><div class="tbl"><table><tr><th></th><th>${esc(t('track'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('places'))}</th><th>${esc(t('description'))}</th></tr>
    ${parcels.map((p) => `<tr><td><input type="checkbox" name="ids" value="${p.id}" ${!inv || p.invoice_id === inv.id ? 'checked' : ''} style="width:auto" data-w="${p.weight || 0}" data-p="${p.places || 0}"></td><td>${esc(p.track)}</td><td>${p.weight}</td><td>${p.places}</td><td>${esc(p.description)}</td></tr>`).join('')}</table></div>` : ''}
  <div class="row">${inp('goods', '品名', 'Перечень товаров')}${inp('pieces', '件数', 'Мест')}${inp('total_weight', '重量', 'Вес, кг')}${inp('volume', '体积', 'Объём, м³')}</div>
  <div class="row">${inp('rate', '单价', 'Цена')}<div><label>за · 按</label><select name="price_basis" id="i-price_basis"><option value="m3" ${v.price_basis !== 'kg' ? 'selected' : ''}>м³</option><option value="kg" ${v.price_basis === 'kg' ? 'selected' : ''}>кг</option></select></div>
    ${inp('freight', '运费 $', 'Фрахт')}${inp('goods_value', '货值 $', 'Стоимость товара')}${inp('ins_rate', '保率 %', 'Страховка %')}${inp('ins_fee', '保险费 $', 'Страховка $')}</div>
  <div class="row">${inp('packing', '打包方式', 'Упаковка', 'list="dl-pack"')}${inp('pack_fee', '包装费 $', 'За упаковку')}${inp('advance', '垫付款 $', 'Оплачено за вас в Китае')}${inp('unload_fee', '落地费 $', 'За разгрузку')}${inp('other_fee', '其他款项 $', 'Другие платежи')}</div>
  <div class="row"><div><label>${esc(t('status'))}</label><select name="inv_status">${invStatusOptions(t, INV_STATUSES.includes(v.inv_status) ? v.inv_status : 'auto')}</select></div>${inp('cargo_status', '运踪', t('inv_cargo_status'), 'placeholder="3.13到"')}${inp('pay_note', '付款', t('inv_pay_note'))}</div>
  <div class="row">${inp('note', '备注', 'Замечание')}${inp('number', '货号', `${t('invoice_no')} (${t('inv_auto')})`, `placeholder="D${esc(client.code)}-MMDD-мест" ${inv ? 'data-touched="1"' : ''}`)}
    <div><label>总计 · ${esc(t('total'))}</label><div class="stat" id="i-total" style="color:var(--brand)">0</div></div></div>
  <p><button>${esc(inv ? t('save') : t('create'))}</button></p></form></div>
  <script>(function(){const f=document.getElementById('invform'),g=(k)=>document.getElementById('i-'+k),n=(k)=>parseFloat(String(g(k).value).replace(',','.'))||0,r=(x)=>Math.round(x*100)/100;
  const code=${JSON.stringify(client.code)};let fr=${inv ? 'true' : 'false'},fi=${inv ? 'true' : 'false'};
  g('freight').addEventListener('input',()=>fr=true);g('ins_fee').addEventListener('input',()=>fi=true);g('number').addEventListener('input',()=>g('number').dataset.touched='1');
  const sum=()=>{let w=0,p=0;f.querySelectorAll('input[name=ids]:checked').forEach(x=>{w+=+x.dataset.w;p+=+x.dataset.p});g('total_weight').value=r(w)||'';g('pieces').value=p||'';calc()};
  f.querySelectorAll('input[name=ids]').forEach(c=>c.addEventListener('change',sum));
  function calc(){if(!fr)g('freight').value=r(n('rate')*(g('price_basis').value==='kg'?n('total_weight'):n('volume')))||'';
    if(!fi)g('ins_fee').value=r(n('goods_value')*n('ins_rate')/100)||'';
    g('total').textContent=r(${JSON.stringify(FEES)}.reduce((s,k)=>s+n(k),0));
    const d=g('inv_date').value;if(!g('number').dataset.touched&&d)g('number').value='D'+code+'-'+d.slice(5,7)+d.slice(8,10)+'-'+(n('pieces')||0)}
  f.addEventListener('input',calc);f.addEventListener('change',calc);calc();${inv ? '' : 'sum();'}})();</script>`;
}

// В Excel код без буквы (9455) — отдельный клиент #9455. В формах админки «1600» может значить и D1600: loose пробует оба.
const findClientByCode = (code, loose = false) => {
  const raw = String(code || '').trim().toUpperCase().replace(/\s+/g, '').replace(/-\d{4}$/, '');
  const q = db.prepare('SELECT id FROM clients WHERE code = ?');
  return q.get(codeKey(raw)) || (loose && /^\d/.test(raw) ? q.get(raw) : null);
};

app.get('/admin/invoices/new', (req, res) => {
  const c = findClientByCode(req.query.code, true);
  if (!c) { req.session.flash = req.t('not_found'); return res.redirect('/admin/invoices'); }
  adminRender(req, res, req.t('a_new_invoice'), invoiceForm(req, getClient(c.id)));
});

function saveInvoice(b, existing) {
  const client = getClient(parseInt(b.client_id, 10));
  if (!client) return null;
  const ids = [].concat(b.ids || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const parcels = ids.map((id) => db.prepare('SELECT * FROM parcels WHERE id = ? AND client_id = ? AND (invoice_id IS NULL OR invoice_id = ?)').get(id, client.id, existing ? existing.id : 0)).filter(Boolean);
  const v = {};
  for (const k of ['origin', 'destination', 'transport', 'delivery_time', 'sender', 'consignee', 'goods', 'packing', 'note', 'cargo_status', 'pay_note']) v[k] = String(b[k] || '').trim().slice(0, 300);
  for (const k of NUM_FIELDS) v[k] = numOrNull(String(b[k] ?? '').replace(',', '.'));
  v.inv_status = INV_STATUSES.includes(b.inv_status) ? b.inv_status : /到|прибыл/i.test(v.cargo_status) ? 'arrived' : existing ? existing.inv_status : 'auto';
  v.inv_date = /^\d{4}-\d{2}-\d{2}$/.test(b.inv_date) ? b.inv_date : new Date().toISOString().slice(0, 10);
  v.price_basis = b.price_basis === 'kg' ? 'kg' : 'm3';
  // Пустые поля заполняем из выбранных посылок и по формулам, как в бумажной накладной.
  if (v.pieces == null) v.pieces = parcels.reduce((s, p) => s + (p.places || 0), 0);
  if (v.total_weight == null) v.total_weight = Math.round(parcels.reduce((s, p) => s + (p.weight || 0), 0) * 100) / 100;
  for (const k of NUM_FIELDS) if (v[k] == null && !['freight', 'ins_fee'].includes(k)) v[k] = 0;
  if (v.freight == null) v.freight = Math.round(v.rate * (v.price_basis === 'kg' ? v.total_weight : v.volume) * 100) / 100;
  if (v.ins_fee == null) v.ins_fee = Math.round((v.goods_value * v.ins_rate) / 100 * 100) / 100;
  // Итог округляем до целого доллара (34.56 → 35, 34.40 → 34); разницу относим во фрахт, чтобы строки сходились с итогом.
  const sum = FEES.reduce((s, k) => s + v[k], 0);
  v.amount = Math.round(sum);
  if (FEES.includes('freight')) v.freight = Math.round((v.freight + v.amount - sum) * 100) / 100;
  let number = String(b.number || '').trim().toUpperCase() || invoiceNumber(client, v.inv_date, v.pieces);
  for (let i = 2; db.prepare('SELECT id FROM invoices WHERE number = ? AND id != ?').get(number, existing ? existing.id : 0); i++) number = `${number.replace(/\/\d+$/, '')}/${i}`;
  v.number = number;
  const cols = Object.keys(v);
  db.exec('BEGIN');
  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE invoices SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => v[k]), id);
    db.prepare('UPDATE parcels SET invoice_id = NULL WHERE invoice_id = ?').run(id);
  } else {
    id = Number(db.prepare(`INSERT INTO invoices (client_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(client.id, ...cols.map((k) => v[k])).lastInsertRowid);
  }
  for (const p of parcels) db.prepare('UPDATE parcels SET invoice_id = ? WHERE id = ?').run(id, p.id);
  db.exec('COMMIT');
  return id;
}

app.post('/admin/invoices', (req, res) => {
  const id = saveInvoice(req.body, null);
  res.redirect(id ? `/admin/invoices/${id}` : '/admin/invoices');
});

app.get('/admin/invoices/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv) return res.redirect('/admin/invoices');
  const t = req.t;
  adminRender(req, res, inv.number, `${invoicePage(req, inv)}<div class="row noprint" style="gap:8px">
    ${canMoney(req) ? `<form method="post" action="/admin/invoices/${inv.id}/paid" style="flex:0 0 auto"><input type="hidden" name="paid" value="${inv.paid ? 0 : 1}"><button class="sec">${esc(inv.paid ? t('unpaid') : t('a_mark_paid'))}</button></form>
    <a class="btn sec" style="flex:0 0 auto" href="/admin/invoices/${inv.id}/edit">${esc(t('edit'))}</a>` : ''}
    ${isOwner(req) ? `<form method="post" action="/admin/invoices/${inv.id}/delete" style="flex:0 0 auto" onsubmit="return confirm('${esc(t('confirm_delete'))}')"><button class="sec">${esc(t('delete'))}</button></form>` : ''}</div>`);
});

app.get('/admin/invoices/:id/edit', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv) return res.redirect('/admin/invoices');
  adminRender(req, res, inv.number, invoiceForm(req, getClient(inv.client_id), inv));
});

app.post('/admin/invoices/bulk', (req, res) => {
  const ids = [].concat(req.body.ids || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const st = INV_STATUSES.includes(req.body.inv_status) ? req.body.inv_status : null;
  const paid = !canMoney(req) ? null : req.body.paid === '1' ? 1 : req.body.paid === '0' ? 0 : null;
  // Удалить отмеченные — только владелец (например, неудачную загрузку).
  if (req.body.del === '1' && isOwner(req)) {
    db.exec('BEGIN');
    for (const id of ids) {
      db.prepare('UPDATE parcels SET invoice_id = NULL WHERE invoice_id = ?').run(id);
      for (const ph of invoicePhotos(id)) { try { fs.unlinkSync(require('path').join(PHOTO_DIR, ph.file)); } catch {} }
      db.prepare('DELETE FROM invoice_photos WHERE invoice_id = ?').run(id);
      db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    }
    db.exec('COMMIT');
    req.session.flash = `${req.t('a_bulk_deleted')}: ${ids.length}`;
    return res.redirect('/admin/invoices');
  }
  db.exec('BEGIN');
  for (const id of ids) db.prepare('UPDATE invoices SET inv_status = COALESCE(?, inv_status), paid = COALESCE(?, paid) WHERE id = ?').run(st, paid, id);
  db.exec('COMMIT');
  req.session.flash = `${req.t('saved')}: ${ids.length}`;
  res.redirect('/admin/invoices');
});

app.post('/admin/invoices/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!inv) return res.redirect('/admin/invoices');
  saveInvoice(req.body, inv);
  res.redirect(`/admin/invoices/${inv.id}`);
});

app.post('/admin/invoices/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.exec('BEGIN');
  db.prepare('UPDATE parcels SET invoice_id = NULL WHERE invoice_id = ?').run(id);
  for (const ph of invoicePhotos(id)) { try { fs.unlinkSync(require('path').join(PHOTO_DIR, ph.file)); } catch {} }
  db.prepare('DELETE FROM invoice_photos WHERE invoice_id = ?').run(id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  db.exec('COMMIT');
  res.redirect('/admin/invoices');
});

app.post('/admin/invoices/:id/photos', photoUpload.array('photos', 10), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(id)) {
    for (const f of req.files || []) {
      const name = `${crypto.randomUUID()}.jpg`;
      fs.writeFileSync(require('path').join(PHOTO_DIR, name), f.buffer);
      db.prepare('INSERT INTO invoice_photos (invoice_id, file) VALUES (?, ?)').run(id, name);
    }
  }
  const back = String(req.body.back || '');
  res.redirect(back.startsWith('/admin/') ? back : `/admin/invoices/${id}`);
});

app.post('/admin/invoices/:id/photos/:pid/delete', (req, res) => {
  const ph = db.prepare('SELECT * FROM invoice_photos WHERE id = ? AND invoice_id = ?').get(parseInt(req.params.pid, 10), parseInt(req.params.id, 10));
  if (ph) {
    db.prepare('DELETE FROM invoice_photos WHERE id = ?').run(ph.id);
    try { fs.unlinkSync(require('path').join(PHOTO_DIR, ph.file)); } catch {}
  }
  const back = String(req.body.back || '');
  res.redirect(back.startsWith('/admin/') ? back : `/admin/invoices/${parseInt(req.params.id, 10)}`);
});

app.post('/admin/invoices/:id/paid', (req, res) => {
  db.prepare('UPDATE invoices SET paid = ? WHERE id = ?').run(req.body.paid === '1' ? 1 : 0, parseInt(req.params.id, 10));
  res.redirect(`/admin/invoices/${parseInt(req.params.id, 10)}`);
});
// ---------- Фото с весов (кладовщик) ----------
// ---------- Файл сканера склада: трек-код + фото коробки ----------
// Трек есть у клиента (он сам добавил в кабинете) — клиент сразу видит фото и «Принят на складе». Нет — посылка
// просто ждёт в базе без клиента; когда клиент добавит этот трек, фото появятся у него.
const scanForm = (t) => `<div class="card"><h2>${esc(t('a_scan_title'))}</h2><p class="muted">${esc(t('a_scan_hint'))}</p>
  <form method="post" action="/admin/import-scan" enctype="multipart/form-data"><input type="file" name="file" accept=".xlsx" required style="margin-bottom:12px"><button class="wide">${esc(t('a_upload'))}</button></form></div>`;
app.post('/admin/import-scan', scanUpload.single('file'), (req, res) => {
  const back = photosOnly(req) ? '/admin/photos' : '/admin/import';
  if (!req.file) return res.redirect(back);
  let rows = [];
  try { rows = readScanFile(req.file.buffer); } catch { rows = []; }
  const crypto = require('crypto');
  const tracks = new Map();
  for (const r of rows) {
    const s = parseScan(r.content);
    if (!/^[A-Z0-9]{6,}$/.test(s.track)) continue;
    const x = tracks.get(s.track) || { total: null, boxes: new Set(), time: r.time, images: [] };
    if (s.total) x.total = Math.max(x.total || 0, s.total);
    if (s.box) x.boxes.add(s.box);
    x.images.push(...r.images.map((img) => ({ ...img, box: s.box || 0 })));
    tracks.set(s.track, x);
  }
  let matched = 0; let waiting = 0; let photos = 0; let repeat = 0;
  for (const [track, x] of tracks) {
    let p = db.prepare('SELECT * FROM parcels WHERE upper(replace(track, \' \', \'\')) = ?').get(track);
    const places = x.total || x.boxes.size || 1;
    if (!p) {
      const id = db.prepare("INSERT INTO parcels (track, places, status) VALUES (?, ?, 'china')").run(track, places).lastInsertRowid;
      addEvent(id, 'china');
      p = db.prepare('SELECT * FROM parcels WHERE id = ?').get(id);
    } else {
      if (p.scanned_at || p.status !== 'expected') repeat++;
      if (p.status === 'expected') { db.prepare("UPDATE parcels SET status = 'china' WHERE id = ?").run(p.id); addEvent(p.id, 'china'); }
      db.prepare("UPDATE parcels SET places = ?, updated_at = datetime('now') WHERE id = ?").run(Math.max(places, p.places || 0), p.id);
    }
    const when = x.time instanceof Date ? x.time.toISOString().slice(0, 19).replace('T', ' ') : String(x.time || '').slice(0, 19);
    if (when) db.prepare('UPDATE parcels SET scanned_at = COALESCE(scanned_at, ?) WHERE id = ?').run(when, p.id);
    for (const img of x.images) {
      const hash = crypto.createHash('sha1').update(img.data).digest('hex');
      // Повторный скан (тот же файл или та же коробка в другой день) фото не добавляет: одна коробка — одно фото.
      if (db.prepare('SELECT 1 FROM parcel_photos WHERE parcel_id = ? AND (hash = ? OR box = ?)').get(p.id, hash, img.box)) continue;
      const name = `${crypto.randomUUID()}.${img.ext}`;
      fs.writeFileSync(require('path').join(PHOTO_DIR, name), img.data);
      db.prepare('INSERT INTO parcel_photos (parcel_id, file, hash, box) VALUES (?, ?, ?, ?)').run(p.id, name, hash, img.box);
      photos++;
    }
    if (p.client_id) matched++; else waiting++;
  }
  req.session.flash = `${req.t('a_scan_done')}: ${tracks.size}. ${req.t('a_scan_matched')}: ${matched}. ${req.t('a_scan_waiting')}: ${waiting}. ${req.t('a_scan_photos')}: ${photos}. ${req.t('a_scan_repeat')}: ${repeat}.`;
  res.redirect(back);
});

app.get('/admin/photos', (req, res) => {
  const t = req.t; const q = String(req.query.q || '').trim().toUpperCase();
  const like = `%${q}%`;
  const rows = db.prepare(`SELECT i.id, i.number, i.inv_date, i.created_at, i.pieces, i.total_weight, c.code FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE ? = '' OR i.number LIKE ? OR c.code = ? OR c.code = ? ORDER BY i.id DESC LIMIT 60`).all(q, like, codeKey(q), q.replace(/^D(?=\d)/, ''));
  const phq = db.prepare('SELECT * FROM invoice_photos WHERE invoice_id = ? ORDER BY id'); const photos = (id) => phq.all(id);
  const back = `/admin/photos${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  adminRender(req, res, t('a_scale_photos'), `${scanForm(t)}<div class="card"><p class="muted" style="margin-top:0">${esc(t('a_scale_hint'))}</p><form class="row"><div><input name="q" value="${esc(req.query.q || '')}" placeholder="${esc(t('invoice_no'))} / ${esc(t('code'))}"></div><button>${esc(t('search'))}</button></form></div>
  <div class="card tbl"><table><tr><th>${esc(t('date'))}</th><th>${esc(t('invoice_no'))}</th><th>${esc(t('places'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('inv_photos'))}</th></tr>
  ${rows.map((i) => { const ph = photos(i.id); return `<tr><td>${esc(fmtDay(i.inv_date || i.created_at))}</td><td><b>${esc(i.number)}</b></td><td>${i.pieces || ''}</td><td>${num(i.total_weight)}</td>
    <td><div class="thumbs">${ph.map((f) => `<span><a href="/photo/${esc(f.file)}" target="_blank"><img src="/photo/${esc(f.file)}" loading="lazy" alt=""></a><form method="post" action="/admin/invoices/${i.id}/photos/${f.id}/delete" onsubmit="return confirm('${esc(t('confirm_delete_photo'))}')"><input type="hidden" name="back" value="${esc(back)}"><button class="sec sm">✕</button></form></span>`).join('')}${photoForm(t, i.id, back)}</div></td></tr>`; }).join('')}</table></div>${PHOTO_JS}`);
});

// ---------- Объявления ----------
app.get('/admin/news', (req, res) => {
  const t = req.t; const rows = db.prepare('SELECT * FROM news ORDER BY id DESC').all();
  adminRender(req, res, t('a_news'), `<div class="card"><h2>${esc(t('a_news_add'))}</h2><p class="muted">${esc(t('a_news_hint'))}</p>
    <form method="post" action="/admin/news"><label>рус</label><textarea name="text_ru" required rows="2" placeholder="Склад в Китае закрыт на Новый год с 10 по 17 февраля"></textarea>
    <label>中文</label><textarea name="text_zh" rows="2"></textarea><label>қаз</label><textarea name="text_kk" rows="2"></textarea><p><button>${esc(t('a_news_add'))}</button></p></form></div>
    <div class="card">${rows.length ? rows.map((n) => `<div class="row" style="align-items:center;border-bottom:1px solid var(--line);padding:8px 0"><div><span class="muted">${esc(fmtDay(n.created_at))}</span> ${esc(n.text_ru)}${n.text_zh ? `<div class="muted">${esc(n.text_zh)}</div>` : ''}${n.text_kk ? `<div class="muted">${esc(n.text_kk)}</div>` : ''}</div>
      <form method="post" action="/admin/news/${n.id}/delete" style="flex:0 0 auto;margin:0" onsubmit="return confirm('${esc(t('confirm_delete'))}')"><button class="sec sm">${esc(t('delete'))}</button></form></div>`).join('') : `<p class="muted">${esc(t('a_news_empty'))}</p>`}</div>`);
});
app.post('/admin/news', (req, res) => {
  const b = req.body; const ru = String(b.text_ru || '').trim();
  if (ru) db.prepare('INSERT INTO news (text_ru, text_zh, text_kk) VALUES (?, ?, ?)').run(ru.slice(0, 500), String(b.text_zh || '').trim().slice(0, 500), String(b.text_kk || '').trim().slice(0, 500));
  res.redirect('/admin/news');
});
app.post('/admin/news/:id/delete', (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(parseInt(req.params.id, 10));
  res.redirect('/admin/news');
});

// ---------- Заявки на отправку дальше ----------
app.get('/admin/forward', (req, res) => {
  const t = req.t;
  const rows = db.prepare(`SELECT f.*, i.number, c.code, c.name FROM forward_requests f JOIN invoices i ON i.id = f.invoice_id JOIN clients c ON c.id = f.client_id
    ORDER BY f.status = 'done', f.id DESC LIMIT 200`).all();
  adminRender(req, res, t('a_forward'), `<div class="card"><p class="muted" style="margin:0">${esc(t('a_forward_hint'))}</p></div>
  <div class="card tbl">${rows.length ? `<table><tr><th>${esc(t('date'))}</th><th>${esc(t('invoice'))}</th><th>${esc(t('fwd_city'))}</th><th>${esc(t('fwd_method'))}</th><th>${esc(t('fwd_receiver'))}</th><th>${esc(t('note'))}</th><th></th></tr>
  ${rows.map((r) => `<tr${r.status === 'done' ? ' style="opacity:.55"' : ''}><td>${esc(fmtDay(r.created_at))}</td><td><a href="/admin/invoices/${r.invoice_id}"><b>${esc(r.number)}</b></a><div class="muted" style="font-size:13px">${esc(dispCode(r.code))} ${esc(r.name)}</div></td>
    <td><b>${esc(r.city)}</b></td><td>${esc(t('fwd_m_' + r.method))}</td><td>${esc(r.receiver)}${r.receiver_phone && isOwner(req) ? `<div>${esc(r.receiver_phone)}</div>` : ''}</td><td>${esc(r.note)}</td>
    <td><form method="post" action="/admin/forward/${r.id}" style="margin:0"><input type="hidden" name="status" value="${r.status === 'done' ? 'new' : 'done'}"><button class="sec sm">${esc(t(r.status === 'done' ? 'fwd_reopen' : 'fwd_mark_done'))}</button></form></td></tr>`).join('')}</table>` : `<p class="muted">${esc(t('a_forward_empty'))}</p>`}</div>`);
});
app.post('/admin/forward/:id', (req, res) => {
  db.prepare('UPDATE forward_requests SET status = ? WHERE id = ?').run(req.body.status === 'done' ? 'done' : 'new', parseInt(req.params.id, 10));
  res.redirect('/admin/forward');
});

// ---------- Отчёт за месяц ----------
function reportData(month) {
  const inv = db.prepare(`SELECT i.*, c.code, c.name FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE substr(COALESCE(NULLIF(i.inv_date, ''), i.created_at), 1, 7) = ? ORDER BY i.inv_date, i.id`).all(month);
  const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const tot = { count: inv.length, pieces: sum(inv, 'pieces'), weight: sum(inv, 'total_weight'), volume: sum(inv, 'volume'), amount: sum(inv, 'amount') };
  tot.paid = sum(inv.filter((i) => i.paid), 'amount'); tot.unpaid = tot.amount - tot.paid;
  const byDest = {};
  for (const i of inv) { const d = (DEST_RU[i.destination] || i.destination || '—'); const o = byDest[d] ||= { count: 0, weight: 0, volume: 0, amount: 0 }; o.count++; o.weight += i.total_weight || 0; o.volume += i.volume || 0; o.amount += i.amount || 0; }
  // Долги — по всем месяцам, а не только по выбранному.
  const debts = db.prepare(`SELECT c.code, c.name, COUNT(*) n, SUM(i.amount) s FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.paid = 0 GROUP BY c.id ORDER BY s DESC`).all();
  // «Пропавшие»: возили хотя бы 3 раза, но последней накладной больше 60 дней.
  const lost = db.prepare(`SELECT c.id, c.code, c.name, c.phone, COUNT(*) n, SUM(i.amount) s, MAX(COALESCE(NULLIF(i.inv_date, ''), substr(i.created_at, 1, 10))) last
    FROM invoices i JOIN clients c ON c.id = i.client_id GROUP BY c.id HAVING n >= 3 AND last < date('now', '-60 days') ORDER BY s DESC LIMIT 100`).all();
  return { inv, tot, byDest, debts, lost };
}
const r2 = (v) => Math.round(v * 100) / 100;
app.get('/admin/report', (req, res) => {
  const t = req.t;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.m || '')) ? req.query.m : new Date().toISOString().slice(0, 7);
  const { tot, byDest, debts, lost } = reportData(month);
  const card = (k, v) => `<div class="card"><div class="muted">${esc(t(k))}</div><div class="stat">${v}</div></div>`;
  adminRender(req, res, t('a_report'), `<div class="card"><form class="row" style="align-items:flex-end"><div><label>${esc(t('a_month'))}</label><input type="month" name="m" value="${month}"></div><button>${esc(t('a_show'))}</button>
    <a class="btn sec" href="/admin/report.xlsx?m=${month}">⬇ Excel</a></form></div>
    <div class="grid g4">${card('a_rep_invoices', tot.count)}${card('a_rep_pieces', tot.pieces)}${card('a_rep_weight', num(r2(tot.weight)) + ' кг')}${card('a_rep_volume', num(tot.volume) + ' м³')}</div>
    <div class="grid g4">${card('a_rep_amount', money(tot.amount))}${card('a_rep_paid', money(tot.paid))}${card('a_rep_unpaid', money(tot.unpaid))}</div>
    <div class="card tbl"><h2>${esc(t('a_rep_by_dest'))}</h2><table><tr><th>${esc(t('a_rep_dest'))}</th><th>${esc(t('a_rep_invoices'))}</th><th>${esc(t('weight'))}</th><th>${esc(t('a_rep_volume'))}</th><th>${esc(t('a_rep_amount'))}</th></tr>
    ${Object.entries(byDest).map(([d, o]) => `<tr><td>${esc(d)}</td><td>${o.count}</td><td>${num(r2(o.weight))}</td><td>${num(o.volume)}</td><td>${money(o.amount)}</td></tr>`).join('')}</table></div>
    <div class="card tbl"><h2>${esc(t('a_rep_debts'))}</h2>${debts.length ? `<table><tr><th>${esc(t('code'))}</th><th>${esc(t('name'))}</th><th>${esc(t('a_rep_invoices'))}</th><th>${esc(t('a_rep_unpaid'))}</th></tr>
    ${debts.map((d) => `<tr><td><b>${esc(dispCode(d.code))}</b></td><td>${esc(d.name)}</td><td>${d.n}</td><td>${money(d.s)}</td></tr>`).join('')}</table>` : `<p class="muted">${esc(t('a_rep_no_debts'))}</p>`}</div>
    <div class="card tbl" id="lost"><h2>${esc(t('a_lost'))}</h2><p class="muted">${esc(t('a_lost_hint'))}</p>${lost.length ? `<table><tr><th>${esc(t('code'))}</th><th>${esc(t('name'))}</th><th>${esc(t('a_rep_invoices'))}</th><th>${esc(t('a_rep_amount'))}</th><th>${esc(t('a_lost_last'))}</th>${isOwner(req) ? '<th></th>' : ''}</tr>
    ${lost.map((d) => `<tr><td><a href="/admin/clients/${d.id}"><b>${esc(dispCode(d.code))}</b></a></td><td>${esc(d.name)}</td><td>${d.n}</td><td>${money(d.s)}</td><td>${esc(fmtDay(d.last))}</td>${isOwner(req) ? `<td>${isStub(d) ? '' : `<a class="btn sec sm" href="https://wa.me/${esc(d.phone)}" target="_blank" rel="noopener">WhatsApp</a>`}</td>` : ''}</tr>`).join('')}</table>` : `<p class="muted">${esc(t('a_lost_none'))}</p>`}</div>`);
});
app.get('/admin/report.xlsx', (req, res) => {
  const t = req.t;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.m || '')) ? req.query.m : new Date().toISOString().slice(0, 7);
  const { inv, tot, byDest, debts } = reportData(month);
  const wb = XLSX.utils.book_new();
  const sheet = (rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map((w) => ({ wch: w })); return ws; };
  XLSX.utils.book_append_sheet(wb, sheet([[t('a_report'), month], [],
    [t('a_rep_invoices'), tot.count], [t('a_rep_pieces'), tot.pieces], [t('a_rep_weight'), r2(tot.weight)], [t('a_rep_volume'), r2(tot.volume * 1000) / 1000],
    [t('a_rep_amount'), r2(tot.amount)], [t('a_rep_paid'), r2(tot.paid)], [t('a_rep_unpaid'), r2(tot.unpaid)], [],
    [t('a_rep_dest'), t('a_rep_invoices'), t('weight'), t('a_rep_volume'), t('a_rep_amount')],
    ...Object.entries(byDest).map(([d, o]) => [d, o.count, r2(o.weight), r2(o.volume * 1000) / 1000, r2(o.amount)])], [24, 14, 12, 12, 14]), t('a_rep_sheet_total').slice(0, 31));
  XLSX.utils.book_append_sheet(wb, sheet([[t('date'), t('invoice_no'), t('code'), t('name'), t('a_rep_dest'), t('places'), t('weight'), t('a_rep_volume'), t('a_rep_amount'), t('a_rep_paid')],
    ...inv.map((i) => [fmtDay(i.inv_date || i.created_at), i.number, dispCode(i.code), i.name, DEST_RU[i.destination] || i.destination, i.pieces || 0, i.total_weight || 0, i.volume || 0, r2(i.amount || 0), i.paid ? '✓' : ''])], [11, 18, 9, 20, 14, 7, 9, 9, 11, 8]), t('a_invoices').slice(0, 31));
  XLSX.utils.book_append_sheet(wb, sheet([[t('code'), t('name'), t('a_rep_invoices'), t('a_rep_unpaid')], ...debts.map((d) => [dispCode(d.code), d.name, d.n, r2(d.s)])], [10, 24, 10, 14]), t('a_rep_debts').slice(0, 31));
  res.setHeader('Content-Disposition', `attachment; filename="cargo151-report-${month}.xlsx"`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// ---------- Резервная копия (владелец) ----------
// Свежая копия базы одним файлом: клиенты, накладные, настройки. Фото сохраняются ночным бэкапом на сервере.
app.get('/admin/backup', (req, res) => {
  const tmp = require('path').join(require('os').tmpdir(), `cargo151-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  res.download(tmp, `cargo151-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(tmp, () => {}));
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
    <div class="card"><h2>${esc(t('s_warehouses'))}</h2>${whs.map(whForm).join('')}${whForm({ id: 'new', name_ru: '', name_zh: '', receiver: '', phone: '', address: '', mark_template: 'D{code}-{last4}', name_template: '{mark}', hours_ru: 'Ежедневно, без выходных, 09:00–20:00', hours_zh: '每天营业，无休息日，09:00–20:00', note_ru: '', note_zh: '', active: 1 }).replace('<div class="card" style="background:#fafafa">', `<div class="card" style="background:#fafafa"><h3>${esc(t('add_wh'))}</h3>`)}</div>
    <div class="card"><h2>💾 ${esc(t('a_backup'))}</h2><p class="muted">${esc(t('a_backup_hint'))}</p><a class="btn sec" href="/admin/backup">⬇ ${esc(t('a_backup'))}</a></div>
    <div class="card"><h2>${esc(t('s_notice'))}</h2>
      <label>рус</label><input name="notice_ru" value="${esc(setting('notice_ru'))}"><label>中文</label><input name="notice_zh" value="${esc(setting('notice_zh'))}"></div>
    ${['services', 'insurance', 'about'].map((k) => `<div class="card"><h2>${esc(t('nav_' + k))}</h2><p class="muted">${esc(t('s_info_hint'))}</p>
      <label>рус</label><textarea name="${k}_ru" style="min-height:220px">${esc(setting(k + '_ru'))}</textarea>
      <label>中文</label><textarea name="${k}_zh" style="min-height:220px">${esc(setting(k + '_zh'))}</textarea></div>`).join('')}
    <div class="card"><h2>${esc(t('nav_info'))}</h2><p class="muted">${esc(t('s_info_hint'))}</p>
      <label>рус</label><textarea name="info_ru" style="min-height:260px">${esc(setting('info_ru'))}</textarea>
      <label>中文</label><textarea name="info_zh" style="min-height:260px">${esc(setting('info_zh'))}</textarea></div>
    <div class="card"><h2>${esc(t('s_promo'))}</h2><p class="muted">${esc(t('s_promo_hint'))}</p>
      <div class="row"><div><label>рус</label><input name="promo_title_ru" value="${esc(setting('promo_title_ru'))}"></div><div><label>中文</label><input name="promo_title_zh" value="${esc(setting('promo_title_zh'))}"></div></div>
      <div class="row"><div><label>рус</label><input name="promo_text_ru" value="${esc(setting('promo_text_ru'))}"></div><div><label>中文</label><input name="promo_text_zh" value="${esc(setting('promo_text_zh'))}"></div></div></div>
    <div class="card"><h2>${esc(t('s_invoice'))}</h2><div class="row"><div><label>${esc(t('s_inv_company'))}</label><input name="invoice_company" value="${esc(setting('invoice_company'))}"></div>
      <div><label>${esc(t('s_inv_title'))}</label><input name="invoice_title" value="${esc(setting('invoice_title'))}"></div></div>
      <label>${esc(t('s_inv_rules'))}</label><textarea name="invoice_rules" style="min-height:320px">${esc(setting('invoice_rules'))}</textarea></div>
    <div class="card"><div class="row"><div><label>${esc(t('s_rate'))}</label><input name="rate_per_kg" value="${esc(setting('rate_per_kg'))}"></div>
    <div><label>${esc(t('s_currency'))}</label><input name="currency" value="${esc(setting('currency'))}"></div>
    <div><label>${esc(t('s_code_start'))}</label><input name="code_start" value="${esc(setting('code_start'))}"></div>
    <div><label>WhatsApp</label><input name="whatsapp" value="${esc(setting('whatsapp'))}"></div></div>
    </div>
    <p><button>${esc(t('save'))}</button></p></form>
    <div class="card" id="staff"><h2>🔑 ${esc(t('s_staff'))}</h2><p class="muted">${esc(t('s_staff_hint'))}</p>
    <div class="tbl"><table><tr><th>${esc(t('name'))}</th><th>${esc(t('a_login'))}</th><th>${esc(t('s_role'))}</th><th>${esc(t('s_new_password'))}</th><th></th></tr>
    ${db.prepare('SELECT * FROM staff ORDER BY active DESC, role, name').all().map((u) => `<tr${u.active ? '' : ' style="opacity:.5"'}><td><b>${esc(u.name)}</b></td><td>${esc(u.login)}</td><td>${esc(t('role_' + u.role))}</td>
      <td><form method="post" action="/admin/settings/staff/${u.id}" class="row" style="margin:0;gap:6px"><input name="pw" type="text" minlength="6" autocomplete="off" placeholder="${esc(t('s_pw_keep'))}"><button class="sec sm" name="act" value="pw">${esc(t('save'))}</button></form></td>
      <td><form method="post" action="/admin/settings/staff/${u.id}" style="margin:0"><button class="sec sm" name="act" value="${u.active ? 'off' : 'on'}">${esc(t(u.active ? 's_staff_off' : 's_staff_on'))}</button></form></td></tr>`).join('')}</table></div>
    <h3>${esc(t('s_staff_add'))}</h3>
    <form method="post" action="/admin/settings/staff"><div class="row"><div><label>${esc(t('name'))}</label><input name="name" required maxlength="60" placeholder="Айгерим"></div>
      <div><label>${esc(t('a_login'))}</label><input name="login" required maxlength="30" pattern="[a-zA-Z0-9._-]{3,30}" autocapitalize="none" placeholder="aigerim"></div></div>
      <div class="row"><div><label>${esc(t('s_role'))}</label><select name="role">${ROLES.filter((r) => r !== 'owner').map((r) => `<option value="${r}">${esc(t('role_' + r))}</option>`).join('')}</select></div>
      <div><label>${esc(t('password'))}</label><input name="pw" required minlength="6" type="text" autocomplete="off"></div></div>
      <p><button>${esc(t('s_staff_add'))}</button></p></form>
    <div class="hint">${ROLES.map((r) => `<div><b>${esc(t('role_' + r))}:</b> ${esc(t('access_' + r))}</div>`).join('')}</div></div>`);
});

app.post('/admin/settings/staff', (req, res) => {
  const b = req.body; const login = String(b.login || '').trim().toLowerCase(); const pw = String(b.pw || '');
  const ok = /^[a-z0-9._-]{3,30}$/.test(login) && login !== 'admin' && pw.length >= 6 && String(b.name || '').trim() && ROLES.includes(b.role) && b.role !== 'owner';
  if (!ok) req.session.flash = req.t('s_staff_bad');
  else if (db.prepare('SELECT 1 FROM staff WHERE login = ?').get(login)) req.session.flash = req.t('s_staff_dup');
  else { db.prepare('INSERT INTO staff (name, login, role, pw) VALUES (?, ?, ?, ?)').run(String(b.name).trim().slice(0, 60), login, b.role, pwHash(pw)); req.session.flash = `${req.t('s_staff_added')}: ${login}`; }
  res.redirect('/admin/settings#staff');
});
app.post('/admin/settings/staff/:id', (req, res) => {
  const id = parseInt(req.params.id, 10); const act = req.body.act;
  if (act === 'pw' && String(req.body.pw || '').length >= 6) { db.prepare('UPDATE staff SET pw = ? WHERE id = ?').run(pwHash(req.body.pw), id); req.session.flash = req.t('s_pw_changed'); }
  else if (act === 'off' || act === 'on') db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(act === 'on' ? 1 : 0, id);
  else req.session.flash = req.t('s_pw_none');
  res.redirect('/admin/settings#staff');
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
  for (const k of ['rate_per_kg', 'currency', 'code_start', 'whatsapp', 'notice_ru', 'notice_zh', 'info_ru', 'info_zh', 'about_ru', 'about_zh', 'services_ru', 'services_zh', 'insurance_ru', 'insurance_zh', 'invoice_company', 'invoice_title', 'invoice_rules', 'promo_title_ru', 'promo_title_zh', 'promo_text_ru', 'promo_text_zh']) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, String(b[k] ?? '').trim());
  db.exec('COMMIT');
  req.session.flash = req.t('saved');
  res.redirect('/admin/settings');
});

app.listen(PORT, () => console.log(`Cargo 151: http://localhost:${PORT}  (admin / ${process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD' : 'admin151'})`));
