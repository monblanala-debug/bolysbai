// «Полезно знать» и «О нас»: шапка и раскрывающиеся разделы. Текст из настроек: «# заголовок», «- пункт», абзацы.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Значок раздела подбираем по словам заголовка (ru/zh), иначе ℹ️.
const ICONS = [[/не покрывает|不在保障/i, '⚠️'], [/при утере|丢失/i, '💰'], [/когда страх|何时/i, '❓'], [/сколько стоит|费用/i, '💵'], [/страхован|保险/i, '🛡️'], [/цифр|数字/i, '📊'], [/склад|仓库/i, '🏭'], [/кем работ|合作/i, '🤝'], [/оплат|代付/i, '💳'], [/авиа|空运/i, '✈️'], [/фулфилмент|履约/i, '📦'], [/выкуп|代购/i, '🔎'], [/доставка из|中国发货/i, '🚚'], [/график|营业/i, '🕘'], [/праздник|节假日/i, '📅'], [/упаков|包装/i, '📦'], [/подписать|标记/i, '🏷️'], [/нельзя|禁运/i, '🚫'],
  [/цена|运费/i, '⚖️'], [/совет|贴士/i, '💡'], [/контакт|联系/i, '📞'], [/делаем|服务|услуг/i, '🛠️'], [/выдач|提货|自提/i, '📍'], [/карго|货运|151/i, '🚚']];
const icon = (title) => (ICONS.find(([re]) => re.test(title)) || [0, 'ℹ️'])[1];
const isBan = (title) => /нельзя|禁运/i.test(title);
// «# В цифрах»: пункты «15 лет — опыта в логистике» показываем плитками.
const isStats = (title) => /цифр|数字/i.test(title);
const stats = (s) => `<div class="ab-stats">${s.blocks.flatMap((b) => b.ul || []).map((x) => { const [n, ...r] = x.split(' — '); return `<div><b>${esc(n)}</b><small>${esc(r.join(' — '))}</small></div>`; }).join('')}</div>`;

function parse(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('# ')) { out.push({ title: line.slice(2), blocks: [] }); continue; }
    if (!out.length) out.push({ title: '', blocks: [] });
    const s = out[out.length - 1]; const last = s.blocks[s.blocks.length - 1];
    if (line.startsWith('- ')) { if (last && last.ul) last.ul.push(line.slice(2)); else s.blocks.push({ ul: [line.slice(2)] }); } else s.blocks.push({ p: line });
  }
  return out;
}
// «Гуанчжоу — Ежедневно…»: короткая часть до тире жирным.
const li = (x) => { const m = x.match(/^(.{2,40}?) — (.+)$/); return m ? `<b>${esc(m[1])}</b> — ${esc(m[2])}` : esc(x); };
const body = (s) => s.blocks.map((b) => (b.p ? `<p>${esc(b.p)}</p>` : `<ul class="${isBan(s.title) ? 'ban' : ''}">${b.ul.map((x) => `<li>${li(x)}</li>`).join('')}</ul>`)).join('');

// Первый раздел открыт, остальные свёрнуты; open — все открыты (для «О нас» и «Услуг»), extra — html в конце.
function infoPage(title, sub, sections, { open = false, extra = '' } = {}) {
  return `<div class="iv narrow"><div class="iv-hero"><h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    ${sections.map((s, i) => (isStats(s.title) ? stats(s) : `<details${open || !i ? ' open' : ''}><summary><span class="ic">${icon(s.title)}</span>${esc(s.title)}</summary><div class="in">${body(s)}</div></details>`)).join('')}${extra}</div>`;
}

// Пункт «🏭 Заголовок — текст»: значок в начале, жирная часть до тире.
const EMOJI = /^((?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic})[\uFE0F\u200D\p{Extended_Pictographic}]*)\s+/u;
const split = (x) => { const m = EMOJI.exec(x); const rest = m ? x.slice(m[0].length) : x; const d = rest.indexOf(' — ');
  return { icon: m ? m[1] : '', title: d > 0 ? rest.slice(0, d) : '', text: d > 0 ? rest.slice(d + 3) : rest }; };
// Тёмная шапка: заголовок, подзаголовок и (необязательно) цифры.
const darkHero = (title, sub, nums = []) => {
  const h = esc(title).replace(/(\d+)\s*$/, ' <span>$1</span>');
  return `<div class="dk-hero"><h1>${h}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}${nums.length ? `<div class="dk-st">${nums.map((x) => { const [n, ...r] = x.split(' — '); return `<div><b>${esc(n)}</b><small>${esc(r.join(' — '))}</small></div>`; }).join('')}</div>` : ''}</div>`;
};
const row = (x, def) => { const r = split(x); return `<div class="dk-row"><span class="i">${esc(r.icon || def)}</span><div>${r.title ? `<b>${esc(r.title)}</b>` : ''}<p>${esc(r.text)}</p></div></div>`; };

// «О нас»: первый раздел — шапка (заголовок + абзац), «# В цифрах» — цифры в шапке, остальное — строки с красной полосой.
function aboutPage(sections, extra = '') {
  const [first, ...rest] = sections; const st = rest.find((s) => isStats(s.title));
  const sub = first ? first.blocks.filter((b) => b.p).map((b) => b.p).join(' ') : '';
  return `<div class="narrow dk">${darkHero(first ? first.title : '', sub, st ? st.blocks.flatMap((b) => b.ul || []) : [])}
    ${rest.filter((s) => s !== st).map((s) => `<h2 class="dk-h">${esc(s.title)}</h2>${s.blocks.map((b) => (b.p ? `<p class="dk-p">${esc(b.p)}</p>` : b.ul.map((x) => row(x, icon(s.title))).join(''))).join('')}`).join('')}${extra}</div>`;
}
// «Услуги»: каждый «# 🚚 Название» — карточка; абзацы — описание, пункты — чёрные метки; «Спросить» ведёт в WhatsApp.
function servicesPage(title, sub, sections, ask) {
  return `<div class="narrow dk">${darkHero(title, sub)}
    ${sections.map((s) => { const r = split(s.title); const tags = s.blocks.flatMap((b) => b.ul || []);
      return `<div class="dk-card"><div class="top"><span class="i">${esc(r.icon || icon(s.title))}</span><b>${esc(r.title ? `${r.title} — ${r.text}` : r.text)}</b></div>
        ${s.blocks.filter((b) => b.p).map((b) => `<p>${esc(b.p)}</p>`).join('')}<div class="ft">${tags.map((x) => `<span>${esc(x)}</span>`).join('')}${ask(r.title || r.text)}</div></div>`; }).join('')}</div>`;
}

module.exports = { parse, infoPage, aboutPage, servicesPage, darkHero };
