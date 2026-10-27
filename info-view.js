// «Полезно знать» и «О нас»: шапка и раскрывающиеся разделы. Текст из настроек: «# заголовок», «- пункт», абзацы.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Значок раздела подбираем по словам заголовка (ru/zh), иначе ℹ️.
const ICONS = [[/график|营业/i, '🕘'], [/праздник|节假日/i, '📅'], [/упаков|包装/i, '📦'], [/подписать|标记/i, '🏷️'], [/нельзя|禁运/i, '🚫'],
  [/цена|运费/i, '⚖️'], [/совет|贴士/i, '💡'], [/контакт|联系/i, '📞'], [/делаем|服务|услуг/i, '🛠️'], [/выдач|提货|自提/i, '📍'], [/карго|货运|151/i, '🚚']];
const icon = (title) => (ICONS.find(([re]) => re.test(title)) || [0, 'ℹ️'])[1];
const isBan = (title) => /нельзя|禁运/i.test(title);

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

// Первый раздел открыт, остальные свёрнуты.
function infoPage(title, sub, sections) {
  return `<div class="iv narrow"><div class="iv-hero"><h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    ${sections.map((s, i) => `<details${i ? '' : ' open'}><summary><span class="ic">${icon(s.title)}</span>${esc(s.title)}</summary><div class="in">${body(s)}</div></details>`).join('')}</div>`;
}

module.exports = { parse, infoPage };
