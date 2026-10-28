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
  mark_template TEXT NOT NULL DEFAULT 'D{code}-{last4}-{city}',
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
CREATE TABLE IF NOT EXISTS team (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role_ru TEXT DEFAULT '',
  role_zh TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  sort INTEGER DEFAULT 0
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
-- Расходы по накладной: например, сами довезли бесплатно ($31) — с примечанием и датой.
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  note TEXT DEFAULT '',
  spent_on TEXT,
  staff TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
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
  ['invoices', 'staff_note_by', "TEXT DEFAULT ''"],
  ['invoices', 'staff_note_at', 'TEXT'],
  // «В долг»: отдали груз без оплаты — это и есть долг (просто неоплаченное долгом не считаем).
  ['invoices', 'credit', 'INTEGER DEFAULT 0'],
  // Оплата: в какой день реально приняли (бухгалтер вносит позже по чату), валюта и курс, если в юанях.
  ['payments', 'paid_on', 'TEXT'],
  ['payments', 'currency', "TEXT DEFAULT 'USD'"],
  ['payments', 'amount_orig', 'REAL'],
  ['payments', 'rate', 'REAL'],
  ['invoices', 'credit_at', 'TEXT'],
  ['invoices', 'credit_by', "TEXT DEFAULT ''"],
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
В эти дни магазины, курьерские службы и склады работают медленнее, отправка может задержаться. Точные даты каждый год разные.
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

# Как подписать посылку
Каждая посылка должна быть подписана вашим кодом. Без кода мы не узнаем, чей это товар, и посылка останется на складе без хозяина.
- Возьмите адрес на странице «Адрес склада»: в нём уже есть ваша маркировка с кодом. Копируйте адрес целиком, ничего не удаляя.
- В имени получателя и в адресе маркировка должна остаться, например D1600-1234.
- Попросите продавца написать ваш код прямо на коробке, маркером или наклейкой.
- Заказываете у завода или поставщика? Отправьте им адрес целиком и попросите подписать каждую коробку вашим кодом.
- После отправки добавьте трек-номер в личном кабинете — так мы быстрее найдём посылку.

# Что нельзя отправлять
Эти товары не пропускают через границу. Сомневаетесь — напишите нам до покупки.
- Оружие, его части, патроны, электрошокеры
- Взрывчатые и горючие вещества: бензин, газ, баллончики, фейерверки, зажигалки с газом
- Наркотики, психотропные и сильнодействующие лекарства
- Яды, кислоты, радиоактивные и едкие химикаты
- Деньги, ценные бумаги, золото и драгоценные камни
- Живые животные, растения и семена
- Скоропортящиеся продукты

Только после согласования с нами (могут не пропустить или нужна особая отправка):
- Аккумуляторы, пауэрбанки и техника со встроенной батареей
- Жидкости, гели, порошки, косметика, парфюм
- Магниты, ножи, лекарства, бренды

# Как считается цена: по весу или по кубу
Мы смотрим на плотность груза: делим вес на объём.
- Плотность 100 кг/м³ и больше — груз тяжёлый, считаем по весу ($/кг)
- Плотность меньше 100 кг/м³ — груз лёгкий и объёмный, считаем по кубу ($/м³)

Пример 1. Одежда: 30 кг, 0,5 м³. Плотность 30 ÷ 0,5 = 60 кг/м³ — меньше 100, цена по кубу.
Пример 2. Автозапчасти: 80 кг, 0,2 м³. Плотность 80 ÷ 0,2 = 400 кг/м³ — больше 100, цена по весу.
Так считают все карго: лёгкий, но большой груз занимает в машине много места.

# Советы
- Не удаляйте маркировку из адреса — без неё склад не узнает, чья посылка.
- Хрупкие товары просите продавца упаковать надёжнее.
- Сохраняйте трек-номер из заказа, по нему мы ищем посылку.`);
  set.run('about_ru', `# Карго 151
Больше 15 лет доставляем грузы из Китая в СНГ: Казахстан, Кыргызстан, Россия.

# В цифрах
- 15+ лет — из Китая в СНГ
- 10+ — сотрудников
- 2 склада — свои, в Иу и Гуанчжоу
- 3 страны — Казахстан, Кыргызстан, Россия

# Почему выбирают нас
- 🏭 Свои склады в Китае — Иу и Гуанчжоу. Сами принимаем, проверяем, храним и упаковываем.
- 🗣️ Говорим по-русски — Ульяна и команда на складе ответят на вопросы и помогут с поставщиком.
- 🌍 Опыт по всему СНГ — Казахстан, Кыргызстан и Россия. Много лет возим грузы в Москву.
- 🤝 Нам доверяют — Крупные блогеры, бренды Казахстана и фулфилмент для Kaspi.
- 💳 Оплатим поставщику — От физлица или юрлица, из России или Казахстана: переводом или наличными в Алматы и Москве, в ₸, ₽ или $.
- ✈️ Есть авиадоставка — Алматы 3–5 дней, Москва 3–8 дней.

# Контакты
- 💬 WhatsApp — +86 188 4511 1182
- 📷 Instagram — @cargo.151`);
  set.run('about_zh', `# 151 货运
15年以上从中国发货到独联体国家：哈萨克斯坦、吉尔吉斯斯坦、俄罗斯。

# 数字
- 15+ 年 — 中国到独联体
- 10+ — 员工
- 2 个仓库 — 义乌和广州自有仓库
- 3 个国家 — 哈萨克斯坦、吉尔吉斯斯坦、俄罗斯

# 为什么选择我们
- 🏭 中国自有仓库 — 义乌和广州。我们自己收货、验货、存储和包装。
- 🗣️ 会说俄语 — Ульяна 和仓库团队会解答问题，帮您联系供应商。
- 🌍 独联体经验丰富 — 哈萨克斯坦、吉尔吉斯斯坦和俄罗斯，多年发货到莫斯科。
- 🤝 值得信赖 — 大博主、哈萨克斯坦品牌和 Kaspi 履约合作伙伴。
- 💳 代付给供应商 — 个人或公司，从俄罗斯或哈萨克斯坦：转账或在阿拉木图、莫斯科付现金，坚戈、卢布或美元。
- ✈️ 空运 — 阿拉木图 3–5 天，莫斯科 3–8 天。

# 联系方式
- 💬 WhatsApp — +86 188 4511 1182
- 📷 Instagram — @cargo.151`);
  set.run('services_ru', `# 🚚 Доставка из Китая
В Казахстан, Кыргызстан и Россию. Принимаем на свои склады в Иу и Гуанчжоу.
- от 20 кг

# ✈️ Авиадоставка
Когда нужно срочно.
- Алматы 3–5 дней
- Москва 3–8 дней

# 💳 Оплата поставщику
Оплатим ваш товар в Китае и привезём его в вашу страну. 1688, Taobao, Pinduoduo, заводы и поставщики — и мелкие, и крупные закупки.
Платить можно от физлица или юрлица, из России или Казахстана, любым удобным способом.
- от физлица и юрлица
- перевод
- наличные в Алматы и Москве
- ₸ ₽ $

# 📦 Фулфилмент и Kaspi
Партнёр в Казахстане примет товар и отправит на Kaspi. Для наших клиентов выгодные условия.

# 🔎 Поиск и выкуп товара
Найдём поставщика, проверим товар и выкупим за вас.

# 🎁 Упаковка
Мешок, коробка или деревянная обрешётка для хрупкого.

# 🛡️ Страхование груза
Спокойно отправляйте дорогой товар.`);
  set.run('services_zh', `# 🚚 中国发货
发往哈萨克斯坦、吉尔吉斯斯坦和俄罗斯。在义乌和广州自有仓库收货。
- 20 公斤起

# ✈️ 空运
急件首选。
- 阿拉木图 3–5 天
- 莫斯科 3–8 天

# 💳 代付给供应商
我们在中国帮您付款，并把货物运到您的国家。1688、淘宝、拼多多、工厂和供应商，小额大额采购都可以。
个人或公司、从俄罗斯或哈萨克斯坦，任何方便的方式都可以付款。
- 个人和公司
- 转账
- 阿拉木图和莫斯科现金
- ₸ ₽ $

# 📦 履约和 Kaspi
哈萨克斯坦合作伙伴收货并发往 Kaspi，我们的客户享受优惠条件。

# 🔎 找货和代购
帮您找供应商、验货并代为采购。

# 🎁 包装
编织袋、纸箱，易碎品可打木架。

# 🛡️ 货物保险
贵重货物放心发。`);
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

# 如何标记包裹
每个包裹都必须写上您的客户编码（唛头）。没有编码我们无法知道是谁的货，包裹会一直无人认领。
- 在「仓库地址」页面复制地址：地址里已经包含您的唛头，请完整复制，不要删除。
- 收件人姓名和地址里必须保留唛头，例如 D1600-1234。
- 请卖家在箱子上直接写上您的编码（记号笔或贴纸）。
- 从工厂或供应商订货？请把完整地址发给他们，并要求每个箱子都写上您的编码。
- 发货后在个人中心添加快递单号，我们能更快找到包裹。

# 禁运物品
以下物品无法通关。不确定的话请在购买前咨询我们。
- 武器及配件、子弹、电击器
- 易燃易爆物品：汽油、气体、喷雾罐、烟花、充气打火机
- 毒品、精神类及管制药品
- 有毒化学品、酸类、放射性及腐蚀性物品
- 现金、有价证券、黄金及宝石
- 活体动物、植物和种子
- 易腐食品

需提前与我们确认（可能无法通关或需特殊渠道）：
- 电池、充电宝及内置电池的电器
- 液体、膏体、粉末、化妆品、香水
- 磁铁、刀具、药品、品牌货

# 运费怎么算：按重量还是按体积
我们看货物密度：重量 ÷ 体积。
- 密度 ≥ 100 公斤/立方：重货，按重量计费（$/公斤）
- 密度 < 100 公斤/立方：轻泡货，按体积计费（$/立方）

例 1：衣服 30 公斤，0.5 立方。密度 30 ÷ 0.5 = 60，小于 100，按体积。
例 2：汽车配件 80 公斤，0.2 立方。密度 80 ÷ 0.2 = 400，大于 100，按重量。
所有货运都这样算：轻泡货在车里占的空间大。

# 小贴士
- 请勿删除地址中的唛头，否则仓库无法识别包裹。
- 易碎品请让商家加固包装。
- 请保存订单中的快递单号，我们凭单号查找包裹。`);
}
seed();

