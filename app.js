// 汎用仕訳日記帳 - UI logic. Data lives only in localStorage.
import {
  resolveEntry, toFreeeCSV, toEpsonCSV, toJdlCSV, collectJdlWarnings, pickJdlTax, isEpsonNoRateTax,
  toYayoiCSV, collectYayoiWarnings, toMfCSV, collectMfWarnings,
  toPcaCSV, collectPcaWarnings,
  toObcCSV, collectObcWarnings,
  buildTransferData, shorokuBalance, shorokuSuggestion,
  tokenizeSearch, matchesSearch, journalFlags, verifyGenerated, trialBalance,
} from './exporters.js?v=24';
import { encodeSJIS } from './sjis.js?v=24';

const STORAGE_KEY = 'journalToolStateV1';
const FORMAT_LABELS = { transfer: '転送', freee: 'freee', epson: 'エプソン', jdl: 'JDL', yayoi: '弥生', mf: 'MF', pca: 'PCA', obc: '勘定奉行' };

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ---------- Default masters ----------

function defaultTaxes() {
  // Policy (decided 2026-11-13): code/number fields carry NO defaults.
  // epsonKazei, epsonTax, jdlKaku, jdlTax, pcaCode and obcCode all start
  // blank; the user registers the codes of the office they file for in
  // the tax master (exports still work with blanks, after the usual
  // unset-code warnings). What stays seeded is only the name-form values,
  // which are names rather than numbers: freeeName (freee's official
  // tax-category names), yayoiName (the 税込 記述形式 from Yayoi's
  // official tax-category table; 非課税売上 shortens to "非課売上" and the
  // reduced rate is "軽減8%" with no space), mfName (Money Forward's
  // formal 税区分 names: half-width spaces, purchases are 課税仕入, the
  // reduced rate is "(軽)8%"), and pcaName (PCA's 略称, from which the
  // PCA tax rate is derived).
  return [
    { id: 'tax-excluded', name: '対象外', freeeName: '対象外', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '対象外', mfName: '対象外', pcaCode: '', pcaName: '対象外', obcCode: '' },
    { id: 'tax-sales10', name: '課税売上10%（込）', freeeName: '課税売上10%', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課税売上込10%', mfName: '課税売上 10%', pcaCode: '', pcaName: '売上10%', obcCode: '' },
    { id: 'tax-sales8', name: '課税売上8%軽減（込）', freeeName: '課税売上8%（軽）', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課税売上込軽減8%', mfName: '課税売上 (軽)8%', pcaCode: '', pcaName: '売上8%軽', obcCode: '' },
    { id: 'tax-sales-exempt', name: '非課税売上', freeeName: '非課売上', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '非課売上', mfName: '非課税売上', pcaCode: '', pcaName: '非売上', obcCode: '' },
    { id: 'tax-purchase10', name: '課税仕入10%（込）', freeeName: '課対仕入10%', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課対仕入込10%', mfName: '課税仕入 10%', pcaCode: '', pcaName: '仕入10%', obcCode: '' },
    { id: 'tax-purchase8', name: '課税仕入8%軽減（込）', freeeName: '課対仕入8%（軽）', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課対仕入込軽減8%', mfName: '課税仕入 (軽)8%', pcaCode: '', pcaName: '仕入8%軽', obcCode: '' },
    { id: 'tax-purchase-exempt', name: '非課税仕入', freeeName: '非課仕入', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '非課仕入', mfName: '非課税仕入', pcaCode: '', pcaName: '非仕入', obcCode: '' },
  ];
}

function defaultAccounts() {
  const X = 'tax-excluded', S = 'tax-sales10', P = 'tax-purchase10';
  // Rows: [id, name, defaultTaxId]. Display order follows the
  // balance-sheet / income-statement classification.
  // The original 28 accounts keep their positional ids (acc1..acc28) so that
  // account IDs stored in existing journals and transfer files keep pointing
  // at the same account. Accounts added on 2026-11-12 (common asset and
  // liability items that were missing) use slug ids.
  // Policy (decided 2026-11-13): per-format account codes carry NO
  // defaults — epsonCode, jdlCode, pcaCode and obcCode all start blank,
  // and the user registers the codes of each office in the account
  // master. (Until 2026-11-13 the defaults carried EPSON's published
  // chart codes, the conversion app's JDL codes and PCA's standard
  // codes; those seedings were removed by this decision. The account
  // SET itself is unchanged: the five accounts dropped on 2026-11-13
  // — のれん, 関係会社株式, 開業費, 社債発行費, 社債 — stay dropped.)
  // Balance-sheet accounts default to 対象外.
  const rows = [
    // 流動資産
    ['acc1', '現金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc2', '普通預金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-checking', '当座預金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-time-deposit', '定期預金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-notes-receivable', '受取手形', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc3', '売掛金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-merchandise', '商品', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-stores', '貯蔵品', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-prepaid-expenses', '前払費用', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-other-receivables', '未収入金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-advances', '立替金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-suspense-payments', '仮払金', X, 'asset', 'normal', 'tot-current-assets'],
    ['acc-allowance-doubtful', '貸倒引当金', X, 'asset', 'normal', 'tot-current-assets'],
    ['tot-current-assets', '流動資産合計', X, 'asset', 'total', ''],
    // 有形固定資産
    ['acc-buildings', '建物', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['acc-building-equipment', '建物附属設備', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['acc-structures', '構築物', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['acc-vehicles', '車両運搬具', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['acc-equipment', '工具器具備品', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['acc-land', '土地', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['acc-accumulated-depreciation', '減価償却累計額', X, 'asset', 'normal', 'tot-tangible-assets'],
    ['tot-tangible-assets', '有形固定資産合計', X, 'asset', 'total', ''],
    // 無形固定資産
    ['acc-software', 'ソフトウェア', X, 'asset', 'normal', 'tot-intangible-assets'],
    ['acc-telephone-rights', '電話加入権', X, 'asset', 'normal', 'tot-intangible-assets'],
    ['tot-intangible-assets', '無形固定資産合計', X, 'asset', 'total', ''],
    // 投資その他の資産
    ['acc-investment-securities', '投資有価証券', X, 'asset', 'normal', 'tot-investments'],
    ['acc-investments-in-capital', '出資金', X, 'asset', 'normal', 'tot-investments'],
    ['acc-long-term-loans', '長期貸付金', X, 'asset', 'normal', 'tot-investments'],
    ['acc-security-deposits', '敷金', X, 'asset', 'normal', 'tot-investments'],
    ['acc-long-term-prepaid', '長期前払費用', X, 'asset', 'normal', 'tot-investments'],
    ['tot-investments', '投資その他の資産合計', X, 'asset', 'total', ''],
    // 繰延資産
    ['acc-organization-costs', '創立費', X, 'asset', 'normal', 'tot-deferred-assets'],
    ['tot-deferred-assets', '繰延資産合計', X, 'asset', 'total', ''],
    // 流動負債
    ['acc-notes-payable', '支払手形', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc4', '買掛金', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc21', '短期借入金', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc23', '未払金', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc-accrued-expenses', '未払費用', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc-advances-received', '前受金', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc-suspense-receipts', '仮受金', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc24', '預り金', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc-income-taxes-payable', '未払法人税等', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['acc-consumption-tax-payable', '未払消費税等', X, 'liability', 'normal', 'tot-current-liabilities'],
    ['tot-current-liabilities', '流動負債合計', X, 'liability', 'total', ''],
    // 固定負債
    ['acc22', '長期借入金', X, 'liability', 'normal', 'tot-fixed-liabilities'],
    ['acc-retirement-reserve', '退職給付引当金', X, 'liability', 'normal', 'tot-fixed-liabilities'],
    ['tot-fixed-liabilities', '固定負債合計', X, 'liability', 'total', ''],
    // 純資産
    ['acc25', '資本金', X, 'equity', 'normal', 'tot-equity'],
    ['acc-capital-reserve', '資本準備金', X, 'equity', 'normal', 'tot-equity'],
    ['acc-earnings-reserve', '利益準備金', X, 'equity', 'normal', 'tot-equity'],
    ['acc26', '繰越利益剰余金', X, 'equity', 'normal', 'tot-equity'],
    ['tot-equity', '純資産合計', X, 'equity', 'total', ''],
    // 収益
    ['acc5', '売上高', S, 'revenue', 'normal', 'tot-revenue'],
    ['acc27', '売上値引', S, 'revenue', 'normal', 'tot-revenue'],
    ['tot-revenue', '収益合計', S, 'revenue', 'total', ''],
    // 費用
    ['acc6', '仕入高', P, 'expense', 'normal', 'tot-expenses'],
    ['acc7', '消耗品費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc8', '旅費交通費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc9', '通信費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc10', '水道光熱費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc11', '地代家賃', P, 'expense', 'normal', 'tot-expenses'],
    ['acc12', '支払手数料', P, 'expense', 'normal', 'tot-expenses'],
    ['acc13', '雑費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc14', '租税公課', X, 'expense', 'normal', 'tot-expenses'],
    ['acc15', '会議費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc16', '交際費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc17', '広告宣伝費', P, 'expense', 'normal', 'tot-expenses'],
    ['acc18', '給料手当', X, 'expense', 'normal', 'tot-expenses'],
    ['acc19', '法定福利費', X, 'expense', 'normal', 'tot-expenses'],
    ['acc20', '減価償却費', X, 'expense', 'normal', 'tot-expenses'],
    ['tot-expenses', '費用合計', X, 'expense', 'total', ''],
    // 振替用
    ['acc28', '諸口', X, 'asset', 'normal', ''],
  ];
  return rows.map(([id, name, defaultTaxId, category, kind, totalParentId]) => ({
    id, name, epsonCode: '', jdlCode: '', defaultTaxId, pcaCode: '', obcCode: '', category,
    kind: kind || 'normal', totalParentId: totalParentId || '',
  }));
}

function newCompany(name, periodStart, periodEnd) {
  return {
    id: uid(), name, periodStart, periodEnd,
    accountOverrides: {}, accountAdditions: [], accountDeleted: [],
    taxOverrides: {}, taxAdditions: [], taxDeleted: [],
    journals: [], templates: [], lastDate: periodStart || '',
    openingBalances: {},
  };
}

// ---------- State ----------

// Masters model (decided 2026-11-12): the built-in defaults are global —
// every company always sees the current default account/tax set, so a
// default added in a new app version reaches existing companies too.
// What stays individual per company is only the difference: field overrides
// on default items, items the user added, and default items the user
// deleted in that company. effAccounts()/effTaxes() materialize the list.
const DEFAULT_ACCOUNTS = defaultAccounts();
const DEFAULT_TAXES = defaultTaxes();
const ACCOUNT_FIELDS = ['name', 'epsonCode', 'jdlCode', 'defaultTaxId', 'pcaCode', 'obcCode', 'category', 'kind', 'totalParentId'];
const TAX_FIELDS = ['name', 'freeeName', 'epsonKazei', 'epsonTax', 'jdlKaku', 'jdlTax', 'yayoiName', 'mfName', 'pcaCode', 'pcaName', 'obcCode'];

function effList(defaults, overrides, additions, deleted) {
  const del = new Set(deleted || []);
  const list = [];
  for (const d of defaults) {
    if (del.has(d.id)) continue;
    list.push({ ...d, ...((overrides || {})[d.id] || {}) });
  }
  for (const a of additions || []) list.push({ ...a });
  return list;
}
function effAccounts(c) { return effList(DEFAULT_ACCOUNTS, c.accountOverrides, c.accountAdditions, c.accountDeleted); }
function effTaxes(c) { return effList(DEFAULT_TAXES, c.taxOverrides, c.taxAdditions, c.taxDeleted); }

function writeMasterField(c, kind, item, field, value) {
  const isAcc = kind === 'account';
  const def = (isAcc ? DEFAULT_ACCOUNTS : DEFAULT_TAXES).find((d) => d.id === item.id);
  if (def) {
    const ovKey = isAcc ? 'accountOverrides' : 'taxOverrides';
    const ovs = c[ovKey] || (c[ovKey] = {});
    const ov = ovs[item.id] || (ovs[item.id] = {});
    if ((def[field] || '') === (value || '')) delete ov[field]; else ov[field] = value;
    if (!Object.keys(ov).length) delete ovs[item.id];
  } else {
    const a = (c[isAcc ? 'accountAdditions' : 'taxAdditions'] || []).find((x) => x.id === item.id);
    if (a) a[field] = value;
  }
}
function deleteMasterItem(c, kind, item) {
  const isAcc = kind === 'account';
  if ((isAcc ? DEFAULT_ACCOUNTS : DEFAULT_TAXES).some((d) => d.id === item.id)) {
    const delKey = isAcc ? 'accountDeleted' : 'taxDeleted';
    const del = c[delKey] || (c[delKey] = []);
    if (!del.includes(item.id)) del.push(item.id);
    if (c[isAcc ? 'accountOverrides' : 'taxOverrides']) delete c[isAcc ? 'accountOverrides' : 'taxOverrides'][item.id];
  } else {
    const addKey = isAcc ? 'accountAdditions' : 'taxAdditions';
    c[addKey] = (c[addKey] || []).filter((x) => x.id !== item.id);
  }
}

// Companies saved by older versions hold a full private copy of the
// masters. Split such a copy into overrides + additions on load. A default
// item missing from an old copy cannot be told apart from a deliberate
// deletion, so it (re)appears as a default — which is the point of making
// the defaults global.
function splitMasters(stored, defaults, fields) {
  const defById = Object.fromEntries(defaults.map((d) => [d.id, d]));
  const overrides = {}; const additions = [];
  for (const item of stored || []) {
    const def = defById[item.id];
    if (!def) { additions.push(item); continue; }
    const ov = {};
    // A field the stored copy does not have at all (e.g. a master field
    // added in a later app version) is not a difference: the current
    // default applies.
    for (const f of fields) if (f in item && (item[f] || '') !== (def[f] || '')) ov[f] = item[f];
    if (Object.keys(ov).length) overrides[item.id] = ov;
  }
  return { overrides, additions };
}
function migrateState(s) {
  let changed = false;
  for (const c of s.companies || []) {
    if (Array.isArray(c.accounts)) {
      const r = splitMasters(c.accounts, DEFAULT_ACCOUNTS, ACCOUNT_FIELDS);
      c.accountOverrides = r.overrides; c.accountAdditions = r.additions; c.accountDeleted = c.accountDeleted || [];
      delete c.accounts; changed = true;
    }
    if (Array.isArray(c.taxes)) {
      const r = splitMasters(c.taxes, DEFAULT_TAXES, TAX_FIELDS);
      c.taxOverrides = r.overrides; c.taxAdditions = r.additions; c.taxDeleted = c.taxDeleted || [];
      delete c.taxes; changed = true;
    }
  }
  if (changed) s.version = 2;
  return changed;
}

let stateMigrated = false;
let state = loadState();
let editingId = null;
let currentVoucher = 1;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.companies)) {
        stateMigrated = migrateState(s);
        return s;
      }
    }
  } catch (e) { /* fall through */ }
  return { version: 2, currentCompanyId: null, companies: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function company() {
  return state.companies.find((c) => c.id === state.currentCompanyId) || null;
}
function accountsById(c) { return Object.fromEntries(effAccounts(c).map((a) => [a.id, a])); }
function taxesById(c) { return Object.fromEntries(effTaxes(c).map((t) => [t.id, t])); }
function shorokuId(c) { const a = effAccounts(c).find((x) => x.name === '諸口'); return a ? a.id : null; }
function nextVoucherNo(c) {
  return c.journals.reduce((mx, j) => Math.max(mx, Number(j.voucherNo) || 0), 0) + 1;
}
function sortedJournals(c) {
  return [...c.journals].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 :
    (Number(a.voucherNo) - Number(b.voucherNo)) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ---------- Dates ----------

// Date fields are plain text inputs on purpose: native date widgets behave
// inconsistently across browsers (segmented typing that rejects a 4-digit
// year in Chrome on Windows; oversized intrinsic width in iOS Safari).
// Accept YYYY-MM-DD, YYYY/MM/DD and YYYYMMDD; normalize to YYYY-MM-DD.
function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim().replace(/\//g, '-');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) {
    const d = s.replace(/-/g, '');
    if (/^\d{8}$/.test(d)) m = [null, d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)];
  }
  if (!m) return null;
  const y = +m[1], mo = +m[2], da = +m[3];
  const dt = new Date(y, mo - 1, da);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}
document.querySelectorAll('.date-input').forEach((el) => {
  el.addEventListener('change', () => {
    const n = normalizeDate(el.value);
    if (n) el.value = n;
    el.classList.toggle('invalid', el.value.trim() !== '' && n === null);
  });
});

// ---------- Tabs ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-page').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
  if (name === 'entry') renderEntryMasters();
  if (name === 'list') renderList();
  if (name === 'trial') renderTrial();
  if (name === 'masters') renderMasters();
  if (name === 'export') updateExportCount();
  if (name === 'settings') renderCompanyForm();
}

// ---------- Header / company switching ----------

function renderHeader() {
  const sel = $('company-select');
  sel.innerHTML = '';
  for (const c of state.companies) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  }
  const c = company();
  if (c) sel.value = c.id;
  $('company-period').textContent = c ? `${c.periodStart} 〜 ${c.periodEnd}` : '';
  $('no-company').hidden = !!c;
}
$('company-select').addEventListener('change', () => {
  state.currentCompanyId = $('company-select').value;
  saveState();
  editingId = null;
  tbCompanyId = null;
  initEntryContext();
  renderHeader(); renderEntryMasters(); renderList(); renderTrial(); renderMasters(); renderCompanyForm(); updateExportCount();
});

// ---------- Entry ----------

function renderEntryMasters() {
  const c = company();
  const dl = $('account-list');
  dl.innerHTML = '';
  const taxSelD = $('e-debit-tax'), taxSelC = $('e-credit-tax');
  const prevD = taxSelD.value, prevC = taxSelC.value;
  taxSelD.innerHTML = ''; taxSelC.innerHTML = '';
  const accSelD = $('e-debit-select'), accSelC = $('e-credit-select');
  for (const sel of [accSelD, accSelC]) {
    sel.innerHTML = '';
    const o = document.createElement('option'); o.value = ''; o.textContent = '科目を選択'; sel.appendChild(o);
  }
  if (!c) return;
  for (const a of effAccounts(c)) {
    if (a.kind === 'total') continue; // 合計科目は明細を持たないため、仕訳入力の選択肢に出さない
    const o = document.createElement('option'); o.value = a.name; dl.appendChild(o);
    for (const sel of [accSelD, accSelC]) {
      const so = document.createElement('option'); so.value = a.name; so.textContent = a.name; sel.appendChild(so);
    }
  }
  syncAccountSelects();
  for (const t of effTaxes(c)) {
    for (const sel of [taxSelD, taxSelC]) {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o);
    }
  }
  if (prevD) taxSelD.value = prevD;
  if (prevC) taxSelC.value = prevC;
  renderTemplateList();
}

function renderTemplateList() {
  const c = company();
  const sel = $('tpl-select');
  sel.innerHTML = '';
  if (!c) return;
  for (const t of c.templates) {
    const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o);
  }
}

function initEntryContext() {
  const c = company();
  if (!c) return;
  currentVoucher = nextVoucherNo(c);
  $('e-voucher').value = currentVoucher;
  $('e-date').value = c.lastDate || c.periodStart || '';
  clearEntryFields();
  $('edit-banner').hidden = true;
  editingId = null;
}

function clearEntryFields() {
  $('e-debit-name').value = '';
  $('e-credit-name').value = '';
  $('e-amount').value = '';
  $('e-summary').value = '';
  $('entry-msg').textContent = '';
  $('entry-msg').className = 'msg';
  syncAccountSelects();
}

function findAccountByName(c, name) {
  return effAccounts(c).find((a) => a.name === name.trim()) || null;
}

function bindAccountDefaultTax(inputId, taxSelId) {
  $(inputId).addEventListener('change', () => {
    const c = company(); if (!c) return;
    const a = findAccountByName(c, $(inputId).value);
    if (a && a.defaultTaxId) $(taxSelId).value = a.defaultTaxId;
  });
}
bindAccountDefaultTax('e-debit-name', 'e-debit-tax');
bindAccountDefaultTax('e-credit-name', 'e-credit-tax');

// Account pulldown (shown on small screens): selecting sets the name input,
// typing in the name input re-syncs the pulldown. Direct input stays possible.
function syncAccountSelect(side) {
  const input = $(side === 'debit' ? 'e-debit-name' : 'e-credit-name');
  const sel = $(side === 'debit' ? 'e-debit-select' : 'e-credit-select');
  if (!input || !sel) return;
  const v = input.value.trim();
  sel.value = [...sel.options].some((o) => o.value === v) ? v : '';
}
function syncAccountSelects() { syncAccountSelect('debit'); syncAccountSelect('credit'); }
function bindAccountSelect(side) {
  const input = $(side === 'debit' ? 'e-debit-name' : 'e-credit-name');
  const sel = $(side === 'debit' ? 'e-debit-select' : 'e-credit-select');
  sel.addEventListener('change', () => {
    input.value = sel.value;
    input.dispatchEvent(new Event('change'));
  });
  input.addEventListener('input', () => syncAccountSelect(side));
}
bindAccountSelect('debit');
bindAccountSelect('credit');

function readEntryForm() {
  const c = company();
  const debit = findAccountByName(c, $('e-debit-name').value);
  const credit = findAccountByName(c, $('e-credit-name').value);
  const amount = Number($('e-amount').value);
  const data = {
    date: normalizeDate($('e-date').value),
    voucherNo: currentVoucher,
    debitAccountId: debit ? debit.id : null,
    debitTaxId: $('e-debit-tax').value,
    creditAccountId: credit ? credit.id : null,
    creditTaxId: $('e-credit-tax').value,
    amount,
    summary: $('e-summary').value.trim(),
  };
  const errors = [];
  if (data.date === null) errors.push('日付の形式が正しくありません（例: 2026-04-01）');
  else if (!data.date) errors.push('日付を入力してください');
  if (!debit) errors.push('借方科目はマスタにある科目名と一致させてください');
  if (!credit) errors.push('貸方科目はマスタにある科目名と一致させてください');
  if (!data.debitTaxId || !data.creditTaxId) errors.push('税区分を選択してください');
  if (!Number.isInteger(amount) || amount <= 0) errors.push('金額は正の整数で入力してください');
  return { data, errors };
}

function fillEntryForm(j) {
  const c = company();
  const byId = accountsById(c);
  $('e-date').value = j.date;
  currentVoucher = Number(j.voucherNo);
  $('e-voucher').value = j.voucherNo;
  $('e-debit-name').value = byId[j.debitAccountId] ? byId[j.debitAccountId].name : '';
  $('e-credit-name').value = byId[j.creditAccountId] ? byId[j.creditAccountId].name : '';
  $('e-debit-tax').value = j.debitTaxId;
  $('e-credit-tax').value = j.creditTaxId;
  $('e-amount').value = j.amount;
  $('e-summary').value = j.summary || '';
  syncAccountSelects();
}

function applyShorokuPrefill(voucherNo) {
  const c = company();
  const sid = shorokuId(c);
  if (!sid) return;
  const side = shorokuSuggestion(c.journals, voucherNo, sid);
  if (!side) return;
  const input = side === 'debit' ? $('e-debit-name') : $('e-credit-name');
  const taxSel = side === 'debit' ? $('e-debit-tax') : $('e-credit-tax');
  input.value = '諸口';
  syncAccountSelect(side);
  const shoroku = effAccounts(c).find((a) => a.id === sid);
  if (shoroku && shoroku.defaultTaxId) taxSel.value = shoroku.defaultTaxId;
}

function saveEntry(mode) {
  const c = company();
  if (!c) return;
  const { data, errors } = readEntryForm();
  const msg = $('entry-msg');
  if (errors.length) { msg.textContent = errors.join('\n'); msg.className = 'msg'; return; }
  if (data.date < c.periodStart || data.date > c.periodEnd) {
    if (!confirm(`日付 ${data.date} は会計期間（${c.periodStart}〜${c.periodEnd}）の外です。保存しますか？`)) return;
  }
  let saved;
  if (editingId) {
    saved = c.journals.find((j) => j.id === editingId);
    if (saved) Object.assign(saved, data, { updatedAt: new Date().toISOString() });
    editingId = null;
    $('edit-banner').hidden = true;
  } else {
    saved = { id: uid(), createdAt: new Date().toISOString(), exports: {}, ...data };
    c.journals.push(saved);
  }
  c.lastDate = data.date;
  saveState();

  if (mode === 'continue') {
    clearEntryFields();
    $('e-date').value = data.date;
    $('e-voucher').value = data.voucherNo;
    currentVoucher = Number(data.voucherNo);
    applyShorokuPrefill(currentVoucher);
  } else {
    // mode === 'new': warn if 諸口 is not balanced within this voucher.
    const sid = shorokuId(c);
    const bal = sid ? shorokuBalance(c.journals, data.voucherNo, sid) : 0;
    let proceed = true;
    if (bal !== 0) {
      proceed = confirm(`伝票${data.voucherNo}の諸口が相殺されていません（残高 ${bal.toLocaleString()}円）。このまま新しい伝票に進みますか？\nキャンセルすると同一伝票の続きを入力できます。`);
    }
    clearEntryFields();
    $('e-date').value = data.date;
    if (proceed) {
      currentVoucher = nextVoucherNo(c);
    } else {
      currentVoucher = Number(data.voucherNo);
      applyShorokuPrefill(currentVoucher);
    }
    $('e-voucher').value = currentVoucher;
  }
  // Set the success message AFTER clearEntryFields(), which clears entry-msg.
  msg.textContent = '保存しました';
  msg.className = 'msg ok';
  renderList();
}
$('save-continue').addEventListener('click', () => saveEntry('continue'));
$('save-new').addEventListener('click', () => saveEntry('new'));
$('edit-cancel').addEventListener('click', () => { editingId = null; $('edit-banner').hidden = true; initEntryContext(); });

$('copy-prev').addEventListener('click', () => {
  const c = company(); if (!c || !c.journals.length) return;
  const last = [...c.journals].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const byId = accountsById(c);
  $('e-debit-name').value = byId[last.debitAccountId] ? byId[last.debitAccountId].name : '';
  $('e-credit-name').value = byId[last.creditAccountId] ? byId[last.creditAccountId].name : '';
  $('e-debit-tax').value = last.debitTaxId;
  $('e-credit-tax').value = last.creditTaxId;
  $('e-amount').value = last.amount;
  $('e-summary').value = last.summary || '';
  syncAccountSelects();
});

// Templates
$('tpl-save').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const name = $('tpl-name').value.trim();
  if (!name) { $('entry-msg').textContent = 'テンプレート名を入力してください'; return; }
  const { data, errors } = readEntryForm();
  if (!data.debitAccountId || !data.creditAccountId || errors.some((e) => e.includes('科目'))) {
    $('entry-msg').textContent = '借方・貸方科目を正しく入力してからテンプレート保存してください';
    return;
  }
  c.templates.push({
    id: uid(), name,
    debitAccountId: data.debitAccountId, debitTaxId: data.debitTaxId,
    creditAccountId: data.creditAccountId, creditTaxId: data.creditTaxId,
    amount: Number.isInteger(data.amount) && data.amount > 0 ? data.amount : '',
    summary: data.summary,
  });
  saveState(); renderTemplateList();
  $('entry-msg').textContent = 'テンプレートを保存しました'; $('entry-msg').className = 'msg ok';
});
$('tpl-apply').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const t = c.templates.find((x) => x.id === $('tpl-select').value);
  if (!t) return;
  fillEntryForm({ ...t, date: $('e-date').value, voucherNo: currentVoucher });
});
$('tpl-delete').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const id = $('tpl-select').value;
  if (!id || !confirm('テンプレートを削除しますか？')) return;
  c.templates = c.templates.filter((x) => x.id !== id);
  saveState(); renderTemplateList();
});

