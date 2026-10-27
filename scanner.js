// Файл сканера склада (扫码时间 · 扫码类型 · 扫码内容 · 二维码地址 · 扫码现场照片): строки с трек-кодом и фото в ячейке.
// Фото в xlsx лежат двумя способами: рисунок поверх листа (xl/drawings) или картинка в ячейке WPS (=DISPIMG, xl/cellimages.xml).
const XLSX = require('xlsx');
const CFB = require('cfb');

const norm = (p) => p.replace(/^\/+/, '').split('/').reduce((a, s) => (s === '..' ? a.slice(0, -1) : s && s !== '.' ? [...a, s] : a), []).join('/');
const dir = (p) => p.split('/').slice(0, -1).join('/');

function zipReader(buf) {
  const zip = CFB.read(buf, { type: 'buffer' });
  const files = new Map();
  zip.FullPaths.forEach((p, i) => { const e = zip.FileIndex[i]; if (e && e.type === 2 && e.content) files.set(norm(p.replace(/^Root Entry\//, '')), Buffer.from(e.content)); });
  const get = (p) => { const k = norm(p); for (const [name, data] of files) if (name === k || name.endsWith('/' + k)) return data; return null; };
  const text = (p) => { const b = get(p); return b ? b.toString('utf8') : ''; };
  // rId → путь файла из .rels рядом с base.
  const rels = (base) => {
    const m = {}; const xml = text(`${dir(base)}/_rels/${base.split('/').pop()}.rels`);
    for (const r of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(r[0]); const tg = /Target="([^"]+)"/.exec(r[0]);
      if (id && tg) m[id[1]] = tg[1].startsWith('/') ? norm(tg[1]) : norm(`${dir(base)}/${tg[1]}`);
    }
    return m;
  };
  return { get, text, rels };
}

const ext = (p) => (/\.png$/i.test(p) ? 'png' : 'jpg');

// Возвращает [{ row, content, time, images: [{ data, ext }] }] первого листа.
function readScanFile(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true, cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const val = (r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x ? x.v : ''; };

  // Колонка с содержимым скана: по заголовку 扫码内容, иначе первая, где значения похожи на трек.
  let head = -1; let col = -1; let tcol = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 5) && col < 0; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = String(val(r, c)).replace(/\s/g, '');
      if (/扫码内容|条码内容|内容|单号|трек/i.test(h) && col < 0) { col = c; head = r; }
      if (/扫码时间|时间|время/i.test(h)) tcol = c;
    }
  }
  if (col < 0) {
    for (let c = range.s.c; c <= range.e.c && col < 0; c++) {
      let n = 0;
      for (let r = range.s.r; r <= range.e.r; r++) if (/^[A-Za-z]{0,5}\d{8,}/.test(String(val(r, c)).trim())) n++;
      if (n >= 2) col = c;
    }
  }
  if (col < 0) return [];

  // Картинки по строкам.
  const byRow = new Map();
  const add = (row, p, data) => { if (!data) return; if (!byRow.has(row)) byRow.set(row, []); byRow.get(row).push({ data, ext: ext(p) }); };
  let z = null;
  try { z = zipReader(buf); } catch { z = null; }
  if (z) {
    // Путь листа из workbook.xml.rels.
    const wbRels = z.rels('xl/workbook.xml');
    const wbXml = z.text('xl/workbook.xml');
    const sh = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => /r:id="([^"]+)"/.exec(m[0]) || /\bid="([^"]+)"/.exec(m[0]))[0];
    const sheetPath = (sh && wbRels[sh[1]]) || 'xl/worksheets/sheet1.xml';
    const sRels = z.rels(sheetPath);
    for (const target of Object.values(sRels)) {
      if (!/drawings\/drawing\d*\.xml$/.test(target)) continue;
      const dRels = z.rels(target);
      const xml = z.text(target);
      // Префикс пространства имён бывает разный (xdr:, без префикса) — допускаем любой.
      for (const a of xml.matchAll(/<((?:\w+:)?)(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/\1\2>/g)) {
        const row = /<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/.exec(a[0]);
        const emb = /r:embed="([^"]+)"/.exec(a[0]);
        if (row && emb && dRels[emb[1]]) add(+row[1], dRels[emb[1]], z.get(dRels[emb[1]]));
      }
    }
    // WPS: =DISPIMG("ID_…",1) в ячейке, сама картинка в xl/cellimages.xml.
    const ci = z.text('xl/cellimages.xml');
    if (ci) {
      const cRels = z.rels('xl/cellimages.xml');
      const byName = {};
      for (const m of ci.matchAll(/<(?:\w+:)?cellImage>[\s\S]*?<\/(?:\w+:)?cellImage>/g)) {
        const name = /\bname="([^"]+)"/.exec(m[0]); const emb = /r:embed="([^"]+)"/.exec(m[0]);
        if (name && emb && cRels[emb[1]]) byName[name[1]] = cRels[emb[1]];
      }
      // Формулу читаем прямо из XML листа: у ячеек без сохранённого значения SheetJS её не отдаёт.
      for (const c of z.text(sheetPath).matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
        const m = /DISPIMG\(\s*(?:&quot;|")([^"&]+)/.exec(c[2]);
        if (m && byName[m[1]]) add(XLSX.utils.decode_cell(c[1]).r, byName[m[1]], z.get(byName[m[1]]));
      }
    }
  }

  const out = [];
  for (let r = head + 1; r <= range.e.r; r++) {
    const content = String(val(r, col) ?? '').trim();
    if (!content) continue;
    const t = tcol >= 0 ? val(r, tcol) : '';
    out.push({ row: r, content, time: t instanceof Date ? t : String(t || ''), images: byRow.get(r) || [] });
  }
  return out;
}

// «KY4001168305249-2-10-|x» → трек KY4001168305249, коробка 2 из 10.
function parseScan(content) {
  const s = String(content || '').trim().replace(/['’]/g, '');
  const parts = s.split('-').map((x) => x.trim());
  const track = (parts[0] || '').replace(/\s+/g, '').toUpperCase();
  const box = parseInt(parts[1], 10); const total = parseInt(parts[2], 10);
  return { track, box: Number.isFinite(box) ? box : null, total: Number.isFinite(total) && total > 0 ? total : null };
}

module.exports = { readScanFile, parseScan };
