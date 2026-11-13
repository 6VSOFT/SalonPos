'use strict';
/* ===== 数据层 (localStorage) ===== */
const KEY = 'salonpos.v1';
const DEFAULTS = {
  settings: { shop: '我的美容院', phone: '', address: '', currency: 'RM', cc: '60', footer: '谢谢惠顾，期待再次为您服务！', receiptNo: 1 },
  customers: [],  // {id,name,phone,birthday,notes,createdAt}
  catalog: [],    // 配套模板 {id,name,sessions,price}
  packages: [],   // 顾客购买的配套 {id,custId,name,sessions,price,date}
  payments: [],   // {id,no,custId,pkgId,amount,method,date,note}
  usages: [],     // 扣次记录 {id,pkgId,custId,date,note,apptId}
  appts: [],      // {id,custId,date,time,dur,service,pkgId,status,notes}
  products: [],   // 零售产品 {id,name,price,stock(null=不追踪)}
  sales: []       // 零售单 {id,no,custId,walkName,walkPhone,items[{prodId,name,price,qty}],subtotal,discount,total,method,received,date,note}
};
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return { ...structuredClone(DEFAULTS), ...d, settings: { ...DEFAULTS.settings, ...d.settings } };
  } catch (e) { console.error(e); }
  return structuredClone(DEFAULTS);
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { alert('保存失败：' + e.message); }
}

/* ===== 工具 ===== */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;
const tracked = p => typeof p.stock === 'number';
const money = n => `${db.settings.currency} ${num(n).toFixed(2)}`;
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const fmtDate = s => { const d = new Date(s + 'T00:00'); return `${s} (周${WD[d.getDay()]})`; };
const byName = (a, b) => a.name.localeCompare(b.name, 'zh');
const cust = id => db.customers.find(c => c.id === id);
const pkg = id => db.packages.find(p => p.id === id);
const pkgUsed = p => db.usages.filter(u => u.pkgId === p.id).length;
const pkgRemain = p => p.sessions - pkgUsed(p);
const pkgPaid = p => db.payments.filter(x => x.pkgId === p.id).reduce((s, x) => s + x.amount, 0);
const pkgBalance = p => Math.round((p.price - pkgPaid(p)) * 100) / 100;
const custPkgs = id => db.packages.filter(p => p.custId === id);
const custRemain = id => custPkgs(id).reduce((s, p) => s + Math.max(0, pkgRemain(p)), 0);
const custBalance = id => custPkgs(id).reduce((s, p) => s + Math.max(0, pkgBalance(p)), 0);
const METHODS = ['现金', '银行转账', '电子钱包', '信用卡'];
const STATUS = { booked: ['已预约', ''], done: ['已完成', 'ok'], cancelled: ['已取消', 'off'] };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ===== WhatsApp ===== */
function waPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = db.settings.cc + d.slice(1);
  return d;
}
function waSend(phone, text) {
  const p = waPhone(phone);
  if (!p) toast('该顾客没有电话号码，请在 WhatsApp 中自行选择联系人');
  window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
function receiptText(pay) {
  const s = db.settings, c = cust(pay.custId), p = pkg(pay.pkgId);
  const L = [`*${s.shop}*`];
  if (s.address) L.push(s.address);
  if (s.phone) L.push(`电话: ${s.phone}`);
  L.push('──────────────', `*收据 Receipt* #${pay.no}`, `日期: ${pay.date}`, `顾客: ${c ? c.name : '-'}`);
  if (p) L.push(`配套: ${p.name} (${p.sessions} 次)`, `配套价格: ${money(p.price)}`);
  L.push('──────────────', `*本次付款: ${money(pay.amount)}* (${pay.method})`);
  if (p) L.push(`已付总额: ${money(pkgPaid(p))}`, `尚欠余额: ${money(Math.max(0, pkgBalance(p)))}`, `剩余次数: ${pkgRemain(p)} / ${p.sessions} 次`);
  if (pay.note) L.push(`备注: ${pay.note}`);
  L.push('──────────────', s.footer);
  return L.join('\n');
}
function usageText(u) {
  const p = pkg(u.pkgId), c = cust(u.custId);
  return [`*${db.settings.shop}*`, `${c ? c.name : ''} 您好，`, `您于 ${u.date} 使用了「${p.name}」1 次。`,
    `*剩余次数: ${pkgRemain(p)} / ${p.sessions} 次*`, db.settings.footer].join('\n');
}
function apptText(a) {
  const c = cust(a.custId);
  return [`*${db.settings.shop}*`, `${c ? c.name : ''} 您好，温馨提醒您的预约：`, `日期: ${fmtDate(a.date)}`, `时间: ${a.time}`,
    a.service ? `项目: ${a.service}` : '', '如需更改请提前联系我们，谢谢！'].filter(Boolean).join('\n');
}
/* 预览信息并通过 WhatsApp 发送 */
function msgSheet(title, phone, text) {
  openSheet(title, `<pre class="receipt">${esc(text)}</pre>
    <div class="btns" style="margin-bottom:12px">
      <button type="button" class="btn wa" id="waBtn">WhatsApp 发送</button>
      <button type="button" class="btn" id="cpBtn">复制文字</button>
    </div>`, null, form => {
    form.querySelector('#waBtn').onclick = () => waSend(phone, text);
    form.querySelector('#cpBtn').onclick = () => navigator.clipboard.writeText(text).then(() => toast('已复制'), () => toast('复制失败'));
  });
}
const showReceipt = pay => msgSheet(`收据 #${pay.no}`, cust(pay.custId)?.phone, receiptText(pay));

/* ===== 弹出表单 ===== */
const sheet = $('#sheet');
function openSheet(title, html, onSubmit, onOpen, submitLabel = '保存') {
  sheet.innerHTML = `<form><header><h2>${esc(title)}</h2><button type="button" class="x" data-act="closeSheet" aria-label="关闭">✕</button></header>
    <div class="body">${html}</div>
    ${onSubmit ? `<footer><button type="button" class="btn" data-act="closeSheet">取消</button><button class="btn primary" type="submit">${submitLabel}</button></footer>` : ''}</form>`;
  const form = sheet.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    if (!onSubmit) return;
    const r = onSubmit(Object.fromEntries(new FormData(form)));
    if (r === false) return;
    sheet.close(); save(); render();
    if (typeof r === 'function') r();
  };
  if (onOpen) onOpen(form);
  if (!sheet.open) sheet.showModal();
}
function custField(sel, walkin) {
  const opts = db.customers.slice().sort(byName).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}　${esc(c.phone)}</option>`).join('');
  return `<label>顾客<select name="custId" ${walkin ? '' : 'required'}><option value="">${walkin ? 'Walk-in 散客（不记录顾客）' : '— 选择顾客 —'}</option>${opts}<option value="__new">＋ 新顾客</option></select></label>
    <div class="two newcust" hidden><label>新顾客姓名<input name="newName" autocomplete="off"></label><label>电话<input name="newPhone" type="tel" autocomplete="off"></label></div>`;
}
function wireCustField(form, onChange) {
  const sel = form.elements.custId, box = form.querySelector('.newcust');
  const upd = () => { box.hidden = sel.value !== '__new'; form.elements.newName.required = !box.hidden; if (onChange) onChange(sel.value); };
  sel.onchange = upd; upd();
}
function resolveCust(f) {
  if (f.custId !== '__new') return f.custId;
  const c = { id: uid(), name: f.newName.trim(), phone: f.newPhone.trim(), birthday: '', notes: '', createdAt: Date.now() };
  db.customers.push(c);
  return c.id;
}
const pkgOptions = (custId, sel, emptyLabel) => `<option value="">${emptyLabel}</option>` +
  custPkgs(custId).filter(p => pkgRemain(p) > 0 || p.id === sel)
    .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}（剩 ${pkgRemain(p)} 次）</option>`).join('');