// ---------- List ----------

for (const id of ['f-from', 'f-to', 'f-keyword', 'f-status']) $(id).addEventListener('input', renderList);

function exportBadges(j) {
  return Object.keys(FORMAT_LABELS)
    .filter((k) => j.exports && j.exports[k])
    .map((k) => `<span class="badge">${FORMAT_LABELS[k]}</span>`)
    .join('') || '<span class="muted">未出力</span>';
}

function renderList() {
  const c = company();
  const tbody = document.querySelector('#journal-table tbody');
  tbody.innerHTML = '';
  if (!c) { $('list-count').textContent = ''; return; }
  const byId = accountsById(c);
  const byTax = taxesById(c);
  const from = normalizeDate($('f-from').value) || '', to = normalizeDate($('f-to').value) || '';
  const tokens = tokenizeSearch($('f-keyword').value);
  const status = $('f-status').value;
  const resolvedById = new Map(sortedJournals(c).map((j) => [j.id, resolveEntry(j, byId, byTax)]));
  const flags = journalFlags([...resolvedById.values()], { start: c.periodStart, end: c.periodEnd });
  let rows = sortedJournals(c);
  rows = rows.filter((j) => {
    if (from && j.date < from) return false;
    if (to && j.date > to) return false;
    if (tokens.length && !matchesSearch(resolvedById.get(j.id), tokens)) return false;
    if (status === 'flagged' && !flags.has(j.id)) return false;
    if (status === 'none' && j.exports && Object.keys(FORMAT_LABELS).some((k) => j.exports[k])) return false;
    if (status === 'any' && !(j.exports && Object.keys(FORMAT_LABELS).some((k) => j.exports[k]))) return false;
    return true;
  });
  $('list-count').textContent = `${rows.length} 件`;
  const flagInfo = $('flag-info');
  if (flagInfo) {
    flagInfo.textContent = flags.size
      ? `要確認・確認推奨の仕訳が ${flags.size} 件あります（バッジが目印です）。上の「絞り込み」で「要確認のみ」を選ぶと、それだけを表示できます。`
      : '要確認・確認推奨の仕訳はありません。';
  }
  for (const j of rows) {
    const tr = document.createElement('tr');
    const dn = byId[j.debitAccountId] ? byId[j.debitAccountId].name : '(不明)';
    const cn = byId[j.creditAccountId] ? byId[j.creditAccountId].name : '(不明)';
    const fl = flags.get(j.id);
    const flagHtml = fl ? [
      fl.strong.length ? `<span class="badge flag-strong" title="${fl.strong.join('／')}">要確認</span>` : '',
      fl.weak.length ? `<span class="badge flag-weak" title="${fl.weak.join('／')}">確認推奨</span>` : '',
    ].join('') : '';
    tr.innerHTML = `
      <td>${j.date}</td><td>${j.voucherNo}</td><td>${dn}</td><td>${cn}</td>
      <td class="num">${Number(j.amount).toLocaleString()}</td>
      <td></td><td>${flagHtml}${exportBadges(j)}</td>
      <td class="row-btns"><button data-act="edit">編集</button> <button data-act="del">削除</button></td>`;
    tr.children[5].textContent = j.summary || '';
    tr.querySelector('[data-act="edit"]').addEventListener('click', () => {
      editingId = j.id;
      showTab('entry');
      renderEntryMasters();
      fillEntryForm(j);
      $('edit-banner').hidden = false;
    });
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`${j.date} 伝票${j.voucherNo} の仕訳を削除しますか？`)) return;
      c.journals = c.journals.filter((x) => x.id !== j.id);
      saveState(); renderList();
    });
    tbody.appendChild(tr);
  }
}

