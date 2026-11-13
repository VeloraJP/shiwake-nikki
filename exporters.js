// Pure export / logic functions for the journal-entry tool.
// No DOM access here so the same file can be unit-tested from Node.
//
// A "resolved entry" is a journal whose account / tax references have been
// replaced by the master records:
// {
//   id, date: 'YYYY-MM-DD', voucherNo, amount, summary,
//   debitAccount:  { id, name, epsonCode, jdlCode, pcaCode, obcCode },
//   creditAccount: { id, name, epsonCode, jdlCode, pcaCode, obcCode },
//   debitTax:  { id, name, freeeName, epsonKazei, epsonTax, jdlKaku, jdlTax, yayoiName, mfName, pcaCode, pcaName, obcCode },
//   creditTax: { ...same... }
// }

export function resolveEntry(journal, accountsById, taxesById) {
  return {
    id: journal.id,
    date: journal.date,
    voucherNo: journal.voucherNo,
    amount: journal.amount,
    summary: journal.summary || '',
    debitAccount: accountsById[journal.debitAccountId] || { id: journal.debitAccountId, name: '(不明な科目)', epsonCode: '', jdlCode: '', pcaCode: '', obcCode: '' },
    creditAccount: accountsById[journal.creditAccountId] || { id: journal.creditAccountId, name: '(不明な科目)', epsonCode: '', jdlCode: '', pcaCode: '', obcCode: '' },
    debitTax: taxesById[journal.debitTaxId] || { id: journal.debitTaxId, name: '(不明な税区分)', freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '', mfName: '', pcaCode: '', pcaName: '', obcCode: '' },
    creditTax: taxesById[journal.creditTaxId] || { id: journal.creditTaxId, name: '(不明な税区分)', freeeName: '', epsonKazei: '', epsonTax: '', jdlKaku: '', jdlTax: '', yayoiName: '', mfName: '', pcaCode: '', pcaName: '', obcCode: '' },
  };
}

// ---------- CSV helpers ----------

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function joinCsv(values) {
  return values.map(csvEscape).join(',');
}

// Minimal CSV line parser (handles quoted fields and doubled quotes).
// Used by the tests to verify column counts / positions.
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function sjisByteLengthLocal(text) {
  let n = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    n += cp < 0x80 || (cp >= 0xff61 && cp <= 0xff9f) ? 1 : 2;
  }
  return n;
}

export function truncateByBytes(text, maxBytes) {
  let out = '';
  let n = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const w = cp < 0x80 || (cp >= 0xff61 && cp <= 0xff9f) ? 1 : 2;
    if (n + w > maxBytes) break;
    out += ch;
    n += w;
  }
  return out;
}
export { sjisByteLengthLocal as sjisByteLength };

function ymd(dateStr) {
  // 'YYYY-MM-DD' -> { y:'YYYY', m:'MM', d:'DD', slash:'YYYY/MM/DD', plain:'YYYYMMDD' }
  const [y, m, d] = String(dateStr).split('-');
  return { y, m, d, slash: `${y}/${m}/${d}`, plain: `${y}${m}${d}` };
}

// ---------- Epson (30 columns, no header; per the proven macro layout) ----------

// Fields that are always double-quoted in the proven output (1-based):
// 7 debit account name, 12 "", 14 "", 16 credit account name, 23 "", 25 summary, 29 "".
const EPSON_QUOTED = new Set([7, 12, 14, 16, 23, 25, 29]);

// EPSON: for 対象外 (00) and 非課税 (20/30) categories the rate column must stay
// blank - setting a rate there makes the EPSON import fail (official FAQ).
const EPSON_NO_RATE_KAZEI = new Set(['00', '20', '30']);
export function isEpsonNoRateTax(tax) {
  return !!tax && EPSON_NO_RATE_KAZEI.has(tax.epsonKazei || '');
}