/* ===== 界面状态 ===== */
const now = new Date();
const ui = { tab: 'cal', month: new Date(now.getFullYear(), now.getMonth(), 1), sel: today(), custId: null, q: '' };

function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#title').textContent = db.settings.shop;
  $('#view').innerHTML = ({ cal: viewCal, cust: () => ui.custId && cust(ui.custId) ? viewCustDetail(cust(ui.custId)) : viewCustList(), sales: viewSales, set: viewSettings })[ui.tab]();
}

/* ----- 功能 1：预约日历 ----- */
function apptCard(a, showDate) {
  const c = cust(a.custId), [label, cls] = STATUS[a.status] || STATUS.booked, p = a.pkgId && pkg(a.pkgId);
  return `<div class="card appt ${a.status}">
    <div class="row"><div class="time">${showDate ? esc(a.date.slice(5)) + ' ' : ''}${esc(a.time)}</div>
      <div class="grow"><div class="name">${esc(c ? c.name : '(已删除顾客)')}</div>
        <div class="muted">${esc(a.service || '未填写项目')} · ${a.dur} 分钟${p ? ' · ' + esc(p.name) : ''}</div>
        ${a.notes ? `<div class="muted">📝 ${esc(a.notes)}</div>` : ''}</div>
      <span class="badge ${cls}">${label}</span></div>
    <div class="btns">
      ${a.status === 'booked' ? `<button class="btn small primary" data-act="apptDone" data-id="${a.id}">完成</button>
        <button class="btn small wa" data-act="apptRemind" data-id="${a.id}">WhatsApp 提醒</button>` : ''}
      <button class="btn small" data-act="apptEdit" data-id="${a.id}">编辑</button>
      ${a.status === 'booked' ? `<button class="btn small danger" data-act="apptCancel" data-id="${a.id}">取消预约</button>`
        : `<button class="btn small danger" data-act="apptDelete" data-id="${a.id}">删除</button>`}
    </div></div>`;
}
function viewCal() {
  const y = ui.month.getFullYear(), m = ui.month.getMonth(), t = today();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const counts = {};
  db.appts.forEach(a => { if (a.status !== 'cancelled') counts[a.date] = (counts[a.date] || 0) + 1; });
  let cells = WD.map(w => `<div class="wd">${w}</div>`).join('') + '<span></span>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
    cells += `<button class="day ${ds === t ? 'today' : ''} ${ds === ui.sel ? 'sel' : ''}" data-act="selDate" data-d="${ds}"><b>${d}</b>${counts[ds] ? `<i>${counts[ds]}</i>` : ''}</button>`;
  }
  const list = db.appts.filter(a => a.date === ui.sel).sort((a, b) => a.time.localeCompare(b.time));
  return `<div class="card">
      <div class="cal-head"><button class="btn small" data-act="month" data-n="-1" aria-label="上个月">‹</button>
        <strong>${y} 年 ${m + 1} 月</strong>
        <span><button class="btn small" data-act="goToday">今天</button> <button class="btn small" data-act="month" data-n="1" aria-label="下个月">›</button></span></div>
      <div class="cal">${cells}</div></div>
    <div class="h2">${fmtDate(ui.sel)}<span class="muted">${list.filter(a => a.status !== 'cancelled').length} 个预约</span></div>
    ${list.length ? list.map(a => apptCard(a)).join('') : '<div class="empty">这一天还没有预约</div>'}
    <button class="fab" data-act="apptNew">＋ 新预约</button>`;
}
function apptForm(a, presetCust) {
  const isNew = !a;
  a = a || { custId: presetCust || '', date: ui.sel, time: '10:00', dur: 60, service: '', pkgId: '', notes: '', status: 'booked' };
  const services = [...new Set([...db.catalog.map(x => x.name), ...db.appts.map(x => x.service)].filter(Boolean))];
  openSheet(isNew ? '新预约' : '编辑预约', `${custField(a.custId)}
    <div class="two"><label>日期<input type="date" name="date" value="${a.date}" required></label>
      <label>时间<input type="time" name="time" value="${a.time}" step="300" required></label></div>
    <div class="two"><label>时长（分钟）<input type="number" name="dur" value="${a.dur}" min="5" step="5" required></label>
      <label>服务项目<input name="service" value="${esc(a.service)}" list="svcList" autocomplete="off"></label></div>
    <datalist id="svcList">${services.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <label>使用配套（完成时扣次）<select name="pkgId"></select></label>
    <label>备注<textarea name="notes">${esc(a.notes)}</textarea></label>`,
    f => {
      const dur = Math.max(5, parseInt(f.dur) || 60);
      const start = t => { const [h, mi] = t.split(':').map(Number); return h * 60 + mi; };
      const clash = db.appts.find(x => x.id !== a.id && x.status === 'booked' && x.date === f.date &&
        start(x.time) < start(f.time) + dur && start(f.time) < start(x.time) + x.dur);
      if (clash && !confirm(`该时段与 ${cust(clash.custId)?.name || '其他顾客'} (${clash.time}) 的预约重叠，仍要保存吗？`)) return false;
      const custId = resolveCust(f);
      Object.assign(a, { custId, date: f.date, time: f.time, dur, service: f.service.trim(), pkgId: f.custId === '__new' ? '' : f.pkgId, notes: f.notes.trim() });
      if (isNew) { a.id = uid(); db.appts.push(a); }
      ui.sel = a.date; ui.month = new Date(+a.date.slice(0, 4), +a.date.slice(5, 7) - 1, 1);
      toast('预约已保存');
    },
    form => wireCustField(form, id => { form.elements.pkgId.innerHTML = pkgOptions(id, a.pkgId, '不使用配套'); }));
}
function apptDone(a) {
  openSheet('完成预约', `<p>${esc(cust(a.custId)?.name || '')} · ${esc(a.date)} ${esc(a.time)} · ${esc(a.service || '')}</p>
    <label>扣除配套次数<select name="pkgId">${pkgOptions(a.custId, a.pkgId, '不扣次数')}</select></label>`,
    f => {
      a.status = 'done';
      if (!f.pkgId) return;
      a.pkgId = f.pkgId;
      const u = { id: uid(), pkgId: f.pkgId, custId: a.custId, date: a.date, note: a.service, apptId: a.id };
      db.usages.push(u);
      return () => msgSheet('已扣除 1 次', cust(u.custId)?.phone, usageText(u));
    }, null, '确认完成');
}

