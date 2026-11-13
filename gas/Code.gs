/**
 * SalonPos → Google Sheet 同步脚本
 * 用法：在「SalonPos 数据」表格里打开 扩展程序 → Apps Script，把这段代码整段贴上，
 * 然后 部署 → 新部署 → 类型选「网页应用」，执行身份「我」，访问权限「任何人」。
 * 把得到的网址贴到 POS 应用「设置 → Google Sheet 同步」。
 * 应用里的「复制 Apps Script 代码」会自动把下面的密钥换成你的同步密钥。
 */
const TOKEN = '__TOKEN__';

const TABS = [
  ['customers', '顾客'], ['packages', '配套'], ['payments', '付款'], ['usages', '扣次'], ['appts', '预约'],
  ['products', '产品'], ['sales', '零售'], ['saleItems', '零售明细'], ['stockMoves', '库存记录'], ['catalog', '配套模板']
];
const LABELS = {
  id: 'ID', no: '收据号', name: '名称', phone: '电话', birthday: '生日', notes: '备注', note: '备注', createdAt: '建立时间',
  custId: '顾客ID', pkgId: '配套ID', prodId: '产品ID', apptId: '预约ID', sessions: '次数', price: '价格', date: '日期',
  amount: '金额', method: '付款方式', time: '时间', dur: '时长(分钟)', service: '服务项目', status: '状态',
  category: '分类', sku: '编号/SKU', cost: '成本价', stock: '库存', minStock: '低库存提醒', active: '上架',
  walkName: '散客姓名', walkPhone: '散客电话', subtotal: '小计', discount: '折扣', total: '总额', received: '收到现金',
  type: '类型', qty: '数量', after: '结余', at: '记录时间', items: '项目'
};
const VALUE_LABELS = {
  status: { booked: '已预约', done: '已完成', cancelled: '已取消' },
  type: { init: '初始库存', in: '进货', adjust: '库存调整', sale: '售出', void: '删除单据退回' }
};
const TIME_KEYS = { createdAt: true, at: true };
const LINKS = [['custId', '顾客', 'c:'], ['pkgId', '配套', 'p:'], ['prodId', '产品', 'pr:']];
const DATA_KEYS = ['customers', 'packages', 'payments', 'appts', 'products', 'sales', 'catalog'];
const CHUNK = 45000;

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: '请求格式错误' }); }
  if (!body || body.token !== TOKEN) return out({ ok: false, error: '同步密钥不正确' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (body.action === 'load') return out(Object.assign({ ok: true }, load()));
    if (body.action === 'save') {
      const prev = load();
      if (!body.force && isEmpty(body.data) && prev.data && !isEmpty(prev.data)) {
        return out({ ok: false, code: 'remote-has-data', error: 'Google Sheet 已有资料，本机资料是空的，已阻止覆盖' });
      }
      return out({ ok: true, savedAt: save(body.data) });
    }
    return out({ ok: false, error: '未知操作' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return out({ ok: true, app: 'SalonPos' }); }

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function isEmpty(db) {
  return !db || DATA_KEYS.every(function (k) { return !(db[k] && db[k].length); });
}

function save(db) {
  const ss = SpreadsheetApp.getActive();
  const names = {};
  (db.customers || []).forEach(function (c) { names['c:' + c.id] = c.name; });
  (db.packages || []).forEach(function (p) { names['p:' + p.id] = p.name; });
  (db.products || []).forEach(function (p) { names['pr:' + p.id] = p.name; });

  const saleItems = [];
  (db.sales || []).forEach(function (s) {
    (s.items || []).forEach(function (i) {
      saleItems.push({ no: s.no, date: s.date, custId: s.custId, prodId: i.prodId, name: i.name, price: i.price, qty: i.qty,
        total: Math.round(i.price * i.qty * 100) / 100 });
    });
  });
  const sales = (db.sales || []).map(function (s) {
    const o = Object.assign({}, s);
    o.items = (s.items || []).map(function (i) { return i.qty > 1 ? i.name + ' ×' + i.qty : i.name; }).join('、');
    return o;
  });
  const data = Object.assign({}, db, { sales: sales, saleItems: saleItems });

  TABS.forEach(function (t) { writeTab(ss, t[1], data[t[0]] || [], names); });
  writeSettings(ss, db.settings || {});
  const now = new Date();
  writeBackup(ss, JSON.stringify(db), now);
  const info = ss.getSheetByName('说明');
  if (info) info.getRange('A8').setValue(now);
  return now.toISOString();
}

function cell(k, v) {
  if (v === null || v === undefined) return '';
  if (TIME_KEYS[k] && typeof v === 'number') return new Date(v);
  if (VALUE_LABELS[k] && VALUE_LABELS[k][v]) return VALUE_LABELS[k][v];
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string') {
    if (v.length > 40000) v = v.slice(0, 40000) + '…（内容过长，完整内容在备份中）'; // 单格上限 5 万字
    if (/^[=+\-@]/.test(v)) v = "'" + v; // 防止被当成公式
  }
  return v;
}

function fit(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

function writeTab(ss, title, rows, names) {
  const sh = ss.getSheetByName(title) || ss.insertSheet(title);
  sh.clearContents();
  const keys = [];
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
  if (!keys.length) { sh.getRange(1, 1).setValue('（暂无资料）'); return; }
  const links = LINKS.filter(function (l) { return keys.indexOf(l[0]) >= 0; });
  const header = keys.map(function (k) { return LABELS[k] || k; }).concat(links.map(function (l) { return l[1]; }));
  const values = rows.map(function (r) {
    return keys.map(function (k) { return cell(k, r[k]); }).concat(links.map(function (l) {
      return r[l[0]] ? cell('', names[l[2] + r[l[0]]] || '(已删除)') : '';
    }));
  });
  const all = [header].concat(values);
  fit(sh, all.length, header.length);
  sh.getRange(1, 1, all.length, header.length).setValues(all);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
}

function writeSettings(ss, s) {
  const sh = ss.getSheetByName('设置') || ss.insertSheet('设置');
  sh.clearContents();
  const rows = [['项目', '内容']].concat(Object.keys(s).map(function (k) { return [k, cell(k, s[k])]; }));
  fit(sh, rows.length, 2);
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold');
}

function writeBackup(ss, json, now) {
  let sh = ss.getSheetByName('_backup');
  if (!sh) { sh = ss.insertSheet('_backup'); sh.hideSheet(); }
  sh.clearContents();
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push([json.slice(i, i + CHUNK)]);
  if (!parts.length) parts.push(['']);
  fit(sh, parts.length + 1, 2);
  sh.getRange(1, 1, 1, 2).setValues([['savedAt', now.toISOString()]]);
  sh.getRange(2, 1, parts.length, 1).setNumberFormat('@').setValues(parts);
}

function load() {
  const sh = SpreadsheetApp.getActive().getSheetByName('_backup');
  if (!sh || sh.getLastRow() < 2) return { data: null, savedAt: null };
  const savedAt = sh.getRange(1, 2).getValue();
  const parts = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; });
  const json = parts.join('');
  return { data: json ? JSON.parse(json) : null, savedAt: savedAt ? String(savedAt) : null };
}