// ---------- Trial balance ----------

let tbCompanyId = null;
function renderTrial() {
  const c = company();
  const fromEl = $('tb-from'), toEl = $('tb-to');
  if (!c || !fromEl) return;
  if (tbCompanyId !== c.id) {
    tbCompanyId = c.id;
    fromEl.value = c.periodStart;
    toEl.value = c.periodEnd;
  }
  const from = normalizeDate(fromEl.value) || c.periodStart;
  const to = normalizeDate(toEl.value) || c.periodEnd;
  const jp = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}年${m}月${dd}日`; };
  $('tb-co-name').textContent = c.name;
  $('tb-period-text').textContent = `自 ${jp(from)}　至 ${jp(to)}`;
  const entries = c.journals.filter((j) => j.date >= from && j.date <= to);
  const tb = trialBalance(entries, effAccounts(c), c.openingBalances || {});
  const num = (n) => (n ? Number(n).toLocaleString() : '');
  // Balances are single amounts, not split by side: a credit balance
  // is shown as a negative with the △ mark.
  const bal = (n) => (n ? (n < 0 ? `△${Math.abs(n).toLocaleString()}` : n.toLocaleString()) : '');
  const cells = (r) => `<td></td><td class="num">${bal(r.openingBalance)}</td><td class="num">${num(r.debit)}</td><td class="num">${num(r.credit)}</td><td class="num">${bal(r.closingBalance)}</td>`;
  // A4 landscape sheet: balance sheet on the left half, profit &
  // loss on the right half.
  const renderSide = (tbody, foot, rows, normals) => {
    tbody.innerHTML = '';
    let lastCategory = null;
    let detailCount = 0;
    for (const r of rows) {
      const cat = r.category || '';
      if (cat && cat !== lastCategory) {
        lastCategory = cat;
        const band = document.createElement('tr');
        band.className = 'tb-band';
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = CATEGORY_LABELS[cat] || cat;
        band.appendChild(td);
        tbody.appendChild(band);
      }
      const tr = document.createElement('tr');
      if (r.isTotal) tr.className = 'tb-total-row';
      else if (detailCount++ % 2 === 1) tr.className = 'tb-row-alt';
      tr.innerHTML = cells(r);
      tr.children[0].textContent = r.name;
      tbody.appendChild(tr);
    }
    const sum = (f) => normals.reduce((t, r) => t + r[f], 0);
    foot.innerHTML = normals.length
      ? `<tr><td>合計</td><td class="num">${bal(sum('openingBalance'))}</td><td class="num">${num(sum('debit'))}</td><td class="num">${num(sum('credit'))}</td><td class="num">${bal(sum('closingBalance'))}</td></tr>`
      : '';
  };
  const isBs = (r) => ['asset', 'liability', 'equity'].includes(r.category);
  renderSide($('tb-body-bs'), $('tb-foot-bs'),
    tb.displayRows.filter(isBs), tb.rows.filter(isBs));
  renderSide($('tb-body-pl'), $('tb-foot-pl'),
    tb.displayRows.filter((r) => !isBs(r)), tb.rows.filter((r) => !isBs(r)));
  $('tb-empty').hidden = tb.rows.length > 0;
  $('tb-pl').hidden = tb.rows.length === 0;
  if (tb.rows.length) {
    $('tb-revenue').textContent = tb.revenue.toLocaleString();
    $('tb-expense').textContent = tb.expense.toLocaleString();
    $('tb-profit').textContent = tb.profit.toLocaleString();
  }
  renderOpening();
  layoutTrialPaper();
}
for (const id of ['tb-from', 'tb-to']) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => renderTrial());
}

// Trial-balance paper layout and zoom. The sheet is designed at
// A4-landscape width (1120px) and by default scaled down so the whole
// sheet fits the available width (on a wide PC screen it sits at
// natural size). Zooming applies ONLY to the sheet: pinch on the
// sheet, the +/− buttons, or Ctrl+wheel set an explicit scale; the
// scaled sheet lives in a sized box (#tb-sizer) inside a scrollable
// frame (#tb-fit), so the rest of the page never zooms and the sheet
// is panned by scrolling the frame. (Until v23 the sheet relied on
// the browser's page pinch zoom, which magnified the whole page.)
let tbZoom = null;   // null = fit-to-width; otherwise explicit scale
let tbScaleNow = 1;  // scale applied by the last layout pass
const TB_MIN_ZOOM = 0.2, TB_MAX_ZOOM = 3;

function layoutTrialPaper() {
  const wrap = $('tb-fit'), sizer = $('tb-sizer'), paper = $('tb-paper');
  if (!wrap || !sizer || !paper) return;
  const avail = wrap.clientWidth;
  if (!avail) return;
  const fit = Math.min(1, avail / paper.offsetWidth);
  const s = tbZoom == null ? fit
    : Math.min(TB_MAX_ZOOM, Math.max(TB_MIN_ZOOM, tbZoom));
  tbScaleNow = s;
  paper.style.transform = `scale(${s})`;
  const w = Math.ceil(paper.offsetWidth * s);
  const h = Math.ceil(paper.offsetHeight * s);
  sizer.style.width = `${w}px`;
  sizer.style.height = `${h}px`;
  wrap.style.height = s > fit
    ? `${Math.min(h, Math.round(window.innerHeight * 0.78))}px`
    : `${h}px`;
  const label = $('tb-zoom-label');
  if (label) label.textContent = `${Math.round(s * 100)}%`;
}

function tbSetZoom(next) {
  tbZoom = next == null ? null
    : Math.min(TB_MAX_ZOOM, Math.max(TB_MIN_ZOOM, next));
  layoutTrialPaper();
  if (tbZoom == null) {
    const w = $('tb-fit');
    if (w) { w.scrollLeft = 0; w.scrollTop = 0; }
  }
}
{
  const zoomIn = $('tb-zoom-in'), zoomOut = $('tb-zoom-out'), zoomFit = $('tb-zoom-fit');
  if (zoomIn) zoomIn.addEventListener('click', () => tbSetZoom(tbScaleNow * 1.25));
  if (zoomOut) zoomOut.addEventListener('click', () => tbSetZoom(tbScaleNow * 0.8));
  if (zoomFit) zoomFit.addEventListener('click', () => tbSetZoom(null));
  const wrap = $('tb-fit');
  if (wrap) {
    // Two-finger pinch on the sheet zooms the sheet only; the
    // preventDefault on touchmove (and Safari's gesturestart) keeps
    // the browser from zooming the whole page for this gesture.
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    wrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), s: tbScaleNow };
    }, { passive: true });
    wrap.addEventListener('touchmove', (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        tbZoom = Math.min(TB_MAX_ZOOM, Math.max(TB_MIN_ZOOM, pinch.s * dist(e.touches) / pinch.d));
        layoutTrialPaper();
      }
    }, { passive: false });
    const endPinch = () => { pinch = null; };
    wrap.addEventListener('touchend', endPinch);
    wrap.addEventListener('touchcancel', endPinch);
    wrap.addEventListener('gesturestart', (e) => e.preventDefault());
    wrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      tbSetZoom(tbScaleNow * (e.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
  }
}
window.addEventListener('resize', () => layoutTrialPaper());

// Opening balances （期首残高）: BS accounts only, kept per company as
// { accountId: { debit, credit } }. Edited from the trial-balance tab;
// changes save immediately and the trial balance re-renders.
function renderOpening() {
  const c = company();
  const body = $('ob-body');
  if (!c || !body) return;
  const ob = c.openingBalances || (c.openingBalances = {});
  body.innerHTML = '';
  let totalDebit = 0, totalCredit = 0;
  for (const a of effAccounts(c)) {
    if (a.kind === 'total') continue;
    if (!['asset', 'liability', 'equity'].includes(a.category)) continue;
    const o = ob[a.id] || { debit: 0, credit: 0 };
    totalDebit += Number(o.debit) || 0;
    totalCredit += Number(o.credit) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td><input type="number" min="0" step="1" data-side="debit"></td><td><input type="number" min="0" step="1" data-side="credit"></td>';
    tr.children[0].textContent = a.name;
    const inputs = { debit: tr.querySelector('[data-side="debit"]'), credit: tr.querySelector('[data-side="credit"]') };
    inputs.debit.value = o.debit || '';
    inputs.credit.value = o.credit || '';
    for (const side of ['debit', 'credit']) {
      inputs[side].addEventListener('change', () => {
        const cur = ob[a.id] || (ob[a.id] = { debit: 0, credit: 0 });
        cur[side] = Math.max(0, Math.floor(Number(inputs[side].value) || 0));
        if (!cur.debit && !cur.credit) delete ob[a.id];
        saveState(); renderTrial();
      });
    }
    body.appendChild(tr);
  }
  const diff = $('ob-diff');
  if (!totalDebit && !totalCredit) diff.textContent = '期首残高はまだ入力されていません。';
  else if (totalDebit === totalCredit) diff.textContent = `期首残高の合計：借方 ${totalDebit.toLocaleString()} ／ 貸方 ${totalCredit.toLocaleString()}（一致しています）`;
  else diff.textContent = `注意：期首残高の借方合計 ${totalDebit.toLocaleString()} と貸方合計 ${totalCredit.toLocaleString()} が一致していません（差額 ${Math.abs(totalDebit - totalCredit).toLocaleString()}）。`;
}

// Carry-forward （期末残高の翌期繰越）: builds the next period's company
// from this period's closing balances over the full company period.
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function addYears(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); }

$('tb-carry').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const msg = $('tb-msg');
  const accounts = effAccounts(c);
  const tb = trialBalance(c.journals, accounts, c.openingBalances || {});
  const start = addDays(c.periodEnd, 1);
  const end = addDays(addYears(start, 1), -1);
  if (state.companies.some((x) => x.name === c.name && x.periodStart === start && x.periodEnd === end)) {
    msg.textContent = `次期（${start} 〜 ${end}）の会社データは既にあります。二重に作らないため、繰越を中止しました。`;
    return;
  }
  const opening = {};
  for (const r of tb.rows) {
    if (r.closingDebit || r.closingCredit) opening[r.id] = { debit: r.closingDebit, credit: r.closingCredit };
  }
  let profitNote = '';
  if (tb.profit !== 0) {
    const ret = accounts.find((a) => a.name === '繰越利益剰余金' && a.kind !== 'total');
    if (ret) {
      if (opening[ret.id]) {
        const cur = opening[ret.id];
        const net = (cur.debit - cur.credit) - tb.profit;
        cur.debit = Math.max(net, 0); cur.credit = Math.max(-net, 0);
        if (!cur.debit && !cur.credit) delete opening[ret.id];
      } else {
        opening[ret.id] = tb.profit > 0 ? { debit: 0, credit: tb.profit } : { debit: -tb.profit, credit: 0 };
      }
      profitNote = `当期の損益 ${tb.profit.toLocaleString()} 円は「繰越利益剰余金」の期首残高に含めました。`;
    } else {
      profitNote = `「繰越利益剰余金」という科目がないため、当期の損益 ${tb.profit.toLocaleString()} 円は繰り越しませんでした。`;
    }
  }
  if (!confirm(`「${c.name}」の期末残高を翌期（${start} 〜 ${end}）へ繰り越します。次期の会社データを新規に作成し、そちらに切り替えます。${profitNote}よろしいですか？`)) return;
  const clone = (v, fb) => JSON.parse(JSON.stringify(v ?? fb));
  const nc = newCompany(c.name, start, end);
  nc.accountOverrides = clone(c.accountOverrides, {});
  nc.accountAdditions = clone(c.accountAdditions, []);
  nc.accountDeleted = clone(c.accountDeleted, []);
  nc.taxOverrides = clone(c.taxOverrides, {});
  nc.taxAdditions = clone(c.taxAdditions, []);
  nc.taxDeleted = clone(c.taxDeleted, []);
  nc.openingBalances = opening;
  state.companies.push(nc);
  state.currentCompanyId = nc.id;
  tbCompanyId = null;
  saveState();
  renderHeader(); renderEntryMasters(); renderList(); renderTrial(); renderMasters(); renderCompanyForm(); updateExportCount();
  $('tb-msg').textContent = `次期（${start} 〜 ${end}）の会社データを作成し、切り替えました。${profitNote}`;
});

// ---------- Export / Import ----------

for (const id of ['x-format', 'x-from', 'x-to', 'x-include']) $(id).addEventListener('input', updateExportCount);

function exportTargets() {
  const c = company();
  if (!c) return [];
  const format = $('x-format').value;
  const from = normalizeDate($('x-from').value) || '0000-01-01';
  const to = normalizeDate($('x-to').value) || '9999-12-31';
  const include = $('x-include').checked;
  return sortedJournals(c).filter((j) => {
    if (j.date < from || j.date > to) return false;
    if (!include && j.exports && j.exports[format]) return false;
    return true;
  });
}

function updateExportCount() {
  const c = company();
  if (!c) { $('x-count').textContent = ''; return; }
  if (!$('x-from').value) $('x-from').value = c.periodStart;
  if (!$('x-to').value) $('x-to').value = c.periodEnd;
  $('x-count').textContent = `対象: ${exportTargets().length} 件`;
}

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function collectWarnings(format, entries) {
  const warnings = [];
  if (format === 'epson') {
    for (const e of entries) {
      for (const side of ['debit', 'credit']) {
        const acc = e[side + 'Account'], tax = e[side + 'Tax'];
        if (!acc.epsonCode) warnings.push(`エプソン: 科目「${acc.name}」のエプソン用コードが未設定です`);
        if (!tax.epsonKazei) warnings.push(`エプソン: 税区分「${tax.name}」の課税区分コードが未設定です`);
        if (tax.epsonTax && isEpsonNoRateTax(tax)) warnings.push(`エプソン: 税区分「${tax.name}」は対象外・非課税のため、税率を空欄で出力します`);
      }
    }
  }
  if (format === 'jdl') {
    for (const e of entries) {
      for (const side of ['debit', 'credit']) {
        const acc = e[side + 'Account'];
        if (!acc.jdlCode) warnings.push(`JDL: 科目「${acc.name}」のJDL用コードが未設定です`);
      }
      const adopted = pickJdlTax(e).tax;
      if (!adopted.jdlKaku) warnings.push(`JDL: 税区分「${adopted.name}」の課区が未設定です`);
      else if (adopted.name !== '対象外' && !adopted.jdlTax) warnings.push(`JDL: 税区分「${adopted.name}」の税区が未設定です`);
    }
    warnings.push(...collectJdlWarnings(entries));
  }
  if (format === 'freee') {
    for (const e of entries) {
      for (const side of ['debit', 'credit']) {
        const acc = e[side + 'Account'], tax = e[side + 'Tax'];
        if (!tax.freeeName) warnings.push(`freee: 税区分「${tax.name}」のfreee税区分名が未設定です`);
        if (acc.name && acc.name.length > 30) warnings.push(`freee: 科目「${acc.name}」の名称が30文字を超えています`);
      }
      if (e.summary && e.summary.length > 1024) warnings.push(`freee: 伝票${e.voucherNo}の摘要が1,024文字を超えています`);
    }
  }
  if (format === 'yayoi') {
    warnings.push(...collectYayoiWarnings(entries));
  }
  if (format === 'mf') {
    warnings.push(...collectMfWarnings(entries));
  }
  if (format === 'pca') {
    warnings.push(...collectPcaWarnings(entries));
  }
  if (format === 'obc') {
    warnings.push(...collectObcWarnings(entries));
  }
  return [...new Set(warnings)];
}

$('x-run').addEventListener('click', () => {
  const c = company();
  const msg = $('x-msg');
  if (!c) return;
  const format = $('x-format').value;
  const targets = exportTargets();
  if (!targets.length) { msg.textContent = '出力対象の仕訳がありません'; msg.className = 'msg'; return; }
  if ($('x-include').checked && targets.some((j) => j.exports && j.exports[format])) {
    let extra = '';
    if (format === 'freee') extra = '\nfreeeでは、同じ日付・同じ伝票番号の取引が既に登録されているとインポート時にエラーになります。';
    if (format === 'mf') extra = '\nマネーフォワードでは、インポートのたびに新しい仕訳として登録されます。取り込み済みの仕訳を再出力して取り込むと重複します。';
    if (format === 'pca') extra = '\nPCA会計は受入履歴を管理しないため、取り込み済みの仕訳を再出力して取り込むと重複します。';
    if (!confirm('出力済みの仕訳が含まれています。再出力しますか？' + extra)) return;
  }
  const byA = accountsById(c), byT = taxesById(c);
  const entries = targets.map((j) => resolveEntry(j, byA, byT));
  const warnings = collectWarnings(format, entries);
  if (warnings.length) {
    if (!confirm('警告があります:\n\n' + warnings.slice(0, 15).join('\n') + (warnings.length > 15 ? `\n…ほか ${warnings.length - 15} 件` : '') + '\n\n出力を続けますか？')) return;
  }
  let genEntries = entries;
  if (format !== 'transfer' && $('x-marker').checked) {
    const allFlags = journalFlags(sortedJournals(c).map((j) => resolveEntry(j, byA, byT)), { start: c.periodStart, end: c.periodEnd });
    genEntries = entries.map((e) => allFlags.has(e.id) ? { ...e, summary: '【要確認】' + (e.summary || '') } : e);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${(c.name || 'journal').replace(/[\\/:*?"<>|]/g, '_')}_${format}_${stamp}`;
  if (format === 'transfer') {
    const data = buildTransferData(c, targets, new Date().toISOString());
    download(base + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  } else {
    let text;
    if (format === 'freee') text = toFreeeCSV(genEntries);
    else if (format === 'epson') text = toEpsonCSV(genEntries);
    else if (format === 'yayoi') text = toYayoiCSV(genEntries);
    else if (format === 'mf') text = toMfCSV(genEntries);
    else if (format === 'pca') text = toPcaCSV(genEntries);
    else if (format === 'obc') text = toObcCSV(genEntries);
    else text = toJdlCSV(genEntries);
    const verify = verifyGenerated(format, text, genEntries);
    if (!verify.ok) {
      msg.textContent = '出力ファイルの検証で問題が見つかったため、出力を中止しました（' + verify.errors[0] + '）';
      msg.className = 'msg';
      return;
    }
    download(base + '.csv', new Blob([encodeSJIS(text)], { type: 'text/csv' }));
  }
  const now = new Date().toISOString();
  for (const j of targets) { j.exports = j.exports || {}; j.exports[format] = now; }
  saveState();
  msg.textContent = `${FORMAT_LABELS[format]}形式で ${targets.length} 件を出力し、出力済みとして記録しました`;
  msg.className = 'msg ok';
  updateExportCount(); renderList();
});

