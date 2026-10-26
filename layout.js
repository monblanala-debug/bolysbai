const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--bg:#f5f6f8;--card:#fff;--ink:#1c2230;--muted:#6b7280;--line:#e5e7eb;--brand:#d62828;--brand-ink:#fff;--ok:#16a34a;--warn:#d97706;--info:#2563eb}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
a{color:var(--info);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--ink);color:#fff}header .in{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header .logo{font-weight:800;font-size:20px;color:#fff}header .logo b{color:var(--brand)}
header nav{display:flex;gap:14px;flex-wrap:wrap;flex:1}header nav a{color:#d1d5db}header nav a.on{color:#fff;font-weight:600}
.lang a{color:#9ca3af;margin-left:8px}.lang a.on{color:#fff;font-weight:700}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
h1{font-size:26px;margin:0 0 8px}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}
.muted{color:var(--muted)}.grid{display:grid;gap:16px}.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.g4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
label{display:block;font-size:14px;font-weight:600;margin:10px 0 4px}
input,select,textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
textarea{min-height:90px}
button,.btn{display:inline-block;background:var(--brand);color:var(--brand-ink);border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
.btn.sec,button.sec{background:#eef0f3;color:var(--ink)}.btn.sm,button.sm{padding:6px 10px;font-size:13px}
.row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.row>*{flex:1;min-width:140px}.row>button,.row>.btn{flex:0 0 auto}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.tbl{overflow-x:auto}
.code{font-family:ui-monospace,Menlo,monospace;font-size:28px;font-weight:800;letter-spacing:1px;color:var(--brand)}
.addr{background:#fafafa;border:1px dashed #cbd5e1;border-radius:8px;padding:12px;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#eef0f3}
.b-china{background:#e0e7ff;color:#3730a3}.b-transit{background:#fef3c7;color:#92400e}.b-border{background:#fde2e2;color:#991b1b}.b-arrived{background:#dcfce7;color:#166534}.b-delivered{background:#e5e7eb;color:#374151}
.alert{padding:10px 14px;border-radius:8px;margin-bottom:12px}.alert.err{background:#fee2e2;color:#991b1b}.alert.ok{background:#dcfce7;color:#166534}.alert.info{background:#e0f2fe;color:#075985}
.stat{font-size:28px;font-weight:800}a.card{color:inherit;text-decoration:none}form>button{margin-top:14px}
.wh-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wh-pick label{border:2px solid var(--line);border-radius:10px;padding:12px;margin:0;cursor:pointer;text-align:center;font-size:16px}
.wh-pick input{display:none}.wh-pick input:checked+span{color:var(--brand)}.wh-pick label:has(input:checked){border-color:var(--brand);background:#fff5f5}
.subnav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.subnav a{padding:8px 12px;border-radius:8px;background:#fff;border:1px solid var(--line);color:var(--ink)}.subnav a.on{background:var(--ink);color:#fff}
@media print{header,.noprint{display:none!important}.card{border:0}body{background:#fff}}
`;

const JS = `
document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;
const el=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(el.innerText).then(()=>{const o=b.innerText;b.innerText=b.dataset.done||'OK';setTimeout(()=>b.innerText=o,1500)})});
document.addEventListener('click',e=>{const b=e.target.closest('[data-wh]');if(!b)return;
document.querySelectorAll('[data-wh]').forEach(x=>x.classList.toggle('sec',x!==b));document.querySelectorAll('[data-wh-block]').forEach(x=>x.hidden=x.dataset.whBlock!==b.dataset.wh)});
document.addEventListener('change',e=>{if(e.target.id==='checkall')document.querySelectorAll('input[name=ids]').forEach(c=>c.checked=e.target.checked)});
`;

function page({ title, body, t, lang, path, session }) {
  const navItems = [['/', 'nav_home'], ['/track', 'nav_track'], ['/cabinet', 'nav_cabinet'], ['/admin', 'nav_admin']];
  const nav = navItems.map(([href, k]) => `<a href="${href}" class="${(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''}">${esc(t(k))}</a>`).join('');
  const logout = session && (session.clientId || session.admin) ? `<a href="/logout">${esc(t('nav_logout'))}</a>` : '';
  const back = encodeURIComponent(path);
  return `<!doctype html><html lang="${lang === 'zh' ? 'zh-CN' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(t('brand'))}</title><style>${CSS}</style></head><body>
<header><div class="in"><a class="logo" href="/">Cargo <b>151</b></a><nav>${nav}${logout}</nav>
<div class="lang"><a href="/lang/ru?back=${back}" class="${lang === 'ru' ? 'on' : ''}">RU</a><a href="/lang/zh?back=${back}" class="${lang === 'zh' ? 'on' : ''}">中文</a></div></div></header>
<main>${body}</main><script>${JS}</script></body></html>`;
}

module.exports = { page, esc };