/* ----- 功能 3：顾客 ----- */
function custRows() {
  const q = ui.q.trim().toLowerCase();
  const list = db.customers.filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '~')).sort(byName);
  if (!list.length) return `<div class="empty">${db.customers.length ? '没有符合的顾客' : '还没有顾客，点击右下角添加'}</div>`;
  return list.map(c => {
    const r = custRemain(c.id), b = custBalance(c.id);
    return `<div class="card row" data-act="custOpen" data-id="${c.id}" role="button" tabindex="0" style="cursor:pointer">
      <div class="grow"><div class="name">${esc(c.name)}</div><div class="muted">${esc(c.phone || '无电话')}</div></div>
      <div style="text-align:right">${r ? `<span class="badge">剩 ${r} 次</span>` : ''}${b > 0 ? `<br><span class="badge warn">欠 ${money(b)}</span>` : ''}</div></div>`;
  }).join('');
}
function viewCustList() {
  return `<input class="search" id="q" type="search" placeholder="搜索姓名或电话…" value="${esc(ui.q)}">
    <div class="muted" style="margin-bottom:8px">共 ${db.customers.length} 位顾客</div>
    <div id="custList">${custRows()}</div>
    <button class="fab" data-act="custNew">＋ 新顾客</button>`;
}
function pkgCard(p, showCust) {
  const used = pkgUsed(p), rem = p.sessions - used, bal = pkgBalance(p);
  return `<div class="card">
    <div class="row"><div class="grow"><div class="name">${showCust ? esc(cust(p.custId)?.name || '') + ' · ' : ''}${esc(p.name)}</div>
      <div class="muted">购买日期 ${esc(p.date)} · ${money(p.price)}</div></div>
      <span class="badge ${rem > 0 ? '' : 'off'}">剩 ${rem} / ${p.sessions} 次</span></div>
    <div class="bar"><div style="width:${p.sessions ? Math.min(100, used / p.sessions * 100) : 0}%"></div></div>
    <div class="row muted"><span class="grow">已付 ${money(pkgPaid(p))}</span>
      ${bal > 0 ? `<span class="badge warn">尚欠 ${money(bal)}</span>` : '<span class="badge ok">已付清</span>'}</div>
    <div class="btns">
      ${rem > 0 ? `<button class="btn small primary" data-act="pkgUse" data-id="${p.id}">扣 1 次</button>` : ''}
      ${bal > 0 ? `<button class="btn small" data-act="payNew" data-id="${p.id}">收款</button>` : ''}
      <button class="btn small" data-act="pkgHistory" data-id="${p.id}">使用记录</button>
      <button class="btn small danger" data-act="pkgDelete" data-id="${p.id}">删除</button>
    </div></div>`;
}
function payRow(x, showCust) {
  const p = pkg(x.pkgId);
  return `<div class="card row"><div class="grow"><div class="name">${showCust ? esc(cust(x.custId)?.name || '(已删除)') + ' · ' : ''}${money(x.amount)}</div>
    <div class="muted">#${x.no} · ${esc(x.date)} · ${esc(x.method)}${p ? ' · ' + esc(p.name) : ''}</div></div>
    <button class="btn small wa" data-act="payReceipt" data-id="${x.id}">收据</button>
    <button class="btn small danger" data-act="payDelete" data-id="${x.id}" aria-label="删除付款">✕</button></div>`;
}
function viewCustDetail(c) {
  const pk = custPkgs(c.id).sort((a, b) => b.date.localeCompare(a.date));
  const ap = db.appts.filter(a => a.custId === c.id).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const up = ap.filter(a => a.status === 'booked' && a.date >= today()).reverse();
  const past = ap.filter(a => !up.includes(a)).slice(0, 10);
  return `<button class="btn small" data-act="custBack">‹ 顾客列表</button>
    <div class="card" style="margin-top:12px">
      <div class="row"><div class="grow"><div class="name" style="font-size:19px">${esc(c.name)}</div>
        <div class="muted">${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '无电话'}${c.birthday ? ' · 🎂 ' + esc(c.birthday) : ''}</div></div>
        <div style="text-align:right"><span class="badge">剩 ${custRemain(c.id)} 次</span>${custBalance(c.id) > 0 ? `<br><span class="badge warn">欠 ${money(custBalance(c.id))}</span>` : ''}</div></div>
      ${c.notes ? `<div class="muted" style="margin-top:6px;white-space:pre-wrap">📝 ${esc(c.notes)}</div>` : ''}
      <div class="btns"><button class="btn small primary" data-act="pkgSell" data-id="${c.id}">卖配套</button>
        <button class="btn small" data-act="saleNew" data-id="${c.id}">买产品</button>
        <button class="btn small" data-act="apptNew" data-id="${c.id}">新预约</button>
        ${c.phone ? `<button class="btn small wa" data-act="custWa" data-id="${c.id}">WhatsApp</button>` : ''}
        <button class="btn small" data-act="custEdit" data-id="${c.id}">编辑</button>
        <button class="btn small danger" data-act="custDelete" data-id="${c.id}">删除</button></div></div>
    <div class="h2">配套（${pk.length}）</div>${pk.length ? pk.map(p => pkgCard(p)).join('') : '<div class="empty">尚未购买配套</div>'}
    <div class="h2">即将到来的预约</div>${up.length ? up.map(a => apptCard(a, true)).join('') : '<div class="empty">没有预约</div>'}
    ${past.length ? `<div class="h2">过往预约</div>${past.map(a => apptCard(a, true)).join('')}` : ''}
    <div class="h2">收款记录</div>${txList(t => t.custId === c.id)}`;
}
function custForm(c) {
  const isNew = !c;
  c = c || { name: '', phone: '', birthday: '', notes: '' };
  openSheet(isNew ? '新顾客' : '编辑顾客', `<label>姓名<input name="name" value="${esc(c.name)}" required autocomplete="off"></label>
    <label>电话（WhatsApp）<input name="phone" type="tel" value="${esc(c.phone)}" placeholder="例如 012-3456789" autocomplete="off"></label>
    <label>生日<input name="birthday" type="date" value="${esc(c.birthday)}"></label>
    <label>备注（肤质、过敏、喜好…）<textarea name="notes">${esc(c.notes)}</textarea></label>`,
    f => {
      const phone = f.phone.trim(), dup = phone && db.customers.find(x => x.id !== c.id && waPhone(x.phone) === waPhone(phone));
      if (dup && !confirm(`电话号码与顾客「${dup.name}」相同，仍要保存吗？`)) return false;
      Object.assign(c, { name: f.name.trim(), phone, birthday: f.birthday, notes: f.notes.trim() });
      if (isNew) { c.id = uid(); c.createdAt = Date.now(); db.customers.push(c); ui.custId = c.id; }
      toast('顾客资料已保存');
    });
}

