const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--bg:#faf7f7;--card:#fff;--ink:#22191a;--muted:#6f6264;--line:#eee3e4;--brand:#e5262d;--brand-dark:#b8161c;--brand-soft:#fdecec;--brand-ink:#fff;--ok:#16a34a;--warn:#d97706;--info:#2563eb}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
a{color:var(--info);text-decoration:none}a:hover{text-decoration:underline}
header{background:#fff;color:var(--ink);border-bottom:3px solid var(--brand);position:sticky;top:env(safe-area-inset-top,0px);z-index:5}header .in{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header .logo{display:block;line-height:0}header .logo img{height:45px;width:auto}header .logo:hover{text-decoration:none}
header nav{display:flex;gap:14px;flex-wrap:wrap;flex:1}header nav a{color:var(--ink)}header nav a.on{color:var(--brand);font-weight:700}
.lang a{color:var(--muted);margin-left:8px}.lang a.on{color:var(--brand);font-weight:700}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
h1{font-size:26px;margin:0 0 8px}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}
.muted{color:var(--muted)}.grid{display:grid;gap:16px}.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.g4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.compact{font-size:14px}.compact th,.compact td{padding-left:5px;padding-right:5px}.payrow td{background:#fffdf5}.paybox{border:1px solid #f3e3b5;border-radius:10px;padding:12px;background:#fff}.paybtn{background:#16a34a;white-space:nowrap}.rownote{min-width:210px}.rowsel{padding:5px 6px;font-size:13px;width:100%}.rownote textarea{padding:6px 8px;font-size:14px;min-height:52px}.staff-note{background:#fff7d6;border-left:3px solid #f59e0b;border-radius:6px;padding:4px 8px;margin-top:4px;font-size:13px;color:#5b4300;white-space:pre-wrap}.sumgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}.sumgrid>div{display:flex;flex-direction:column;gap:2px}.sumgrid b{font-size:22px}
label{display:block;font-size:14px;font-weight:600;margin:10px 0 4px}
input,select,textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
textarea{min-height:90px}
button:hover,.btn:hover{background:var(--brand-dark);text-decoration:none}button.sec:hover,.btn.sec:hover{background:#e7dfe0}
button,.btn{display:inline-block;background:var(--brand);color:var(--brand-ink);border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
.btn.sec,button.sec{background:#eef0f3;color:var(--ink)}.btn.sm,button.sm{padding:6px 10px;font-size:13px}
.row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.row>*{flex:1;min-width:140px}.row>button,.row>.btn{flex:0 0 auto}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.tbl{overflow-x:auto}.dayrow td{background:#f6f1f1;border-top:2px solid var(--line)}
.iv p{margin:0 0 10px}.iv ul{margin:0 0 10px;padding:0;list-style:none}.iv li{position:relative;padding:5px 0 5px 28px}
.iv li:before{content:'';position:absolute;left:4px;top:13px;width:8px;height:8px;border-radius:50%;background:var(--brand)}
.iv ul.ban li:before{content:'✕';width:auto;height:auto;background:none;color:var(--brand);font-weight:800;top:5px;left:5px}
.rv-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px}@media(min-width:700px){.rv-grid{grid-template-columns:repeat(3,1fr);gap:12px}}
.rv-grid a{display:block;border-radius:12px;overflow:hidden;background:#eee;aspect-ratio:3/4;box-shadow:0 1px 4px rgba(0,0,0,.12)}.rv-grid img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.rv-h{font-size:20px;margin:22px 0 10px}.rv-v video{width:100%;aspect-ratio:9/16;border-radius:12px;background:#111;object-fit:cover;display:block}
.ab-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}@media(min-width:700px){.ab-stats{grid-template-columns:repeat(4,1fr)}}
.ab-stats div{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 12px;text-align:center}.ab-stats b{display:block;font-size:26px;color:var(--brand);line-height:1.1}.ab-stats small{display:block;color:var(--muted,#666);font-size:13px;margin-top:4px}
.team{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}@media(min-width:700px){.team{grid-template-columns:repeat(4,1fr)}}
.tm{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 10px;text-align:center}.tm img,.tm-av{width:84px;height:84px;border-radius:50%;object-fit:cover;object-position:top;display:block;margin:0 auto 8px;background:#eee}
.tm-av{display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;background:linear-gradient(135deg,#e5262d,#a5121a)}.tm b{display:block}.tm small{display:block;color:var(--muted,#666);font-size:13px;margin-top:2px}
.rv-wh a{aspect-ratio:4/3}.rv-wh img{object-position:center}
.dk-hero{background:#17181c;color:#fff;border-radius:18px;padding:22px 18px;margin-bottom:14px}.dk-hero h1{margin:0 0 4px;font-size:28px}.dk-hero h1 span{color:#ff3b42}.dk-hero p{margin:0;opacity:.8}
.dk-st{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:16px}@media(min-width:700px){.dk-st{grid-template-columns:repeat(4,1fr)}}.dk-st b{display:block;font-size:28px;color:#ff3b42;line-height:1.1}.dk-st small{opacity:.75;font-size:13px}
.dk-h{font-size:20px;margin:22px 0 10px}.dk-p{color:#555}
.dk-row{display:flex;gap:12px;align-items:flex-start;padding:14px;background:#fff;border-radius:14px;border-left:5px solid var(--brand);margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.dk-row .i{font-size:26px;line-height:1.1}.dk-row b{display:block}.dk-row p{margin:2px 0 0;color:#555;font-size:14px}
.dk-card{background:#fff;border-radius:16px;margin-bottom:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}.dk-card .top{display:flex;gap:12px;align-items:center;padding:14px 14px 6px}.dk-card .i{width:46px;height:46px;flex:none;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:22px}
.dk-card b{font-size:18px}.dk-card p{margin:0;padding:0 14px 10px;color:#555;font-size:14px}.dk-card .ft{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 14px 14px}.dk-card .ft span{background:#17181c;color:#fff;border-radius:8px;padding:4px 10px;font-size:13px}.dk-card .ft a{margin-left:auto;color:var(--brand);font-weight:700;font-size:14px;text-decoration:none}
.rv-box{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}.rv-box[hidden]{display:none}.rv-box img{max-width:100%;max-height:100%;object-fit:contain}
.rv-box button{position:absolute;background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:24px;padding:0;margin:0}.rv-x{top:12px;right:12px}.rv-p{left:8px;top:50%}.rv-n{right:8px;top:50%}
.iv-hero{border-radius:18px;padding:22px 20px;margin-bottom:12px;background:#17181c;color:#fff}.iv-hero h1{margin:0;font-size:26px}.iv-hero small{display:block;opacity:.85;margin-top:4px}
.iv details{background:#fff;border:1px solid var(--line);border-radius:14px;margin-bottom:10px;overflow:hidden}
.iv summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:15px 16px;font-weight:700;font-size:17px}.iv summary::-webkit-details-marker{display:none}
.iv summary .ic{font-size:20px}.iv summary:after{content:'+';margin-left:auto;font-size:22px;color:var(--brand);font-weight:400}.iv details[open] summary:after{content:'−'}
.iv summary:hover{background:#fdf6f6}.iv summary:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}.iv details[open] summary{border-bottom:1px solid var(--line)}.iv .in{padding:14px 16px 6px}

.dchip{display:inline-block;font-size:12px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap}.dchip.up{background:#dcfce7;color:#166534}.dchip.down{background:#fee2e2;color:#991b1b}.okc{color:var(--ok)}
.dhero{background:#22191a;color:#fff;border-radius:18px;padding:22px 24px;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,2fr);gap:20px;position:relative;overflow:hidden;margin-bottom:16px}@media(max-width:760px){.dhero{grid-template-columns:minmax(0,1fr);padding:18px}}
.dhero:before{content:'';position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(229,38,45,.45),transparent 70%)}
.dhero .lb{color:#cbbfc0;font-size:13px}.dhero .huge{font-size:42px;font-weight:800;line-height:1.1;color:#4ade80}.dhero .mo{margin-top:6px;color:#e9e1e2}
.dhero-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;position:relative}@media(max-width:480px){.dhero-nums{grid-template-columns:minmax(0,1fr)}}.dhero-nums.two{grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:480px){.dhero-nums.two{grid-template-columns:minmax(0,1fr)}}.dgrid.half{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.dhero-nums a{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 14px;color:#fff;min-width:0}.dhero-nums a:hover{text-decoration:none;background:rgba(255,255,255,.12)}.dhero-nums b{display:block;font-size:28px;line-height:1.15;overflow-wrap:anywhere}.dhero-nums b.bad{color:#f87171}.dhero-nums small{color:#cbbfc0}
.dalarm{display:block;margin:-26px 0 16px;padding:24px 20px 12px;background:#fde8e8;border:1px solid #f6c3c5;border-top:0;border-radius:0 0 16px 16px;color:#991b1b;font-weight:600}.dalarm:hover{text-decoration:none;background:#fbdcdc}
.dgrid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px;align-items:start}@media(max-width:820px){.dgrid{grid-template-columns:minmax(0,1fr)}}.dgrid h2{margin:0 0 10px;font-size:17px}
.dhead{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px}.dhead h2{margin:0}.dhead small{color:var(--muted)}
.dbars{display:flex;align-items:flex-end;gap:2px;height:130px;padding-top:8px;border-bottom:1px solid var(--line)}.dbars div{flex:1;background:#f4b4b6;border-radius:4px 4px 0 0;min-height:2px}.dbars div.now{background:var(--brand)}.dbars div:hover{background:var(--brand-dark)}
.dax{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px}
.dscore th{font-size:12px;text-transform:uppercase;letter-spacing:.03em}.dscore th span{font-weight:400;text-transform:none}.dscore td,.dscore th{padding:9px 6px;vertical-align:middle}.dscore td b{font-size:16px}
.dmini{height:6px;background:#f1e9ea;border-radius:3px;margin-top:5px;position:relative;min-width:70px}.dmini i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--brand)}.dmini s{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.5}
.datt a{display:flex;align-items:center;gap:10px;padding:11px 4px;border-bottom:1px solid var(--line);color:var(--ink)}.datt a:last-child{border-bottom:0}.datt a:hover{text-decoration:none;background:#faf5f5}.datt a>span:nth-child(2){min-width:0;overflow-wrap:anywhere}
.datt .dot{width:10px;height:10px;border-radius:50%;flex:0 0 10px}.datt .n{margin-left:auto;font-weight:800;font-size:17px;white-space:nowrap}.datt small{display:block;color:var(--muted);font-size:12px}
.dseg{display:flex;height:14px;border-radius:7px;overflow:hidden;gap:2px;margin:6px 0 12px}.dseg i{display:block;min-width:3px}
.dleg{display:grid;gap:2px}.dleg a{display:flex;align-items:center;gap:8px;padding:4px 0;color:var(--ink);font-size:14px}.dleg i{width:10px;height:10px;border-radius:3px;flex:0 0 10px}.dleg b{margin-left:auto}
.s-expected{background:#9ca3af}.s-china{background:#6366f1}.s-transit{background:#f59e0b}.s-border{background:#ef4444}.s-arrived{background:#16a34a}.s-delivered{background:#4b5563}
.dfoot{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:14px}
.code{font-family:ui-monospace,Menlo,monospace;font-size:28px;font-weight:800;letter-spacing:1px;color:var(--brand)}
.addr{background:#fafafa;border:1px dashed #cbd5e1;border-radius:8px;padding:12px;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#eef0f3}
.b-china{background:#e0e7ff;color:#3730a3}.b-expected{background:#f3f4f6;color:#4b5563}.b-transit{background:#fef3c7;color:#92400e}.b-border{background:#fde2e2;color:#991b1b}.b-arrived{background:#dcfce7;color:#166534}.b-delivered{background:#e5e7eb;color:#374151}
.alert{padding:10px 14px;border-radius:8px;margin-bottom:12px}.alert.err{background:#fee2e2;color:#991b1b}.alert.ok{background:#dcfce7;color:#166534}.alert.info{background:#fdf1f1;color:var(--ink);border:1px solid #f3d2d3}
.stat{font-size:28px;font-weight:800}
.narrow{max-width:640px;margin:0 auto}.keepers{margin-top:16px;padding-top:12px;border-top:1px solid var(--line);display:grid;gap:4px;font-size:15px}.seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:#f1e9ea;border-radius:12px;padding:4px;gap:4px;margin-bottom:14px}.seg a{text-align:center;padding:12px 8px;border-radius:9px;font-weight:700;font-size:17px;color:var(--ink)}.seg a:hover{text-decoration:none;background:#fff}.seg a.on{background:var(--brand);color:#fff;box-shadow:0 2px 8px rgba(229,38,45,.3)}.seg a.on::before{content:'✓ '}
.seg label{margin:0;cursor:pointer}.seg label input{position:absolute;opacity:0;pointer-events:none}.seg label span{display:block;text-align:center;padding:12px 8px;border-radius:9px;font-weight:700;font-size:17px}
.seg label input:checked+span{background:var(--brand);color:#fff;box-shadow:0 2px 8px rgba(229,38,45,.3)}.seg label input:checked+span::before{content:'✓ '}.seg label input:focus-visible+span{outline:2px solid var(--brand)}
.codebar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-color:var(--brand);background:var(--brand-soft)}.center{text-align:center}.code.big{font-size:44px;margin:8px 0}.wide{width:100%;margin-top:16px;text-align:center}
.hint{font-size:13px;color:var(--muted);background:#faf5f5;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:6px}
.pick{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}.pick label{margin:0;cursor:pointer;position:relative}.pick input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:0;top:0}
.pick span{display:block;text-align:center;padding:12px 6px;border:2px solid var(--line);border-radius:10px;font-weight:700;font-size:16px;background:#fff;transition:all .15s}
.pick label:hover span{border-color:var(--brand)}.pick input:checked+span{background:var(--brand);border-color:var(--brand);color:#fff}.pick input:focus-visible+span{outline:3px solid #f5b5b7;outline-offset:2px}
.steps{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}.steps span{flex:1;min-width:90px;text-align:center;padding:8px;border-radius:8px;background:#fff;border:1px solid var(--line);font-size:13px;color:var(--muted)}
.steps span.on{background:var(--brand);color:#fff;border-color:var(--brand);font-weight:700}.steps span.done{color:var(--brand);border-color:#f3c6c8}
.wh-list{display:grid;gap:12px}.wh{display:flex;flex-direction:column;gap:4px;border:2px solid var(--line);border-radius:12px;padding:16px;color:var(--ink)}.wh:hover{border-color:var(--brand);text-decoration:none}.wh b{font-size:20px}
.field{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)}.field>div{min-width:0}.val{font-weight:600;word-break:break-word}
.alert.warn{background:#fef3c7;color:#92400e}.alert.warn a{color:inherit}
footer{max-width:1100px;margin:0 auto;padding:8px max(16px,env(safe-area-inset-left,0px)) 32px;font-size:13px}footer a{color:var(--muted)}
.card ul{padding-left:20px}.card h2{margin-top:18px}.card h2:first-child{margin-top:0}a.card{color:inherit;text-decoration:none}form>button{margin-top:14px}
.wh-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wh-pick label{border:2px solid var(--line);border-radius:10px;padding:12px;margin:0;cursor:pointer;text-align:center;font-size:16px}
.wh-pick input{display:none}.wh-pick input:checked+span{color:var(--brand)}.wh-pick label:has(input:checked){border-color:var(--brand);background:#fff5f5}
.subnav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.subnav a{padding:8px 12px;border-radius:8px;background:#fff;border:1px solid var(--line);color:var(--ink)}.subnav a.on{background:var(--ink);color:#fff}
.hero{position:relative;overflow:hidden;border-radius:16px;background:linear-gradient(180deg,#fff 0%,#fff3f3 100%);border:1px solid var(--line);margin-bottom:16px}
.hero svg{display:block;width:100%;height:auto;max-width:100%}
.hero .tag{padding:16px 18px 0;font-weight:800;font-size:clamp(18px,3.4vw,28px);line-height:1.25;color:var(--ink);text-wrap:balance;max-width:640px}
.hero .tag span{color:var(--brand)}.hero .tag small{display:block;font-size:.6em;font-weight:600;color:var(--muted);margin-top:4px}.narrow+.hero{margin-top:24px}
.route{fill:none;stroke:var(--brand);stroke-width:2.2;stroke-linecap:round;opacity:.9}
.route.flow{stroke-dasharray:6 10;animation:flow 1.6s linear infinite}
.glow{fill:none;stroke:var(--brand);stroke-width:8;opacity:.12}
@keyframes flow{to{stroke-dashoffset:-32}}
.pulse{fill:var(--brand);opacity:.25;transform-box:fill-box;transform-origin:center;animation:pulse 2.4s ease-out infinite}
@keyframes pulse{0%{transform:scale(.6);opacity:.45}100%{transform:scale(2.4);opacity:0}}
.truck{animation:drive 14s linear infinite}.air{animation:fly 11s linear infinite}@keyframes fly{from{transform:translateX(0)}to{transform:translateX(-1000px)}}
.hero .modes{display:flex;gap:8px;padding:10px 18px 0;flex-wrap:wrap}.hero .modes span{background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:14px;font-weight:700;color:var(--ink)}
@keyframes drive{from{transform:translateX(-160px)}to{transform:translateX(960px)}}
button.copied,.btn.copied{background:var(--ok)!important;color:#fff!important;transition:background .2s}
.code.landed{animation:land .35s ease-out}@keyframes land{0%{transform:scale(1.12)}100%{transform:scale(1)}}
.hero .route,.hero .glow{transition:opacity .3s,stroke-width .3s}.hero.sel .route:not(.hl),.hero.sel .glow:not(.hl){opacity:.15}.hero .route.hl{stroke-width:4}.hero .glow.hl{opacity:.3}
.hero .city text{transition:font-size .3s}.hero .city.hl text:not(.sub){font-size:24px;fill:var(--brand)}.hero .city.hl .pulse{animation-duration:1s}
.tl{list-style:none;margin:12px 0 4px;padding:0 0 0 4px}.tl li{position:relative;padding:0 0 14px 22px;color:var(--muted)}.tl li:before{content:'';position:absolute;left:0;top:5px;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid var(--line)}.tl li:after{content:'';position:absolute;left:6px;top:19px;bottom:-1px;width:2px;background:var(--line)}.tl li:last-child:after{display:none}.tl li b{font-weight:600}.tl li.done{color:var(--ink)}.tl li.done:before{background:var(--brand);border-color:var(--brand)}.tl li.done:after{background:var(--brand)}.tl li.on{color:var(--ink)}.tl li.on b{color:var(--brand);font-weight:800}.tl li.on:before{background:var(--brand);border-color:var(--brand);box-shadow:0 0 0 4px #fde2e2}
.prog{position:relative;padding-top:24px;margin:6px 0 4px;min-width:220px}.prog .bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}
.prog .bar i{display:block;height:100%;width:var(--p);background:var(--brand);border-radius:3px;animation:grow 1.4s cubic-bezier(.2,.7,.3,1)}
.prog .ptruck{position:absolute;top:2px;left:clamp(0px,calc(var(--p) - 26px),calc(100% - 26px));animation:drive-in 1.4s cubic-bezier(.2,.7,.3,1);line-height:0}
.prog ol{position:relative;height:16px;list-style:none;padding:0;margin:6px 0 0;font-size:11px;color:var(--muted)}
.prog ol li{position:absolute;top:0;white-space:nowrap;transform:translateX(-50%)}.prog ol li:first-child{transform:none}.prog ol li:last-child{transform:translateX(-100%)}.prog ol li.done{color:var(--ink)}.prog ol li.on{color:var(--brand);font-weight:700}
.prog.compact{padding-top:20px;min-width:140px}.prog.compact ol{display:none}
@keyframes grow{from{width:0}}@keyframes drive-in{from{left:0}}
.parcel{display:grid;gap:8px}.parcel .hist{font-size:13px;color:var(--muted)}
.fade>*{animation:fadeUp .5s ease-out both}.fade>*:nth-child(2){animation-delay:.08s}.fade>*:nth-child(3){animation-delay:.16s}.fade>*:nth-child(4){animation-delay:.24s}.fade>*:nth-child(n+5){animation-delay:.3s}
.fade .card>h2{animation:fadeUp .5s ease-out both}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.route.flow,.pulse,.truck,.prog .bar i,.prog .ptruck,.fade>*,.fade .card>h2,.code.landed{animation:none}.mover{display:none}.air{display:none}}
@media (max-width:720px){header .in{gap:8px 12px}header nav{order:3;flex:1 0 100%;flex-wrap:wrap;gap:6px;padding-bottom:4px}header nav a{white-space:nowrap;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:14px}header nav a.on{background:var(--brand);border-color:var(--brand);color:#fff}.lang{margin-left:auto}}
.wa-fab{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:8px;background:#25d366;color:#fff;font-weight:700;padding:10px 16px 10px 12px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.18);z-index:15}.wa-fab:hover{text-decoration:none;background:#1ebe5a}
@media (max-width:720px){.wa-fab span{display:none}.wa-fab{padding:12px}}
body{padding-bottom:72px}
.wb{background:#fff;border:1.5px solid #333;font-size:15px;margin-bottom:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wb-fit{overflow:hidden;margin-bottom:12px}.wb-sheet{width:1040px;margin:0;transform-origin:0 0}
.wb-top{display:flex;align-items:center;gap:16px;padding:10px 14px;border-bottom:1.5px solid #333}.wb-top img{height:60px}.wb-top>div{flex:1;text-align:center}
.wb-top .co{font-size:26px;font-weight:700;letter-spacing:.04em}.wb-top .ti{font-size:26px;font-weight:800;margin-top:2px}
.wb .g{display:grid;border-bottom:1.5px solid #333}.wb .head{grid-template-columns:repeat(3,1fr)}.wb .goods{grid-template-columns:2.1fr repeat(3,1fr) 1.35fr repeat(4,1fr) 1.3fr repeat(4,1fr)}.wb .v.gd{font-size:14px;overflow-wrap:normal;line-height:1.3}.wb .v.nw{white-space:nowrap;overflow-wrap:normal}.wb .sum{grid-template-columns:2fr 1fr}
.wb .c{display:flex;flex-direction:column;border-right:1px solid #999;border-bottom:1px solid #999;min-width:0}
.wb .l{background:#bfe3f7;font-size:13px;line-height:1.25;text-align:center;padding:4px 2px;color:#223}.wb .goods .l{background:#fde68a;font-size:11px;letter-spacing:-.2px;padding:4px 1px;min-height:50px;display:flex;flex-direction:column;justify-content:center;min-width:0;overflow:hidden;overflow-wrap:anywhere}.wb .goods{grid-template-rows:auto auto}.wb .goods .c{display:grid;grid-row:span 2;grid-template-rows:subgrid}.wb .sum .l{background:#fff200}
.wb .v{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px 4px;font-weight:700;font-size:17px;overflow-wrap:anywhere}.wb .goods .v{font-size:16px}.wb .v.big{color:#e5262d;font-size:28px}
.wb-tracks{padding:8px 12px;font-size:14px;border-bottom:1px solid #999;overflow-wrap:anywhere}
.wb-rules{padding:8px 12px;font-size:12.5px;line-height:1.45}.wb-rules .rh{text-align:center;font-size:15px;margin-bottom:6px}.wb-rules p{margin:0 0 3px}
.only-m{display:none}@media (max-width:720px){.only-m{display:block}}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:10px 0}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block;background:#eee}
.photo-btn{display:block;text-align:center;font-size:18px;padding:16px;margin:6px 0}.wa-btn{background:#22c55e;font-size:18px;padding:14px 22px}
.invlist{display:grid;gap:10px}.inv{border:1px solid var(--line,#eee);border-radius:12px;padding:12px 14px}.inv .badge{margin-right:4px}
.cnt{display:inline-block;min-width:20px;padding:0 6px;border-radius:10px;background:var(--brand);color:#fff;font-size:12px;line-height:20px;text-align:center}
.prow{display:flex;gap:12px;align-items:center}.prow>div{flex:1;min-width:0}
.news{border-left:4px solid var(--brand)}.news h2{margin-bottom:6px}.news-i{padding:6px 0;border-top:1px solid var(--line)}.news-i:first-of-type{border-top:0}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.thumbs span{position:relative}.thumbs img{width:56px;height:56px;object-fit:cover;border-radius:6px;display:block}.thumbs span form{position:absolute;top:-6px;right:-6px;margin:0}.thumbs span button{padding:0 6px;font-size:12px;line-height:18px}
.promo{background:linear-gradient(135deg,#e5262d,#a5121a);color:#fff;border-radius:18px;padding:20px;margin:0 0 16px;position:relative;overflow:hidden}
.promo:after{content:'¥';position:absolute;right:-4px;bottom:-40px;font-size:170px;font-weight:900;opacity:.12;line-height:1;pointer-events:none}
.promo b{display:block;font-size:21px;line-height:1.25;margin-bottom:6px;position:relative}.promo p{margin:0 0 14px;opacity:.94;font-size:15px;max-width:560px;position:relative}
.promo-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;position:relative}.promo-chips span{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:4px 12px;border-radius:999px;font-weight:700;font-size:13px}
.promo-btn{background:#fff;color:var(--brand);position:relative}.promo-btn:hover{background:#fdecec;color:var(--brand-dark)}
@media (max-width:520px){.promo-btn{display:block;text-align:center}}
.road{position:relative;height:52px;background:linear-gradient(#f3eaea,#f3eaea 30px,#3a3b40 30px);overflow:hidden}
.road:after{content:"";position:absolute;left:0;right:0;bottom:10px;height:2px;background:repeating-linear-gradient(90deg,#fff 0 18px,transparent 18px 36px);animation:rd-dash 1s linear infinite}
.road .tr{position:absolute;bottom:4px;left:0;animation:rd-drive 12s linear infinite}
.bgtr{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}.bgtr span{position:absolute;left:0;opacity:.10}
.bgtr .a{top:22%;animation:rd-ea 38s linear infinite}.bgtr .b{top:58%;animation:rd-eb 46s linear infinite}.bgtr .c{top:82%;animation:rd-ea 52s linear infinite -20s}
.bgtr .d{top:0;left:15%;animation:rd-ec 60s linear infinite}.bgtr .e{top:0;left:70%;animation:rd-ec 70s linear infinite -30s}
.dk-hero,.iv-hero{position:relative;overflow:hidden}.dk-hero>*,.iv-hero>*{position:relative;z-index:1}
.dk-hero:before,.iv-hero:before{content:"";position:absolute;top:14px;left:0;width:54px;height:27px;background:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCAzMiI+PHBhdGggZD0iTTIgMThsOC0yIDYgNmg0bC0zLTcgMjItNCA4LThoNWwtNCA5IDEyIDJjMyAxIDMgMyAwIDRsLTQ0IDZjLTMgMC01LTEtNi0yeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==") no-repeat center/contain;opacity:.3;animation:rd-fly 14s linear infinite}
@keyframes rd-dash{to{background-position:-36px 0}}@keyframes rd-drive{from{transform:translateX(-110px)}to{transform:translateX(100vw)}}
@keyframes rd-ea{from{transform:translateX(-120px)}to{transform:translateX(110vw)}}@keyframes rd-eb{from{transform:translateX(110vw) scaleX(-1)}to{transform:translateX(-120px) scaleX(-1)}}
@keyframes rd-ec{from{transform:translate(-80px,-60px) rotate(35deg)}to{transform:translate(60vw,110vh) rotate(35deg)}}
@keyframes rd-fly{from{transform:translate(-60px,30px)}to{transform:translate(110vw,-10px)}}
@media (prefers-reduced-motion:reduce){.road:after,.road .tr,.bgtr span,.dk-hero:before,.iv-hero:before{animation:none}.bgtr{display:none}}
@media print{.road,.bgtr{display:none}}
.f-cities{margin-top:6px;font-size:13px;opacity:.8}
@media print{header,footer,.wa-fab,.noprint{display:none!important}.wb-sheet{width:auto!important;transform:none!important;font-size:12px}.wb-fit{height:auto!important}.wb .goods .l{font-size:10px}.wb .v{font-size:13px}.card{border:0}body{background:#fff}}
`;

const JS = `
const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;
const el=document.getElementById(b.dataset.copy);const text=el.dataset.final||el.innerText;
const done=()=>{const o=b.dataset.label||b.innerText;b.dataset.label=o;b.classList.add('copied');b.innerText='✓ '+(b.dataset.done||'OK');clearTimeout(b._t);b._t=setTimeout(()=>{b.classList.remove('copied');b.innerText=o},1800)};
const select=()=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)};
try{navigator.clipboard.writeText(text).then(done,()=>{select();done()})}catch(_){select();done()}});
document.addEventListener('change',e=>{if(e.target.id==='checkall')document.querySelectorAll('input[name=ids]').forEach(c=>c.checked=e.target.checked)});
// Код «выпадает» как на табло: цифры перебираются и встают по местам слева направо.
document.querySelectorAll('[data-flip]').forEach(el=>{const fin=el.textContent;el.dataset.final=fin;if(calm)return;let f=0;const total=22;
const iv=setInterval(()=>{f++;const settled=Math.floor(f/total*fin.length);el.textContent=[...fin].map((c,i)=>i<settled||!/[0-9]/.test(c)?c:String(Math.floor(Math.random()*10))).join('');if(f>=total){clearInterval(iv);el.textContent=fin;el.classList.add('landed')}},45)});
// Подсветка выбранного склада выдачи на карте.
const city=document.getElementById('f-city');const hero=document.querySelector('.hero');
if(city&&hero)city.addEventListener('change',e=>{const name=e.target.dataset.name;const g=hero.querySelector('[data-city="'+name+'"]');
hero.querySelectorAll('.hl').forEach(x=>x.classList.remove('hl'));hero.classList.toggle('sel',!!g);if(!g)return;g.classList.add('hl');
hero.querySelectorAll('[data-to="'+g.dataset.key+'"]').forEach(x=>x.classList.add('hl'))});
`;

// Заголовок, описание, канонический адрес, языковые версии и превью ссылки для поиска и мессенджеров.
function head(seo, title, t, lang, path) {
  const o = seo.origin || ''; const full = seo.title || `${title} · ${t('brand')}`; const url = `${o}${path}${lang === 'ru' ? '' : `?lang=${lang}`}`;
  return `<title>${esc(full)}</title>${seo.desc ? `<meta name="description" content="${esc(seo.desc)}">` : ''}
${seo.noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${esc(url)}">`}
${seo.alt ? ['ru', 'kk', 'zh'].map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(`${o}${path}${l === 'ru' ? '' : `?lang=${l}`}`)}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${esc(o + path)}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(t('brand'))}"><meta property="og:title" content="${esc(full)}">${seo.desc ? `<meta property="og:description" content="${esc(seo.desc)}">` : ''}
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(o)}/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
${(seo.verify || []).map(([n, v]) => `<meta name="${n}" content="${esc(v)}">`).join('')}<meta name="theme-color" content="#17181c"><link rel="icon" href="/logo.png">${seo.jsonld ? `<script type="application/ld+json">${seo.jsonld}</script>` : ''}`;
}
// Публичные страницы: фура «151» едет по дороге под меню, на фоне бледные фуры в разные стороны.
const TRUCK = '<svg viewBox="0 0 120 50" width="96" height="40" aria-hidden="true"><rect x="2" y="6" width="72" height="30" rx="3" fill="#e5262d"/><text x="38" y="27" font-size="13" font-weight="800" fill="#fff" text-anchor="middle" font-family="system-ui">151</text><path d="M76 14h22l14 12v10H76z" fill="#17181c"/><path d="M82 18h14l8 8H82z" fill="#9fc6e8"/><circle cx="20" cy="40" r="7" fill="#17181c"/><circle cx="20" cy="40" r="3" fill="#ccc"/><circle cx="58" cy="40" r="7" fill="#17181c"/><circle cx="58" cy="40" r="3" fill="#ccc"/><circle cx="98" cy="40" r="7" fill="#17181c"/><circle cx="98" cy="40" r="3" fill="#ccc"/></svg>';
const ROAD = `<div class="road noprint" aria-hidden="true"><div class="tr">${TRUCK}</div></div>`;
const BG_TRUCKS = `<div class="bgtr" aria-hidden="true">${['a', 'b', 'c', 'd', 'e'].map((c) => `<span class="${c}">${TRUCK}</span>`).join('')}</div>`;
function page({ title, body, t, lang, path, session, whatsapp, seo = {} }) {
  const wa = String(whatsapp || '').replace(/\D/g, '');
  const adm = String(path || '').startsWith('/admin'); // в админке подвал и кнопка WhatsApp не нужны
  const waPretty = wa.length === 13 ? `+${wa.slice(0, 2)} ${wa.slice(2, 5)} ${wa.slice(5, 9)} ${wa.slice(9)}` : `+${wa}`;
  // Клиент уже вошёл — «Получить код» ему не нужен, вместо него адрес склада в Китае.
  const first = session && session.clientId ? ['/address', 'china_address'] : ['/', 'nav_home'];
  const navItems = [first, ['/track', 'nav_track'], ['/cabinet', 'nav_cabinet'], ['/services', 'nav_services'], ['/about', 'nav_about'], ['/reviews', 'nav_reviews'], ['/info', 'nav_info']];
  const isOn = (href) => (href === '/' ? ['/', '/code', '/address'].includes(path) : path.startsWith(href) || (href === '/cabinet' && path.startsWith('/invoice')));
  const nav = navItems.map(([href, k]) => `<a href="${href}" class="${isOn(href) ? 'on' : ''}">${esc(t(k))}</a>`).join('');
  const logout = session && (session.clientId || session.admin) ? `<a href="/logout">${esc(t('nav_logout'))}</a>` : '';
  const back = encodeURIComponent(path);
  return `<!doctype html><html lang="${lang === 'zh' ? 'zh-CN' : lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head(seo, title, t, lang, path)}<style>${CSS}</style></head><body>
${adm ? '' : BG_TRUCKS}<header><div class="in"><a class="logo" href="/"><img src="/logo.png" alt="Cargo 151" width="96" height="45"></a><nav>${nav}${logout}</nav>
<div class="lang"><a href="/lang/ru?back=${back}" class="${lang === 'ru' ? 'on' : ''}">RU</a><a href="/lang/kk?back=${back}" class="${lang === 'kk' ? 'on' : ''}">ҚАЗ</a><a href="/lang/zh?back=${back}" class="${lang === 'zh' ? 'on' : ''}">中文</a></div></div></header>${adm ? '' : ROAD}
<main>${body}</main>${adm ? '' : `<footer>${wa ? `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp ${esc(waPretty)}</a> · ` : ''}<a href="https://www.instagram.com/cargo.151" target="_blank" rel="noopener">Instagram @cargo.151</a>${(seo.cities || []).length ? `<div class="f-cities">${esc(t('seo_cities'))}: ${seo.cities.map(([n, sl]) => `<a href="/dostavka/${sl}">${esc(n)}</a>`).join(' · ')}</div>` : ''}</footer>`}${wa && !adm ? `<a class="wa-fab noprint" href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="WhatsApp"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path fill="#fff" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-3.9-.5-5.6-1.5l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.7 3.7 0 0 0-1.1 2.7 6.4 6.4 0 0 0 1.3 3.4 14.7 14.7 0 0 0 5.7 5c2.1.9 2.9 1 4 .8a3.4 3.4 0 0 0 2.2-1.6 2.8 2.8 0 0 0 .2-1.6c-.1-.1-.3-.2-.6-.4z"/></svg><span>${esc(t('write_wa'))}</span></a>` : ''}<script>${JS}</script></body></html>`;
}

// Схематичная карта маршрутов: склады в Китае → города выдачи, с бегущими точками и фурой.
function heroMap(t, lang) {
  // Направления — страны целиком: возим по всему Казахстану, Кыргызстану и России, не только в три города.
  const L = (ru, kk, zh) => (lang === 'zh' ? zh : lang === 'kk' ? kk : ru);
  const P = {
    gz: [600, 300, L('Гуанчжоу', 'Гуанчжоу', '广州')], yw: [660, 215, L('Иу', 'Иу', '义乌')],
    ala: [360, 150, L('Казахстан', 'Қазақстан', '哈萨克斯坦')], bsk: [270, 240, L('Кыргызстан', 'Қырғызстан', '吉尔吉斯斯坦')],
    msk: [80, 95, L('Россия', 'Ресей', '俄罗斯')],
  };
  const whole = L('по всей стране', 'бүкіл ел бойынша', '全境配送');
  const RU = { ala: 'Алматы', bsk: 'Бишкек', msk: 'Москва' }; // как в списке складов выдачи
  const routes = [['gz', 'ala', -40], ['yw', 'ala', -30], ['gz', 'bsk', 30], ['yw', 'msk', -50], ['gz', 'msk', -30]];
  const path = ([a, b, bend]) => {
    const [x1, y1] = P[a]; const [x2, y2] = P[b];
    return `M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2 + bend} ${x2},${y2}`;
  };
  const lines = routes.map((r, i) => `<path id="rt${i}" d="${path(r)}" class="glow" data-to="${r[1]}"/><path d="${path(r)}" class="route flow" data-to="${r[1]}" style="animation-delay:-${i * 0.3}s"/>`).join('');
  const movers = routes.map((r, i) => `<circle r="4" fill="#e5262d" class="mover"><animateMotion dur="${4 + (i % 3)}s" begin="${i * 0.7}s" repeatCount="indefinite" rotate="auto"><mpath href="#rt${i}"/></animateMotion></circle>`).join('');
  const plane = `<g class="mover"><path d="M-9,0 L9,0 M2,-7 L5,0 L2,7 M-7,-3 L-5,0 L-7,3" stroke="#e5262d" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><animateMotion dur="7s" repeatCount="indefinite" rotate="auto-reverse"><mpath href="#rt4"/></animateMotion></g>`;
  const cities = Object.entries(P).map(([k, [x, y, name]]) => {
    const hub = k === 'gz' || k === 'yw';
    return `<g class="city" data-key="${k}" data-city="${RU[k] || ''}"><circle cx="${x}" cy="${y}" r="${hub ? 9 : 6}" class="pulse" style="animation-delay:-${(x % 7) / 3}s"/>
      <circle cx="${x}" cy="${y}" r="${hub ? 6 : 4.5}" fill="${hub ? '#e5262d' : '#fff'}" stroke="#e5262d" stroke-width="2.5"/>
      ${hub ? '' : `<circle cx="${x}" cy="${y}" r="34" fill="#e5262d" opacity=".07"/>`}
      <text x="${x + (hub ? 14 : 11)}" y="${y + 6}" font-size="${hub ? 22 : 20}" font-weight="${hub ? 800 : 800}" fill="#22191a">${esc(name)}</text>
      ${hub ? '' : `<text class="sub" x="${x + 11}" y="${y + 24}" font-size="13" font-weight="600" fill="#e5262d">${esc(whole)}</text>`}</g>`;
  }).join('');
  const dots = `<pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#e8caca"/></pattern>`;
  const truck = `<g class="truck"><g transform="translate(0,352)">
    <rect x="0" y="0" width="92" height="34" rx="3" fill="#e5262d"/><text x="46" y="23" font-size="13" font-weight="900" fill="#fff" text-anchor="middle">CARGO 151</text>
    <path d="M94,8 h18 l12,12 v14 h-30 z" fill="#b8161c"/><rect x="100" y="11" width="10" height="8" fill="#ffe3e3"/>
    <circle cx="20" cy="38" r="7" fill="#22191a"/><circle cx="70" cy="38" r="7" fill="#22191a"/><circle cx="110" cy="38" r="7" fill="#22191a"/>
    <circle cx="20" cy="38" r="2.5" fill="#fff"/><circle cx="70" cy="38" r="2.5" fill="#fff"/><circle cx="110" cy="38" r="2.5" fill="#fff"/></g></g>`;
  // Самолёт летит из Китая на запад: у нас и авто-, и авиадоставка.
  const air = `<g class="air"><g transform="translate(820,58)">
    <path d="M100,-1 H170" stroke="#e5262d" stroke-width="2" stroke-dasharray="4 6" opacity=".45"/>
    <path d="M0,0 C6,-6 14,-8 24,-8 H64 L76,-24 H84 L79,-8 H90 Q96,-8 96,-1 Q96,5 90,5 H24 C14,5 6,3 0,0Z" fill="#e5262d"/>
    <path d="M36,-1 H54 L68,22 H58 Z" fill="#b8161c"/>
    <circle cx="16" cy="-3" r="2.2" fill="#ffe3e3"/><circle cx="26" cy="-4" r="1.8" fill="#fff"/><circle cx="34" cy="-4" r="1.8" fill="#fff"/><circle cx="42" cy="-4" r="1.8" fill="#fff"/></g></g>`;
  const modes = `<div class="modes"><span>🚛 ${esc(t('mode_auto'))}</span><span>✈️ ${esc(t('mode_air'))}</span></div>`;
  return `<div class="hero" aria-hidden="true"><div class="tag">${t('hero_tag')}</div>${modes}<svg viewBox="0 30 800 370" role="img"><defs>${dots}</defs>
    <rect width="800" height="400" fill="url(#dots)"/>${lines}${movers}${plane}${cities}${air}
    <rect x="0" y="392" width="800" height="8" fill="#22191a" opacity=".85"/><path d="M0,396 H800" stroke="#fff" stroke-width="1.5" stroke-dasharray="18 14"/>${truck}</svg>
    </div>`;
}

// Шкала статуса: фура доезжает до текущего этапа.
const STAGES = ['china', 'transit', 'border', 'arrived', 'delivered'];
function statusLine(t, status, compact) {
  const idx = STAGES.indexOf(status);
  const pct = idx < 0 ? 0 : (idx / (STAGES.length - 1)) * 100;
  const truck = `<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true"><rect x="0" y="1" width="16" height="10" rx="1.5" fill="#e5262d"/><path d="M17 4h4.5l3.5 3.5V11h-8z" fill="#b8161c"/><circle cx="5" cy="13" r="2.4" fill="#22191a"/><circle cx="20" cy="13" r="2.4" fill="#22191a"/></svg>`;
  const labels = STAGES.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}" style="left:${(i / (STAGES.length - 1)) * 100}%">${esc(t('sl_' + s))}</li>`).join('');
  return `<div class="prog${compact ? ' compact' : ''}" style="--p:${pct}%" title="${esc(t('st_' + status))}"><span class="ptruck">${truck}</span><div class="bar"><i></i></div><ol>${labels}</ol></div>`;
}

module.exports = { page, esc, heroMap, statusLine };
