const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'cargo151.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  pickup_address TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY,
  name_ru TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  receiver TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  mark_template TEXT NOT NULL DEFAULT 'D{code}-{last4}',
  name_template TEXT NOT NULL DEFAULT '{mark}',
  note_ru TEXT DEFAULT '',
  note_zh TEXT DEFAULT '',
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  city_id INTEGER REFERENCES cities(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  rate REAL NOT NULL,
  total_weight REAL NOT NULL,
  amount REAL NOT NULL,
  paid INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS parcels (
  id INTEGER PRIMARY KEY,
  track TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id),
  client_code TEXT,
  description TEXT DEFAULT '',
  weight REAL DEFAULT 0,
  places INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'china',
  invoice_id INTEGER REFERENCES invoices(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS parcel_events (
  id INTEGER PRIMARY KEY,
  parcel_id INTEGER NOT NULL REFERENCES parcels(id),
  status TEXT NOT NULL,
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// Колонки, добавленные после первой версии: досоздаём в старых базах.
for (const [table, col, def] of [
  ['warehouses', 'name_template', "TEXT NOT NULL DEFAULT '{mark}'"],
  ['warehouses', 'note_ru', "TEXT DEFAULT ''"],
  ['warehouses', 'note_zh', "TEXT DEFAULT ''"],
  ['warehouses', 'hours_ru', "TEXT DEFAULT 'Ежедневно, без выходных'"],
  ['warehouses', 'hours_zh', "TEXT DEFAULT '每天营业，无休息日'"],
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

const STATUSES = {
  expected: 'Ожидается на складе',
  china: 'Принят на складе в Китае',
  transit: 'В пути',
  border: 'На границе / таможня',
  arrived: 'Прибыл в город выдачи',
  delivered: 'Выдан клиенту',
};

function seed() {
  const n = db.prepare('SELECT COUNT(*) c FROM cities').get().c;
  if (n) return;
  const cities = [
    ['Алматы', 'ALA'], ['Астана', 'AST'], ['Шымкент', 'SHY'], ['Актау', 'AKU'],
    ['Актобе', 'AKT'], ['Атырау', 'ATR'], ['Бишкек', 'BSK'], ['Ош', 'OSH'],
    ['Москва', 'MSK'], ['Санкт-Петербург', 'SPB'],
  ];
  const ins = db.prepare('INSERT INTO cities (name, prefix, pickup_address) VALUES (?, ?, ?)');
  for (const [name, prefix] of cities) ins.run(name, prefix, `${name}, адрес пункта выдачи (заполните в админке)`);
  const wh = db.prepare('INSERT INTO warehouses (name_ru, name_zh, receiver, phone, address, note_ru, note_zh) VALUES (?, ?, ?, ?, ?, ?, ?)');
  wh.run('Гуанчжоу', '广州', '乌莉亚', '18038711151', '广东省佛山市南海区里水镇广物汽贸广佛汽车城B区B07-1号151库房',
    'Принимаем все посылки, в том числе мелкие', '接收所有包裹，包括小件');
  wh.run('Иу', '义乌', '乌丽亚娜', '18606567151', '浙江省金华市义乌市后宅街道群英路2号，恒泰胶带厂院内151库',
    'Только крупные грузы. Мелкие посылки принимаются только в Гуанчжоу', '仅接收大件货物，小件包裹请寄广州仓');
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  set.run('rate_per_kg', '4');
  set.run('code_start', '1600');
  set.run('currency', '$');
  set.run('whatsapp', '8618845111182');
  set.run('notice_ru', 'Праздники в Китае: в эти дни склады и почта Китая работают медленнее, грузы могут задерживаться. Подробнее — в разделе «Полезно знать».');
  set.run('notice_zh', '中国节假日期间，仓库和快递速度会变慢，货物可能延误。详见「须知」。');
  set.run('info_ru', `# Праздники в Китае
В эти дни магазины,快递 и склады работают медленнее, отправка может задержаться. Точные даты каждый год разные.
- Новый год (元旦) — 1 января
- Китайский Новый год (春节) — конец января или февраль, 1–2 недели многие фабрики и магазины не работают
- Цинмин (清明节) — начало апреля
- Праздник труда (劳动节) — 1–5 мая
- Праздник лодок-драконов (端午节) — июнь
- Праздник середины осени (中秋节) — сентябрь
- Национальный праздник (国庆节) — 1–7 октября
- 11.11 и 6.18 — распродажи, курьеры перегружены

# Упаковка
- Мешок + скотч — укажите цену
- Картонная коробка — укажите цену
- Деревянная обрешётка — укажите цену

# Советы
- Мелкие посылки отправляйте только на склад в Гуанчжоу.
- Не удаляйте маркировку из адреса — без неё склад не узнает, чья посылка.
- Хрупкие товары просите продавца упаковать надёжнее.
- Сохраняйте трек-номер из заказа, по нему мы ищем посылку.`);
  set.run('about_ru', `# Карго 151
Доставляем грузы из Китая в Казахстан, Кыргызстан и Россию. Свои склады в Гуанчжоу и Иу.
(Заполните в админке: сколько лет работаете, сроки доставки, контакты, WhatsApp, Instagram.)

# Контакты
- WhatsApp: +86 188 4511 1182
- Instagram: @cargo.151 (instagram.com/cargo.151)
- Пункты выдачи: смотрите в своём городе на странице адреса`);
  set.run('about_zh', `# 151 货运
从中国发货到哈萨克斯坦、吉尔吉斯斯坦和俄罗斯。在广州和义乌设有自有仓库。
（请在后台填写：经营年限、运输时效、联系方式。）

# 联系方式
- WhatsApp：+86 188 4511 1182
- Instagram：@cargo.151`);
  set.run('services_ru', `# Доставка из Китая
Принимаем посылки на склады в Гуанчжоу и Иу и отправляем в ваш город.

# Фулфилмент для маркетплейсов
Работаем с фулфилментом: приёмка, проверка, упаковка и отправка на Wildberries, Kaspi, Ozon.

# Помощь с оплатой
Поможем оплатить заказ на 1688, Taobao, Pinduoduo, если у вас нет китайской карты.

# Выкуп и поиск товара
Найдём поставщика и выкупим товар за вас.

# Упаковка
Мешок, коробка, деревянная обрешётка — цены в разделе «Полезно знать».`);
  set.run('services_zh', `# 中国发货
在广州和义乌仓库收货，发往您所在的城市。

# 电商平台履约
提供履约服务：收货、验货、包装并发往 Wildberries、Kaspi、Ozon。

# 代付
没有中国银行卡？我们帮您支付 1688、淘宝、拼多多订单。

# 代购和找货
帮您寻找供应商并代为采购。

# 包装
编织袋、纸箱、木架 — 价格见「须知」。`);
  set.run('info_zh', `# 中国节假日
节假日期间，商家、快递和仓库速度变慢，发货可能延误。每年具体日期不同。
- 元旦 — 1月1日
- 春节 — 1月底或2月，很多工厂和商家停工1–2周
- 清明节 — 4月初
- 劳动节 — 5月1–5日
- 端午节 — 6月
- 中秋节 — 9月
- 国庆节 — 10月1–7日
- 双11、618 — 大促期间快递爆仓

# 包装
- 编织袋 + 胶带 — 请填写价格
- 纸箱 — 请填写价格
- 木架 — 请填写价格

# 小贴士
- 小件包裹只能寄到广州仓。
- 请勿删除地址中的唛头，否则仓库无法识别包裹。
- 易碎品请让商家加固包装。
- 请保存订单中的快递单号，我们凭单号查找包裹。`);
}
seed();

function setting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : '';
}

// Оставляет только цифры; казахстанский/российский формат 8XXXXXXXXXX приводится к 7XXXXXXXXXX.
function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '8' ? '7' + d.slice(1) : d;
}

// Код клиента — сквозной номер, начиная с CODE_START (по умолчанию 1600).
function nextClientCode() {
  const start = parseInt(setting('code_start') || '1600', 10);
  const max = db.prepare("SELECT MAX(CAST(code AS INTEGER)) m FROM clients WHERE code GLOB '[0-9]*'").get().m;
  return String(Math.max(start, (max || 0) + 1));
}

// Маркировка для склада: шаблон вроде D{code}-{last4}.
function shippingMark(template, client) {
  const last4 = normPhone(client.phone).slice(-4);
  return String(template || 'D{code}-{last4}').replace('{code}', client.code).replace('{last4}', last4);
}

function addEvent(parcelId, status, comment = '') {
  db.prepare('INSERT INTO parcel_events (parcel_id, status, comment) VALUES (?, ?, ?)').run(parcelId, status, comment);
}

// Создаёт или обновляет посылку по трек-коду; новый статус пишется в историю.
function upsertParcel({ track, clientCode, weight, places, description, status }) {
  track = String(track || '').trim();
  if (!track) return null;
  status = STATUSES[status] ? status : statusFromText(status) || 'china';
  const code = clientCode ? String(clientCode).trim().toUpperCase() : null;
  const client = code ? db.prepare('SELECT id FROM clients WHERE code = ?').get(code) : null;
  const existing = db.prepare('SELECT * FROM parcels WHERE track = ?').get(track);
  if (existing) {
    db.prepare(`UPDATE parcels SET client_id = COALESCE(?, client_id), client_code = COALESCE(?, client_code),
      weight = COALESCE(?, weight), places = COALESCE(?, places), description = COALESCE(?, description),
      status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(client ? client.id : null, code, numOrNull(weight), numOrNull(places), description || null, status, existing.id);
    if (existing.status !== status) addEvent(existing.id, status);
    return existing.id;
  }
  const r = db.prepare(`INSERT INTO parcels (track, client_id, client_code, weight, places, description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(track, client ? client.id : null, code, numOrNull(weight) || 0, numOrNull(places) || 1, description || '', status);
  addEvent(r.lastInsertRowid, status);
  return r.lastInsertRowid;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function statusFromText(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const [k, v] of Object.entries(STATUSES)) if (t === k || t === v.toLowerCase()) return k;
  if (t.includes('китай') || t.includes('склад')) return 'china';
  if (t.includes('пути')) return 'transit';
  if (t.includes('границ') || t.includes('тамож')) return 'border';
  if (t.includes('прибыл')) return 'arrived';
  if (t.includes('выдан')) return 'delivered';
  return null;
}

// Связывает посылки без клиента, если клиент зарегистрировался позже.
function linkOrphanParcels(clientId, code) {
  db.prepare('UPDATE parcels SET client_id = ? WHERE client_id IS NULL AND client_code = ?').run(clientId, code);
}

module.exports = { db, STATUSES, setting, normPhone, nextClientCode, shippingMark, upsertParcel, addEvent, numOrNull, linkOrphanParcels };