/* ----- 功能 2：配套、付款、剩余次数 ----- */
function addPayment(custId, pkgId, amount, method, date, note) {
  const pay = { id: uid(), no: db.settings.receiptNo++, custId, pkgId, amount, method, date, note: note || '' };
  db.payments.push(pay);
  return pay;
}
const methodField = `<label>付款方式<select name="method">${METHODS.map(m => `<option>${m}</option>`).join('')}</select></label>`;
function sellForm(presetCust) {
  openSheet('卖配套', `${custField(presetCust)}
    ${db.catalog.length ? `<label>选择配套模板<select name="tpl"><option value="">自定义</option>${db.catalog.map(t => `<option value="${t.id}">${esc(t.name)}（${t.sessions} 次 · ${money(t.price)}）</option>`).join('')}</select></label>` : ''}
    <label>配套名称<input name="name" required autocomplete="off" placeholder="例如 脸部护理 10 次"></label>
    <div class="two"><label>次数<input name="sessions" type="number" min="1" step="1" value="10" required></label>
      <label>配套价格 (${esc(db.settings.currency)})<input name="price" type="number" min="0" step="0.01" required></label></div>
    <div class="two"><label>本次收款 (${esc(db.settings.currency)})<input name="amount" type="number" min="0" step="0.01" placeholder="0 = 暂未付款"></label>${methodField}</div>
    <label>日期<input name="date" type="date" value="${today()}" required></label>`,
    f => {
      const price = num(f.price), amount = num(f.amount);
      if (amount > price && !confirm('收款金额大于配套价格，确定吗？')) return false;
      const custId = resolveCust(f);
      const p = { id: uid(), custId, name: f.name.trim(), sessions: Math.max(1, parseInt(f.sessions) || 1), price, date: f.date };
      db.packages.push(p);
      toast('配套已记录');
      if (amount > 0) { const pay = addPayment(custId, p.id, amount, f.method, f.date); return () => showReceipt(pay); }
    },
    form => {
      wireCustField(form);
      if (form.elements.tpl) form.elements.tpl.onchange = e => {
        const t = db.catalog.find(x => x.id === e.target.value); if (!t) return;
        form.elements.name.value = t.name; form.elements.sessions.value = t.sessions; form.elements.price.value = t.price; form.elements.amount.value = t.price;
      };
    }, '确认');
}
function payForm(p) {
  const bal = pkgBalance(p);
  openSheet('收款', `<p>${esc(cust(p.custId)?.name || '')} · ${esc(p.name)}<br><span class="muted">配套 ${money(p.price)} · 已付 ${money(pkgPaid(p))} · 尚欠 ${money(bal)}</span></p>
    <div class="two"><label>收款金额 (${esc(db.settings.currency)})<input name="amount" type="number" min="0.01" step="0.01" value="${bal.toFixed(2)}" required></label>${methodField}</div>
    <label>日期<input name="date" type="date" value="${today()}" required></label>
    <label>备注<input name="note" autocomplete="off"></label>`,
    f => {
      const amount = num(f.amount);
      if (amount <= 0) { toast('请输入金额'); return false; }
      if (amount > bal && !confirm('收款金额大于尚欠余额，确定吗？')) return false;
      const pay = addPayment(p.custId, p.id, amount, f.method, f.date, f.note.trim());
      return () => showReceipt(pay);
    }, null, '确认收款');
}
function useForm(p) {
  openSheet('扣除 1 次', `<p>${esc(cust(p.custId)?.name || '')} · ${esc(p.name)}<br><span class="muted">目前剩余 ${pkgRemain(p)} / ${p.sessions} 次</span></p>
    <label>日期<input name="date" type="date" value="${today()}" required></label>
    <label>备注<input name="note" autocomplete="off" placeholder="例如 服务项目、美容师"></label>`,
    f => {
      const u = { id: uid(), pkgId: p.id, custId: p.custId, date: f.date, note: f.note.trim(), apptId: '' };
      db.usages.push(u);
      return () => msgSheet('已扣除 1 次', cust(u.custId)?.phone, usageText(u));
    }, null, '确认扣次');
}
function historySheet(p) {
  const us = db.usages.filter(u => u.pkgId === p.id).sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`使用记录 · ${p.name}`, (us.length ? us.map((u, i) => `<div class="card row"><div class="grow"><div class="name">第 ${us.length - i} 次 · ${esc(u.date)}</div>
      <div class="muted">${esc(u.note || '')}</div></div><button type="button" class="btn small danger" data-act="useDelete" data-id="${u.id}">撤销</button></div>`).join('')
    : '<div class="empty">还没有使用记录</div>') + `<p class="muted">剩余 ${pkgRemain(p)} / ${p.sessions} 次</p>`);
}
function viewSales() {
  const t = today(), mon = t.slice(0, 7);
  const tx = allTx();
  const sum = f => tx.filter(f).reduce((s, x) => s + x.amount, 0);
  const byMethod = {};
  tx.filter(x => x.date === t).forEach(x => { byMethod[x.method] = r2((byMethod[x.method] || 0) + x.amount); });
  const active = db.packages.filter(p => cust(p.custId) && (pkgRemain(p) > 0 || pkgBalance(p) > 0))
    .sort((a, b) => pkgBalance(b) - pkgBalance(a) || byName(cust(a.custId), cust(b.custId)));
  const owed = active.reduce((s, p) => s + Math.max(0, pkgBalance(p)), 0);
  return `<div class="btns" style="margin:0 0 12px"><button class="btn primary" data-act="saleNew">＋ 产品零售</button><button class="btn" data-act="pkgSell">＋ 卖配套</button></div>
    <div class="stats"><div class="stat"><small>今日收款</small><b>${money(sum(x => x.date === t))}</b></div>
      <div class="stat"><small>本月收款</small><b>${money(sum(x => x.date.startsWith(mon)))}</b></div>
      <div class="stat"><small>顾客欠款</small><b>${money(owed)}</b></div></div>
    ${Object.keys(byMethod).length ? `<div class="method-sum">今日：${Object.entries(byMethod).map(([m, a]) => `${esc(m)} ${money(a)}`).join(' · ')}</div>` : ''}
    <div class="h2">未完成配套（${active.length}）<span class="muted">共剩 ${active.reduce((s, p) => s + Math.max(0, pkgRemain(p)), 0)} 次</span></div>
    ${active.length ? active.map(p => pkgCard(p, true)).join('') : '<div class="empty">没有未用完或未付清的配套</div>'}
    <div class="h2">最近收款</div>${txList(() => true, true, 40)}`;
}