export function epsonRow(e) {
  const { y, m, d } = ymd(e.date);
  // Rate text is the master value as-is on BOTH sides: 10% is unified to "10"
  // (decision 2026-11-12; the proven macro used "10.0" on the credit side only).
  // The reduced-rate text "K8" is kept as-is.
  const debitTaxText = isEpsonNoRateTax(e.debitTax) ? '' : (e.debitTax.epsonTax || '');
  const creditTaxText = isEpsonNoRateTax(e.creditTax) ? '' : (e.creditTax.epsonTax || '');
  const cols = new Array(30).fill('');
  cols[0] = y;
  cols[1] = m;
  cols[2] = d;
  cols[3] = String(e.voucherNo);       // 伝票番号
  cols[4] = String(e.amount);          // 借方金額
  cols[5] = e.debitAccount.epsonCode || '';
  cols[6] = e.debitAccount.name;
  cols[7] = e.debitTax.epsonKazei || ''; // 借方課税区分 (00 = 対象外)
  cols[8] = debitTaxText;                // 借方税区分 (対象外・非課税は空欄)
  // cols[9..13] (10-14列目): 空欄 / "" (実績どおり)
  cols[14] = e.creditAccount.epsonCode || '';
  cols[15] = e.creditAccount.name;
  cols[16] = e.creditTax.epsonKazei || ''; // 貸方課税区分 (02 = 課税売上(込))
  cols[17] = creditTaxText;                // 貸方税区分 (10% は借方と統一して "10", 軽減8% は "K8")
  // cols[18] (19列目): 空欄
  cols[19] = '2';                          // 20列目: 実績どおり固定
  // cols[20] (21列目): 空欄 (仕様確定)
  // cols[21] (22列目): 空欄
  // cols[22] (23列目): ""
  cols[23] = String(e.amount);             // 貸方金額 (5列目と同額)
  cols[24] = truncateByBytes(e.summary, 48); // 摘要 (48バイトまで)
  // cols[25..29] (26-30列目): 空欄 / "" (実績どおり)
  return cols.map((v, i) => {
    const s = v == null ? '' : String(v);
    if (EPSON_QUOTED.has(i + 1)) return '"' + s.replace(/"/g, '""') + '"';
    return csvEscape(s);
  }).join(',');
}

export function toEpsonCSV(entries) {
  return entries.map(epsonRow).join('\r\n') + (entries.length ? '\r\n' : '');
}

// ---------- freee (template: [表題行] header + [明細行] rows) ----------

export const FREEE_COLUMNS = [
  '日付', '伝票番号', '決算整理仕訳',
  '借方勘定科目', '借方科目コード', '借方補助科目', '借方取引先', '借方取引先コード', '借方部門', '借方品目', '借方金額', '借方税区分', '借方税額',
  '貸方勘定科目', '貸方科目コード', '貸方補助科目', '貸方取引先', '貸方取引先コード', '貸方部門', '貸方品目', '貸方金額', '貸方税区分', '貸方税額',
  '摘要', '借方メモタグ', '貸方メモタグ',
];

export function freeeRow(e) {
  const v = {};
  v['日付'] = ymd(e.date).slash;
  v['伝票番号'] = String(e.voucherNo);
  v['決算整理仕訳'] = '';
  v['借方勘定科目'] = e.debitAccount.name;
  v['借方科目コード'] = '';
  v['借方補助科目'] = '';
  v['借方取引先'] = '';
  v['借方取引先コード'] = '';
  v['借方部門'] = '';
  v['借方品目'] = '';
  v['借方金額'] = String(e.amount);
  v['借方税区分'] = e.debitTax.freeeName;
  v['借方税額'] = ''; // spec v1.0: 空欄
  v['貸方勘定科目'] = e.creditAccount.name;
  v['貸方科目コード'] = '';
  v['貸方補助科目'] = '';
  v['貸方取引先'] = '';
  v['貸方取引先コード'] = '';
  v['貸方部門'] = '';
  v['貸方品目'] = '';
  v['貸方金額'] = String(e.amount);
  v['貸方税区分'] = e.creditTax.freeeName;
  v['貸方税額'] = '';
  v['摘要'] = e.summary;
  v['借方メモタグ'] = '';
  v['貸方メモタグ'] = '';
  return FREEE_COLUMNS.map((c) => v[c] ?? '');
}

export function toFreeeCSV(entries) {
  const header = joinCsv(['[表題行]', ...FREEE_COLUMNS]);
  const rows = entries.map((e) => joinCsv(['[明細行]', ...freeeRow(e)]));
  return [header, ...rows].join('\r\n') + '\r\n';
}

// ---------- JDL (proven 16 columns + header row) ----------

export const JDL_HEADER = '番号,伝番,日付,借方科目,,借方補助,,貸方科目,,貸方補助,,金額,摘要,課区,,税区';

function isExcludedTax(tax) {
  return tax && tax.name === '対象外';
}

// JDL has only one 課区/税区 pair per row. Rule (JDL形式_実績16列.md):
// use the side whose tax category is not 対象外; if both sides are not
// 対象外, prefer the debit side (and warn); if both are 対象外, use the debit side.
export function pickJdlTax(e) {
  const dEx = isExcludedTax(e.debitTax);
  const cEx = isExcludedTax(e.creditTax);
  if (!dEx && !cEx) return { tax: e.debitTax, side: 'debit', bothNonExcluded: true };
  if (!dEx) return { tax: e.debitTax, side: 'debit', bothNonExcluded: false };
  if (!cEx) return { tax: e.creditTax, side: 'credit', bothNonExcluded: false };
  return { tax: e.debitTax, side: 'debit', bothNonExcluded: false };
}

export function collectJdlWarnings(entries) {
  const warnings = [];
  entries.forEach((e, i) => {
    if (pickJdlTax(e).bothNonExcluded) {
      warnings.push(`JDL: ${i + 1}行目（伝票${e.voucherNo}）は借方・貸方とも対象外でない税区分のため、借方側の課区・税区を採用しました`);
    }
  });
  return warnings;
}

export function jdlRow(e, seq) {
  const { tax } = pickJdlTax(e);
  const cols = new Array(16).fill('');
  cols[0] = String(seq);                 // 番号 (出力順の連番, 1から)
  cols[1] = String(e.voucherNo);         // 伝番
  cols[2] = ymd(e.date).plain;           // 日付 YYYYMMDD
  cols[3] = e.debitAccount.jdlCode || ''; // 借方科目コード
  // cols[4] 空欄(借方科目名) / cols[5] 借方補助: 空欄 / cols[6] 空欄
  cols[7] = e.creditAccount.jdlCode || ''; // 貸方科目コード
  // cols[8] 空欄(貸方科目名) / cols[9] 貸方補助: 空欄 / cols[10] 空欄
  cols[11] = String(e.amount);           // 金額 (税込)
  cols[12] = truncateByBytes(e.summary, 64); // 摘要 (64バイト)
  cols[13] = tax.jdlKaku || '';          // 課区 (14列目)
  // cols[14] 空欄
  cols[15] = tax.jdlTax || '';           // 税区 (16列目)
  return cols;
}

export function toJdlCSV(entries) {
  const rows = entries.map((e, i) => joinCsv(jdlRow(e, i + 1)));
  return [JDL_HEADER, ...rows].join('\r\n') + '\r\n';
}

// ---------- Yayoi （弥生会計 desktop, 弥生インポート形式: 25 columns, no header) ----------
// Authority: Yayoi's official support pages, checked 2026-11-13:
// "仕訳データの項目と記述形式" (ida18545) for the 25 columns, and
// "課税方式別税区分・税計算区分一覧" (ida18111) for the 税区分 記述形式.
// Every entry in this tool is a single line, so the 識別フラグ is always
// 2000 (the 2110-series slip flags are never used). Accounts are matched
// by NAME on the Yayoi side, so no codes are involved.

// The tax rate is read from the 記述形式 itself ("...込10%" -> 10,
// "...込軽減8%" -> 8); categories without a rate in the name yield 0.
export function yayoiTaxRate(tax) {
  const n = (tax && tax.yayoiName) || '';
  if (n.includes('10%')) return 10;
  if (n.includes('8%')) return 8;
  return 0;
}

// 内税額 contained in a tax-inclusive amount: floor(amount * rate / (100 + rate)).
// Yayoi does not auto-calculate the tax amount for 税抜経理 offices, so the
// value must be written; for 税込 offices it equals the derived 内税額.
export function yayoiTaxAmount(amount, tax) {
  const rate = yayoiTaxRate(tax);
  if (!rate) return 0;
  return Math.floor((Number(amount) || 0) * rate / (100 + rate));
}

export function collectYayoiWarnings(entries) {
  const warnings = [];
  for (const e of entries) {
    for (const side of ['debit', 'credit']) {
      const acc = e[side + 'Account'], tax = e[side + 'Tax'];
      if (!tax.yayoiName) warnings.push(`弥生: 税区分「${tax.name}」の弥生用税区分（記述形式）が未設定です`);
      if (acc.name && [...acc.name].length > 24) warnings.push(`弥生: 科目「${acc.name}」の名称が24文字を超えています（取り込み時にエラーになります）`);
    }
  }
  return [...new Set(warnings)];
}

export function yayoiRow(e) {
  const cols = new Array(25).fill('');
  cols[0] = '2000';                        // 識別フラグ （伝票以外の仕訳データ）
  cols[1] = String(e.voucherNo);           // 伝票No （事業所設定が手入力の場合のみ反映）
  // cols[2] 決算: blank = 通常の仕訳
  cols[3] = ymd(e.date).slash;             // 取引日付
  cols[4] = e.debitAccount.name;           // 借方勘定科目 (名称で照合)
  // cols[5] 借方補助科目 / cols[6] 借方部門: blank (本ツールは補助・部門なし)
  cols[7] = e.debitTax.yayoiName || '';    // 借方税区分 (記述形式)
  cols[8] = String(e.amount);              // 借方金額 (税込)
  cols[9] = String(yayoiTaxAmount(e.amount, e.debitTax));   // 借方税金額 （内税額）
  cols[10] = e.creditAccount.name;         // 貸方勘定科目
  // cols[11] 貸方補助科目 / cols[12] 貸方部門: blank
  cols[13] = e.creditTax.yayoiName || '';  // 貸方税区分 (記述形式)
  cols[14] = String(e.amount);             // 貸方金額 (税込)
  cols[15] = String(yayoiTaxAmount(e.amount, e.creditTax)); // 貸方税金額 （内税額）
  cols[16] = truncateByBytes(e.summary, 64); // 摘要 （半角64桁超は取り込み時に切り捨て）
  // cols[17] 番号 / cols[18] 期日: blank
  cols[19] = '0';                          // タイプ: 0 = 仕訳データ
  // cols[20] 生成元 / cols[21] 仕訳メモ: blank
  cols[22] = '0';                          // 付箋1: 0 = 付箋なし
  // cols[23] 付箋2: blank
  cols[24] = 'no';                         // 調整: チェックなし
  return cols;
}

export function toYayoiCSV(entries) {
  return entries.map((e) => joinCsv(yayoiRow(e))).join('\r\n') + (entries.length ? '\r\n' : '');
}

// ---------- Money Forward （マネーフォワード クラウド会計, 仕訳帳インポート形式) ----------
// Authority: Money Forward's official support pages, checked 2026-11-13:
// "「仕訳帳」をインポートする" (27 columns, first row is a label row) and
// the official 税区分 list (formal names such as 課税売上 10%).
// The 取引No column carries this tool's voucher number: rows sharing a
// 取引No, date and balanced totals are imported as one compound entry,
// and rows must be consecutive (the export order guarantees that).

export const MF_COLUMNS = [
  '取引No', '取引日',
  '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)', '借方税額',
  '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)', '貸方税額',
  '摘要', '仕訳メモ', 'タグ', 'MF仕訳タイプ', '決算整理仕訳',
  '作成日時', '作成者', '最終更新日時', '最終更新者',
];

// A double quote inside a field makes the MF import fail (official error
// FAQ), so text fields replace it with the full-width character.
export function sanitizeMfText(s) {
  return String(s == null ? '' : s).replace(/"/g, '”');
}

export function collectMfWarnings(entries) {
  const warnings = [];
  const perVoucher = new Map();
  for (const e of entries) {
    perVoucher.set(e.voucherNo, (perVoucher.get(e.voucherNo) || 0) + 1);
    for (const side of ['debit', 'credit']) {
      const acc = e[side + 'Account'], tax = e[side + 'Tax'];
      if (!tax.mfName) warnings.push(`マネーフォワード: 税区分「${tax.name}」のマネーフォワード用税区分名が未設定です`);
      if (acc.name && [...acc.name].length > 30) warnings.push(`マネーフォワード: 科目「${acc.name}」の名称が30字を超えています（取り込み時に超過分が削除されます）`);
    }
    if (e.summary && [...e.summary].length > 200) warnings.push(`マネーフォワード: 伝票${e.voucherNo}の摘要が200字を超えています`);
  }
  for (const [v, n] of perVoucher) {
    if (n >= 300) warnings.push(`マネーフォワード: 伝票${v}が${n}行あります。複合仕訳は300行までしか取り込めません`);
  }
  return [...new Set(warnings)];
}

export function mfRow(e) {
  const cols = new Array(MF_COLUMNS.length).fill('');
  cols[0] = String(e.voucherNo);              // 取引No (= 伝票番号)
  cols[1] = ymd(e.date).slash;                 // 取引日
  cols[2] = sanitizeMfText(e.debitAccount.name);  // 借方勘定科目 (名称で照合)
  // cols[3] 借方補助科目 / cols[4] 借方部門 / cols[5] 借方取引先: blank
  cols[6] = sanitizeMfText(e.debitTax.mfName || ''); // 借方税区分 (正式名称)
  // cols[7] 借方インボイス: blank (= 適格と判定される)
  cols[8] = String(e.amount);                  // 借方金額(円) (税込)
  // cols[9] 借方税額: blank (税額は取り込まれない。公式指示は「0」または空欄)
  cols[10] = sanitizeMfText(e.creditAccount.name); // 貸方勘定科目
  // cols[11] 貸方補助科目 / cols[12] 貸方部門 / cols[13] 貸方取引先: blank
  cols[14] = sanitizeMfText(e.creditTax.mfName || ''); // 貸方税区分
  // cols[15] 貸方インボイス: blank
  cols[16] = String(e.amount);                 // 貸方金額(円) (税込)
  // cols[17] 貸方税額: blank
  cols[18] = sanitizeMfText(e.summary);        // 摘要
  // cols[19] 仕訳メモ / cols[20] タグ / cols[21] MF仕訳タイプ / cols[22] 決算整理仕訳: blank
  // cols[23..26] 作成日時・作成者・最終更新日時・最終更新者: blank (入力不要)
  return cols;
}

export function toMfCSV(entries) {
  const header = joinCsv(MF_COLUMNS);
  const rows = entries.map((e) => joinCsv(mfRow(e)));
  return [header, ...rows].join('\r\n') + '\r\n';
}

// ---------- PCA (PCA会計, 汎用データ受入・仕訳データ標準形式) ----------
// Authority: PCA's official "汎用データレイアウト" (checked 2026-11-13):
// the 仕訳データ layout (current version; the output uses its first 30
// items), the 税区分一覧表 (2-character tax codes), and the
// 勘定科目属性一覧 (standard 8-digit account codes). The importer can
// detect columns from the item-name header row ("項目名から自動判定"),
// so the file starts with the official item names and carries no
// version row. Cross-checks against third-party material (a vendor's
// PCA output spec, Money Forward's PCA migration guide, a GitHub
// binding dataset) disagreed with the official layout in places; the
// official layout was followed.

export const PCA_COLUMNS = [
  '伝票日付', '伝票番号', '仕訳区分', '管理仕訳区分',
  '借方税計算モード', '借方部門コード', '借方部門名', '借方科目コード', '借方科目名', '借方補助コード', '借方補助名', '借方税区分コード', '借方税区分名', '借方金額', '借方消費税額',
  '貸方税計算モード', '貸方部門コード', '貸方部門名', '貸方科目コード', '貸方科目名', '貸方補助コード', '貸方補助名', '貸方税区分コード', '貸方税区分名', '貸方金額', '貸方消費税額',
  '摘要文', '数字１', '数字２', '入力プログラム区分',
];

// The rate is read from the PCA 略称 ("仕入10%" -> 10, "売上8%軽" -> 8);
// categories without a rate in the name yield 0.
export function pcaTaxRate(tax) {
  const n = (tax && tax.pcaName) || '';
  if (n.includes('10%')) return 10;
  if (n.includes('8%')) return 8;
  return 0;
}

// 内税額 contained in a tax-inclusive amount (same rule as Yayoi).
export function pcaTaxAmount(amount, tax) {
  const rate = pcaTaxRate(tax);
  if (!rate) return 0;
  return Math.floor((Number(amount) || 0) * rate / (100 + rate));
}

export function collectPcaWarnings(entries) {
  const warnings = [];
  for (const e of entries) {
    for (const side of ['debit', 'credit']) {
      const acc = e[side + 'Account'], tax = e[side + 'Tax'];
      if (!acc.pcaCode) warnings.push(`PCA: 科目「${acc.name}」のPCA用コードが未設定です`);
      if (!tax.pcaCode) warnings.push(`PCA: 税区分「${tax.name}」のPCA用税区分コードが未設定です`);
    }
    if (Number(e.voucherNo) > 99999) warnings.push(`PCA: 伝票番号${e.voucherNo}が5桁を超えています（PCAの伝票番号は5桁までです）`);
    if (e.summary && [...e.summary].length > 128) warnings.push(`PCA: 伝票${e.voucherNo}の摘要が128字を超えています`);
  }
  return [...new Set(warnings)];
}

export function pcaRow(e) {
  const cols = new Array(PCA_COLUMNS.length).fill('');
  const dRate = pcaTaxRate(e.debitTax), cRate = pcaTaxRate(e.creditTax);
  cols[0] = ymd(e.date).plain;                    // 伝票日付 (YYYYMMDD)
  cols[1] = String(e.voucherNo);                  // 伝票番号 (5桁まで)
  cols[2] = '21';                                 // 仕訳区分: 21 = 月次 (初期値)
  cols[3] = '0';                                  // 管理仕訳区分: 0 = 財務 (初期値)
  cols[4] = dRate ? '1' : '0';                    // 借方税計算モード: 1 = 内税自動計算 / 0 = 税計算しない
  // cols[5] 借方部門コード / cols[6] 借方部門名: blank (本ツールは部門なし。列は受入時の必須指定のため残す)
  cols[7] = e.debitAccount.pcaCode || '';         // 借方科目コード
  cols[8] = e.debitAccount.name;                  // 借方科目名
  // cols[9] 借方補助コード / cols[10] 借方補助名: blank (補助なし)
  cols[11] = e.debitTax.pcaCode || '';            // 借方税区分コード
  cols[12] = e.debitTax.pcaName || '';            // 借方税区分名 (略称)
  cols[13] = String(e.amount);                    // 借方金額 (税込)
  cols[14] = dRate ? String(pcaTaxAmount(e.amount, e.debitTax)) : ''; // 借方消費税額 （内税額）
  cols[15] = cRate ? '1' : '0';                   // 貸方税計算モード
  // cols[16] 貸方部門コード / cols[17] 貸方部門名: blank
  cols[18] = e.creditAccount.pcaCode || '';       // 貸方科目コード
  cols[19] = e.creditAccount.name;                // 貸方科目名
  // cols[20] 貸方補助コード / cols[21] 貸方補助名: blank
  cols[22] = e.creditTax.pcaCode || '';           // 貸方税区分コード
  cols[23] = e.creditTax.pcaName || '';           // 貸方税区分名 (略称)
  cols[24] = String(e.amount);                    // 貸方金額 (税込)
  cols[25] = cRate ? String(pcaTaxAmount(e.amount, e.creditTax)) : ''; // 貸方消費税額
  cols[26] = e.summary;                           // 摘要文
  // cols[27] 数字１ / cols[28] 数字２: blank
  cols[29] = '1';                                 // 入力プログラム区分: 1 = コクヨ式 (初期値)
  return cols;
}

export function toPcaCSV(entries) {
  const header = joinCsv(PCA_COLUMNS);
  const rows = entries.map((e) => joinCsv(pcaRow(e)));
  return [header, ...rows].join('\r\n') + '\r\n';
}

// ---------- OBC (勘定奉行, OBC受入形式・仕訳伝票データ) ----------
// Authority: OBC's official support material (the OBC受入形式 is the
// layout 勘定奉行 itself exports and re-imports; checked 2026-11-13),
// freee's official help page documenting this format with all 53
// columns and their 受入記号 (OBCD/CSJS), OBC's official support
// examples for tax codes (0010 課税売上分課税仕入 / 0001 非課税仕入),
// and a real-machine-verified integration report for the cloud API
// (0000 対象外 / 0060 課売上 / 0080 非課税売上). Third-party output
// specs for the cloud's mapping-based intake (different column order)
// were not adopted. 53 columns, no header row.

export const OBC_COLUMN_COUNT = 53;

// The rate is read from the internal tax name ("課税売上10%（込）" -> 10,
// "課税仕入8%軽減（込）" -> 8); categories without a rate yield 0.
export function obcTaxRate(tax) {
  const n = (tax && tax.name) || '';
  if (n.includes('10%')) return 10;
  if (n.includes('8%')) return 8;
  return 0;
}

export function collectObcWarnings(entries) {
  const warnings = [];
  for (const e of entries) {
    for (const side of ['debit', 'credit']) {
      const acc = e[side + 'Account'], tax = e[side + 'Tax'];
      if (!acc.obcCode) warnings.push(`勘定奉行: 科目「${acc.name}」の勘定奉行用コードが未設定です`);
      if (!tax.obcCode) warnings.push(`勘定奉行: 税区分「${tax.name}」の勘定奉行用税区分コードが未設定です`);
    }
  }
  return [...new Set(warnings)];
}

// One side of an OBC row. base = index of the 部門コード column
// (debit 14, credit 32). Layout per side: 部門コード, 勘定科目コード,
// 補助科目コード, 税区分コード, 税率種別, 税率, 事業区分コード,
// 消費税計算, 端数処理, インボイス取引区分, 控除割合, 取引先コード,
// 本体金額, 消費税額, 外貨コード, レート, 外貨本体金額, 外貨消費税額.
function obcSide(cols, base, account, tax, amount) {
  const rate = obcTaxRate(tax);
  cols[base + 1] = account.obcCode || '';         // 勘定科目コード
  cols[base + 3] = tax.obcCode || '';             // 税区分コード
  cols[base + 4] = rate ? (rate === 8 ? '1' : '0') : ''; // 税率種別: 0 = 標準 / 1 = 軽減
  cols[base + 5] = rate ? String(rate) : '';      // 税率
  cols[base + 7] = rate ? '2' : '0';              // 消費税計算: 2 = 税込金額からの計算 / 0 = しない
  cols[base + 12] = String(amount);               // 本体金額 (税込金額を入れる)
  // 消費税額 (base + 13) stays blank: with 消費税計算 = 2 the importer
  // calculates the tax amount itself.
}

export function obcRow(e, isFirstOfVoucher) {
  const cols = new Array(OBC_COLUMN_COUNT).fill('');
  cols[0] = isFirstOfVoucher ? '*' : '';          // 伝票区切 (OBCD001)
  // cols[1] 伝票区分コード: blank = 通常伝票; cols[2] 用途区分: blank = 振替伝票
  // cols[3] 証憑 / cols[4-6] (undocumented in the format table) /
  // cols[7] 支払先情報（証憑項目）: blank
  // cols[8] 部門指定方法: blank = 勘定科目単位; cols[9] 伝票部門コード: blank
  cols[10] = e.date.replaceAll('-', '/');         // 日付 (YYYY/MM/DD)
  cols[11] = '0';                                 // 整理区分: 0 = 日常仕訳
  cols[12] = String(e.voucherNo);                 // 伝票No
  // cols[13] 伝票入力形式: blank = 通常入力
  obcSide(cols, 14, e.debitAccount, e.debitTax, e.amount);   // 借方 O..AF
  obcSide(cols, 32, e.creditAccount, e.creditTax, e.amount); // 貸方 AG..AX
  cols[50] = e.summary;                           // 摘要 (CSJS100)
  // cols[51] 付箋色 / cols[52] 付箋文字: blank
  return cols;
}

export function toObcCSV(entries) {
  const seen = new Set();
  const rows = entries.map((e) => {
    const first = !seen.has(e.voucherNo);
    seen.add(e.voucherNo);
    return joinCsv(obcRow(e, first));
  });
  return rows.join('\r\n') + '\r\n';
}

// ---------- Transfer file (this tool's own JSON) ----------

export function buildTransferData(company, journals, exportedAt) {
  return {
    type: 'journal-transfer',
    version: 1,
    companyName: company.name,
    periodStart: company.periodStart,
    periodEnd: company.periodEnd,
    exportedAt,
    journals: journals.map((j) => ({ ...j })),
  };
}

// ---------- 諸口 (shoroku) balance ----------

// Balance of the 諸口 account within one voucher:
// (sum of amounts where 諸口 is debit) - (sum where 諸口 is credit).
export function shorokuBalance(journals, voucherNo, shorokuAccountId) {
  let bal = 0;
  for (const j of journals) {
    if (Number(j.voucherNo) !== Number(voucherNo)) continue;
    if (j.debitAccountId === shorokuAccountId) bal += Number(j.amount) || 0;
    if (j.creditAccountId === shorokuAccountId) bal -= Number(j.amount) || 0;
  }
  return bal;
}

// Which side should 諸口 be auto-filled on to reduce the remaining balance?
// balance > 0 (net debit) -> credit side; balance < 0 -> debit side; 0 -> null.
export function shorokuSuggestion(journals, voucherNo, shorokuAccountId) {
  const bal = shorokuBalance(journals, voucherNo, shorokuAccountId);
  if (bal > 0) return 'credit';
  if (bal < 0) return 'debit';
  return null;
}

// ---------- Full-text CSV parser (for verification) ----------

// Parses a whole CSV document (quoted fields may contain commas, doubled
// quotes and line breaks). A trailing line break does not produce a
// phantom row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  let has = false;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true; has = true;
    } else if (c === ',') {
      row.push(cur); cur = ''; has = true;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = []; has = false;
    } else { cur += c; has = true; }
  }
  if (has || cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---------- Search tokens (list filter) ----------

// The keyword box accepts several space-separated tokens; all of them
// must match (AND). A token's shape decides what it is matched against:
//   "2026-04" / "2026/04"        -> year-month of the date
//   "2026-04-01" / "20260401"    -> the exact date
//   "4月"                        -> month of the date
//   digits (commas allowed)      -> amount or voucher number (exact)
//   anything else                -> substring of summary / account names
export function tokenizeSearch(text) {
  return String(text == null ? '' : text).split(/[\s　]+/).map((t) => t.trim()).filter(Boolean);
}

function isValidYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function matchSearchToken(e, token) {
  let m;
  if ((m = token.match(/^(\d{4})[-/](\d{1,2})$/))) {
    return e.date.startsWith(`${m[1]}-${m[2].padStart(2, '0')}`);
  }
  if ((m = token.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    return e.date === `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  if ((m = token.match(/^(\d{4})(\d{2})(\d{2})$/)) && isValidYmd(+m[1], +m[2], +m[3])) {
    return e.date === `${m[1]}-${m[2]}-${m[3]}`;
  }
  if ((m = token.match(/^(\d{1,2})月$/))) {
    return Number(e.date.slice(5, 7)) === Number(m[1]);
  }
  const digits = token.replace(/,/g, '');
  if (/^\d+$/.test(digits)) {
    const n = Number(digits);
    return Number(e.amount) === n || Number(e.voucherNo) === n;
  }
  return (e.summary || '').includes(token)
    || e.debitAccount.name.includes(token)
    || e.creditAccount.name.includes(token);
}

export function matchesSearch(e, tokens) {
  return tokens.every((t) => matchSearchToken(e, t));
}

// ---------- Review flags （要確認） ----------

// Direction of a tax category, read from the internal name
// ("課税売上..." -> sales, "課税仕入..." -> purchase, otherwise null).
export function taxDirection(tax) {
  const n = (tax && tax.name) || '';
  if (n.includes('売上')) return 'sales';
  if (n.includes('仕入')) return 'purchase';
  return null;
}

// Computes review flags for a company's resolved entries. Flags are
// derived, never stored, so editing an entry clears them automatically.
// Returns a Map: entry id -> { strong: [reasons], weak: [reasons] }.
//   strong = should be fixed before importing anywhere
//     - the voucher's 諸口 does not offset to zero
//     - the date is outside the company's accounting period
//   weak = worth a visual check, not necessarily an error
//     - debit tax is sales-type while credit tax is purchase-type
//     - both sides are taxed at different rates
export function journalFlags(entries, period) {
  const flags = new Map();
  const add = (e, level, reason) => {
    const f = flags.get(e.id) || { strong: [], weak: [] };
    f[level].push(reason);
    flags.set(e.id, f);
  };
  const byVoucher = new Map();
  for (const e of entries) {
    const k = String(e.voucherNo);
    if (!byVoucher.has(k)) byVoucher.set(k, []);
    byVoucher.get(k).push(e);
  }
  for (const list of byVoucher.values()) {
    let bal = 0;
    let uses = false;
    for (const e of list) {
      if (e.debitAccount.name === '諸口') { bal += Number(e.amount) || 0; uses = true; }
      if (e.creditAccount.name === '諸口') { bal -= Number(e.amount) || 0; uses = true; }
    }
    if (uses && bal !== 0) {
      for (const e of list) add(e, 'strong', '伝票内で諸口が相殺されていません');
    }
  }
  for (const e of entries) {
    if (period && (e.date < period.start || e.date > period.end)) {
      add(e, 'strong', '日付が会計期間外です');
    }
    if (taxDirection(e.debitTax) === 'sales' && taxDirection(e.creditTax) === 'purchase') {
      add(e, 'weak', '借方が売上系・貸方が仕入系の税区分になっています');
    }
    const dr = obcTaxRate(e.debitTax);
    const cr = obcTaxRate(e.creditTax);
    if (dr && cr && dr !== cr) add(e, 'weak', '借方・貸方で税率が異なります');
  }
  return flags;
}

// ---------- Generated-file verification (re-parse and check) ----------

// Re-parses a generated CSV and checks it against the entries it was
// generated from: row counts, column counts, per-row amounts and the
// debit/credit balance the format can express. Returns
// { ok, errors } with at most 10 error messages.
export function verifyGenerated(format, text, entries) {
  const errors = [];
  const fail = (msg) => { if (errors.length < 10) errors.push(msg); };
  if (format === 'transfer') return { ok: true, errors };
  const rows = parseCsv(text);
  const total = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const num = (v) => Number(v);
  const sumCol = (dataRows, idx) => dataRows.reduce((s, r) => s + (num(r[idx]) || 0), 0);
  const expectRows = (n, label) => {
    if (rows.length !== n) fail(`${label}: 行数が一致しません（${rows.length}行／期待${n}行）`);
  };
  const checkCols = (dataRows, n, label) => {
    dataRows.forEach((r, i) => {
      if (r.length !== n) fail(`${label}: ${i + 1}行目の列数が${r.length}です（期待${n}）`);
    });
  };
  const sameHeader = (row, cols, label) => {
    if (!row || row.length !== cols.length || row.some((v, i) => v !== cols[i])) {
      fail(`${label}: ヘッダー行が定義と一致しません`);
    }
  };

  if (format === 'epson') {
    expectRows(entries.length, 'エプソン');
    checkCols(rows, 30, 'エプソン');
    rows.forEach((r, i) => {
      if (num(r[4]) !== num(r[23])) fail(`エプソン: ${i + 1}行目の借方金額と貸方金額が一致しません`);
      if (entries[i] && num(r[4]) !== Number(entries[i].amount)) fail(`エプソン: ${i + 1}行目の金額が仕訳と一致しません`);
    });
  } else if (format === 'jdl') {
    expectRows(entries.length + 1, 'JDL');
    sameHeader(rows[0], parseCsvLine(JDL_HEADER), 'JDL');
    const data = rows.slice(1);
    checkCols(data, 16, 'JDL');
    if (sumCol(data, 11) !== total) fail('JDL: 金額の合計が仕訳の合計と一致しません');
  } else if (format === 'yayoi') {
    expectRows(entries.length, '弥生');
    checkCols(rows, 25, '弥生');
    rows.forEach((r, i) => {
      if (entries[i] && (num(r[8]) !== Number(entries[i].amount) || num(r[14]) !== Number(entries[i].amount))) {
        fail(`弥生: ${i + 1}行目の金額が仕訳と一致しません`);
      }
    });
  } else if (format === 'freee') {
    expectRows(entries.length + 1, 'freee');
    if (!rows[0] || rows[0][0] !== '[表題行]') fail('freee: 表題行がありません');
    const data = rows.slice(1);
    checkCols(data, FREEE_COLUMNS.length + 1, 'freee');
    data.forEach((r, i) => { if (r[0] !== '[明細行]') fail(`freee: ${i + 1}行目が明細行ではありません`); });
    const dIdx = 1 + FREEE_COLUMNS.indexOf('借方金額');
    const cIdx = 1 + FREEE_COLUMNS.indexOf('貸方金額');
    if (sumCol(data, dIdx) !== total || sumCol(data, cIdx) !== total) {
      fail('freee: 借方・貸方の金額合計が仕訳の合計と一致しません');
    }
  } else if (format === 'mf') {
    expectRows(entries.length + 1, 'マネーフォワード');
    sameHeader(rows[0], MF_COLUMNS, 'マネーフォワード');
    const data = rows.slice(1);
    checkCols(data, MF_COLUMNS.length, 'マネーフォワード');
    const perVoucher = new Map();
    for (const r of data) {
      const g = perVoucher.get(r[0]) || { d: 0, c: 0 };
      g.d += num(r[8]) || 0;
      g.c += num(r[16]) || 0;
      perVoucher.set(r[0], g);
    }
    for (const [v, g] of perVoucher) {
      if (g.d !== g.c) fail(`マネーフォワード: 取引No${v}の借方・貸方合計が一致しません`);
    }
    if (sumCol(data, 8) !== total) fail('マネーフォワード: 金額の合計が仕訳の合計と一致しません');
  } else if (format === 'pca') {
    expectRows(entries.length + 1, 'PCA');
    sameHeader(rows[0], PCA_COLUMNS, 'PCA');
    const data = rows.slice(1);
    checkCols(data, PCA_COLUMNS.length, 'PCA');
    if (sumCol(data, 13) !== total || sumCol(data, 24) !== total) {
      fail('PCA: 借方・貸方の金額合計が仕訳の合計と一致しません');
    }
  } else if (format === 'obc') {
    expectRows(entries.length, '勘定奉行');
    checkCols(rows, OBC_COLUMN_COUNT, '勘定奉行');
    rows.forEach((r, i) => {
      if (entries[i] && (num(r[26]) !== Number(entries[i].amount) || num(r[44]) !== Number(entries[i].amount))) {
        fail(`勘定奉行: ${i + 1}行目の金額が仕訳と一致しません`);
      }
    });
  } else {
    fail(`未知の形式です: ${format}`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------- Trial balance （試算表） ----------
// Aggregates entries per account, in master order. Accounts appear when
// they have activity in the period or a nonzero opening balance.
// Balances sit on the heavier side; the closing balance is the opening
// balance plus the period movement. Accounts flagged kind === 'total'
// （合計科目） never hold entries: they are reported separately in
// totalRows as the sum of the normal accounts whose totalParentId
// points at them, and they are excluded from the grand totals so
// nothing is counted twice. The simple P/L summary uses the account
// category of normal accounts only: revenue net = credit balance -
// debit balance (so a debit-balance revenue account such as 売上値引
// reduces revenue), expense net = debit balance - credit balance,
// profit = revenue - expense. Amounts are tax-inclusive book values,
// so the profit is a rough guide, not a filing figure.
// `opening` maps accountId -> { debit, credit } opening balances.
export function trialBalance(entries, accounts, opening = {}) {
  const sums = new Map();
  for (const e of entries) {
    for (const [id, side] of [[e.debitAccountId, 'debit'], [e.creditAccountId, 'credit']]) {
      if (!sums.has(id)) sums.set(id, { debit: 0, credit: 0 });
      sums.get(id)[side] += Number(e.amount) || 0;
    }
  }
  const rows = [];
  let totalOpeningDebit = 0, totalOpeningCredit = 0;
  let totalDebit = 0, totalCredit = 0, totalDebitBalance = 0, totalCreditBalance = 0;
  let totalClosingDebit = 0, totalClosingCredit = 0;
  let revenue = 0, expense = 0;
  for (const a of accounts) {
    if (a.kind === 'total') continue;
    const s = sums.get(a.id) || { debit: 0, credit: 0 };
    const o = opening[a.id] || {};
    const openingDebit = Number(o.debit) || 0;
    const openingCredit = Number(o.credit) || 0;
    if (!sums.has(a.id) && !openingDebit && !openingCredit) continue;
    const debitBalance = Math.max(s.debit - s.credit, 0);
    const creditBalance = Math.max(s.credit - s.debit, 0);
    const net = (openingDebit - openingCredit) + (s.debit - s.credit);
    const closingDebit = Math.max(net, 0);
    const closingCredit = Math.max(-net, 0);
    rows.push({
      id: a.id, name: a.name, category: a.category || '', totalParentId: a.totalParentId || '',
      openingDebit, openingCredit,
      openingBalance: openingDebit - openingCredit,
      debit: s.debit, credit: s.credit, debitBalance, creditBalance,
      closingDebit, closingCredit,
      closingBalance: closingDebit - closingCredit,
    });
    totalOpeningDebit += openingDebit; totalOpeningCredit += openingCredit;
    totalDebit += s.debit; totalCredit += s.credit;
    totalDebitBalance += debitBalance; totalCreditBalance += creditBalance;
    totalClosingDebit += closingDebit; totalClosingCredit += closingCredit;
    if (a.category === 'revenue') revenue += creditBalance - debitBalance;
    if (a.category === 'expense') expense += debitBalance - creditBalance;
  }
  const totalRows = [];
  for (const a of accounts) {
    if (a.kind !== 'total') continue;
    const members = rows.filter((r) => r.totalParentId === a.id);
    if (!members.length) continue;
    // Period totals are gross sums; opening/closing balances are shown
    // net, so a contra account （貸倒引当金 etc.) reduces its total.
    const t = {
      id: a.id, name: a.name, category: a.category || '', isTotal: true,
      openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0,
    };
    let netOpening = 0, netClosing = 0;
    for (const m of members) {
      t.debit += m.debit; t.credit += m.credit;
      netOpening += m.openingDebit - m.openingCredit;
      netClosing += m.closingDebit - m.closingCredit;
    }
    t.openingDebit = Math.max(netOpening, 0); t.openingCredit = Math.max(-netOpening, 0);
    t.closingDebit = Math.max(netClosing, 0); t.closingCredit = Math.max(-netClosing, 0);
    t.openingBalance = netOpening;
    t.closingBalance = netClosing;
    totalRows.push(t);
  }
  // Display order: each total row sits right after the last of its
  // member rows, the way a printed trial balance reads.
  const totalById = Object.fromEntries(totalRows.map((t) => [t.id, t]));
  const lastMemberAt = new Map();
  rows.forEach((r, i) => { if (r.totalParentId && totalById[r.totalParentId]) lastMemberAt.set(r.totalParentId, i); });
  const displayRows = [];
  rows.forEach((r, i) => {
    displayRows.push(r);
    for (const [tid, at] of lastMemberAt) if (at === i) displayRows.push(totalById[tid]);
  });
  return {
    rows, totalRows, displayRows,
    totalOpeningDebit, totalOpeningCredit,
    totalDebit, totalCredit, totalDebitBalance, totalCreditBalance,
    totalClosingDebit, totalClosingCredit,
    revenue, expense, profit: revenue - expense,
  };
}
