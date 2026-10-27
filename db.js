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
CREATE TABLE IF NOT EXISTS invoice_photos (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  file TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY,
  text_ru TEXT NOT NULL,
  text_zh TEXT DEFAULT '',
  text_kk TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS forward_requests (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  city TEXT NOT NULL,
  method TEXT DEFAULT '',
  receiver TEXT DEFAULT '',
  receiver_phone TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  pw TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS parcel_photos (
  id INTEGER PRIMARY KEY,
  parcel_id INTEGER NOT NULL REFERENCES parcels(id),
  file TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Оплаты по накладной: можно частями. method 'auto' — остаток, записанный кнопкой «Оплачено».
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  method TEXT DEFAULT '',
  note TEXT DEFAULT '',
  staff TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS payments_inv ON payments(invoice_id);
-- Журнал: кто и что сделал в админке.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT DEFAULT (datetime('now')),
  staff TEXT DEFAULT '',
  role TEXT DEFAULT '',
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT ''
);
`);

// Колонки, добавленные после первой версии: досоздаём в старых базах.
for (const [table, col, def] of [
  ['warehouses', 'name_template', "TEXT NOT NULL DEFAULT '{mark}'"],
  ['warehouses', 'note_ru', "TEXT DEFAULT ''"],
  ['warehouses', 'note_zh', "TEXT DEFAULT ''"],
  ['warehouses', 'hours_ru', "TEXT DEFAULT 'Ежедневно, без выходных, 09:00–20:00'"],
  ['warehouses', 'hours_zh', "TEXT DEFAULT '每天营业，无休息日，09:00–20:00'"],
  // Накладная в формате бумажной 货运单: rate = цена за ед., total_weight = вес, amount = итог, note = замечание.
  ...['origin', 'destination', 'transport', 'delivery_time', 'sender', 'consignee', 'goods', 'packing', 'inv_date']
    .map((c) => ['invoices', c, "TEXT DEFAULT ''"]),
  ['invoices', 'price_basis', "TEXT DEFAULT 'm3'"],
  ['invoices', 'cargo_status', "TEXT DEFAULT ''"],
  // Где груз по накладной: transit → border → arrived → delivered (клиент видит в «Отследить»).
  ['invoices', 'inv_status', "TEXT DEFAULT 'transit'"],
  ['invoices', 'pay_note', "TEXT DEFAULT ''"],
  // Клиенты со старым кодом (D185, Y58…), добавленные вручную: не сдвигают нумерацию новых кодов.
  ['clients', 'legacy', 'INTEGER DEFAULT 0'],
  // Приёмка на складе: ссылка на фото для клиента, когда отправили в WhatsApp, на каком складе.
  ['parcels', 'photo_token', 'TEXT'],
  ['parcels', 'wa_sent_at', 'TEXT'],
  ['parcels', 'warehouse_id', 'INTEGER'],
  // Фото из файла сканера: хэш, чтобы повторная загрузка не дублировала; время скана на складе.
  ['parcel_photos', 'hash', 'TEXT'],
  // Номер коробки (2 из 10): на одну коробку храним одно фото, повторный скан её не дублирует.
  ['parcel_photos', 'box', 'INTEGER'],
  ['parcels', 'scanned_at', 'TEXT'],
  ['invoices', 'pieces', 'INTEGER DEFAULT 0'],
  ...['volume', 'freight', 'goods_value', 'ins_rate', 'ins_fee', 'pack_fee', 'advance', 'unload_fee', 'other_fee']
    .map((c) => ['invoices', c, 'REAL DEFAULT 0']),
  // Заметки для сотрудников (клиент не видит) и когда груз прибыл / выдан — для сводки.
  ['clients', 'note', "TEXT DEFAULT ''"],
  ['invoices', 'staff_note', "TEXT DEFAULT ''"],
  ['invoices', 'arrived_at', 'TEXT'],
  ['invoices', 'delivered_at', 'TEXT'],
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
// Дата прибытия и выдачи ставится сама, когда статус накладной становится «Прибыло» / «Выдано».
for (const ev of ['INSERT', 'UPDATE OF inv_status']) {
  db.exec(`CREATE TRIGGER IF NOT EXISTS inv_stage_${ev.split(' ')[0].toLowerCase()} AFTER ${ev} ON invoices WHEN NEW.inv_status IN ('arrived', 'delivered') BEGIN
    UPDATE invoices SET arrived_at = COALESCE(arrived_at, datetime('now')), delivered_at = CASE WHEN NEW.inv_status = 'delivered' THEN COALESCE(delivered_at, datetime('now')) ELSE delivered_at END WHERE id = NEW.id; END`);
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
  const cities = [['Алматы', 'ALA'], ['Москва', 'MSK'], ['Бишкек', 'BSK']];
  const ins = db.prepare('INSERT INTO cities (name, prefix, pickup_address) VALUES (?, ?, ?)');
  for (const [name, prefix] of cities) ins.run(name, prefix, `${name}, адрес пункта выдачи (заполните в админке)`);
  const wh = db.prepare('INSERT INTO warehouses (name_ru, name_zh, receiver, phone, address, note_ru, note_zh) VALUES (?, ?, ?, ?, ?, ?, ?)');
  wh.run('Гуанчжоу', '广州', '乌莉亚', '18038711151', '广东省佛山市南海区里水镇广物汽贸广佛汽车城B区B07-1号151库房',
    '', '');
  wh.run('Иу', '义乌', '乌丽亚娜', '18606567151', '浙江省金华市义乌市后宅街道群英路2号，恒泰胶带厂院内151库',
    '', '');
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
Можем дополнительно упаковать груз на складе. Стоимость зависит от размера, уточняйте в WhatsApp.
- Мешок + скотч
- Картонная коробка
- Деревянная обрешётка для хрупкого

# Советы
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
Мешок, коробка, деревянная обрешётка. Стоимость уточняйте в WhatsApp.`);
  set.run('services_zh', `# 中国发货
在广州和义乌仓库收货，发往您所在的城市。

# 电商平台履约
提供履约服务：收货、验货、包装并发往 Wildberries、Kaspi、Ozon。

# 代付
没有中国银行卡？我们帮您支付 1688、淘宝、拼多多订单。

# 代购和找货
帮您寻找供应商并代为采购。

# 包装
编织袋、纸箱、木架，价格请通过 WhatsApp 咨询。`);
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
仓库可提供加固包装，价格按尺寸计算，请通过 WhatsApp 咨询。
- 编织袋 + 胶带
- 纸箱
- 易碎品打木架

# 小贴士
- 请勿删除地址中的唛头，否则仓库无法识别包裹。
- 易碎品请让商家加固包装。
- 请保存订单中的快递单号，我们凭单号查找包裹。`);
}
seed();

// Настройки, появившиеся позже: в старых базах дописываем, не трогая уже заполненные.
{
  const def = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  def.run('wa_arrival_ru', 'Здравствуйте, {name}! Ваша посылка {mark} прибыла на склад {warehouse}. Мест: {places}{weight}. Фото: {link}');
  def.run('wa_arrival_zh', '您好，{name}！您的包裹 {mark} 已到达{warehouse}仓库。件数：{places}{weight}。照片：{link}');
  def.run('promo_title_ru', 'Не получается оплатить поставщику?');
  def.run('promo_text_ru', 'Оплатим заказ на 1688, Taobao, Pinduoduo, пополним Alipay и WeChat в юанях. Напишите — поможем.');
  def.run('promo_title_zh', '无法付款给供应商？');
  def.run('promo_text_zh', '我们帮您支付 1688、淘宝、拼多多订单，充值支付宝和微信人民币。');
  // Страница «Страховка» — по пунктам 4–7 правил накладной; меняется в настройках.
  def.run('insurance_ru', `# Страхование груза
Страховка защищает от полной утери груза в пути. Оформляется до отправки: сообщите менеджеру стоимость товара.

# Когда страховка нужна
- Если стоимость товара больше 5 $ за кг в коробке — страхование обязательно.
- Без страховки компенсация за утерю, конфискацию или изъятие такого груза не выплачивается.
- Сообщить стоимость и решить, страховать ли груз, — ответственность клиента.

# Что получите при утере
- Застрахованный груз — по страховой сумме, которую вы указали.
- Незастрахованный груз (стоимостью до 5 $/кг) — 3 $/кг по ЖД и 5 $/кг для авто.

# Что страховка не покрывает
- Повреждения, дефекты и недостачу — только полную утерю.
- Повреждения при досмотре таможней.

# Сколько стоит
Процент страховки зависит от товара. Напишите нам в WhatsApp до отправки — посчитаем.`);
  def.run('insurance_zh', `# 货物保险
保险保障运输途中货物全部丢失。请在发货前向客服告知货值。

# 何时需要保险
- 每箱货值超过 5 美元/公斤时必须投保。
- 未告知货值且未投保的，丢失、没收或扣押不予赔偿。
- 告知货值和决定是否投保由客户负责。

# 丢失如何赔偿
- 已投保：按申报的保险金额赔偿。
- 未投保（货值 5 美元/公斤以内）：铁路 3 美元/公斤，汽运 5 美元/公斤。

# 不在保障范围
- 损坏、瑕疵、短少 — 仅保障全部丢失。
- 海关查验造成的损坏。

# 费用
保险费率视货物而定，请发货前通过 WhatsApp 咨询。`);
  def.run('invoice_company', '义乌市坦达供应链管理有限公司');
  def.run('invoice_title', '151库 Cargo');
  def.run('invoice_rules', `ПРАВИЛА ОТПРАВКИ ГРУЗОВ ИЗ КИТАЯ
1. К перевозке по всем видам транспорта не принимаются: оружие, боеприпасы, товары, нарушающие права интеллектуальной собственности, жидкости, газы, токсичные и легковоспламеняющиеся вещества и предметы.
2. Пожалуйста, предоставляйте точное название продукта, количество и прочую информацию до отправки.
3. Указывайте достоверное наименование груза. В случае расхождения с фактическим содержимым клиент несёт ответственность за возможные таможенные штрафы.
4. Если фактическая стоимость товара превышает 5 $/кг за одну коробку, клиент обязан заранее уведомить компанию о стоимости товара и оформить страхование груза. В случае отсутствия уведомления и страхования компенсация за утерю, конфискацию или изъятие груза не выплачивается. Компания не обязана самостоятельно определять фактическую стоимость товара. Ответственность за уведомление о стоимости и принятие решения о страховании полностью лежит на клиенте.
5. В случае утери груза: застрахованные товары возмещаются по указанной страховой сумме; незастрахованные товары возмещаются по тарифу 3 $/кг для ЖД и 5 $/кг для авто доставки (только для товаров стоимостью до 5 $/кг).
6. Страховка покрывает только полную утерю груза и не распространяется на повреждения, дефекты или недостачи.
7. По вопросам страхового коэффициента обязательно проконсультируйтесь заранее.
8. В случае таможенного закрытия или официальных праздников срок доставки может быть продлён.
9. При получении товара на месте клиент обязан проверить целостность и количество. В случае повреждения упаковки или недостачи необходимо немедленно сообщить на складе.
10. Если клиент уходит, не проверив товар, и позже заявляет о проблемах, компания ответственности не несёт.
11. За повреждения, вызванные действиями таможенных органов, компания ответственности не несёт.
12. Если клиент не забирает груз в день уведомления о его поступлении на склад, компания оставляет за собой право взимать плату за хранение.
13. В случае несоответствия количества или повреждения товара все вопросы решаются непосредственно на складе до ухода клиента. После этого претензии не принимаются.
14. Если клиент самостоятельно выбрал упаковку и товар прибыл с повреждениями вследствие данного выбора, компания ответственности не несёт.
15. Если вы получили это сообщение с данными правилами — это означает, что вы ознакомлены и согласны со всеми вышеуказанными условиями. Пожалуйста, внимательно ознакомьтесь.
16. Тариф на доставку может изменяться. Ранее действовавшая цена не является фиксированной и не гарантируется для последующих заказов. Окончательная стоимость устанавливается компанией Карго 151.`);
}

function setting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : '';
}

// Оставляет только цифры; казахстанский/российский формат 8XXXXXXXXXX приводится к 7XXXXXXXXXX.
function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1);
  if (d.length === 10 && d[0] === '7') return '7' + d; // 747 123 45 67 без +7
  return d;
}

// Код клиента — сквозной номер, начиная с CODE_START (по умолчанию 1600).
function nextClientCode() {
  const start = parseInt(setting('code_start') || '1600', 10);
  const max = db.prepare("SELECT MAX(CAST(code AS INTEGER)) m FROM clients WHERE code GLOB '[0-9]*' AND legacy = 0").get().m;
  let n = Math.max(start, (max || 0) + 1);
  while (db.prepare('SELECT 1 FROM clients WHERE code = ?').get(String(n))) n++;
  return String(n);
}

// Маркировка для склада: шаблон вроде D{code}-{last4}.
// Коды клиентов в базе: «1600» — это D1600 (буква D не хранится), «#9455» — код из одних цифр без буквы,
// «Y15», «X40», «AB016» — как есть. dispCode показывает код так, как его пишут люди.
const dispCode = (code) => { const c = String(code || ''); return c.startsWith('#') ? c.slice(1) : /^\d/.test(c) ? `D${c}` : c; };
// Из того, что написали в Excel или в форме: D1600 → 1600, 9455 → #9455, y15 → Y15.
const codeKey = (raw) => { const c = String(raw || '').trim().toUpperCase().replace(/\s+/g, ''); return /^D\d/.test(c) ? c.slice(1) : /^\d/.test(c) ? `#${c}` : c; };

function shippingMark(template, client) {
  const last4 = normPhone(client.phone).slice(-4);
  const code = String(client.code || '');
  return String(template || 'D{code}-{last4}').replace('D{code}', dispCode(code)).replace('{code}', code.replace(/^#/, '')).replace('{last4}', last4);
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

module.exports = { dispCode, codeKey, db, STATUSES, setting, normPhone, nextClientCode, shippingMark, upsertParcel, addEvent, numOrNull, linkOrphanParcels };