/* ----- 产品零售（Walk-in 单次购买） ----- */
function allTx() {
  return [
    ...db.payments.map(x => ({ kind: 'pay', rec: x, no: x.no, date: x.date, method: x.method, amount: x.amount, custId: x.custId })),
    ...db.sales.map(x => ({ kind: 'sale', rec: x, no: x.no, date: x.date, method: x.method, amount: x.total, custId: x.custId }))
  ].sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
}
function txList(filter, showCust, limit = Infinity) {
  const list = allTx().filter(filter).slice(0, limit);
  return list.length ? list.map(t => t.kind === 'pay' ? payRow(t.rec, showCust) : saleRow(t.rec, showCust)).join('')
    : '<div class="empty">没有收款记录</div>';
}
function saleCustName(s) {
  const c = s.custId && cust(s.custId);
  return c ? c.name : (s.walkName ? `${s.walkName}（散客）` : 'Walk-in 散客');
}
function saleText(s) {
  const st = db.settings, L = [`*${st.shop}*`];
  if (st.address) L.push(st.address);
  if (st.phone) L.push(`电话: ${st.phone}`);
  L.push('──────────────', `*收据 Receipt* #${s.no}`, `日期: ${s.date}`, `顾客: ${saleCustName(s)}`, '──────────────');
  s.items.forEach(i => L.push(i.name, `  ${i.qty} x ${money(i.price)} = ${money(i.qty * i.price)}`));
  L.push('──────────────');
  if (s.discount > 0) L.push(`小计: ${money(s.subtotal)}`, `折扣: -${money(s.discount)}`);
  L.push(`*总额: ${money(s.total)}* (${s.method})`);
  if (s.received > 0) L.push(`收到: ${money(s.received)}`, `找零: ${money(s.received - s.total)}`);
  if (s.note) L.push(`备注: ${s.note}`);
  L.push('──────────────', st.footer);
  return L.join('\n');
}
const showSaleReceipt = s => msgSheet(`收据 #${s.no}`, (s.custId && cust(s.custId)?.phone) || s.walkPhone, saleText(s));
function saleRow(s, showCust) {
  const items = s.items.map(i => i.qty > 1 ? `${i.name}×${i.qty}` : i.name).join('、');
  return `<div class="card row"><div class="grow"><div class="name">${showCust ? esc(saleCustName(s)) + ' · ' : ''}${money(s.total)}</div>
    <div class="muted">#${s.no} · ${esc(s.date)} · ${esc(s.method)} · 🛍 ${esc(items)}</div></div>
    <button class="btn small wa" data-act="saleReceipt" data-id="${s.id}">收据</button>
    <button class="btn small danger" data-act="saleDelete" data-id="${s.id}" aria-label="删除零售记录">✕</button></div>`;
}
function saleForm(presetCust) {
  const lines = [];
  let calc;
  const cur = esc(db.settings.currency);
  const prodOpts = db.products.slice().sort(byName).map(p => `<option value="${p.id}">${esc(p.name)} · ${money(p.price)}${tracked(p) ? (p.stock > 0 ? ` · 库存 ${p.stock}` : ' · 缺货') : ''}</option>`).join('');
  openSheet('产品零售', `${custField(presetCust, true)}
    <label class="walkin">电话（选填，用于 WhatsApp 收据）<input name="walkPhone" type="tel" autocomplete="off"></label>
    <div class="h2" style="margin-top:4px">购买项目</div>
    <div id="lines"></div>
    <label>加入项目<select id="pick"><option value="">— 选择产品 —</option>${prodOpts}<option value="__custom">＋ 自定义项目</option></select></label>
    <div class="custom-row" hidden><input id="cName" placeholder="项目名称" autocomplete="off"><input id="cPrice" type="number" min="0" step="0.01" placeholder="单价"><button type="button" class="btn" id="cAdd">加入</button></div>
    <div class="two"><label>折扣 (${cur})<input name="discount" type="number" min="0" step="0.01" placeholder="0"></label>${methodField}</div>
    <div class="card totals" id="totals"></div>
    <label class="cashbox">收到现金 (${cur})<input name="received" type="number" min="0" step="0.01" placeholder="选填，用于计算找零"></label>
    <div class="two"><label>日期<input name="date" type="date" value="${today()}" required></label><label>备注<input name="note" autocomplete="off"></label></div>`,
    f => {
      if (!lines.length) { toast('请先加入购买项目'); return false; }
      const c = calc(), received = f.method === '现金' ? r2(c.received) : 0;
      if (received > 0 && received < c.total) { toast('收到的现金少于应收金额'); return false; }
      const need = {};
      lines.forEach(l => { if (l.prodId) need[l.prodId] = (need[l.prodId] || 0) + l.qty; });
      const short = Object.entries(need).map(([id, q]) => [db.products.find(p => p.id === id), q]).filter(([p, q]) => p && tracked(p) && q > p.stock);
      if (short.length && !confirm(`库存不足：\n${short.map(([p, q]) => `${p.name}（库存 ${p.stock}，需要 ${q}）`).join('\n')}\n仍要继续吗？`)) return false;
      const custId = resolveCust(f);
      Object.entries(need).forEach(([id, q]) => { const p = db.products.find(x => x.id === id); if (p && tracked(p)) p.stock -= q; });
      const s = { id: uid(), no: db.settings.receiptNo++, custId, walkName: '', walkPhone: custId ? '' : f.walkPhone.trim(),
        items: lines.map(l => ({ ...l })), subtotal: c.subtotal, discount: c.discount, total: c.total, method: f.method, received, date: f.date, note: f.note.trim() };
      db.sales.push(s);
      toast('收款完成');
      return () => showSaleReceipt(s);
    },
    form => {
      const E = form.elements, linesEl = form.querySelector('#lines'), pick = form.querySelector('#pick'), customRow = form.querySelector('.custom-row');
      calc = () => {
        const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
        const discount = r2(Math.min(subtotal, Math.max(0, num(E.discount.value))));
        return { subtotal, discount, total: r2(subtotal - discount), received: num(E.received.value) };
      };
      const updTotals = () => {
        const c = calc(), cash = E.method.value === '现金';
        form.querySelector('.cashbox').hidden = !cash;
        form.querySelector('#totals').innerHTML = `
          <div class="row"><span class="grow">小计（${lines.reduce((s, l) => s + l.qty, 0)} 件）</span><span>${money(c.subtotal)}</span></div>
          ${c.discount > 0 ? `<div class="row"><span class="grow">折扣</span><span>-${money(c.discount)}</span></div>` : ''}
          <div class="row grand"><span class="grow">应收</span><span>${money(c.total)}</span></div>
          ${cash && c.received > 0 ? `<div class="row ${c.received < c.total ? 'neg' : ''}"><span class="grow">${c.received < c.total ? '还差' : '找零'}</span><span>${money(Math.abs(c.received - c.total))}</span></div>` : ''}`;
      };
      const renderLines = () => {
        linesEl.innerHTML = lines.length ? lines.map((l, i) => `<div class="line">
          <div class="row"><span class="grow name">${esc(l.name)}</span><button type="button" class="x" data-rm="${i}" aria-label="移除">✕</button></div>
          <div class="ctl"><div class="qty"><button type="button" data-q="${i}" data-d="-1" aria-label="减少">−</button><input data-qi="${i}" type="number" min="1" step="1" value="${l.qty}" inputmode="numeric" aria-label="数量"><button type="button" data-q="${i}" data-d="1" aria-label="增加">＋</button></div>
            <span class="muted">×</span><input class="price" data-pi="${i}" type="number" min="0" step="0.01" value="${l.price}" aria-label="单价"><span class="sum" data-si="${i}">${money(l.qty * l.price)}</span></div></div>`).join('')
          : '<div class="empty" style="padding:12px">还没有加入项目</div>';
        updTotals();
      };
      const add = (name, price, prodId) => {
        const ex = prodId && lines.find(l => l.prodId === prodId);
        if (ex) ex.qty++; else lines.push({ prodId: prodId || '', name, price: r2(price), qty: 1 });
        renderLines();
      };
      pick.onchange = () => {
        customRow.hidden = pick.value !== '__custom';
        if (pick.value === '__custom') { form.querySelector('#cName').focus(); return; }
        const p = db.products.find(x => x.id === pick.value);
        if (p) add(p.name, p.price, p.id);
        pick.value = '';
      };
      form.querySelector('#cAdd').onclick = () => {
        const n = form.querySelector('#cName'), pr = form.querySelector('#cPrice');
        if (!n.value.trim()) { n.focus(); return; }
        add(n.value.trim(), Math.max(0, num(pr.value)));
        n.value = ''; pr.value = ''; customRow.hidden = true; pick.value = '';
      };
      // 在项目区按 Enter 不要直接提交整张单
      customRow.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); form.querySelector('#cAdd').click(); } });
      linesEl.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
      linesEl.addEventListener('click', e => {
        const q = e.target.closest('[data-q]'), rm = e.target.closest('[data-rm]');
        if (q) { const l = lines[q.dataset.q]; l.qty = Math.max(1, l.qty + +q.dataset.d); renderLines(); }
        if (rm) { lines.splice(+rm.dataset.rm, 1); renderLines(); }
      });
      linesEl.addEventListener('input', e => {
        const t = e.target, i = t.dataset.qi ?? t.dataset.pi;
        if (i === undefined) return;
        const l = lines[i];
        if (t.dataset.qi !== undefined) l.qty = Math.max(1, parseInt(t.value) || 1); else l.price = r2(Math.max(0, num(t.value)));
        linesEl.querySelector(`[data-si="${i}"]`).textContent = money(l.qty * l.price);
        updTotals();
      });
      E.discount.addEventListener('input', updTotals);
      E.received.addEventListener('input', updTotals);
      E.method.addEventListener('change', updTotals);
      wireCustField(form, id => { form.querySelector('.walkin').hidden = id !== ''; });
      renderLines();
    }, '确认收款');
}
function prodForm(p) {
  const isNew = !p;
  p = p || { name: '', price: '', stock: null };
  openSheet(isNew ? '添加产品' : '编辑产品', `<label>产品名称<input name="name" value="${esc(p.name)}" required autocomplete="off"></label>
    <div class="two"><label>售价 (${esc(db.settings.currency)})<input name="price" type="number" min="0" step="0.01" value="${p.price}" required></label>
      <label>库存数量<input name="stock" type="number" step="1" value="${tracked(p) ? p.stock : ''}" placeholder="留空 = 不追踪"></label></div>`,
    f => {
      Object.assign(p, { name: f.name.trim(), price: r2(num(f.price)), stock: f.stock.trim() === '' ? null : (parseInt(f.stock) || 0) });
      if (isNew) { p.id = uid(); db.products.push(p); }
      toast('产品已保存');
    });
}

