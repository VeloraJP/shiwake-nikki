// Node tests for the pure exporters. Run: node tests/export.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  resolveEntry, parseCsvLine,
  toEpsonCSV, EPSON_HEADER, toFreeeCSV, FREEE_COLUMNS, isEpsonNoRateTax,
  toJdlCSV, JDL_HEADER, collectJdlWarnings, pickJdlTax,
  toYayoiCSV, yayoiTaxRate, yayoiTaxAmount, collectYayoiWarnings,
  toMfCSV, MF_COLUMNS, collectMfWarnings, sanitizeMfText,
  toPcaCSV, PCA_COLUMNS, collectPcaWarnings, pcaTaxRate, pcaTaxAmount,
  toObcCSV, OBC_COLUMN_COUNT, collectObcWarnings, obcTaxRate,
  shorokuBalance, shorokuSuggestion,
  parseCsv, tokenizeSearch, matchesSearch, journalFlags, verifyGenerated, trialBalance,
  invoiceDeductionRate,
} from '../exporters.js';
import { encodeSJIS } from '../sjis.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

// ---------- Fixtures ----------
const accounts = {
  cash: { id: 'cash', name: '現金', epsonCode: '1111', jdlCode: '111', pcaCode: '11110010', obcCode: '101' },
  receivable: { id: 'receivable', name: '売掛金', epsonCode: '1122', jdlCode: '112', pcaCode: '11120020', obcCode: '121' },
  sales: { id: 'sales', name: '売上高', epsonCode: '4111', jdlCode: '411', pcaCode: '21100010', obcCode: '401' },
  supplies: { id: 'supplies', name: '消耗品費', epsonCode: '', jdlCode: '831', pcaCode: '27002070', obcCode: '751' },
  shoroku: { id: 'shoroku', name: '諸口', epsonCode: '', jdlCode: '', pcaCode: '19900010', obcCode: '999' },
};
const taxes = {
  excluded: { id: 'excluded', name: '対象外', freeeName: '対象外', epsonKazei: '00', epsonTax: '', jdlKaku: '00', jdlTax: '0', yayoiName: '対象外', mfName: '対象外', pcaCode: '00', pcaName: '対象外', obcCode: '0000' },
  sales10: { id: 'sales10', name: '課税売上10%（込）', freeeName: '課税売上10%', epsonKazei: '02', epsonTax: '10', jdlKaku: '31', jdlTax: '8', yayoiName: '課税売上込10%', mfName: '課税売上 10%', pcaCode: 'B5', pcaName: '売上10%', obcCode: '0060' },
  purchase10: { id: 'purchase10', name: '課税仕入10%（込）', freeeName: '課税仕入10%', epsonKazei: '', epsonTax: '', jdlKaku: '11', jdlTax: '8', yayoiName: '課対仕入込10%', mfName: '課税仕入 10%', pcaCode: 'Q5', pcaName: '仕入10%', obcCode: '0010' },
  sales8: { id: 'sales8', name: '課税売上8%軽減（込）', freeeName: '課税売上8%（軽）', epsonKazei: '02', epsonTax: 'K8', jdlKaku: '32', jdlTax: '6', yayoiName: '課税売上込軽減8%', mfName: '課税売上 (軽)8%', pcaCode: 'B6', pcaName: '売上8%軽', obcCode: '0060' },
};
const accountsById = Object.fromEntries(Object.values(accounts).map((a) => [a.id, a]));
const taxesById = Object.fromEntries(Object.values(taxes).map((t) => [t.id, t]));
const resolve = (j) => resolveEntry(j, accountsById, taxesById);

// Epson sample journals (dates/accounts mirror the old proven macro samples)
const epsonJ1 = resolve({ id: 'j1', date: '2026-04-01', voucherNo: 1, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 70000, summary: '本日売上高' });
const epsonJ2 = resolve({ id: 'j2', date: '2026-04-01', voucherNo: 2, debitAccountId: 'receivable', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 80000, summary: '本日売上高/ｽｸｴｱ' });
const epsonDataCols = (entries) => toEpsonCSV(entries).trimEnd().split('\r\n').slice(1).map(parseCsvLine);

// ---------- a. Epson (official template, header + 45 columns) ----------
test('epson: header row matches the official template and data rows carry the mapped values', () => {
  const lines = toEpsonCSV([epsonJ1, epsonJ2]).trimEnd().split('\r\n');
  assert.strictEqual(lines.length, 3, 'header + 2 data rows');
  assert.deepStrictEqual(parseCsvLine(lines[0]), EPSON_HEADER);
  const c1 = parseCsvLine(lines[1]);
  assert.strictEqual(c1.length, 45, 'column count must be 45');
  assert.strictEqual(c1[0], '0'); // 月種別: 通常
  assert.strictEqual(c1[2], '3'); // 形式: 振替
  assert.strictEqual(c1[5], '20260401'); // 伝票日付 YYYYMMDD
  assert.strictEqual(c1[6], '1'); // 伝票番号
  assert.strictEqual(c1[8], '1'); // 枝番
  assert.strictEqual(c1[11], '1111'); // 借方科目
  assert.strictEqual(c1[12], '現金'); // 借方科目名
  assert.strictEqual(c1[15], '70000'); // 借方金額
  assert.strictEqual(c1[16], '00'); // 借方消費税コード (対象外)
  assert.strictEqual(c1[18], ''); // 対象外は税率空欄
  assert.strictEqual(c1[22], ' '); // 借方インボイス情報: 適格 = 半角スペース
  assert.strictEqual(c1[25], '4111'); // 貸方科目
  assert.strictEqual(c1[29], '70000'); // 貸方金額
  assert.strictEqual(c1[30], '02'); // 貸方消費税コード (課税売上(込))
  assert.strictEqual(c1[32], '10'); // 貸方消費税税率
  assert.strictEqual(c1[36], ' '); // 貸方インボイス情報
  assert.strictEqual(c1[37], '本日売上高'); // 摘要
  const c2 = parseCsvLine(lines[2]);
  assert.strictEqual(c2[6], '2');
  assert.strictEqual(c2[11], '1122');
  assert.strictEqual(c2[37], '本日売上高/ｽｸｴｱ');
});

test('epson: 枝番 counts lines within the same voucher number', () => {
  const a = resolve({ id: 'e1', date: '2026-04-01', voucherNo: 9, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'shoroku', creditTaxId: 'excluded', amount: 100, summary: '一行目' });
  const b = resolve({ id: 'e2', date: '2026-04-01', voucherNo: 9, debitAccountId: 'shoroku', debitTaxId: 'excluded', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 100, summary: '二行目' });
  const rows = epsonDataCols([a, b]);
  assert.strictEqual(rows[0][8], '1');
  assert.strictEqual(rows[1][8], '2');
});