// Настройки, появившиеся позже: в старых базах дописываем, не трогая уже заполненные.
{
  const def = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  def.run('cny_rate', '7.2');
  def.run('wa_arrival_ru', 'Здравствуйте, {name}! Ваша посылка {mark} прибыла на склад {warehouse}. Мест: {places}{weight}. Фото: {link}');
  def.run('wa_arrival_zh', '您好，{name}！您的包裹 {mark} 已到达{warehouse}仓库。件数：{places}{weight}。照片：{link}');
  def.run('promo_title_ru', 'Оплатим ваш заказ в Китае за вас');
  def.run('promo_text_ru', 'Нет китайской карты? Оплатим в юанях заказ на 1688, Taobao, Pinduoduo, а также вашему заводу или поставщику — и мелкие, и крупные закупки.');
  def.run('promo_title_zh', '我们帮您在中国付款');
  def.run('promo_text_zh', '没有中国银行卡？我们用人民币帮您支付 1688、淘宝、拼多多订单，也可以直接付款给工厂或供应商，小额大额采购都可以。');
  // Опечатка в «Полезно знать»: китайское слово посреди русского текста.
  db.prepare("UPDATE settings SET value = replace(value, 'магазины,快递 и склады', 'магазины, курьерские службы и склады') WHERE key = 'info_ru'").run();
  // Новые разделы «Полезно знать» (запрещённое, вес/куб) дописываем в уже сохранённый текст — перед «Советы» или в конец.
  for (const [key, mark, tips, add] of [['info_ru', '# Что нельзя отправлять', '# Советы', `# Что нельзя отправлять
Эти товары не пропускают через границу. Сомневаетесь — напишите нам до покупки.
- Оружие, его части, патроны, электрошокеры
- Взрывчатые и горючие вещества: бензин, газ, баллончики, фейерверки, зажигалки с газом
- Наркотики, психотропные и сильнодействующие лекарства
- Яды, кислоты, радиоактивные и едкие химикаты
- Деньги, ценные бумаги, золото и драгоценные камни
- Живые животные, растения и семена
- Скоропортящиеся продукты

Только после согласования с нами (могут не пропустить или нужна особая отправка):
- Аккумуляторы, пауэрбанки и техника со встроенной батареей
- Жидкости, гели, порошки, косметика, парфюм
- Магниты, ножи, лекарства, бренды

# Как считается цена: по весу или по кубу
Мы смотрим на плотность груза: делим вес на объём.
- Плотность 100 кг/м³ и больше — груз тяжёлый, считаем по весу ($/кг)
- Плотность меньше 100 кг/м³ — груз лёгкий и объёмный, считаем по кубу ($/м³)

Пример 1. Одежда: 30 кг, 0,5 м³. Плотность 30 ÷ 0,5 = 60 кг/м³ — меньше 100, цена по кубу.
Пример 2. Автозапчасти: 80 кг, 0,2 м³. Плотность 80 ÷ 0,2 = 400 кг/м³ — больше 100, цена по весу.
Так считают все карго: лёгкий, но большой груз занимает в машине много места.

`], ['info_zh', '# 禁运物品', '# 小贴士', `# 禁运物品
以下物品无法通关。不确定的话请在购买前咨询我们。
- 武器及配件、子弹、电击器
- 易燃易爆物品：汽油、气体、喷雾罐、烟花、充气打火机
- 毒品、精神类及管制药品
- 有毒化学品、酸类、放射性及腐蚀性物品
- 现金、有价证券、黄金及宝石
- 活体动物、植物和种子
- 易腐食品

需提前与我们确认（可能无法通关或需特殊渠道）：
- 电池、充电宝及内置电池的电器
- 液体、膏体、粉末、化妆品、香水
- 磁铁、刀具、药品、品牌货

# 运费怎么算：按重量还是按体积
我们看货物密度：重量 ÷ 体积。
- 密度 ≥ 100 公斤/立方：重货，按重量计费（$/公斤）
- 密度 < 100 公斤/立方：轻泡货，按体积计费（$/立方）

例 1：衣服 30 公斤，0.5 立方。密度 30 ÷ 0.5 = 60，小于 100，按体积。
例 2：汽车配件 80 公斤，0.2 立方。密度 80 ÷ 0.2 = 400，大于 100，按重量。
所有货运都这样算：轻泡货在车里占的空间大。

`]]) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && !row.value.includes(mark)) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(row.value.includes(tips) ? row.value.replace(tips, add + tips) : `${row.value.trimEnd()}\n\n${add.trimEnd()}`, key);
  }
  // Раздел «Как подписать посылку» — перед «Что нельзя отправлять» (или «Советы»), иначе в конец.
  for (const [key, mark, before, add] of [['info_ru', '# Как подписать посылку', ['# Что нельзя отправлять', '# Советы'], `# Как подписать посылку
Каждая посылка должна быть подписана вашим кодом. Без кода мы не узнаем, чей это товар, и посылка останется на складе без хозяина.
- Возьмите адрес на странице «Адрес склада»: в нём уже есть ваша маркировка с кодом. Копируйте адрес целиком, ничего не удаляя.
- В имени получателя и в адресе маркировка должна остаться, например D1600-1234.
- Попросите продавца написать ваш код прямо на коробке, маркером или наклейкой.
- Заказываете у завода или поставщика? Отправьте им адрес целиком и попросите подписать каждую коробку вашим кодом.
- После отправки добавьте трек-номер в личном кабинете — так мы быстрее найдём посылку.

`], ['info_zh', '# 如何标记包裹', ['# 禁运物品', '# 小贴士'], `# 如何标记包裹
每个包裹都必须写上您的客户编码（唛头）。没有编码我们无法知道是谁的货，包裹会一直无人认领。
- 在「仓库地址」页面复制地址：地址里已经包含您的唛头，请完整复制，不要删除。
- 收件人姓名和地址里必须保留唛头，例如 D1600-1234。
- 请卖家在箱子上直接写上您的编码（记号笔或贴纸）。
- 从工厂或供应商订货？请把完整地址发给他们，并要求每个箱子都写上您的编码。
- 发货后在个人中心添加快递单号，我们能更快找到包裹。

`]]) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row || row.value.includes(mark)) continue;
    const at = before.find((b) => row.value.includes(b));
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(at ? row.value.replace(at, add + at) : `${row.value.trimEnd()}\n\n${add.trimEnd()}`, key);
  }
  // Старый текст плашки (с Alipay/WeChat) меняем на новый, если его не правили в настройках.
  const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?');
  upd.run('Оплатим ваш заказ в Китае за вас', 'promo_title_ru', 'Не получается оплатить поставщику?');
  upd.run('Нет китайской карты? Оплатим в юанях заказ на 1688, Taobao, Pinduoduo, а также вашему заводу или поставщику — и мелкие, и крупные закупки.', 'promo_text_ru', 'Оплатим заказ на 1688, Taobao, Pinduoduo, пополним Alipay и WeChat в юанях. Напишите — поможем.');
  upd.run('我们帮您在中国付款', 'promo_title_zh', '无法付款给供应商？');
  upd.run('没有中国银行卡？我们用人民币帮您支付 1688、淘宝、拼多多订单，也可以直接付款给工厂或供应商，小额大额采购都可以。', 'promo_text_zh', '我们帮您支付 1688、淘宝、拼多多订单，充值支付宝和微信人民币。');
  // Коды из одних цифр, которые до 27.10 заводились без «#» и показывались как D2838 вместо 2838.
  // Узнаём их по накладным: все номера начинаются с «2838-», а не с «D2838-». Если уже есть правильный клиент #2838 — сливаем.
  for (const c of db.prepare("SELECT * FROM clients WHERE code GLOB '[0-9]*' AND phone LIKE 'stub-%'").all()) {
    const invs = db.prepare('SELECT number FROM invoices WHERE client_id = ?').all(c.id).map((r) => String(r.number));
    const twin = db.prepare('SELECT id FROM clients WHERE code = ?').get(`#${c.code}`);
    const bare = invs.length ? invs.every((n) => n.startsWith(`${c.code}-`)) : !!twin && c.name === `D${c.code}`;
    if (!bare) continue;
    db.exec('BEGIN');
    if (twin) {
      for (const tb of ['invoices', 'parcels', 'forward_requests']) db.prepare(`UPDATE ${tb} SET client_id = ? WHERE client_id = ?`).run(twin.id, c.id);
      db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
    } else {
      db.prepare('UPDATE clients SET code = ?, name = CASE WHEN name = ? THEN ? ELSE name END, phone = ? WHERE id = ?').run(`#${c.code}`, `D${c.code}`, c.code, `stub-#${c.code}`, c.id);
    }
    db.exec('COMMIT');
  }
  // Накладные с кодом через дефис (AM-5250-1025-1), загруженные до 28.10: дата вышла 50.52, клиент — «AM».
  // Берём из номера код AM-5250 и дату 25.10, переносим к нужному клиенту; пустой клиент «AM» удаляем.
  for (const inv of db.prepare("SELECT i.*, c.code ccode, c.phone cphone FROM invoices i JOIN clients c ON c.id = i.client_id WHERE substr(i.inv_date, 6, 2) > '12' OR substr(i.inv_date, 9, 2) > '31'").all()) {
    const m = /^(.+)-(\d{2})(\d{2})-(\d+)$/.exec(String(inv.number || '').trim());
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) continue;
    const code = codeKey(m[1]);
    let y = +String(inv.created_at || '').slice(0, 4) || new Date().getFullYear();
    if (`${y}-${m[2]}-${m[3]}` > String(inv.created_at || '').slice(0, 10)) y--;
    const day = `${y}-${m[2]}-${m[3]}`;
    db.exec('BEGIN');
    let target = db.prepare('SELECT id FROM clients WHERE code = ?').get(code);
    const stubOnly = String(inv.cphone).startsWith('stub-') && !db.prepare('SELECT 1 FROM invoices WHERE client_id = ? AND id != ? AND number NOT LIKE ?').get(inv.client_id, inv.id, `${m[1]}-%`);
    if (!target && stubOnly) { db.prepare('UPDATE clients SET code = ?, name = ?, phone = ? WHERE id = ?').run(code, code, `stub-${code}`, inv.client_id); target = { id: inv.client_id }; }
    if (target) {
      const dup = db.prepare('SELECT id FROM invoices WHERE number = ? AND client_id = ? AND id != ?').get(inv.number, target.id, inv.id);
      if (dup) { for (const tb of ['payments', 'expenses', 'invoice_photos']) db.prepare(`DELETE FROM ${tb} WHERE invoice_id = ?`).run(inv.id); db.prepare('UPDATE parcels SET invoice_id = NULL WHERE invoice_id = ?').run(inv.id); db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id); }
      else db.prepare('UPDATE invoices SET client_id = ?, inv_date = ?, sender = ? WHERE id = ?').run(target.id, day, code, inv.id);
      if (target.id !== inv.client_id && String(inv.cphone).startsWith('stub-') && !db.prepare('SELECT 1 FROM invoices WHERE client_id = ?').get(inv.client_id) && !db.prepare('SELECT 1 FROM parcels WHERE client_id = ?').get(inv.client_id)) db.prepare('DELETE FROM clients WHERE id = ?').run(inv.client_id);
    } else db.prepare('UPDATE invoices SET inv_date = ? WHERE id = ?').run(day, inv.id);
    db.exec('COMMIT');
  }
  // Маркировка с городом в конце: D1566-7741-ALMATY (если шаблон не меняли).
  db.prepare("UPDATE warehouses SET mark_template = 'D{code}-{last4}-{city}' WHERE mark_template = 'D{code}-{last4}'").run();
  // Номера, записанные до новых правил (0555…, 916…, 138…), приводим к международному виду, если такой номер ещё не занят.
  for (const c of db.prepare("SELECT id, phone FROM clients WHERE phone NOT LIKE 'stub-%'").all()) {
    const n = normPhone(c.phone);
    if (n !== c.phone && n.length >= 10 && !db.prepare('SELECT 1 FROM clients WHERE phone = ?').get(n)) db.prepare('UPDATE clients SET phone = ? WHERE id = ?').run(n, c.id);
  }
  // Новые «О нас» и «Услуги» вместо стартовых текстов, если их ещё не меняли в настройках.
  const NEW_TEXT = { about_ru: `# Карго 151
Больше 15 лет доставляем грузы из Китая в СНГ: Казахстан, Кыргызстан, Россия.

# В цифрах
- 15+ лет — из Китая в СНГ
- 10+ — сотрудников
- 2 склада — свои, в Иу и Гуанчжоу
- 3 страны — Казахстан, Кыргызстан, Россия

# Почему выбирают нас
- 🏭 Свои склады в Китае — Иу и Гуанчжоу. Сами принимаем, проверяем, храним и упаковываем.
- 🗣️ Говорим по-русски — Ульяна и команда на складе ответят на вопросы и помогут с поставщиком.
- 🌍 Опыт по всему СНГ — Казахстан, Кыргызстан и Россия. Много лет возим грузы в Москву.
- 🤝 Нам доверяют — Крупные блогеры, бренды Казахстана и фулфилмент для Kaspi.
- 💳 Оплатим поставщику — От физлица или юрлица, из России или Казахстана: переводом или наличными в Алматы и Москве, в ₸, ₽ или $.
- ✈️ Есть авиадоставка — Алматы 3–5 дней, Москва 3–8 дней.

# Контакты
- 💬 WhatsApp — +86 188 4511 1182
- 📷 Instagram — @cargo.151`, about_zh: `# 151 货运
15年以上从中国发货到独联体国家：哈萨克斯坦、吉尔吉斯斯坦、俄罗斯。

# 数字
- 15+ 年 — 中国到独联体
- 10+ — 员工
- 2 个仓库 — 义乌和广州自有仓库
- 3 个国家 — 哈萨克斯坦、吉尔吉斯斯坦、俄罗斯

# 为什么选择我们
- 🏭 中国自有仓库 — 义乌和广州。我们自己收货、验货、存储和包装。
- 🗣️ 会说俄语 — Ульяна 和仓库团队会解答问题，帮您联系供应商。
- 🌍 独联体经验丰富 — 哈萨克斯坦、吉尔吉斯斯坦和俄罗斯，多年发货到莫斯科。
- 🤝 值得信赖 — 大博主、哈萨克斯坦品牌和 Kaspi 履约合作伙伴。
- 💳 代付给供应商 — 个人或公司，从俄罗斯或哈萨克斯坦：转账或在阿拉木图、莫斯科付现金，坚戈、卢布或美元。
- ✈️ 空运 — 阿拉木图 3–5 天，莫斯科 3–8 天。

# 联系方式
- 💬 WhatsApp — +86 188 4511 1182
- 📷 Instagram — @cargo.151`, services_ru: `# 🚚 Доставка из Китая
В Казахстан, Кыргызстан и Россию. Принимаем на свои склады в Иу и Гуанчжоу.
- от 20 кг

# ✈️ Авиадоставка
Когда нужно срочно.
- Алматы 3–5 дней
- Москва 3–8 дней

# 💳 Оплата поставщику
Оплатим ваш товар в Китае и привезём его в вашу страну. 1688, Taobao, Pinduoduo, заводы и поставщики — и мелкие, и крупные закупки.
Платить можно от физлица или юрлица, из России или Казахстана, любым удобным способом.
- от физлица и юрлица
- перевод
- наличные в Алматы и Москве
- ₸ ₽ $

# 📦 Фулфилмент и Kaspi
Партнёр в Казахстане примет товар и отправит на Kaspi. Для наших клиентов выгодные условия.

# 🔎 Поиск и выкуп товара
Найдём поставщика, проверим товар и выкупим за вас.

# 🎁 Упаковка
Мешок, коробка или деревянная обрешётка для хрупкого.

# 🛡️ Страхование груза
Спокойно отправляйте дорогой товар.`, services_zh: `# 🚚 中国发货
发往哈萨克斯坦、吉尔吉斯斯坦和俄罗斯。在义乌和广州自有仓库收货。
- 20 公斤起

# ✈️ 空运
急件首选。
- 阿拉木图 3–5 天
- 莫斯科 3–8 天

# 💳 代付给供应商
我们在中国帮您付款，并把货物运到您的国家。1688、淘宝、拼多多、工厂和供应商，小额大额采购都可以。
个人或公司、从俄罗斯或哈萨克斯坦，任何方便的方式都可以付款。
- 个人和公司
- 转账
- 阿拉木图和莫斯科现金
- ₸ ₽ $

# 📦 履约和 Kaspi
哈萨克斯坦合作伙伴收货并发往 Kaspi，我们的客户享受优惠条件。

# 🔎 找货和代购
帮您找供应商、验货并代为采购。

# 🎁 包装
编织袋、纸箱，易碎品可打木架。

# 🛡️ 货物保险
贵重货物放心发。` };
  for (const [key, old] of [['about_ru', '(Заполните в админке'], ['about_zh', '（请在后台填写'], ['services_ru', '# Доставка из Китая\nПринимаем посылки на склады в Гуанчжоу и Иу'], ['services_zh', '# 中国发货\n在广州和义乌仓库收货']]) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && row.value.includes(old)) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(NEW_TEXT[key], key);
  }
  // Команду заполняет владелец сам; убираем стартовую Ульяну, если её не меняли.
  db.prepare("DELETE FROM team WHERE name = 'Ульяна' AND photo = '' AND role_ru = 'Менеджер, говорит по-русски' AND role_zh = '客服经理，会说俄语'").run();
  db.prepare("DELETE FROM settings WHERE key = 'team_seeded'").run();
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