/* ----- 设置 ----- */
function viewSettings() {
  const s = db.settings;
  return `<div class="h2" style="margin-top:0">店铺资料（显示在收据上）</div>
    <form class="card" id="setForm">
      <label>店名<input name="shop" value="${esc(s.shop)}" required></label>
      <label>店铺电话<input name="phone" type="tel" value="${esc(s.phone)}"></label>
      <label>地址<input name="address" value="${esc(s.address)}"></label>
      <div class="two"><label>货币符号<input name="currency" value="${esc(s.currency)}" required></label>
        <label>WhatsApp 国家区号<input name="cc" value="${esc(s.cc)}" inputmode="numeric" required></label></div>
      <label>收据结尾语<input name="footer" value="${esc(s.footer)}"></label>
      <button class="btn primary">保存设置</button></form>
    <div class="h2">配套模板<button class="btn small" data-act="tplNew">＋ 添加</button></div>
    ${db.catalog.length ? db.catalog.map(t => `<div class="card row"><div class="grow"><div class="name">${esc(t.name)}</div><div class="muted">${t.sessions} 次 · ${money(t.price)}</div></div>
      <button class="btn small" data-act="tplEdit" data-id="${t.id}">编辑</button><button class="btn small danger" data-act="tplDelete" data-id="${t.id}">删除</button></div>`).join('')
      : '<div class="empty">添加常用配套，卖配套时可一键选择</div>'}
    <div class="h2">零售产品<button class="btn small" data-act="prodNew">＋ 添加</button></div>
    ${db.products.length ? db.products.slice().sort(byName).map(p => `<div class="card row"><div class="grow"><div class="name">${esc(p.name)}</div>
        <div class="muted">${money(p.price)} · ${tracked(p) ? `库存 ${p.stock}` : '不追踪库存'}</div></div>
        ${tracked(p) && p.stock <= 0 ? '<span class="badge warn">缺货</span>' : ''}
        <button class="btn small" data-act="prodEdit" data-id="${p.id}">编辑</button><button class="btn small danger" data-act="prodDelete" data-id="${p.id}">删除</button></div>`).join('')
      : '<div class="empty">添加店内销售的美容产品，零售收款时可直接选择</div>'}
    <div class="h2">数据备份</div>
    <div class="card"><p class="muted" style="margin-top:0">所有数据只保存在这台设备的浏览器里。请定期导出备份，清除浏览器数据会导致资料丢失。</p>
      <div class="btns"><button class="btn" data-act="exportData">导出备份</button>
        <button class="btn" data-act="importData">导入备份</button><input type="file" id="importFile" accept="application/json,.json" hidden></div></div>
    <div class="h2">账户</div>
    <div class="card"><button class="btn danger" data-act="logout">登出</button></div>`;
}
function tplForm(t) {
  const isNew = !t;
  t = t || { name: '', sessions: 10, price: '' };
  openSheet(isNew ? '添加配套模板' : '编辑配套模板', `<label>配套名称<input name="name" value="${esc(t.name)}" required autocomplete="off"></label>
    <div class="two"><label>次数<input name="sessions" type="number" min="1" step="1" value="${t.sessions}" required></label>
      <label>价格 (${esc(db.settings.currency)})<input name="price" type="number" min="0" step="0.01" value="${t.price}" required></label></div>`,
    f => {
      Object.assign(t, { name: f.name.trim(), sessions: Math.max(1, parseInt(f.sessions) || 1), price: num(f.price) });
      if (isNew) { t.id = uid(); db.catalog.push(t); }
    });
}