$('import-file').addEventListener('change', async () => {
  const c = company();
  const msg = $('import-msg');
  const file = $('import-file').files[0];
  if (!c || !file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.type !== 'journal-transfer' || !Array.isArray(data.journals)) {
      msg.textContent = '転送ファイルの形式が正しくありません'; msg.className = 'msg'; return;
    }
    if (data.companyName !== c.name || data.periodStart !== c.periodStart || data.periodEnd !== c.periodEnd) {
      msg.textContent = `会社名・会計期間が現在の会社（${c.name} / ${c.periodStart}〜${c.periodEnd}）と一致しないため、取り込めません`;
      msg.className = 'msg'; return;
    }
    const existing = new Set(c.journals.map((j) => j.id));
    let added = 0, skipped = 0;
    for (const j of data.journals) {
      if (!j || !j.id || existing.has(j.id)) { skipped++; continue; }
      c.journals.push({ ...j, exports: j.exports || {} });
      existing.add(j.id);
      added++;
    }
    saveState(); renderList();
    msg.textContent = `取り込みました: 追加 ${added} 件 / 重複でスキップ ${skipped} 件`;
    msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = 'ファイルの読み込みに失敗しました: ' + e.message;
    msg.className = 'msg';
  }
  $('import-file').value = '';
});