test('epson: debit tax code/rate columns (17/19) and K8 on credit', () => {
  const j = resolve({ id: 'j3', date: '2026-04-02', voucherNo: 3, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 1100, summary: 'コピー用紙' });
  const cols = epsonDataCols([j])[0];
  assert.strictEqual(cols[16], ''); // 課税仕入 epson code unconfirmed -> blank (warning is a UI concern)
  assert.strictEqual(cols[30], '00'); // credit 現金 = 対象外
  assert.strictEqual(cols[32], '');
  const j8 = resolve({ id: 'j4', date: '2026-04-02', voucherNo: 4, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales8', amount: 1080, summary: '軽減売上' });
  const cols8 = epsonDataCols([j8])[0];
  assert.strictEqual(cols8[30], '02');
  assert.strictEqual(cols8[32], 'K8');
});

// ---------- b. freee (thick) ----------
test('freee: header row is [表題行] + FREEE_COLUMNS', () => {
  const lines = toFreeeCSV([epsonJ1]).trimEnd().split('\r\n');
  const header = parseCsvLine(lines[0]);
  assert.deepStrictEqual(header, ['[表題行]', ...FREEE_COLUMNS]);
});

test('freee: detail rows are [明細行] with values in the right columns', () => {
  const lines = toFreeeCSV([epsonJ1, epsonJ2]).trimEnd().split('\r\n');
  assert.strictEqual(lines.length, 3, 'header + 2 detail rows');
  const col = (row, name) => row[1 + FREEE_COLUMNS.indexOf(name)];
  const r1 = parseCsvLine(lines[1]);
  assert.strictEqual(r1[0], '[明細行]');
  assert.strictEqual(r1.length, 1 + FREEE_COLUMNS.length);
  assert.strictEqual(col(r1, '日付'), '2026/04/01');
  assert.strictEqual(col(r1, '伝票番号'), '1');
  assert.strictEqual(col(r1, '借方勘定科目'), '現金');
  assert.strictEqual(col(r1, '借方金額'), '70000');
  assert.strictEqual(col(r1, '借方税区分'), '対象外');
  assert.strictEqual(col(r1, '借方税額'), '');
  assert.strictEqual(col(r1, '貸方勘定科目'), '売上高');
  assert.strictEqual(col(r1, '貸方金額'), '70000');
  assert.strictEqual(col(r1, '貸方税区分'), '課税売上10%');
  assert.strictEqual(col(r1, '貸方税額'), '');
  assert.strictEqual(col(r1, '摘要'), '本日売上高');
  assert.strictEqual(col(r1, '借方補助科目'), '');
  assert.strictEqual(col(r1, '借方部門'), '');
  assert.strictEqual(col(r1, '借方取引先'), '');
  const r2 = parseCsvLine(lines[2]);
  assert.strictEqual(col(r2, '伝票番号'), '2');
  assert.strictEqual(col(r2, '借方勘定科目'), '売掛金');
  assert.strictEqual(col(r2, '借方金額'), '80000');
  assert.strictEqual(col(r2, '摘要'), '本日売上高/ｽｸｴｱ');
});

test('freee: both sides carry the same amount (single-entry)', () => {
  const lines = toFreeeCSV([epsonJ1]).trimEnd().split('\r\n');
  const r = parseCsvLine(lines[1]);
  const col = (name) => r[1 + FREEE_COLUMNS.indexOf(name)];
  assert.strictEqual(col('借方金額'), col('貸方金額'));
});

// ---------- c. JDL (16 columns + header) ----------
test('jdl: header row matches the proven header exactly, no marker lines', () => {
  const text = toJdlCSV([epsonJ1]);
  const lines = text.trimEnd().split('\r\n');
  assert.strictEqual(lines[0], '番号,伝番,日付,借方科目,,借方補助,,貸方科目,,貸方補助,,金額,摘要,課区,,税区');
  assert.strictEqual(lines[0], JDL_HEADER);
  assert.ok(!text.includes('＜仕訳一覧＞'), 'marker lines must not be emitted');
});

test('jdl: data rows have 16 columns, 課区 at 14 and 税区 at 16', () => {
  const lines = toJdlCSV([epsonJ1, epsonJ2]).trimEnd().split('\r\n');
  assert.strictEqual(lines.length, 3, 'header + 2 rows');
  const r1 = parseCsvLine(lines[1]);
  assert.strictEqual(r1.length, 16);
  assert.strictEqual(r1[0], '1'); // 番号: sequence from 1
  assert.strictEqual(r1[1], '1'); // 伝番
  assert.strictEqual(r1[2], '20260401');
  assert.strictEqual(r1[3], '111'); // 借方科目コード (現金)
  assert.strictEqual(r1[7], '411'); // 貸方科目コード (売上高)
  assert.strictEqual(r1[11], '70000');
  assert.strictEqual(r1[12], '本日売上高');
  // debit tax is 対象外, credit tax is 課税売上 -> credit side values are used
  assert.strictEqual(r1[13], '31', '課区 must be column 14');
  assert.strictEqual(r1[15], '8', '税区 must be column 16');
  assert.strictEqual(r1[14], '');
  const r2 = parseCsvLine(lines[2]);
  assert.strictEqual(r2[0], '2');
  assert.strictEqual(r2[1], '2');
});

test('jdl: tax selection rule (non-excluded side; both non-excluded -> debit + warning; both excluded -> debit)', () => {
  // debit 課税仕入 / credit 対象外 -> debit side
  const buy = resolve({ id: 'b1', date: '2026-04-03', voucherNo: 5, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 500, summary: '消耗品' });
  assert.strictEqual(pickJdlTax(buy).side, 'debit');
  const rb = parseCsvLine(toJdlCSV([buy]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(rb[13], '11');
  assert.strictEqual(rb[15], '8');
  // both non-excluded -> debit wins and a warning is produced
  const both = resolve({ id: 'b2', date: '2026-04-03', voucherNo: 6, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 500, summary: '両側課税' });
  assert.strictEqual(pickJdlTax(both).bothNonExcluded, true);
  assert.strictEqual(pickJdlTax(both).side, 'debit');
  assert.strictEqual(collectJdlWarnings([both]).length, 1);
  assert.strictEqual(collectJdlWarnings([buy]).length, 0);
  // both excluded -> debit side values
  const ex = resolve({ id: 'b3', date: '2026-04-03', voucherNo: 7, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'receivable', creditTaxId: 'excluded', amount: 500, summary: '振替' });
  assert.strictEqual(pickJdlTax(ex).side, 'debit');
  const re = parseCsvLine(toJdlCSV([ex]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(re[13], '00');
  assert.strictEqual(re[15], '0');
});

test('jdl: summary truncated to 64 SJIS bytes', () => {
  const long = resolve({ id: 'b4', date: '2026-04-03', voucherNo: 8, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 1, summary: 'あ'.repeat(40) });
  const r = parseCsvLine(toJdlCSV([long]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(r[12], 'あ'.repeat(32)); // 32 fullwidth chars = 64 bytes
});

// ---------- d. 諸口 suggestion ----------
test('shoroku: suggestion continues until the balance reaches zero', () => {
  const sid = 'shoroku';
  const j = (voucherNo, d, c, amount) => ({ voucherNo, debitAccountId: d, creditAccountId: c, amount });
  let journals = [j(1, 'shoroku', 'sales', 1000)]; // 諸口/売上 1000
  assert.strictEqual(shorokuBalance(journals, 1, sid), 1000);
  assert.strictEqual(shorokuSuggestion(journals, 1, sid), 'credit');
  journals.push(j(1, 'receivable', 'shoroku', 500)); // 売掛金/諸口 500
  assert.strictEqual(shorokuBalance(journals, 1, sid), 500);
  assert.strictEqual(shorokuSuggestion(journals, 1, sid), 'credit');
  journals.push(j(1, 'cash', 'shoroku', 500)); // 現金/諸口 500
  assert.strictEqual(shorokuBalance(journals, 1, sid), 0);
  assert.strictEqual(shorokuSuggestion(journals, 1, sid), null);
  // other vouchers are independent
  assert.strictEqual(shorokuSuggestion(journals, 2, sid), null);
  // net credit balance -> debit side suggested
  const j2 = [j(9, 'sales', 'shoroku', 300)];
  assert.strictEqual(shorokuSuggestion(j2, 9, sid), 'debit');
});

// ---------- e. Shift-JIS encoder ----------
test('sjis: known kanji encode to CP932 bytes, unmapped becomes ?', () => {
  assert.deepStrictEqual([...encodeSJIS('現金')], [0x8c, 0xbb, 0x8b, 0xe0]);
  assert.deepStrictEqual([...encodeSJIS('A')], [0x41]);
  const jdlBytes = encodeSJIS(toJdlCSV([epsonJ1]));
  assert.ok(jdlBytes.length > 0);
});

// ---------- f. Reversed entries (貸借逆仕訳: 売上高が借方・現金が貸方) ----------
const reversed = resolve({ id: 'r1', date: '2026-04-05', voucherNo: 10, debitAccountId: 'sales', debitTaxId: 'sales10', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 5000, summary: '売上取消' });

test('reversed: epson puts debit-side tax in columns 17/19 and credit-side tax in 31/33', () => {
  const cols = epsonDataCols([reversed])[0];
  assert.strictEqual(cols[11], '4111', 'debit account code = 売上高');
  assert.strictEqual(cols[16], '02', 'column 17 = debit 消費税コード (課税売上)');
  assert.strictEqual(cols[18], '10', 'column 19 = debit 消費税税率');
  assert.strictEqual(cols[25], '1111', 'credit account code = 現金');
  assert.strictEqual(cols[30], '00', 'column 31 = credit 消費税コード (対象外)');
  assert.strictEqual(cols[32], '', 'column 33 = credit 消費税税率 (対象外は空欄)');
  assert.strictEqual(cols[15], '5000');
  assert.strictEqual(cols[29], '5000');
});

test('reversed: epson debit-side K8 stays "K8" in column 19', () => {
  const j = resolve({ id: 'r2', date: '2026-04-05', voucherNo: 11, debitAccountId: 'sales', debitTaxId: 'sales8', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 1080, summary: '軽減売上取消' });
  const cols = epsonDataCols([j])[0];
  assert.strictEqual(cols[16], '02');
  assert.strictEqual(cols[18], 'K8');
});

test('reversed: freee swaps account/tax positions with the entry', () => {
  const lines = toFreeeCSV([reversed]).trimEnd().split('\r\n');
  const r = parseCsvLine(lines[1]);
  const col = (name) => r[1 + FREEE_COLUMNS.indexOf(name)];
  assert.strictEqual(col('借方勘定科目'), '売上高');
  assert.strictEqual(col('借方税区分'), '課税売上10%');
  assert.strictEqual(col('貸方勘定科目'), '現金');
  assert.strictEqual(col('貸方税区分'), '対象外');
  assert.strictEqual(col('借方金額'), '5000');
  assert.strictEqual(col('貸方金額'), '5000');
});

test('reversed: jdl takes the tax pair from the debit (non-excluded) side', () => {
  assert.strictEqual(pickJdlTax(reversed).side, 'debit');
  const r = parseCsvLine(toJdlCSV([reversed]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(r[3], '411', 'debit code = 売上高');
  assert.strictEqual(r[7], '111', 'credit code = 現金');
  assert.strictEqual(r[13], '31', '課区 from debit tax');
  assert.strictEqual(r[15], '8', '税区 from debit tax');
});

// ---------- g. No codes assigned ----------
const noCodeAccounts = {
  kari: { id: 'kari', name: '仮払金', epsonCode: '', jdlCode: '' },
  cash2: { id: 'cash2', name: '現金', epsonCode: '', jdlCode: '' },
};
const blankTaxes = {
  // Mirrors the shipped defaults for JDL: 課区/税区 start blank.
  excludedBlank: { id: 'excludedBlank', name: '対象外', freeeName: '対象外', epsonKazei: '00', epsonTax: '', jdlKaku: '', jdlTax: '' },
  sales10Blank: { id: 'sales10Blank', name: '課税売上10%（込）', freeeName: '課税売上10%', epsonKazei: '02', epsonTax: '10', jdlKaku: '', jdlTax: '' },
};
const resolveNC = (j) => resolveEntry(j,
  Object.fromEntries(Object.values(noCodeAccounts).map((a) => [a.id, a])),
  Object.fromEntries(Object.values(blankTaxes).map((t) => [t.id, t])));
const noCode = resolveNC({ id: 'n1', date: '2026-04-06', voucherNo: 12, debitAccountId: 'kari', debitTaxId: 'excludedBlank', creditAccountId: 'cash2', creditTaxId: 'excludedBlank', amount: 3000, summary: '仮払い' });

test('no codes: epson leaves account code columns (12/26) blank, names still output', () => {
  const cols = epsonDataCols([noCode])[0];
  assert.strictEqual(cols[11], '');
  assert.strictEqual(cols[12], '仮払金');
  assert.strictEqual(cols[25], '');
  assert.strictEqual(cols[26], '現金');
  assert.strictEqual(cols[16], '00', 'tax 消費税コード is independent of account codes');
});

test('no codes: jdl leaves code columns (4/8) blank and 課区/税区 blank when tax mappings are blank', () => {
  const r = parseCsvLine(toJdlCSV([noCode]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(r[3], '');
  assert.strictEqual(r[7], '');
  assert.strictEqual(r[13], '', '課区 blank when the chosen tax has no JDL mapping');
  assert.strictEqual(r[15], '', '税区 blank when the chosen tax has no JDL mapping');
  const sale = resolveNC({ id: 'n2', date: '2026-04-06', voucherNo: 13, debitAccountId: 'cash2', debitTaxId: 'excludedBlank', creditAccountId: 'kari', creditTaxId: 'sales10Blank', amount: 3000, summary: '売上' });
  const r2 = parseCsvLine(toJdlCSV([sale]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(r2[13], '', 'non-excluded side chosen, but its mappings are blank -> blank');
  assert.strictEqual(r2[15], '');
});

test('no codes: unknown account id falls back to (不明な科目) with blank codes', () => {
  const ghost = resolveEntry({ id: 'n3', date: '2026-04-06', voucherNo: 14, debitAccountId: 'missing', debitTaxId: 'excluded', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 100, summary: '' }, accountsById, taxesById);
  assert.strictEqual(ghost.debitAccount.name, '(不明な科目)');
  assert.strictEqual(ghost.debitAccount.epsonCode, '');
  assert.strictEqual(ghost.debitAccount.jdlCode, '');
});

// ---------- h. Custom codes take priority over defaults ----------
test('custom codes: exporter uses the master values as-is (custom overrides default)', () => {
  const customAccounts = {
    cashX: { id: 'cashX', name: '現金', epsonCode: '9999', jdlCode: '999' },
    salesX: { id: 'salesX', name: '売上高', epsonCode: '4000', jdlCode: '400' },
  };
  const customTaxes = {
    exX: { id: 'exX', name: '対象外', freeeName: '対象外', epsonKazei: '00', epsonTax: '', jdlKaku: '', jdlTax: '' },
    s10X: { id: 's10X', name: '課税売上10%（込）', freeeName: '課税売上10%', epsonKazei: '99', epsonTax: '10', jdlKaku: '77', jdlTax: '7' },
  };
  const j = resolveEntry({ id: 'c1', date: '2026-04-07', voucherNo: 15, debitAccountId: 'cashX', debitTaxId: 'exX', creditAccountId: 'salesX', creditTaxId: 's10X', amount: 1000, summary: '独自コード' },
    Object.fromEntries(Object.values(customAccounts).map((a) => [a.id, a])),
    Object.fromEntries(Object.values(customTaxes).map((t) => [t.id, t])));
  const ec = epsonDataCols([j])[0];
  assert.strictEqual(ec[11], '9999', 'epson debit code = custom value, not default 1111');
  assert.strictEqual(ec[25], '4000', 'epson credit code = custom value, not default 4111');
  assert.strictEqual(ec[30], '99', 'epson credit 消費税コード = custom value');
  assert.strictEqual(ec[32], '10', 'epson credit 消費税税率 = master value as-is (unified "10", no "10.0" conversion)');
  const jr = parseCsvLine(toJdlCSV([j]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(jr[3], '999');
  assert.strictEqual(jr[7], '400');
  assert.strictEqual(jr[13], '77', '課区 = custom value');
  assert.strictEqual(jr[15], '7', '税区 = custom value');
});

// ---------- j. Both sides taxed (貸借両側に税区分) ----------
const bothTaxed = resolve({ id: 'bt1', date: '2026-04-08', voucherNo: 20, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 3300, summary: '両側課税' });

test('both taxed: epson outputs each side tax in its own columns independently', () => {
  const cols = epsonDataCols([bothTaxed])[0];
  assert.strictEqual(cols[16], '', 'debit 消費税コード: 課税仕入 is unconfirmed -> blank');
  assert.strictEqual(cols[18], '');
  assert.strictEqual(cols[30], '02', 'credit 消費税コード = 課税売上');
  assert.strictEqual(cols[32], '10', 'credit 消費税税率 = 10 (unified with debit side)');
});

test('both taxed: freee outputs both sides tax names', () => {
  const lines = toFreeeCSV([bothTaxed]).trimEnd().split('\r\n');
  const r = parseCsvLine(lines[1]);
  const col = (name) => r[1 + FREEE_COLUMNS.indexOf(name)];
  assert.strictEqual(col('借方税区分'), '課税仕入10%');
  assert.strictEqual(col('貸方税区分'), '課税売上10%');
});

test('both taxed: jdl row uses the debit pair (課区/税区) and warns', () => {
  const r = parseCsvLine(toJdlCSV([bothTaxed]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(r[13], '11', '課区 = debit （課税仕入） value, not credit 31');
  assert.strictEqual(r[15], '8', '税区 = debit value');
  assert.strictEqual(collectJdlWarnings([bothTaxed]).length, 1);
});

// ---------- k. Official-help survey (2026-11-12) reflections ----------
const rawEntry = (over) => ({
  date: '2026-04-09', voucherNo: 30, amount: 5500, summary: '公式確認分',
  debitAccount: { name: '消耗品費', epsonCode: '', jdlCode: '831' },
  creditAccount: { name: '現金', epsonCode: '1111', jdlCode: '111' },
  debitTax: { name: '課税仕入10%（込）', epsonKazei: '32', epsonTax: '10' },
  creditTax: { name: '対象外', epsonKazei: '00', epsonTax: '' },
  ...over,
});

test('epson: purchase tax code 32 outputs debit rate as-is (10)', () => {
  const cols = epsonDataCols([rawEntry({})])[0];
  assert.strictEqual(cols[16], '32', 'debit 消費税コード = 32 （課税仕入（込）)');
  assert.strictEqual(cols[18], '10', 'debit 消費税税率 = 10 (debit side keeps the master text)');
});

test('epson: purchase tax on the credit side also outputs 10 as-is (unified 2026-11-12), K8 stays K8', () => {
  const e = rawEntry({
    debitTax: { name: '対象外', epsonKazei: '00', epsonTax: '' },
    creditTax: { name: '課税仕入10%（込）', epsonKazei: '32', epsonTax: '10' },
  });
  const cols = epsonDataCols([e])[0];
  assert.strictEqual(cols[30], '32');
  assert.strictEqual(cols[32], '10');
  const e8 = rawEntry({
    debitTax: { name: '対象外', epsonKazei: '00', epsonTax: '' },
    creditTax: { name: '課税仕入8%軽減（込）', epsonKazei: '32', epsonTax: 'K8' },
  });
  assert.strictEqual(epsonDataCols([e8])[0][32], 'K8');
});

test('epson: rate is forced blank for 対象外/非課税 categories even if a rate is set', () => {
  const e = rawEntry({
    debitTax: { name: '非課税売上', epsonKazei: '20', epsonTax: '10' },
    creditTax: { name: '非課税仕入', epsonKazei: '30', epsonTax: '10' },
  });
  const cols = epsonDataCols([e])[0];
  assert.strictEqual(cols[16], '20');
  assert.strictEqual(cols[18], '', 'debit rate blanked for 非課税');
  assert.strictEqual(cols[30], '30');
  assert.strictEqual(cols[32], '', 'credit rate blanked for 非課税');
  assert.ok(isEpsonNoRateTax({ epsonKazei: '00' }) && isEpsonNoRateTax({ epsonKazei: '20' }) && isEpsonNoRateTax({ epsonKazei: '30' }));
  assert.ok(!isEpsonNoRateTax({ epsonKazei: '02' }) && !isEpsonNoRateTax({ epsonKazei: '32' }));
});

test('freee: trailing columns use official names 借方メモタグ/貸方メモタグ (no 備考/メモタグ)', () => {
  assert.deepStrictEqual(FREEE_COLUMNS.slice(-2), ['借方メモタグ', '貸方メモタグ']);
  assert.ok(!FREEE_COLUMNS.includes('備考') && !FREEE_COLUMNS.includes('メモタグ'));
  const header = parseCsvLine(toFreeeCSV([bothTaxed]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(header[header.length - 2], '借方メモタグ');
  assert.strictEqual(header[header.length - 1], '貸方メモタグ');
});

// ---------- l. Yayoi （弥生インポート形式, 25 columns, no header) ----------
test('yayoi: row has 25 columns with flag 2000, names, tax writings and 内税額', () => {
  const cols = parseCsvLine(toYayoiCSV([epsonJ1]).trimEnd());
  assert.strictEqual(cols.length, 25, 'column count must be 25');
  assert.strictEqual(cols[0], '2000', '識別フラグ = 2000 （伝票以外の仕訳データ）');
  assert.strictEqual(cols[1], '1', '伝票No');
  assert.strictEqual(cols[2], '', '決算 = blank (通常の仕訳)');
  assert.strictEqual(cols[3], '2026/04/01', '取引日付');
  assert.strictEqual(cols[4], '現金', '借方勘定科目は名称');
  assert.strictEqual(cols[5], '', '借方補助科目 = blank');
  assert.strictEqual(cols[6], '', '借方部門 = blank');
  assert.strictEqual(cols[7], '対象外', '借方税区分');
  assert.strictEqual(cols[8], '70000', '借方金額 (税込)');
  assert.strictEqual(cols[9], '0', '借方税金額: 対象外は 0');
  assert.strictEqual(cols[10], '売上高', '貸方勘定科目は名称');
  assert.strictEqual(cols[13], '課税売上込10%', '貸方税区分は記述形式');
  assert.strictEqual(cols[14], '70000', '貸方金額 (税込)');
  assert.strictEqual(cols[15], '6363', '貸方税金額 = floor(70000 * 10 / 110)');
  assert.strictEqual(cols[16], '本日売上高', '摘要');
  assert.strictEqual(cols[19], '0', 'タイプ = 0 (仕訳データ)');
  assert.strictEqual(cols[22], '0', '付箋1 = 0');
  assert.strictEqual(cols[24], 'no', '調整 = no');
});

test('yayoi: tax amount is the floored 内税額 for 10% and 軽減8%, rate read from the 記述形式', () => {
  assert.strictEqual(yayoiTaxRate(taxes.sales10), 10);
  assert.strictEqual(yayoiTaxRate(taxes.sales8), 8);
  assert.strictEqual(yayoiTaxRate(taxes.excluded), 0);
  assert.strictEqual(yayoiTaxAmount(1100, taxes.purchase10), 100);
  assert.strictEqual(yayoiTaxAmount(1080, taxes.sales8), 80);
  assert.strictEqual(yayoiTaxAmount(1000, taxes.sales10), 90, 'floor(1000 * 10 / 110) = 90');
  assert.strictEqual(yayoiTaxAmount(5000, taxes.excluded), 0);
  const j8 = resolve({ id: 'y8', date: '2026-04-02', voucherNo: 4, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales8', amount: 1080, summary: '軽減売上' });
  const cols = parseCsvLine(toYayoiCSV([j8]).trimEnd());
  assert.strictEqual(cols[13], '課税売上込軽減8%', '軽減は空白なしの記述形式');
  assert.strictEqual(cols[15], '80');
});

test('yayoi: summary truncated to 64 SJIS bytes; no header line is emitted', () => {
  const long = resolve({ id: 'y9', date: '2026-04-03', voucherNo: 8, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 1, summary: 'あ'.repeat(40) });
  const text = toYayoiCSV([long]);
  const lines = text.trimEnd().split('\r\n');
  assert.strictEqual(lines.length, 1, 'data only, no header');
  assert.strictEqual(parseCsvLine(lines[0])[16], 'あ'.repeat(32));
});

test('yayoi: blank yayoiName produces a warning; seeded names do not', () => {
  const blankTax = { id: 'bx', name: '独自税区分', freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '' };
  const e = resolveEntry({ id: 'yw', date: '2026-04-03', voucherNo: 9, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '' },
    accountsById, { ...taxesById, excluded: blankTax });
  const w = collectYayoiWarnings([e]);
  assert.strictEqual(w.length, 1);
  assert.ok(w[0].includes('未設定'));
  assert.strictEqual(collectYayoiWarnings([epsonJ1]).length, 0);
});

// ---------- m. Money Forward （仕訳帳インポート形式, 27 columns + label row) ----------
test('mf: label row is the official 27 item names in order', () => {
  const lines = toMfCSV([epsonJ1]).trimEnd().split('\r\n');
  assert.deepStrictEqual(parseCsvLine(lines[0]), MF_COLUMNS);
  assert.strictEqual(MF_COLUMNS.length, 27);
  assert.strictEqual(MF_COLUMNS[0], '取引No');
  assert.strictEqual(MF_COLUMNS[8], '借方金額(円)');
  assert.strictEqual(MF_COLUMNS[16], '貸方金額(円)');
  assert.strictEqual(MF_COLUMNS[18], '摘要');
  assert.strictEqual(MF_COLUMNS[26], '最終更新者');
});

test('mf: row carries voucher as 取引No, names, formal tax names, gross amounts, blank tax amounts', () => {
  const lines = toMfCSV([epsonJ1]).trimEnd().split('\r\n');
  const cols = parseCsvLine(lines[1]);
  assert.strictEqual(cols.length, 27);
  assert.strictEqual(cols[0], '1', '取引No = 伝票番号');
  assert.strictEqual(cols[1], '2026/04/01', '取引日');
  assert.strictEqual(cols[2], '現金', '借方勘定科目は名称');
  assert.strictEqual(cols[6], '対象外', '借方税区分');
  assert.strictEqual(cols[8], '70000', '借方金額(円) は税込');
  assert.strictEqual(cols[9], '', '借方税額は空欄（取り込まれない）');
  assert.strictEqual(cols[10], '売上高', '貸方勘定科目は名称');
  assert.strictEqual(cols[14], '課税売上 10%', '貸方税区分は正式名称');
  assert.strictEqual(cols[16], '70000', '貸方金額(円) は税込');
  assert.strictEqual(cols[17], '', '貸方税額は空欄');
  assert.strictEqual(cols[18], '本日売上高', '摘要');
  const j8 = resolve({ id: 'm8', date: '2026-04-02', voucherNo: 4, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales8', amount: 1080, summary: '軽減売上' });
  const cols8 = parseCsvLine(toMfCSV([j8]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(cols8[14], '課税売上 (軽)8%', '軽減は正式名称どおり (軽)8%');
});

test('mf: double quotes in text fields are replaced with full-width (import would fail otherwise)', () => {
  assert.strictEqual(sanitizeMfText('売上"特価"'), '売上”特価”');
  const j = resolve({ id: 'mq', date: '2026-04-02', voucherNo: 5, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '値引"対象"' });
  const line = toMfCSV([j]).trimEnd().split('\r\n')[1];
  assert.strictEqual(parseCsvLine(line)[18], '値引”対象”');
  assert.ok(!line.includes('"'), 'no raw double quote remains in the row');
});

test('mf: warnings for blank mfName and for a voucher with 300+ lines', () => {
  const blankTax = { id: 'bm', name: '独自税区分', freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '', mfName: '' };
  const e = resolveEntry({ id: 'mw', date: '2026-04-03', voucherNo: 9, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '' },
    accountsById, { ...taxesById, excluded: blankTax });
  const w = collectMfWarnings([e]);
  assert.strictEqual(w.length, 1);
  assert.ok(w[0].includes('未設定'));
  assert.strictEqual(collectMfWarnings([epsonJ1]).length, 0);
  const many = Array.from({ length: 300 }, (_, i) => resolve({ id: 'mm' + i, date: '2026-04-03', voucherNo: 77, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '' }));
  const w2 = collectMfWarnings(many);
  assert.ok(w2.some((x) => x.includes('300行')), 'voucher with 300 lines warns');
});

// ---------- n. PCA （汎用データ受入・仕訳データ標準形式, 30 columns + header row) ----------
test('pca: header row is the official first-30 item names in order', () => {
  const lines = toPcaCSV([epsonJ1]).trimEnd().split('\r\n');
  assert.deepStrictEqual(parseCsvLine(lines[0]), PCA_COLUMNS);
  assert.strictEqual(PCA_COLUMNS.length, 30);
  assert.strictEqual(PCA_COLUMNS[0], '伝票日付');
  assert.strictEqual(PCA_COLUMNS[7], '借方科目コード');
  assert.strictEqual(PCA_COLUMNS[11], '借方税区分コード');
  assert.strictEqual(PCA_COLUMNS[26], '摘要文');
  assert.strictEqual(PCA_COLUMNS[29], '入力プログラム区分');
});

test('pca: row carries YYYYMMDD date, codes, tax modes and 内税額', () => {
  const lines = toPcaCSV([epsonJ1]).trimEnd().split('\r\n');
  const cols = parseCsvLine(lines[1]);
  assert.strictEqual(cols.length, 30);
  assert.strictEqual(cols[0], '20260401', '伝票日付はYYYYMMDD');
  assert.strictEqual(cols[1], '1', '伝票番号');
  assert.strictEqual(cols[2], '21', '仕訳区分は初期値21（月次）');
  assert.strictEqual(cols[3], '0', '管理仕訳区分は初期値0（財務）');
  assert.strictEqual(cols[4], '0', '借方（対象外）は税計算しない');
  assert.strictEqual(cols[7], '11110010', '借方科目コードはPCA標準コード');
  assert.strictEqual(cols[8], '現金', '借方科目名');
  assert.strictEqual(cols[11], '00', '借方税区分コード 対象外 = 00');
  assert.strictEqual(cols[12], '対象外', '借方税区分名は略称');
  assert.strictEqual(cols[13], '70000', '借方金額は税込');
  assert.strictEqual(cols[14], '', '借方の消費税額は空欄（税計算しない）');
  assert.strictEqual(cols[15], '1', '貸方（課税）は内税自動計算');
  assert.strictEqual(cols[18], '21100010', '貸方科目コード');
  assert.strictEqual(cols[22], 'B5', '貸方税区分コード 課税売上10% = B5');
  assert.strictEqual(cols[23], '売上10%', '貸方税区分名は略称');
  assert.strictEqual(cols[25], '6363', '貸方消費税額は内税額（切り捨て）');
  assert.strictEqual(cols[26], '本日売上高', '摘要文');
  assert.strictEqual(cols[29], '1', '入力プログラム区分は初期値1');
  // Both sides taxed: 課税仕入 (Q5) on the debit side.
  const both = resolve({ id: 'pb', date: '2026-04-05', voucherNo: 3, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 3300, summary: '両側課税' });
  const b = parseCsvLine(toPcaCSV([both]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(b[4], '1', '借方（課税仕入）も内税自動計算');
  assert.strictEqual(b[11], 'Q5', '課税仕入10%（共通） = Q5');
  assert.strictEqual(b[12], '仕入10%');
  assert.strictEqual(b[14], '300', '借方消費税額 = floor(3300*10/110)');
  // Reduced rate: B6 / 8%.
  const j8 = resolve({ id: 'p8', date: '2026-04-02', voucherNo: 4, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales8', amount: 1080, summary: '軽減売上' });
  const c8 = parseCsvLine(toPcaCSV([j8]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(c8[22], 'B6', '課税売上8%軽減 = B6');
  assert.strictEqual(c8[25], '80', '消費税額 = floor(1080*8/108)');
  assert.strictEqual(pcaTaxRate(taxes.sales10), 10);
  assert.strictEqual(pcaTaxRate(taxes.excluded), 0);
  assert.strictEqual(pcaTaxAmount(1080, taxes.sales8), 80);
});

test('pca: warnings for blank codes and oversized voucher numbers', () => {
  const blankAcc = { id: 'ba', name: '独自科目', epsonCode: '', jdlCode: '', pcaCode: '' };
  const blankTax = { id: 'bt', name: '独自税区分', freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '', mfName: '', pcaCode: '', pcaName: '' };
  const e = resolveEntry({ id: 'pw', date: '2026-04-03', voucherNo: 9, debitAccountId: 'ba', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'bt', amount: 100, summary: '' },
    { ...accountsById, ba: blankAcc }, { ...taxesById, bt: blankTax });
  const w = collectPcaWarnings([e]);
  assert.strictEqual(w.length, 2, 'blank account code + blank tax code');
  assert.ok(w.every((x) => x.includes('未設定')));
  assert.strictEqual(collectPcaWarnings([epsonJ1]).length, 0);
  const big = resolve({ id: 'pv', date: '2026-04-03', voucherNo: 100000, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '' });
  assert.ok(collectPcaWarnings([big]).some((x) => x.includes('5桁')), 'voucher over 5 digits warns');
});

// ---------- o. OBC （勘定奉行・OBC受入形式, 53 columns, no header) ----------
test('obc: 53 columns, 伝票区切 *, date, codes, rate fields and gross amounts', () => {
  assert.strictEqual(OBC_COLUMN_COUNT, 53);
  const cols = parseCsvLine(toObcCSV([epsonJ1]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(cols.length, 53);
  assert.strictEqual(cols[0], '*', '伝票区切は伝票の1行目に *');
  assert.strictEqual(cols[10], '2026/04/01', '日付はYYYY/MM/DD');
  assert.strictEqual(cols[11], '0', '整理区分は0（日常仕訳）');
  assert.strictEqual(cols[12], '1', '伝票No');
  // Debit side (base 14): cash / 対象外.
  assert.strictEqual(cols[15], '101', '借方科目コード');
  assert.strictEqual(cols[17], '0000', '借方税区分コード 対象外 = 0000');
  assert.strictEqual(cols[18], '', '対象外は税率種別なし');
  assert.strictEqual(cols[19], '', '対象外は税率なし');
  assert.strictEqual(cols[21], '0', '対象外は消費税計算しない');
  assert.strictEqual(cols[26], '70000', '借方本体金額は税込金額');
  assert.strictEqual(cols[27], '', '消費税額は空欄（奉行側で自動計算）');
  // Credit side (base 32): sales / 課税売上10%.
  assert.strictEqual(cols[33], '401', '貸方科目コード');
  assert.strictEqual(cols[35], '0060', '貸方税区分コード 課税売上 = 0060');
  assert.strictEqual(cols[36], '0', '税率種別 標準 = 0');
  assert.strictEqual(cols[37], '10', '税率 = 10');
  assert.strictEqual(cols[39], '2', '消費税計算は2（税込金額からの計算）');
  assert.strictEqual(cols[44], '70000', '貸方本体金額は税込金額');
  assert.strictEqual(cols[50], '本日売上高', '摘要');
});

test('obc: 伝票区切 is * only on the first row of each voucher', () => {
  const lines = [5, 5, 6].map((v, i) => resolve({
    id: 'ov' + i, date: '2026-04-06', voucherNo: v,
    debitAccountId: 'shoroku', debitTaxId: 'excluded',
    creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100 * (i + 1), summary: '区切' + i,
  }));
  const rows = toObcCSV(lines).trimEnd().split('\r\n').map(parseCsvLine);
  assert.deepStrictEqual(rows.map((r) => r[0]), ['*', '', '*']);
});

test('obc: reduced rate keeps code 0060 with 税率種別 1 / 税率 8; purchases use 0010', () => {
  const j8 = resolve({ id: 'o8', date: '2026-04-02', voucherNo: 4, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales8', amount: 1080, summary: '軽減売上' });
  const c8 = parseCsvLine(toObcCSV([j8]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(c8[35], '0060', '軽減も課税売上コードは0060');
  assert.strictEqual(c8[36], '1', '税率種別 軽減 = 1');
  assert.strictEqual(c8[37], '8', '税率 = 8');
  const both = resolve({ id: 'ob', date: '2026-04-05', voucherNo: 3, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 3300, summary: '両側課税' });
  const b = parseCsvLine(toObcCSV([both]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(b[17], '0010', '課税仕入（課税売上分） = 0010');
  assert.strictEqual(b[21], '2', '借方も消費税計算は2');
  assert.strictEqual(obcTaxRate(taxes.sales10), 10);
  assert.strictEqual(obcTaxRate(taxes.sales8), 8);
  assert.strictEqual(obcTaxRate(taxes.excluded), 0);
});

test('obc: warnings for blank account / tax codes', () => {
  const blankAcc = { id: 'ba2', name: '独自科目2', epsonCode: '', jdlCode: '', pcaCode: '', obcCode: '' };
  const blankTax = { id: 'bt2', name: '独自税区分2', freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '', mfName: '', pcaCode: '', pcaName: '', obcCode: '' };
  const e = resolveEntry({ id: 'ow', date: '2026-04-03', voucherNo: 9, debitAccountId: 'ba2', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'bt2', amount: 100, summary: '' },
    { ...accountsById, ba2: blankAcc }, { ...taxesById, bt2: blankTax });
  const w = collectObcWarnings([e]);
  assert.strictEqual(w.length, 2, 'blank account code + blank tax code');
  assert.ok(w.every((x) => x.includes('未設定')));
  assert.strictEqual(collectObcWarnings([epsonJ1]).length, 0);
});

// ---------- i. Shipped defaults audit (app.js seed data) ----------
// Policy (decided 2026-11-13): code/number fields carry NO defaults.
// Account codes (epson/jdl/pca/obc) and tax codes (epsonKazei/epsonTax,
// jdlKaku/jdlTax, pcaCode, obcCode) all start blank; users register the
// codes of their office in the masters. Name-form tax values (freee /
// yayoi / Money Forward names and the PCA 略称) are names, not numbers,
// and stay seeded.
test('defaults: codes start blank; name-form tax values stay seeded (2026-11-13 decision)', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const taxBlock = src.slice(src.indexOf('function defaultTaxes'), src.indexOf('function defaultAccounts'));
  const accBlock = src.slice(src.indexOf('function defaultAccounts'), src.indexOf('function newCompany'));
  // Accounts: 62 detail rows + 10 seeded total rows (v20), each
  // [id, name, defaultTaxId, category, kind, totalParentId] — names are
  // seeded; only code/number fields stay blank. The original 28 keep
  // their positional ids (transfer-file compat); the five accounts
  // dropped on 2026-11-13 stay dropped.
  assert.ok(accBlock.includes("['acc1', '現金', X, 'asset', 'normal', 'tot-current-assets']"), 'acc1 stays 現金 (asset, member of 流動資産合計)');
  assert.ok(accBlock.includes("['acc28', '諸口', X, 'asset', 'normal', '']"), 'acc28 stays 諸口 (asset, no total parent)');
  const rowLines = accBlock.split('\n').filter((l) => /\['(acc|tot)/.test(l));
  assert.strictEqual(rowLines.length, 72, 'seeded account count = 62 detail + 10 total');
  assert.ok(rowLines.every((l) => /^\s*\['[a-z0-9-]+', '[^']+', [XSP], '(asset|liability|equity|revenue|expense)', '(normal|total)', '[a-z0-9-]*'\],$/.test(l)),
    'every account row is [id, name, defaultTaxId, category, kind, totalParentId] with no code elements');
  assert.strictEqual(rowLines.filter((l) => l.includes("'total'")).length, 10, '10 seeded total accounts');
  for (const n of ['流動資産合計', '有形固定資産合計', '無形固定資産合計', '投資その他の資産合計', '繰延資産合計', '流動負債合計', '固定負債合計', '純資産合計', '収益合計', '費用合計']) {
    assert.ok(accBlock.includes(`', '${n}',`), `total account seeded: ${n}`);
  }
  assert.ok(accBlock.includes("['acc5', '売上高', S, 'revenue', 'normal', 'tot-revenue']"), '売上高 category = revenue, member of 収益合計');
  assert.ok(accBlock.includes("['acc7', '消耗品費', P, 'expense', 'normal', 'tot-expenses']"), '消耗品費 category = expense, member of 費用合計');
  for (const n of ['当座預金', '受取手形', '商品', '前払費用', '貸倒引当金', '建物', '土地', '減価償却累計額', 'ソフトウェア', '投資有価証券', '長期貸付金', '敷金', '創立費', '支払手形', '未払費用', '前受金', '未払法人税等', '未払消費税等', '退職給付引当金', '資本準備金', '利益準備金']) {
    assert.ok(accBlock.includes(`', '${n}',`), `BS account seeded: ${n}`);
  }
  for (const n of ['のれん', '関係会社株式', '開業費', '社債発行費', '社債']) {
    assert.ok(!accBlock.includes(`', '${n}',`), `dropped account stays dropped: ${n}`);
  }
  assert.ok(accBlock.includes("epsonCode: '', jdlCode: ''") && accBlock.includes("pcaCode: '', obcCode: ''"),
    'account code fields are built blank');
  // Taxes: every code/number field is blank in all rows (7 base rows +
  // the 10 transitional-measure rows added in v25).
  for (const f of ['epsonKazei', 'epsonTax', 'jdlKaku', 'jdlTax', 'pcaCode', 'obcCode']) {
    assert.ok(!new RegExp(`${f}: '[^']`).test(taxBlock), `${f} has no seeded value`);
    assert.strictEqual((taxBlock.match(new RegExp(`${f}: ''`, 'g')) || []).length, 17, `${f} blank in all 17 rows`);
  }
  // Transitional rows (v25): 10 records, marked and pointing at their
  // base purchase category, with the official name-form values seeded.
  assert.strictEqual((taxBlock.match(/transitional: true/g) || []).length, 10, '10 transitional records');
  for (const n of ['課対仕入（控80）10%', '課対仕入（控70）8%（軽）', '課対仕入（控50）10%', '課対仕入（控30）8%（軽）']) {
    assert.ok(taxBlock.includes(`freeeName: '${n}'`), `transitional freeeName seed: ${n}`);
  }
  assert.ok(taxBlock.includes("yayoiName: '課対仕入込10%区分70%'"), 'transitional yayoi suffix form');
  assert.ok(taxBlock.includes("yayoiName: '課対仕入込軽減8%区分控不'"), 'transitional yayoi 控不 form');
  assert.ok(taxBlock.includes("pcaName: '仕入10%控80'"), 'transitional pcaName seed');
  assert.ok(taxBlock.includes("pcaName: '仕入免税等'"), 'transitional pcaName for no deduction');
  // Taxes: freee names are freee's official tax-category names (kept).
  for (const n of ['課税売上10%', '課税売上8%（軽）', '課対仕入10%', '課対仕入8%（軽）', '非課売上', '非課仕入']) {
    assert.ok(taxBlock.includes(`freeeName: '${n}'`), `freeeName seed: ${n}`);
  }
  // Taxes: Yayoi names are the 税込 記述形式 from Yayoi's official table
  // (2026-11-13). 非課税売上 shortens to 非課売上; 軽減 has no space.
  assert.ok(taxBlock.includes("yayoiName: '対象外'"), '対象外 yayoi = 対象外');
  assert.ok(taxBlock.includes("yayoiName: '課税売上込10%'"), '課税売上10% yayoi = 課税売上込10%');
  assert.ok(taxBlock.includes("yayoiName: '課税売上込軽減8%'"), '課税売上8%軽減 yayoi = 課税売上込軽減8%');
  assert.ok(taxBlock.includes("yayoiName: '非課売上'"), '非課税売上 yayoi = 非課売上');
  assert.ok(taxBlock.includes("yayoiName: '課対仕入込10%'"), '課税仕入10% yayoi = 課対仕入込10%');
  assert.ok(taxBlock.includes("yayoiName: '課対仕入込軽減8%'"), '課税仕入8%軽減 yayoi = 課対仕入込軽減8%');
  assert.ok(taxBlock.includes("yayoiName: '非課仕入'"), '非課税仕入 yayoi = 非課仕入');
  // Taxes: Money Forward names are MF's formal 税区分 names (2026-11-13):
  // half-width spaces, purchases are 課税仕入, reduced rate is "(軽)8%".
  assert.ok(taxBlock.includes("mfName: '対象外'"), '対象外 mf = 対象外');
  assert.ok(taxBlock.includes("mfName: '課税売上 10%'"), '課税売上10% mf = 課税売上 10%');
  assert.ok(taxBlock.includes("mfName: '課税売上 (軽)8%'"), '課税売上8%軽減 mf = 課税売上 (軽)8%');
  assert.ok(taxBlock.includes("mfName: '非課税売上'"), '非課税売上 mf = 非課税売上');
  assert.ok(taxBlock.includes("mfName: '課税仕入 10%'"), '課税仕入10% mf = 課税仕入 10%');
  assert.ok(taxBlock.includes("mfName: '課税仕入 (軽)8%'"), '課税仕入8%軽減 mf = 課税仕入 (軽)8%');
  assert.ok(taxBlock.includes("mfName: '非課税仕入'"), '非課税仕入 mf = 非課税仕入');
  // Taxes: PCA 略称 (names) stay seeded; the codes do not.
  assert.ok(taxBlock.includes("pcaName: '対象外'"), '対象外 pcaName = 対象外');
  assert.ok(taxBlock.includes("pcaName: '売上10%'"), '課税売上10% pcaName = 売上10%');
  assert.ok(taxBlock.includes("pcaName: '売上8%軽'"), '課税売上8%軽減 pcaName = 売上8%軽');
  assert.ok(taxBlock.includes("pcaName: '非売上'"), '非課税売上 pcaName = 非売上');
  assert.ok(taxBlock.includes("pcaName: '仕入10%'"), '課税仕入10% pcaName = 仕入10%');
  assert.ok(taxBlock.includes("pcaName: '仕入8%軽'"), '課税仕入8%軽減 pcaName = 仕入8%軽');
  assert.ok(taxBlock.includes("pcaName: '非仕入'"), '非課税仕入 pcaName = 非仕入');
});

// ---------- Search tokens (v16) ----------
const searchJ = resolve({ id: 's1', date: '2026-05-15', voucherNo: 7, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'cash', creditTaxId: 'excluded', amount: 3300, summary: 'コピー用紙' });

test('search: tokenize splits on half/full-width spaces', () => {
  assert.deepStrictEqual(tokenizeSearch(' 消耗品費　3300 '), ['消耗品費', '3300']);
  assert.deepStrictEqual(tokenizeSearch(''), []);
});

test('search: number tokens match amount (commas allowed) or voucher number', () => {
  assert.ok(matchesSearch(searchJ, ['3300']));
  assert.ok(matchesSearch(searchJ, ['3,300']));
  assert.ok(matchesSearch(searchJ, ['7']));
  assert.ok(!matchesSearch(searchJ, ['9999']));
});

test('search: date tokens (year-month, month, full date in 3 notations)', () => {
  assert.ok(matchesSearch(searchJ, ['2026-05']));
  assert.ok(matchesSearch(searchJ, ['2026/05']));
  assert.ok(matchesSearch(searchJ, ['5月']));
  assert.ok(!matchesSearch(searchJ, ['6月']));
  assert.ok(matchesSearch(searchJ, ['2026-05-15']));
  assert.ok(matchesSearch(searchJ, ['2026/05/15']));
  assert.ok(matchesSearch(searchJ, ['20260515']));
  assert.ok(!matchesSearch(searchJ, ['2026-05-16']));
});

test('search: text tokens match summary/account names; tokens are ANDed', () => {
  assert.ok(matchesSearch(searchJ, ['コピー']));
  assert.ok(matchesSearch(searchJ, ['消耗品費']));
  assert.ok(matchesSearch(searchJ, ['現金']));
  assert.ok(matchesSearch(searchJ, ['消耗品費', '3300']));
  assert.ok(!matchesSearch(searchJ, ['消耗品費', '9999']));
  assert.ok(!matchesSearch(searchJ, ['売掛金']));
});

// ---------- Review flags （要確認， Ver1.0.0) ----------
const PERIOD = { start: '2026-04-01', end: '2027-03-31' };

test('flags: unbalanced shoroku voucher flags every row of the voucher (strong)', () => {
  const a = resolve({ id: 'f1', date: '2026-04-10', voucherNo: 21, debitAccountId: 'shoroku', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 1000, summary: '' });
  const b = resolve({ id: 'f2', date: '2026-04-10', voucherNo: 21, debitAccountId: 'receivable', debitTaxId: 'excluded', creditAccountId: 'shoroku', creditTaxId: 'excluded', amount: 400, summary: '' });
  const flags = journalFlags([a, b], PERIOD);
  assert.ok(flags.get('f1').strong.length === 1);
  assert.ok(flags.get('f2').strong.length === 1);
  const c = resolve({ id: 'f3', date: '2026-04-10', voucherNo: 21, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'shoroku', creditTaxId: 'excluded', amount: 600, summary: '' });
  assert.ok(!journalFlags([a, b, c], PERIOD).has('f1'), 'balanced voucher has no flag');
});

test('flags: date outside the accounting period is strong', () => {
  const out = resolve({ id: 'f4', date: '2025-12-31', voucherNo: 22, debitAccountId: 'cash', debitTaxId: 'excluded', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '' });
  const flags = journalFlags([out], PERIOD);
  assert.ok(flags.get('f4').strong.some((r) => r.includes('期間外')));
  assert.ok(!journalFlags([epsonJ1], PERIOD).has('j1'));
});

test('flags: tax direction reversal and mixed rates are weak; normal entries are clean', () => {
  const reversal = resolve({ id: 'f5', date: '2026-04-10', voucherNo: 23, debitAccountId: 'sales', debitTaxId: 'sales10', creditAccountId: 'supplies', creditTaxId: 'purchase10', amount: 100, summary: '' });
  const f5 = journalFlags([reversal], PERIOD).get('f5');
  assert.ok(f5 && f5.strong.length === 0 && f5.weak.length === 1, JSON.stringify(f5));
  const mixed = resolve({ id: 'f6', date: '2026-04-10', voucherNo: 24, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'sales', creditTaxId: 'sales8', amount: 100, summary: '' });
  const f6 = journalFlags([mixed], PERIOD).get('f6');
  assert.ok(f6 && f6.weak.some((r) => r.includes('税率')), JSON.stringify(f6));
  const normal = resolve({ id: 'f7', date: '2026-04-10', voucherNo: 25, debitAccountId: 'supplies', debitTaxId: 'purchase10', creditAccountId: 'sales', creditTaxId: 'sales10', amount: 100, summary: '' });
  assert.ok(!journalFlags([normal], PERIOD).has('f7'));
});

// ---------- Generated-file verification (v16) ----------
const vEntries = [epsonJ1, epsonJ2, searchJ];

test('verify: every format passes on its own generated output', () => {
  const gens = { epson: toEpsonCSV, jdl: toJdlCSV, yayoi: toYayoiCSV, freee: toFreeeCSV, mf: toMfCSV, pca: toPcaCSV, obc: toObcCSV };
  for (const [fmt, gen] of Object.entries(gens)) {
    const r = verifyGenerated(fmt, gen(vEntries), vEntries);
    assert.ok(r.ok, `${fmt}: ${r.errors.join('; ')}`);
  }
  assert.ok(verifyGenerated('transfer', '{}', vEntries).ok, 'transfer is out of scope');
});

test('verify: tampered amounts are detected', () => {
  const epsonBad = toEpsonCSV(vEntries).replace('70000', '70001');
  assert.ok(!verifyGenerated('epson', epsonBad, vEntries).ok, 'epson debit != credit');
  const pcaRows = parseCsv(toPcaCSV(vEntries));
  pcaRows[1][13] = '1';
  const pcaBad = pcaRows.map((r) => r.join(',')).join('\r\n');
  assert.ok(!verifyGenerated('pca', pcaBad, vEntries).ok, 'pca totals diverge');
  const obcBad = toObcCSV(vEntries).replace('70000', '70002');
  assert.ok(!verifyGenerated('obc', obcBad, vEntries).ok, 'obc amount mismatch');
});

test('verify: dropped rows and wrong column counts are detected', () => {
  const mfLines = toMfCSV(vEntries).trimEnd().split('\r\n');
  mfLines.splice(1, 1);
  assert.ok(!verifyGenerated('mf', mfLines.join('\r\n') + '\r\n', vEntries).ok, 'mf row count');
  const yayoiBad = toYayoiCSV(vEntries).split('\r\n').map((l, i) => (i === 0 ? l + ',' : l)).join('\r\n');
  assert.ok(!verifyGenerated('yayoi', yayoiBad, vEntries).ok, 'yayoi column count');
  const jdlBad = toJdlCSV(vEntries).replace('70000', '60000');
  assert.ok(!verifyGenerated('jdl', jdlBad, vEntries).ok, 'jdl total');
});

// ---------- Trial balance （試算表, v18) ----------
test('trial balance: per-account totals, balances, totals row and simple P/L', () => {
  const accounts = [
    { id: 'cash', name: '現金', category: 'asset' },
    { id: 'receivable', name: '売掛金', category: 'asset' },
    { id: 'sales', name: '売上高', category: 'revenue' },
    { id: 'discount', name: '売上値引', category: 'revenue' },
    { id: 'supplies', name: '消耗品費', category: 'expense' },
    { id: 'shoroku', name: '諸口', category: 'asset' },
    { id: 'loan', name: '短期借入金', category: 'liability' },
  ];
  const j = (debitAccountId, creditAccountId, amount) => ({ debitAccountId, creditAccountId, amount });
  const tb = trialBalance([
    j('cash', 'sales', 10000),
    j('supplies', 'cash', 3000),
    j('shoroku', 'sales', 777),
    j('discount', 'cash', 500),
    j('receivable', 'shoroku', 777),
  ], accounts);
  const byName = Object.fromEntries(tb.rows.map((r) => [r.name, r]));
  assert.deepStrictEqual(tb.rows.map((r) => r.name), ['現金', '売掛金', '売上高', '売上値引', '消耗品費', '諸口'],
    'rows follow master order; accounts without activity are omitted');
  assert.deepStrictEqual([byName['現金'].debit, byName['現金'].credit, byName['現金'].debitBalance, byName['現金'].creditBalance], [10000, 3500, 6500, 0]);
  assert.deepStrictEqual([byName['売上高'].debit, byName['売上高'].credit, byName['売上高'].creditBalance], [0, 10777, 10777]);
  assert.deepStrictEqual([byName['諸口'].debit, byName['諸口'].credit, byName['諸口'].debitBalance, byName['諸口'].creditBalance], [777, 777, 0, 0], 'shoroku nets to zero');
  assert.strictEqual(tb.totalDebit, 15054);
  assert.strictEqual(tb.totalDebit, tb.totalCredit, 'debit and credit totals agree');
  assert.strictEqual(tb.totalDebitBalance, tb.totalCreditBalance, 'balance totals agree');
  assert.strictEqual(tb.revenue, 10277, 'revenue net = sales credit balance - discount debit balance');
  assert.strictEqual(tb.expense, 3000);
  assert.strictEqual(tb.profit, 7277);
  assert.strictEqual(trialBalance([], accounts).rows.length, 0);
});

test('trial balance: opening balances, closing balances and total accounts (v19)', () => {
  const accounts = [
    { id: 'cash', name: '現金', category: 'asset', totalParentId: 'cur' },
    { id: 'bank', name: '普通預金', category: 'asset', totalParentId: 'cur' },
    { id: 'allow', name: '貸倒引当金', category: 'asset', totalParentId: 'cur' },
    { id: 'cur', name: '流動資産合計', category: 'asset', kind: 'total' },
    { id: 'cap', name: '資本金', category: 'equity' },
    { id: 'ret', name: '繰越利益剰余金', category: 'equity' },
    { id: 'sales', name: '売上高', category: 'revenue' },
  ];
  const tb = trialBalance(
    [{ debitAccountId: 'cash', creditAccountId: 'sales', amount: 1000 }],
    accounts,
    { cash: { debit: 5000, credit: 0 }, allow: { debit: 0, credit: 300 }, cap: { debit: 0, credit: 4700 } },
  );
  const byName = Object.fromEntries(tb.rows.map((r) => [r.name, r]));
  assert.deepStrictEqual([byName['現金'].openingDebit, byName['現金'].closingDebit], [5000, 6000],
    'closing = opening + period movement');
  assert.deepStrictEqual([byName['資本金'].openingCredit, byName['資本金'].closingCredit], [4700, 4700],
    'an account with only an opening balance still appears');
  assert.ok(!('流動資産合計' in byName), 'total accounts are not normal rows');
  assert.strictEqual(tb.totalRows.length, 1);
  assert.deepStrictEqual(
    [tb.totalRows[0].name, tb.totalRows[0].openingDebit, tb.totalRows[0].openingCredit, tb.totalRows[0].debit, tb.totalRows[0].closingDebit, tb.totalRows[0].closingCredit],
    ['流動資産合計', 4700, 0, 1000, 5700, 0],
    'total row: balances are net of contra accounts, period totals are gross');
  assert.strictEqual(byName['現金'].closingBalance, 6000, 'signed balance: debit balance is positive');
  assert.strictEqual(byName['資本金'].closingBalance, -4700, 'signed balance: credit balance is negative');
  assert.strictEqual(tb.totalRows[0].closingBalance, 5700, 'total row signed balance is the net');
  assert.deepStrictEqual(tb.displayRows.map((r) => r.name),
    ['現金', '貸倒引当金', '流動資産合計', '資本金', '売上高'],
    'display rows interleave each total right after its last member');
  assert.strictEqual(tb.displayRows[2].isTotal, true);
  assert.strictEqual(tb.totalOpeningDebit, 5000);
  assert.strictEqual(tb.totalOpeningCredit, 5000);
  assert.strictEqual(tb.totalClosingDebit, tb.totalClosingCredit, 'closing totals agree when opening is balanced plus balanced journals');
  assert.strictEqual(tb.profit, 1000);
});

// ---------- Invoice transitional measure (v25) ----------
const invTaxes = {
  'tax-excluded': { id: 'tax-excluded', name: '対象外', freeeName: '対象外', epsonKazei: '00', epsonTax: '', jdlKaku: '00', jdlTax: '0', yayoiName: '対象外', mfName: '対象外', pcaCode: '00', pcaName: '対象外', obcCode: '0000' },
  'tax-purchase10': { id: 'tax-purchase10', name: '課税仕入10%（込）', freeeName: '課対仕入10%', epsonKazei: '32', epsonTax: '10', jdlKaku: '31', jdlTax: '3', yayoiName: '課対仕入込10%', mfName: '課税仕入 10%', pcaCode: 'Q5', pcaName: '仕入10%', obcCode: '0010' },
  'tax-purchase10-k80': { id: 'tax-purchase10-k80', name: '課税仕入10%（込）・経過措置80%', freeeName: '課対仕入（控80）10%', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課対仕入込10%区分80%', mfName: '課税仕入 10%', pcaCode: '', pcaName: '仕入10%控80', obcCode: '', transitional: true, baseTaxId: 'tax-purchase10', invoiceRate: 80 },
  'tax-purchase10-k70': { id: 'tax-purchase10-k70', name: '課税仕入10%（込）・経過措置70%', freeeName: '課対仕入（控70）10%', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '73', yayoiName: '課対仕入込10%区分70%', mfName: '課税仕入 10%', pcaCode: 'QI', pcaName: '仕入10%控70', obcCode: '', transitional: true, baseTaxId: 'tax-purchase10', invoiceRate: 70 },
  'tax-purchase10-k50': { id: 'tax-purchase10-k50', name: '課税仕入10%（込）・経過措置50%', freeeName: '課対仕入（控50）10%', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課対仕入込10%区分50%', mfName: '課税仕入 10%', pcaCode: '', pcaName: '', obcCode: '', transitional: true, baseTaxId: 'tax-purchase10', invoiceRate: 50 },
  'tax-purchase10-k30': { id: 'tax-purchase10-k30', name: '課税仕入10%（込）・経過措置30%', freeeName: '課対仕入（控30）10%', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課対仕入込10%区分30%', mfName: '課税仕入 10%', pcaCode: '', pcaName: '', obcCode: '', transitional: true, baseTaxId: 'tax-purchase10', invoiceRate: 30 },
  'tax-purchase10-k0': { id: 'tax-purchase10-k0', name: '課税仕入10%（込）・非適格（控除なし）', freeeName: '対象外', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '課対仕入込10%区分控不', mfName: '課税仕入 10%', pcaCode: 'Q0', pcaName: '仕入免税等', obcCode: '', transitional: true, baseTaxId: 'tax-purchase10', invoiceRate: 0 },
};
const invResolve = (j) => resolveEntry(j, accountsById, invTaxes);
const buyBase = { id: 'i1', voucherNo: 31, debitAccountId: 'supplies', debitTaxId: 'tax-purchase10', creditAccountId: 'cash', creditTaxId: 'tax-excluded', amount: 11000, summary: '免税事業者からの仕入' };
const buy70 = invResolve({ ...buyBase, date: '2027-05-10', nonInvoice: true });

test('invoice: deduction rate follows the statutory date table', () => {
  assert.strictEqual(invoiceDeductionRate('2023-09-30'), null);
  assert.strictEqual(invoiceDeductionRate('2023-10-01'), 80);
  assert.strictEqual(invoiceDeductionRate('2026-09-30'), 80);
  assert.strictEqual(invoiceDeductionRate('2026-10-01'), 70);
  assert.strictEqual(invoiceDeductionRate('2028-09-30'), 70);
  assert.strictEqual(invoiceDeductionRate('2028-10-01'), 50);
  assert.strictEqual(invoiceDeductionRate('2030-09-30'), 50);
  assert.strictEqual(invoiceDeductionRate('2030-10-01'), 30);
  assert.strictEqual(invoiceDeductionRate('2031-09-30'), 30);
  assert.strictEqual(invoiceDeductionRate('2031-10-01'), 0);
});

test('invoice: resolve swaps the purchase side to the transitional record and inherits base fields', () => {
  assert.strictEqual(buy70.invoiceRate, 70);
  assert.strictEqual(buy70.debitTax.id, 'tax-purchase10-k70');
  assert.strictEqual(buy70.debitTax.jdlKaku, '31', '課区 is inherited from the base category');
  assert.strictEqual(buy70.debitTax.obcCode, '0010', 'OBC tax code is inherited from the base category');
  assert.strictEqual(buy70.debitTax.jdlTax, '73', '税区 is NOT inherited: the variant value is used');
  assert.strictEqual(buy70.debitTaxBase.id, 'tax-purchase10');
  assert.strictEqual(buy70.creditTax.id, 'tax-excluded', 'the non-purchase side is untouched');
  const plain = invResolve({ ...buyBase, date: '2027-05-10' });
  assert.strictEqual(plain.debitTax.id, 'tax-purchase10', 'no flag, no swap');
  assert.strictEqual(plain.invoiceRate, null);
  const early = invResolve({ ...buyBase, date: '2023-04-01', nonInvoice: true });
  assert.strictEqual(early.invoiceRate, null, 'before 2023-10-01 the measure does not apply');
  assert.strictEqual(early.debitTax.id, 'tax-purchase10');
});

test('invoice: freee uses the （控70）name and the no-deduction variant resolves to 対象外', () => {
  assert.ok(toFreeeCSV([buy70]).includes('課対仕入（控70）10%'));
  const buyNone = invResolve({ ...buyBase, date: '2032-02-01', nonInvoice: true });
  assert.strictEqual(buyNone.debitTax.id, 'tax-purchase10-k0');
  assert.strictEqual(buyNone.debitTax.freeeName, '対象外');
});

test('invoice: yayoi appends the 区分 suffix and the tax amount still uses the base rate', () => {
  const cols = parseCsvLine(toYayoiCSV([buy70]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(cols[7], '課対仕入込10%区分70%');
  assert.strictEqual(cols[9], '1000', '内税額 is computed at 10% regardless of the deduction rate');
});

test('invoice: MF writes the deduction into the invoice column, tax name unchanged', () => {
  const rows = parseCsv(toMfCSV([buy70]));
  assert.strictEqual(rows[1][6], '課税仕入 10%');
  assert.strictEqual(rows[1][7], '70％控除');
  const plain = invResolve({ ...buyBase, date: '2027-05-10' });
  assert.strictEqual(parseCsv(toMfCSV([plain]))[1][7], '', 'no flag means blank (= 適格)');
  const buyNone = invResolve({ ...buyBase, date: '2032-02-01', nonInvoice: true });
  assert.strictEqual(parseCsv(toMfCSV([buyNone]))[1][7], '控除なし');
});

test('invoice: OBC sets インボイス取引区分=1 and the rate in the dedicated columns', () => {
  const cols = parseCsvLine(toObcCSV([buy70]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(cols[17], '0010', 'tax code stays the base code (inherited)');
  assert.strictEqual(cols[23], '1', 'debit インボイス取引区分 (X column)');
  assert.strictEqual(cols[24], '70', 'debit 控除割合 (Y column)');
  const buyNone = invResolve({ ...buyBase, date: '2032-02-01', nonInvoice: true });
  const cols0 = parseCsvLine(toObcCSV([buyNone]).trimEnd().split('\r\n')[0]);
  assert.strictEqual(cols0[23], '1');
  assert.strictEqual(cols0[24], '0', 'no deduction is rate 0');
});

test('invoice: PCA swaps to the transitional code QI with its 略称', () => {
  const rows = parseCsv(toPcaCSV([buy70]));
  assert.strictEqual(rows[1][11], 'QI');
  assert.strictEqual(rows[1][12], '仕入10%控70');
  assert.strictEqual(rows[1][14], '1000', '消費税額 is the full 内税額 at 10%');
});

test('invoice: JDL swaps only the 税区 when registered, and falls back with a warning when not', () => {
  const lines = toJdlCSV([buy70]).trimEnd().split('\r\n');
  const cols = parseCsvLine(lines[1]);
  assert.strictEqual(cols[13], '31', '課区 stays the base purchase 課区');
  assert.strictEqual(cols[15], '73', '税区 is the registered transitional code');
  assert.ok(!collectJdlWarnings([buy70]).some((w) => w.includes('経過措置')), 'no fallback warning when registered');
  const buy80 = invResolve({ ...buyBase, date: '2026-04-10', nonInvoice: true });
  const pick = pickJdlTax(buy80);
  assert.strictEqual(pick.fellBack, true, 'unregistered 税区 falls back to the base category');
  assert.strictEqual(pick.tax.id, 'tax-purchase10');
  const cols80 = parseCsvLine(toJdlCSV([buy80]).trimEnd().split('\r\n')[1]);
  assert.strictEqual(cols80[15], '3', 'the base 税区 is output on fallback');
  assert.ok(collectJdlWarnings([buy80]).some((w) => w.includes('経過措置80%')), 'the fallback is reported');
});

test('invoice: epson writes the deduction code into the invoice columns (23/37), space when qualified', () => {
  const row = (j) => epsonDataCols([j])[0];
  // 70% period: the debit purchase side gets '7'; the 対象外 credit side stays a space.
  assert.strictEqual(row(buy70)[22], '7');
  assert.strictEqual(row(buy70)[36], ' ');
  // The tax code/rate still come from the base division (inherited on swap).
  assert.strictEqual(row(buy70)[16], '32');
  assert.strictEqual(row(buy70)[18], '10');
  // Each statutory period maps to its code.
  assert.strictEqual(row(invResolve({ ...buyBase, date: '2025-04-01', nonInvoice: true }))[22], '8');
  assert.strictEqual(row(invResolve({ ...buyBase, date: '2029-01-15', nonInvoice: true }))[22], '5');
  assert.strictEqual(row(invResolve({ ...buyBase, date: '2030-12-01', nonInvoice: true }))[22], '3');
  assert.strictEqual(row(invResolve({ ...buyBase, date: '2031-10-05', nonInvoice: true }))[22], '0');
  // No flag: both sides are the qualified-issuer space.
  const plain = invResolve({ ...buyBase, date: '2027-05-10' });
  assert.strictEqual(row(plain)[22], ' ');
  assert.strictEqual(row(plain)[36], ' ');
  // Before the measure started, the flag has no effect.
  assert.strictEqual(row(invResolve({ ...buyBase, date: '2023-09-15', nonInvoice: true }))[22], ' ');
  // Flagged and plain rows differ only in the invoice column.
  const a = row(buy70), b = row(plain);
  a.forEach((v, i) => { if (i !== 22) assert.strictEqual(v, b[i], `column ${i + 1} must not change`); });
});

test('invoice: generated files still pass the reload verification', () => {
  const gens = { epson: toEpsonCSV, jdl: toJdlCSV, freee: toFreeeCSV, yayoi: toYayoiCSV, mf: toMfCSV, pca: toPcaCSV, obc: toObcCSV };
  for (const [fmt, gen] of Object.entries(gens)) {
    const r = verifyGenerated(fmt, gen([buy70]), [buy70]);
    assert.ok(r.ok, `${fmt}: ${r.errors.join('; ')}`);
  }
});

console.log(`\nAll ${passed} tests passed.`);