/* ===== 事件 ===== */
const commit = () => { save(); render(); };
const appt = id => db.appts.find(a => a.id === id);
const actions = {
  tab: d => { ui.tab = d.tab; ui.custId = null; render(); window.scrollTo(0, 0); },
  closeSheet: () => sheet.close(),
  // 日历
  selDate: d => { ui.sel = d.d; render(); },
  month: d => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + +d.n, 1); render(); },
  goToday: () => { const n = new Date(); ui.month = new Date(n.getFullYear(), n.getMonth(), 1); ui.sel = today(); render(); },
  apptNew: d => apptForm(null, d.id),
  apptEdit: d => apptForm(appt(d.id)),
  apptDone: d => apptDone(appt(d.id)),
  apptRemind: d => { const a = appt(d.id); msgSheet('预约提醒', cust(a.custId)?.phone, apptText(a)); },
  apptCancel: d => { if (confirm('确定取消这个预约吗？')) { appt(d.id).status = 'cancelled'; commit(); } },
  apptDelete: d => { if (confirm('确定删除这条预约记录吗？（已扣的次数不会退回）')) { db.appts = db.appts.filter(a => a.id !== d.id); commit(); } },
  // 顾客
  custOpen: d => { ui.custId = d.id; render(); window.scrollTo(0, 0); },
  custBack: () => { ui.custId = null; render(); },
  custNew: () => custForm(),
  custEdit: d => custForm(cust(d.id)),
  custWa: d => waSend(cust(d.id).phone, ''),
  custDelete: d => {
    const c = cust(d.id);
    if (!confirm(`确定删除顾客「${c.name}」吗？\n该顾客的配套、付款、扣次和预约记录将一并永久删除，无法恢复。\n产品零售记录会保留，改记为散客。`)) return;
    for (const k of ['packages', 'payments', 'usages', 'appts']) db[k] = db[k].filter(x => x.custId !== c.id);
    db.sales.forEach(s => { if (s.custId === c.id) { s.custId = ''; s.walkName = c.name; } });
    db.customers = db.customers.filter(x => x.id !== c.id);
    ui.custId = null; commit(); toast('顾客已删除');
  },
  // 配套与付款
  pkgSell: d => sellForm(d.id),
  pkgUse: d => useForm(pkg(d.id)),
  pkgHistory: d => historySheet(pkg(d.id)),
  pkgDelete: d => {
    const p = pkg(d.id);
    if (!confirm(`确定删除配套「${p.name}」吗？\n相关的付款和扣次记录将一并永久删除。`)) return;
    db.packages = db.packages.filter(x => x.id !== p.id);
    db.payments = db.payments.filter(x => x.pkgId !== p.id);
    db.usages = db.usages.filter(x => x.pkgId !== p.id);
    commit();
  },
  useDelete: d => {
    if (!confirm('确定撤销这次扣次吗？')) return;
    const u = db.usages.find(x => x.id === d.id);
    db.usages = db.usages.filter(x => x.id !== d.id);
    commit(); historySheet(pkg(u.pkgId)); toast('已撤销，次数已退回');
  },
  payNew: d => payForm(pkg(d.id)),
  payReceipt: d => showReceipt(db.payments.find(x => x.id === d.id)),
  payDelete: d => {
    const x = db.payments.find(y => y.id === d.id);
    if (confirm(`确定删除付款 #${x.no}（${money(x.amount)}）吗？无法恢复。`)) { db.payments = db.payments.filter(y => y.id !== d.id); commit(); }
  },
  // 产品零售
  saleNew: d => saleForm(d.id),
  saleReceipt: d => showSaleReceipt(db.sales.find(x => x.id === d.id)),
  saleDelete: d => {
    const s = db.sales.find(x => x.id === d.id);
    if (!confirm(`确定删除零售记录 #${s.no}（${money(s.total)}）吗？\n有追踪库存的产品会加回库存。删除后无法恢复。`)) return;
    s.items.forEach(i => { const p = db.products.find(x => x.id === i.prodId); if (p && tracked(p)) p.stock += i.qty; });
    db.sales = db.sales.filter(x => x.id !== s.id); commit(); toast('已删除');
  },
  prodNew: () => prodForm(),
  prodEdit: d => prodForm(db.products.find(p => p.id === d.id)),
  prodDelete: d => { if (confirm('确定删除这个产品吗？（不影响已有的零售记录）')) { db.products = db.products.filter(p => p.id !== d.id); commit(); } },
  // 设置
  tplNew: () => tplForm(),
  tplEdit: d => tplForm(db.catalog.find(t => t.id === d.id)),
  tplDelete: d => { if (confirm('确定删除这个配套模板吗？（不影响已卖出的配套）')) { db.catalog = db.catalog.filter(t => t.id !== d.id); commit(); } },
  exportData: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
    a.download = `salonpos-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importData: () => $('#importFile').click()
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[role=button][data-act]')) e.target.click();
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; $('#custList').innerHTML = custRows(); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'setForm') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  Object.assign(db.settings, { shop: f.shop.trim(), phone: f.phone.trim(), address: f.address.trim(), currency: f.currency.trim(), cc: f.cc.replace(/\D/g, ''), footer: f.footer.trim() });
  commit(); toast('设置已保存');
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!d || !Array.isArray(d.customers) || !Array.isArray(d.packages)) throw new Error('不是有效的备份文件');
    if (!confirm(`备份包含 ${d.customers.length} 位顾客。\n导入将覆盖本机现有的全部数据，确定吗？`)) return;
    localStorage.setItem(KEY, JSON.stringify(d));
    db = load(); ui.custId = null; render(); toast('导入成功');
  } catch (err) { alert('导入失败：' + err.message); }
});
// 点击背景关闭弹窗
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

/* ===== 登入 ===== */
// 只保存 "salonpos|<小写ID>|<密码>" 的 SHA-256，代码中不出现明文凭据
const AUTH_HASH = 'a045df4830d0aaecbe67b0cabbbcfb245baf2e7b8a463cea9144d7da44474098';
const AUTH_KEY = 'salonpos.auth';
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function isAuthed() {
  try { return localStorage.getItem(AUTH_KEY) === AUTH_HASH || sessionStorage.getItem(AUTH_KEY) === AUTH_HASH; } catch { return false; }
}
function unlock() { document.body.classList.remove('locked'); render(); }
let loginFails = 0;
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('#loginErr'), btn = f.querySelector('button');
  btn.disabled = true; err.textContent = '';
  try {
    const h = await sha256(`salonpos|${f.id.value.trim().toLowerCase()}|${f.pw.value}`);
    if (h !== AUTH_HASH) {
      loginFails++;
      await new Promise(r => setTimeout(r, Math.min(5000, 400 * loginFails)));
      err.textContent = '登入 ID 或密码不正确';
      f.pw.value = ''; f.pw.focus();
      return;
    }
    (f.remember.checked ? localStorage : sessionStorage).setItem(AUTH_KEY, h);
    f.reset(); loginFails = 0; unlock();
  } catch (ex) {
    err.textContent = '无法登入：' + ex.message;
  } finally { btn.disabled = false; }
});
actions.logout = () => {
  if (!confirm('确定要登出吗？')) return;
  try { localStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(AUTH_KEY); } catch {}
  sheet.close(); ui.tab = 'cal'; ui.custId = null;
  document.body.classList.add('locked');
};

if (isAuthed()) unlock();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(console.error);