// Номер в международном виде, только цифры, как бы его ни написали:
// Казахстан/Россия: +7 747…, 8 747…, 747… → 7747…; Россия 916… → 7916…;
// Кыргызстан: 0555 123 456 или 555 123 456 → 996555123456; Китай: 138 1234 5678 → 8613812345678; 00… → без 00.
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1);
  if (d.length === 10 && (d[0] === '7' || d[0] === '9')) return '7' + d; // 747 123 45 67, 916 123 45 67 без +7
  if (d.length === 10 && d[0] === '0') return '996' + d.slice(1); // Кыргызстан: 0555 123 456
  if (d.length === 9 && /^[2-9]/.test(d)) return '996' + d; // Кыргызстан без 0
  if (d.length === 11 && d[0] === '1') return '86' + d; // Китай без +86
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
function codeKey(raw) { const c = String(raw || '').trim().toUpperCase().replace(/\s+/g, ''); return /^D\d/.test(c) ? c.slice(1) : /^\d/.test(c) ? `#${c}` : c; }

function shippingMark(template, client) {
  const last4 = normPhone(client.phone).slice(-4);
  const code = String(client.code || '');
  // {city} — город выдачи латиницей: ALMATY, MOSKVA, BISHKEK; нет города — убираем вместе с дефисом.
  const city = client.city_name ? require('./seo').slug(client.city_name).toUpperCase() : '';
  return String(template || 'D{code}-{last4}-{city}').replace('D{code}', dispCode(code)).replace('{code}', code.replace(/^#/, '')).replace('{last4}', last4)
    .replace(/-?\{city\}/, (m) => (city ? m.replace('{city}', city) : ''));
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
