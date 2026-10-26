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
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const wh = db.prepare('INSERT INTO warehouses (name_ru, name_zh, receiver, phone, address) VALUES (?, ?, ?, ?, ?)');
  wh.run('Гуанчжоу', '广州', '乌莉亚', '18038711151', '广东省 佛山市 南海区 里水镇广物汽贸广佛汽车城B区B07-1 号 151 库房入仓');
  db.prepare('INSERT INTO warehouses (name_ru, name_zh, receiver, phone, address, mark_template) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Иу', '义乌', '乌丽亚娜', '18606567151', '浙江省金华市义乌市后宅街道群英路2号，恒泰胶带厂院内151库', 'D{code}-{last4}');
  set.run('rate_per_kg', '4');
  set.run('code_start', '1600');
  set.run('currency', '$');
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