// ---------- Masters ----------

function taxOptions(selectedId) {
  const c = company();
  return effTaxes(c).map((t) => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.name}</option>`).join('');
}

const CATEGORY_LABELS = { asset: '資産', liability: '負債', equity: '純資産', revenue: '収益', expense: '費用' };
function categoryOptions(selected) {
  return Object.entries(CATEGORY_LABELS)
    .map(([v, label]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label}</option>`).join('');
}

const KIND_LABELS = { normal: '通常科目', total: '合計科目' };
function kindOptions(selected) {
  return Object.entries(KIND_LABELS)
    .map(([v, label]) => `<option value="${v}" ${v === (selected || 'normal') ? 'selected' : ''}>${label}</option>`).join('');
}
// 合計先 options for one account row: total accounts other than itself.
function parentOptions(c, a) {
  if (a.kind === 'total') return '<option value="">―</option>';
  const opts = ['<option value="">なし</option>'];
  for (const t of effAccounts(c)) {
    if (t.kind === 'total' && t.id !== a.id) {
      opts.push(`<option value="${t.id}" ${t.id === a.totalParentId ? 'selected' : ''}>${t.name}</option>`);
    }
  }
  return opts.join('');
}
function fillNewParentOptions(c) {
  const sel = $('acc-new-parent');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">なし</option>' + effAccounts(c)
    .filter((t) => t.kind === 'total')
    .map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderMasters() {
  const c = company();
  const aBody = document.querySelector('#account-table tbody');
  const tBody = document.querySelector('#tax-table tbody');
  aBody.innerHTML = ''; tBody.innerHTML = '';
  if (!c) return;
  fillNewParentOptions(c);
  for (const a of effAccounts(c)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-f="name" value=""></td>
      <td><input data-f="epsonCode" value=""></td>
      <td><input data-f="jdlCode" value=""></td>
      <td><input data-f="pcaCode" value=""></td>
      <td><input data-f="obcCode" value=""></td>
      <td><select data-f="defaultTaxId">${taxOptions(a.defaultTaxId)}</select></td>
      <td><select data-f="category">${categoryOptions(a.category || 'asset')}</select></td>
      <td><select data-f="kind">${kindOptions(a.kind)}</select></td>
      <td><select data-f="totalParentId">${parentOptions(c, a)}</select></td>
      <td class="row-btns"><button data-act="del">削除</button></td>`;
    tr.querySelector('[data-f="name"]').value = a.name;
    tr.querySelector('[data-f="epsonCode"]').value = a.epsonCode || '';
    tr.querySelector('[data-f="jdlCode"]').value = a.jdlCode || '';
    tr.querySelector('[data-f="pcaCode"]').value = a.pcaCode || '';
    tr.querySelector('[data-f="obcCode"]').value = a.obcCode || '';
    tr.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('change', () => {
        writeMasterField(c, 'account', a, el.dataset.f, el.value);
        if (el.dataset.f === 'kind' && el.value === 'total') {
          writeMasterField(c, 'account', a, 'totalParentId', '');
        }
        saveState(); renderEntryMasters();
        if (el.dataset.f === 'kind' || el.dataset.f === 'totalParentId') renderMasters();
      });
    });
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      const m = $('master-msg');
      if (a.name === '諸口') { m.textContent = '「諸口」は複合仕訳に必要なため削除できません'; return; }
      if (c.journals.some((j) => j.debitAccountId === a.id || j.creditAccountId === a.id)) {
        m.textContent = `警告: 科目「${a.name}」は仕訳で使用中のため削除できません`;
        return;
      }
      if (!confirm(`科目「${a.name}」を削除しますか？`)) return;
      deleteMasterItem(c, 'account', a);
      c.templates = c.templates.filter((t) => t.debitAccountId !== a.id && t.creditAccountId !== a.id);
      saveState(); renderMasters(); renderEntryMasters();
    });
    aBody.appendChild(tr);
  }
  for (const t of effTaxes(c)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-f="name" value=""></td>
      <td><input data-f="freeeName" value=""></td>
      <td><input data-f="epsonKazei" value=""></td>
      <td><input data-f="epsonTax" value=""></td>
      <td><input data-f="jdlKaku" value=""></td>
      <td><input data-f="jdlTax" value=""></td>
      <td><input data-f="yayoiName" value=""></td>
      <td><input data-f="mfName" value=""></td>
      <td><input data-f="pcaCode" value=""></td>
      <td><input data-f="pcaName" value=""></td>
      <td><input data-f="obcCode" value=""></td>
      <td class="row-btns"><button data-act="del">削除</button></td>`;
    for (const f of ['name', 'freeeName', 'epsonKazei', 'epsonTax', 'jdlKaku', 'jdlTax', 'yayoiName', 'mfName', 'pcaCode', 'pcaName', 'obcCode']) {
      tr.querySelector(`[data-f="${f}"]`).value = t[f] || '';
    }
    tr.querySelectorAll('input').forEach((el) => {
      el.addEventListener('change', () => { writeMasterField(c, 'tax', t, el.dataset.f, el.value); saveState(); renderEntryMasters(); });
    });
    tr.querySelector('[data-act="del"]').addEventListener('click', () => {
      const m = $('master-msg');
      const used = c.journals.some((j) => j.debitTaxId === t.id || j.creditTaxId === t.id)
        || effAccounts(c).some((a) => a.defaultTaxId === t.id);
      if (used) { m.textContent = `警告: 税区分「${t.name}」は仕訳または科目の初期値で使用中のため削除できません`; return; }
      if (!confirm(`税区分「${t.name}」を削除しますか？`)) return;
      deleteMasterItem(c, 'tax', t);
      saveState(); renderMasters(); renderEntryMasters();
    });
    tBody.appendChild(tr);
  }
}

$('acc-add').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const name = $('acc-new-name').value.trim();
  if (!name) return;
  if (effAccounts(c).some((a) => a.name === name)) { $('master-msg').textContent = '同じ名前の科目があります'; return; }
  const kind = $('acc-new-kind').value;
  (c.accountAdditions || (c.accountAdditions = [])).push({
    id: uid(), name, epsonCode: '', jdlCode: '', pcaCode: '', obcCode: '', defaultTaxId: 'tax-excluded',
    category: $('acc-new-category').value, kind,
    totalParentId: kind === 'total' ? '' : $('acc-new-parent').value,
  });
  $('acc-new-name').value = '';
  saveState(); renderMasters(); renderEntryMasters();
});
$('tax-add').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const name = $('tax-new-name').value.trim();
  if (!name) return;
  (c.taxAdditions || (c.taxAdditions = [])).push({ id: uid(), name, freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '', mfName: '', pcaCode: '', pcaName: '', obcCode: '' });
  $('tax-new-name').value = '';
  saveState(); renderMasters(); renderEntryMasters();
});

// ---------- Company / settings ----------

function renderCompanyForm() {
  const c = company();
  if (!c) return;
  $('c-name').value = c.name;
  $('c-start').value = c.periodStart;
  $('c-end').value = c.periodEnd;
}
$('company-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('c-name').value.trim();
  const start = normalizeDate($('c-start').value), end = normalizeDate($('c-end').value);
  if (!name || !start || !end) {
    $('company-msg').textContent = '会社名と会計期間（正しい日付）を入力してください';
    $('company-msg').className = 'msg';
    return;
  }
  const c = newCompany(name, start, end);
  state.companies.push(c);
  state.currentCompanyId = c.id;
  saveState();
  initEntryContext();
  renderHeader(); renderEntryMasters(); renderList(); renderMasters(); updateExportCount();
  $('company-msg').textContent = `会社「${name}」を登録しました`;
  $('company-msg').className = 'msg ok';
});
$('c-update').addEventListener('click', () => {
  const c = company(); if (!c) return;
  const start = normalizeDate($('c-start').value), end = normalizeDate($('c-end').value);
  if (($('c-start').value.trim() && start === null) || ($('c-end').value.trim() && end === null)) {
    $('company-msg').textContent = '会計期間の日付の形式が正しくありません（例: 2026-04-01）';
    $('company-msg').className = 'msg';
    return;
  }
  c.name = $('c-name').value.trim() || c.name;
  c.periodStart = start || c.periodStart;
  c.periodEnd = end || c.periodEnd;
  saveState(); renderHeader();
  $('company-msg').textContent = '会社情報を更新しました'; $('company-msg').className = 'msg ok';
});
$('c-delete').addEventListener('click', () => {
  const c = company(); if (!c) return;
  if (!confirm(`会社「${c.name}」のデータ（仕訳 ${c.journals.length} 件を含む）を削除しますか？`)) return;
  state.companies = state.companies.filter((x) => x.id !== c.id);
  state.currentCompanyId = state.companies.length ? state.companies[0].id : null;
  saveState(); initEntryContext();
  renderHeader(); renderEntryMasters(); renderList(); renderMasters(); renderCompanyForm(); updateExportCount();
});

$('backup-run').addEventListener('click', () => {
  download(`journal-backup-${new Date().toISOString().slice(0, 10)}.json`,
    new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
});
$('restore-file').addEventListener('change', async () => {
  const file = $('restore-file').files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.companies)) throw new Error('形式が正しくありません');
    if (!confirm('現在のデータを復元ファイルで置き換えますか？')) return;
    state = data;
    migrateState(state);
    if (!state.companies.find((c) => c.id === state.currentCompanyId)) {
      state.currentCompanyId = state.companies.length ? state.companies[0].id : null;
    }
    saveState(); initEntryContext();
    renderHeader(); renderEntryMasters(); renderList(); renderMasters(); renderCompanyForm(); updateExportCount();
    $('backup-msg').textContent = '復元しました'; $('backup-msg').className = 'msg ok';
  } catch (e) {
    $('backup-msg').textContent = '復元に失敗しました: ' + e.message;
    $('backup-msg').className = 'msg';
  }
  $('restore-file').value = '';
});

// ---------- Init ----------

if (stateMigrated) saveState();
renderHeader();
initEntryContext();
renderEntryMasters();
renderList();
renderCompanyForm();
updateExportCount();
