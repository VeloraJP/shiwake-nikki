# UI-level checks for the journal tool, incl. downloaded CSV contents.
# Run (from app/):  python3 -m http.server 8768 &  then  python3 tests/ui_check.py
import csv, io, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8768/"
results = []
dialogs = []
dialog_mode = {"how": "accept"}

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS" if cond else "FAIL"), "-", name, detail if not cond else "")

def on_dialog(d):
    dialogs.append(d.message)
    if dialog_mode["how"] == "dismiss":
        d.dismiss()
    else:
        d.accept()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 950})
    pg.on("dialog", on_dialog)
    pg.goto(BASE)
    pg.wait_for_timeout(400)

    # --- setup company ---
    pg.click("button[data-tab='settings']")
    pg.fill("#c-name", "テスト株式会社")
    pg.fill("#c-start", "2026-04-01")
    pg.fill("#c-end", "2027-03-31")
    pg.click("#c-save")
    pg.wait_for_timeout(300)

    # --- masters: set JDL codes so CSV assertions are meaningful ---
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)

    def set_master_code(table, row_name, field, value):
        rows = pg.locator(f"{table} tbody tr")
        for i in range(rows.count()):
            nm = rows.nth(i).locator('[data-f="name"]').input_value()
            if nm == row_name:
                inp = rows.nth(i).locator(f'[data-f="{field}"]')
                inp.fill(value)
                inp.evaluate("e => e.dispatchEvent(new Event('change', {bubbles:true}))")
                return True
        return False

    check("masters: JDL account codes set",
          set_master_code("#account-table", "現金", "jdlCode", "111")
          and set_master_code("#account-table", "売上高", "jdlCode", "411")
          and set_master_code("#account-table", "消耗品費", "jdlCode", "831"))

    def get_master_value(table, row_name, field):
        rows = pg.locator(f"{table} tbody tr")
        for i in range(rows.count()):
            if rows.nth(i).locator('[data-f="name"]').input_value() == row_name:
                return rows.nth(i).locator(f'[data-f="{field}"]').input_value()
        return None

    check("masters: tax code fields start blank (2026-11-13 decision); freee names stay seeded",
          get_master_value("#tax-table", "課税仕入10%（込）", "epsonKazei") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "epsonTax") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "jdlKaku") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "jdlTax") == ""
          and get_master_value("#tax-table", "課税売上10%（込）", "jdlKaku") == ""
          and get_master_value("#tax-table", "対象外", "jdlKaku") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "freeeName") == "課対仕入10%"
          and get_master_value("#tax-table", "非課税売上", "epsonKazei") == ""
          and get_master_value("#tax-table", "非課税仕入", "epsonKazei") == "")

    check("masters: seeded yayoi tax writings (official 記述形式, 税込)",
          get_master_value("#tax-table", "対象外", "yayoiName") == "対象外"
          and get_master_value("#tax-table", "課税売上10%（込）", "yayoiName") == "課税売上込10%"
          and get_master_value("#tax-table", "課税売上8%軽減（込）", "yayoiName") == "課税売上込軽減8%"
          and get_master_value("#tax-table", "非課税売上", "yayoiName") == "非課売上"
          and get_master_value("#tax-table", "課税仕入10%（込）", "yayoiName") == "課対仕入込10%"
          and get_master_value("#tax-table", "課税仕入8%軽減（込）", "yayoiName") == "課対仕入込軽減8%"
          and get_master_value("#tax-table", "非課税仕入", "yayoiName") == "非課仕入")

    check("masters: seeded mf tax names (official formal names)",
          get_master_value("#tax-table", "対象外", "mfName") == "対象外"
          and get_master_value("#tax-table", "課税売上10%（込）", "mfName") == "課税売上 10%"
          and get_master_value("#tax-table", "課税売上8%軽減（込）", "mfName") == "課税売上 (軽)8%"
          and get_master_value("#tax-table", "非課税売上", "mfName") == "非課税売上"
          and get_master_value("#tax-table", "課税仕入10%（込）", "mfName") == "課税仕入 10%"
          and get_master_value("#tax-table", "課税仕入8%軽減（込）", "mfName") == "課税仕入 (軽)8%"
          and get_master_value("#tax-table", "非課税仕入", "mfName") == "非課税仕入")

    check("masters: pca codes start blank; pca tax names （略称） stay seeded",
          get_master_value("#tax-table", "対象外", "pcaCode") == ""
          and get_master_value("#tax-table", "課税売上10%（込）", "pcaCode") == ""
          and get_master_value("#tax-table", "課税売上8%軽減（込）", "pcaCode") == ""
          and get_master_value("#tax-table", "非課税売上", "pcaCode") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "pcaCode") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "pcaName") == "仕入10%"
          and get_master_value("#tax-table", "課税仕入8%軽減（込）", "pcaCode") == ""
          and get_master_value("#tax-table", "非課税仕入", "pcaCode") == ""
          and get_master_value("#account-table", "現金", "pcaCode") == ""
          and get_master_value("#account-table", "売上高", "pcaCode") == ""
          and get_master_value("#account-table", "諸口", "pcaCode") == "")

    check("masters: obc tax and account codes start blank (office-specific, 2026-11-13 decision)",
          get_master_value("#tax-table", "対象外", "obcCode") == ""
          and get_master_value("#tax-table", "課税売上10%（込）", "obcCode") == ""
          and get_master_value("#tax-table", "課税売上8%軽減（込）", "obcCode") == ""
          and get_master_value("#tax-table", "非課税売上", "obcCode") == ""
          and get_master_value("#tax-table", "課税仕入10%（込）", "obcCode") == ""
          and get_master_value("#tax-table", "課税仕入8%軽減（込）", "obcCode") == ""
          and get_master_value("#tax-table", "非課税仕入", "obcCode") == ""
          and get_master_value("#account-table", "現金", "obcCode") == "")

    pg.click("button[data-tab='entry']")
    pg.wait_for_timeout(200)

    def count_journals():
        pg.click("button[data-tab='list']")
        pg.wait_for_timeout(150)
        t = pg.locator("#list-count").inner_text()
        pg.click("button[data-tab='entry']")
        pg.wait_for_timeout(150)
        return int(t.split()[0])

    def set_entry(debit=None, credit=None, dtax=None, ctax=None, amount=None, date=None, summary=None):
        if date is not None:
            pg.fill("#e-date", date)
        if debit is not None:
            pg.select_option("#e-debit-select", label=debit)
        if credit is not None:
            pg.select_option("#e-credit-select", label=credit)
        if dtax is not None:
            pg.select_option("#e-debit-tax", value=dtax)
        if ctax is not None:
            pg.select_option("#e-credit-tax", value=ctax)
        if amount is not None:
            pg.fill("#e-amount", str(amount))
        if summary is not None:
            pg.fill("#e-summary", summary)
        pg.wait_for_timeout(80)

    def msg():
        return pg.locator("#entry-msg").inner_text()

    # design fact: single shared amount field, no per-side amount inputs
    n = pg.evaluate("document.querySelectorAll('#e-debit-amount,#e-credit-amount').length")
    check("design: no separate debit/credit amount fields (imbalance impossible per row)", n == 0 and pg.locator("#e-amount").count() == 1)

    # S1 amount = 0
    set_entry(debit="現金", credit="売上高", amount="0", date="2026-04-01", summary="金額ゼロ")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S1 amount 0 rejected", "金額は正の整数" in msg() and count_journals() == 0, msg())

    # S2 amount decimal
    set_entry(amount="100.5")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S2 decimal amount rejected", "金額は正の整数" in msg() and count_journals() == 0, msg())

    # S3 unknown account name typed directly
    pg.fill("#e-debit-name", "存在しない科目")
    set_entry(credit="現金", amount="100", summary="不明科目")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S3 unknown account rejected", "借方科目はマスタ" in msg() and count_journals() == 0, msg())

    # S4 same account on both sides
    set_entry(debit="現金", credit="現金", amount="1000", summary="同一科目")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    msg_after_save = msg()
    check("S4 same account both sides saves", count_journals() == 1)
    check("S4-msg: success message '保存しました' stays visible after save",
          msg_after_save == "保存しました", f"actual: {msg_after_save!r}")

    # S5 purchase account with SALES tax (mismatch allowed)
    pg.select_option("#e-debit-select", label="消耗品費")
    pg.wait_for_timeout(80)
    auto_tax = pg.locator("#e-debit-tax").input_value()
    check("S5a account default tax auto-set to 課税仕入10%", auto_tax == "tax-purchase10", auto_tax)
    set_entry(credit="現金", dtax="tax-sales10", amount="2200", summary="税区分不一致")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S5b mismatched tax (仕入科目 x 売上税区分) saves", count_journals() == 2)

    # S6 both sides taxed
    set_entry(debit="消耗品費", credit="売上高", amount="3300", summary="両側課税")
    pg.wait_for_timeout(80)
    check("S6a credit default tax auto-set to 課税売上10%", pg.locator("#e-credit-tax").input_value() == "tax-sales10")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S6b both-sides-taxed entry saves", count_journals() == 3)

    # S7 shoroku unbalanced: dismiss keeps voucher, entry still saved
    dialogs.clear(); dialog_mode["how"] = "dismiss"
    set_entry(debit="諸口", credit="売上高", amount="1000", date="2026-04-10", summary="諸口一回目")
    pg.click("#save-new"); pg.wait_for_timeout(250)
    joined = "\n".join(dialogs)
    check("S7a unbalanced shoroku warns on save-new", "相殺されていません" in joined and "1,000円" in joined, joined[:120])
    check("S7b entry saved despite warning; voucher stays", count_journals() == 4 and pg.locator("#e-voucher").input_value() == "4",
          pg.locator("#e-voucher").input_value())
    dialog_mode["how"] = "accept"
    set_entry(debit="現金", credit="諸口", amount="1000", summary="諸口相殺")
    pg.click("#save-continue"); pg.wait_for_timeout(150)
    check("S7c balancing line saves on same voucher", count_journals() == 5 and pg.locator("#e-voucher").input_value() == "4")

    # S8 date outside period: dismiss -> not saved
    dialogs.clear(); dialog_mode["how"] = "dismiss"
    set_entry(debit="現金", credit="売上高", amount="100", date="2027-05-01", summary="期間外")
    pg.click("#save-new"); pg.wait_for_timeout(250)
    joined = "\n".join(dialogs)
    check("S8a out-of-period date warns", "会計期間" in joined and "外です" in joined, joined[:120])
    check("S8b dismissed -> not saved", count_journals() == 5)
    dialog_mode["how"] = "accept"

    # S7d shoroku unbalanced again, accept -> voucher advances
    dialogs.clear()
    set_entry(debit="諸口", credit="売上高", amount="500", date="2026-04-10", summary="諸口受入")
    pg.click("#save-new"); pg.wait_for_timeout(250)
    check("S7d accepted -> saved and voucher advances", count_journals() == 6 and pg.locator("#e-voucher").input_value() == "5",
          pg.locator("#e-voucher").input_value())

    # S9 long summary (truncation checked in CSV)
    set_entry(debit="現金", credit="売上高", amount="100", date="2026-04-11", summary="あ" * 40)
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S9 long summary saves", count_journals() == 7, msg())

    # S10 huge amount, empty summary
    set_entry(debit="現金", credit="売上高", amount="99999999999", summary="")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S10 huge amount + empty summary saves", count_journals() == 8, msg())

    # S11 entry on an account with no EPSON code （地代家賃 splits into
    # 地代/家賃 in EPSON's chart): keeps the unset-code warning / blank-code
    # output paths covered now that most accounts carry seeded codes.
    set_entry(debit="地代家賃", credit="現金", amount="500", date="2026-04-11", summary="コード未設定")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    check("S11 codeless-account entry saves", count_journals() == 9, msg())

    # ---------- Exports: download and inspect CSV ----------
    pg.click("button[data-tab='export']")
    pg.wait_for_timeout(200)
    check("P5 export screen shows freee duplicate-import caution",
          "同じ日付・同じ伝票番号" in pg.locator("#tab-export").inner_text())
    pg.check("#x-include")

    def run_export(fmt):
        dialogs.clear()
        pg.select_option("#x-format", value=fmt)
        pg.wait_for_timeout(150)
        with pg.expect_download() as dl:
            pg.click("#x-run")
        path = dl.value.path()
        return path, "\n".join(dialogs)

    def read_rows(path, encoding):
        raw = open(path, "rb").read().decode(encoding)
        return [r for r in csv.reader(io.StringIO(raw)) if r]

    # Codes carry no defaults (2026-11-13 decision): register the codes the
    # Epson/JDL assertions rely on through the masters first, like a user
    # setting up their office's codes.
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    set_master_code("#account-table", "消耗品費", "epsonCode", "523")
    set_master_code("#account-table", "売上高", "epsonCode", "810")
    set_master_code("#tax-table", "課税売上10%（込）", "epsonKazei", "02")
    set_master_code("#tax-table", "課税売上10%（込）", "epsonTax", "10")
    set_master_code("#tax-table", "課税売上10%（込）", "jdlKaku", "11")
    set_master_code("#tax-table", "課税売上10%（込）", "jdlTax", "10")
    set_master_code("#tax-table", "対象外", "epsonKazei", "00")
    set_master_code("#tax-table", "課税仕入10%（込）", "epsonKazei", "32")
    set_master_code("#tax-table", "課税仕入10%（込）", "epsonTax", "10")
    set_master_code("#tax-table", "課税仕入10%（込）", "jdlKaku", "31")
    set_master_code("#tax-table", "課税仕入10%（込）", "jdlTax", "10")
    pg.click("button[data-tab='export']")
    pg.wait_for_timeout(200)

    # Epson (all CSV downloads are Shift_JIS by design: encodeSJIS for every format)
    path, dlg = run_export("epson")
    rows = read_rows(path, "cp932")
    by_summary = {r[24]: r for r in rows if len(r) > 24}
    r5 = by_summary.get("税区分不一致")
    check("E1 epson: mismatch entry debit tax cols are sales-tax 02/10", r5 and r5[7] == "02" and r5[8] == "10", str(r5))
    check("E2 epson: mismatch entry credit tax col is 00, debit code is the registered 523", r5 and r5[16] == "00" and r5[5] == "523", str(r5))
    r6 = by_summary.get("両側課税")
    check("E3 epson: both-taxed credit side 02/10, debit side 32/10 (rate text unified to 10)", r6 and r6[16] == "02" and r6[17] == "10" and r6[7] == "32" and r6[8] == "10" and r6[14] == "810", str(r6))
    r9 = [r for r in rows if len(r) > 24 and r[24].startswith("あ")]
    check("E4 epson: summary truncated to 48 bytes (24 fullwidth chars)", len(r9) == 1 and r9[0][24] == "あ" * 24, str(r9))
    check("E5 epson: warnings shown for unset codes", "未設定" in dlg, dlg[:160])
    r11 = by_summary.get("コード未設定")
    check("E5b epson: codeless account outputs a blank code column", r11 and r11[5] == "" and r11[6] == "地代家賃", str(r11))

    # JDL
    path, dlg = run_export("jdl")
    rows = read_rows(path, "cp932")
    data = rows[1:]
    by_summary = {r[12]: r for r in data if len(r) > 12}
    j6 = by_summary.get("両側課税")
    check("J1 jdl: both-taxed uses DEBIT pair (課区31=課税仕入) not credit (11)", j6 and j6[13] == "31" and j6[15] == "10", str(j6))
    check("J2 jdl: both-taxed codes from masters", j6 and j6[3] == "831" and j6[7] == "411", str(j6))
    j5 = by_summary.get("税区分不一致")
    check("J3 jdl: mismatch entry takes debit （課税売上） pair 11/10", j5 and j5[13] == "11" and j5[15] == "10" and j5[3] == "831" and j5[7] == "111", str(j5))
    j9 = [r for r in data if len(r) > 12 and r[12].startswith("あ")]
    check("J4 jdl: summary truncated to 64 bytes (32 fullwidth chars)", len(j9) == 1 and j9[0][12] == "あ" * 32, str(j9))
    check("J5 jdl: warning says debit pair adopted", "借方側の課区・税区を採用しました" in dlg, dlg[:200])

    # freee
    path, dlg = run_export("freee")
    rows = read_rows(path, "cp932")
    f6 = None
    for r in rows[1:]:
        if len(r) > 24 and r[24] == "両側課税":
            f6 = r
    # FREEE row: [明細行] + columns; 借方税区分 idx 12, 貸方税区分 idx 22 in the full row
    check("F1 freee: both-taxed official names on both sides", f6 and f6[12] == "課対仕入10%" and f6[22] == "課税売上10%", str(f6))

    # Yayoi (25 columns, no header, accounts by name, 内税額 computed)
    path, dlg = run_export("yayoi")
    rows = read_rows(path, "cp932")
    y6 = None
    for r in rows:
        if len(r) > 16 and r[16] == "両側課税":
            y6 = r
    check("Y1 yayoi: 25 columns, no header, flag 2000, type 0, adjust no",
          y6 and len(y6) == 25 and y6[0] == "2000" and y6[19] == "0" and y6[24] == "no"
          and rows[0][0] == "2000", str(y6))
    check("Y2 yayoi: account names, tax writings and 内税額 300 on both sides",
          y6 and y6[4] == "消耗品費" and y6[7] == "課対仕入込10%" and y6[8] == "3300" and y6[9] == "300"
          and y6[10] == "売上高" and y6[13] == "課税売上込10%" and y6[15] == "300", str(y6))
    check("Y3 yayoi: exported badge recorded (list filter finds it)",
          "未設定" not in dlg, dlg[:160])

    # Money Forward (27 columns, label row first, 取引No = 伝票番号)
    check("MF0 export screen shows the compound-entry note",
          "複合仕訳として取り込まれます" in pg.locator("#tab-export").inner_text())
    path, dlg = run_export("mf")
    rows = read_rows(path, "cp932")
    m6 = None
    for r in rows[1:]:
        if len(r) > 18 and r[18] == "両側課税":
            m6 = r
    check("MF1 mf: label row is the official 27-column header",
          len(rows[0]) == 27 and rows[0][0] == "取引No" and rows[0][1] == "取引日"
          and rows[0][8] == "借方金額(円)" and rows[0][16] == "貸方金額(円)"
          and rows[0][18] == "摘要" and rows[0][26] == "最終更新者", str(rows[0]))
    check("MF2 mf: names, formal tax names, gross amounts, blank tax-amount columns",
          m6 and len(m6) == 27 and m6[2] == "消耗品費" and m6[6] == "課税仕入 10%"
          and m6[8] == "3300" and m6[9] == "" and m6[10] == "売上高"
          and m6[14] == "課税売上 10%" and m6[16] == "3300" and m6[17] == "", str(m6))
    v4_idx = [i for i, r in enumerate(rows[1:]) if r[0] == "4"]
    check("MF3 mf: same-voucher rows share 取引No and are consecutive (one compound entry)",
          len(v4_idx) == 3 and v4_idx == list(range(v4_idx[0], v4_idx[0] + 3)), str(v4_idx))
    check("MF4 mf: no unset-name warning in dialog", "未設定" not in dlg, dlg[:160])

    # PCA （汎用データ受入・仕訳データ標準形式, 30 columns, item-name header row)
    check("PCA0 export screen shows the PCA import note",
          "項目名から自動判定" in pg.locator("#tab-export").inner_text())
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    set_master_code("#account-table", "消耗品費", "pcaCode", "27002070")
    set_master_code("#account-table", "売上高", "pcaCode", "21100010")
    set_master_code("#tax-table", "課税仕入10%（込）", "pcaCode", "Q5")
    set_master_code("#tax-table", "課税売上10%（込）", "pcaCode", "B5")
    pg.click("button[data-tab='export']")
    pg.wait_for_timeout(200)
    path, dlg = run_export("pca")
    rows = read_rows(path, "cp932")
    p6 = None
    for r in rows[1:]:
        if len(r) > 26 and r[26] == "両側課税":
            p6 = r
    check("PCA1 pca: header row is the official first-30 item names",
          len(rows[0]) == 30 and rows[0][0] == "伝票日付" and rows[0][1] == "伝票番号"
          and rows[0][7] == "借方科目コード" and rows[0][11] == "借方税区分コード"
          and rows[0][26] == "摘要文" and rows[0][29] == "入力プログラム区分", str(rows[0]))
    check("PCA2 pca: codes, tax modes, gross amounts and 内税額 on both sides",
          p6 and len(p6) == 30 and len(p6[0]) == 8 and p6[2] == "21" and p6[3] == "0"
          and p6[4] == "1" and p6[7] == "27002070" and p6[8] == "消耗品費"
          and p6[11] == "Q5" and p6[12] == "仕入10%" and p6[13] == "3300" and p6[14] == "300"
          and p6[15] == "1" and p6[18] == "21100010" and p6[19] == "売上高"
          and p6[22] == "B5" and p6[23] == "売上10%" and p6[24] == "3300" and p6[25] == "300"
          and p6[29] == "1", str(p6))
    check("PCA3 pca: unset codes of other accounts warn in dialog (codes have no defaults)",
          "未設定" in dlg, dlg[:160])

    # OBC （勘定奉行・OBC受入形式, 53 columns, no header)
    check("OBC0 export screen shows the OBC import note",
          "OBC受入形式" in pg.locator("#tab-export").inner_text())
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    set_master_code("#account-table", "消耗品費", "obcCode", "751")
    set_master_code("#account-table", "売上高", "obcCode", "401")
    set_master_code("#tax-table", "課税仕入10%（込）", "obcCode", "0010")
    set_master_code("#tax-table", "課税売上10%（込）", "obcCode", "0060")
    pg.click("button[data-tab='export']")
    pg.wait_for_timeout(200)
    path, dlg = run_export("obc")
    rows = read_rows(path, "cp932")
    o6 = None
    for r in rows:
        if len(r) > 50 and r[50] == "両側課税":
            o6 = r
    check("OBC1 obc: 53 columns, date, codes, rate fields, gross amounts, summary",
          o6 and len(o6) == 53 and o6[10].count("/") == 2 and o6[11] == "0"
          and o6[15] == "751" and o6[17] == "0010" and o6[18] == "0" and o6[19] == "10"
          and o6[21] == "2" and o6[26] == "3300" and o6[27] == ""
          and o6[33] == "401" and o6[35] == "0060" and o6[36] == "0" and o6[37] == "10"
          and o6[39] == "2" and o6[44] == "3300", str(o6))
    v4 = [r for r in rows if len(r) > 12 and r[12] == "4"]
    check("OBC2 obc: 伝票区切 * only on the first row of the voucher",
          len(v4) == 3 and v4[0][0] == "*" and v4[1][0] == "" and v4[2][0] == "", str([r[0] for r in v4]))
    check("OBC3 obc: unset account codes of other accounts warn in dialog",
          "勘定奉行用コードが未設定" in dlg, dlg[:200])

    # --- mobile 390px: no form control may stick out of the card ---
    # (2026-11-12 iPhone report: date inputs overflowed the card on iOS.
    # Chromium cannot reproduce the iOS intrinsic-width quirk, but this
    # guards the layout contract: every card field fits the card width.)
    mp = b.new_page(viewport={"width": 390, "height": 844})
    mp.on("dialog", on_dialog)
    mp.goto(BASE)
    mp.wait_for_timeout(400)
    bad_all = []
    for tab in ["entry", "list", "export", "masters", "settings"]:
        mp.click(f"button[data-tab='{tab}']")
        mp.wait_for_timeout(150)
        res = mp.evaluate("""() => {
          const mr = document.querySelector('main').getBoundingClientRect().right;
          const bad = [];
          document.querySelectorAll('main input, main select').forEach(el => {
            if (el.closest('.table-wrap')) return;
            const r = el.getBoundingClientRect();
            if (r.width && r.right > mr + 1) bad.push((el.id || el.type) + ':+' + Math.round(r.right - mr));
          });
          return bad;
        }""")
        bad_all += [f"{tab}:{x}" for x in res]
    scroll_w = mp.evaluate("() => document.documentElement.scrollWidth")
    check("M1 mobile 390px: no input/select overflows the card", bad_all == [] and scroll_w <= 390, str(bad_all) + f" scrollW={scroll_w}")
    mp.close()

    # --- N. masters model: defaults global, additions/edits individual ---
    def entry_account_names(page):
        return page.evaluate("""() => [...document.querySelectorAll('#e-debit-select option')].map(o => o.textContent).filter(t => t !== '科目を選択')""")

    def master_code(page, row_name, field):
        rows = page.locator("#account-table tbody tr")
        for i in range(rows.count()):
            if rows.nth(i).locator('[data-f="name"]').input_value() == row_name:
                return rows.nth(i).locator(f'[data-f="{field}"]').input_value()
        return None

    pg.click("button[data-tab='entry']")
    pg.wait_for_timeout(200)
    names_a = entry_account_names(pg)
    check("N1 company A sees all 62 default accounts incl. 建物", len(names_a) == 62 and "建物" in names_a, f"count={len(names_a)}")

    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    pg.fill("#acc-new-name", "独自科目N")
    pg.click("#acc-add")
    pg.wait_for_timeout(200)

    pg.click("button[data-tab='settings']")
    pg.wait_for_timeout(200)
    pg.fill("#c-name", "会社B")
    # Date fields are text inputs: slash and 8-digit forms must normalize
    # to YYYY-MM-DD (native date widgets rejected plain year typing).
    pg.fill("#c-start", "2026/04/01")
    pg.fill("#c-end", "20270331")
    pg.click("#c-save")
    pg.wait_for_timeout(300)
    period_b = pg.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('journalToolStateV1'));
      const c = s.companies.find(x => x.name === '会社B');
      return c ? [c.periodStart, c.periodEnd] : null;
    }""")
    check("D1 company dates accept 2026/04/01 and 20270331, stored normalized",
          period_b == ["2026-04-01", "2027-03-31"], str(period_b))
    pg.click("button[data-tab='entry']")
    pg.wait_for_timeout(200)
    names_b = entry_account_names(pg)
    check("N1b new company B also sees the 62 defaults", len(names_b) == 62 and "建物" in names_b, f"count={len(names_b)}")
    check("N2 account added in A does not leak into B", "独自科目N" not in names_b)
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    cash_jdl_b = master_code(pg, "現金", "jdlCode")
    check("N3 code edited in A does not leak into B （現金 jdlCode stays at the blank default)", cash_jdl_b == "", f"got={cash_jdl_b}")
    pg.select_option("#company-select", label="テスト株式会社")
    pg.wait_for_timeout(300)
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    check("N3b company A keeps its own edit and addition",
          master_code(pg, "現金", "jdlCode") == "111" and master_code(pg, "独自科目N", "jdlCode") == "")

    # --- N4. legacy (v1) saved data migrates: gains defaults, keeps differences ---
    legacy = {
        "version": 1, "currentCompanyId": "legacy1",
        "companies": [{
            "id": "legacy1", "name": "移行テスト", "periodStart": "2026-04-01", "periodEnd": "2027-03-31",
            "accounts": [
                {"id": "acc1", "name": "現金", "epsonCode": "1111", "jdlCode": "999", "defaultTaxId": "tax-excluded"},
                {"id": "custom-x", "name": "独自科目X", "epsonCode": "", "jdlCode": "", "defaultTaxId": "tax-excluded"},
            ],
            "taxes": [
                {"id": "tax-excluded", "name": "対象外", "freeeName": "", "epsonKazei": "00", "epsonTax": "", "jdlKaku": "", "jdlTax": ""},
            ],
            "journals": [], "templates": [], "lastDate": "2026-04-01",
        }],
    }
    import json as _json
    ctx2 = b.new_context(viewport={"width": 1280, "height": 950})
    ctx2.add_init_script(f"localStorage.setItem('journalToolStateV1', {_json.dumps(_json.dumps(legacy))})")
    pg2 = ctx2.new_page()
    pg2.on("dialog", on_dialog)
    pg2.goto(BASE)
    pg2.wait_for_timeout(400)
    pg2.click("button[data-tab='masters']")
    pg2.wait_for_timeout(200)
    acc_rows = pg2.locator("#account-table tbody tr").count()
    tax_rows = pg2.locator("#tax-table tbody tr").count()
    check("N4 legacy company gains current defaults (72+1 accounts, 7 taxes)",
          acc_rows == 73 and tax_rows == 7, f"acc={acc_rows} tax={tax_rows}")
    check("N4b legacy differences survive （現金 jdlCode=999, 独自科目X)",
          master_code(pg2, "現金", "jdlCode") == "999" and master_code(pg2, "独自科目X", "name") is not None)
    stored = pg2.evaluate("() => JSON.parse(localStorage.getItem('journalToolStateV1'))")
    comp = stored["companies"][0]
    check("N4c stored shape migrated to overrides/additions",
          "accounts" not in comp and comp.get("accountOverrides", {}).get("acc1", {}).get("jdlCode") == "999"
          and any(a["name"] == "独自科目X" for a in comp.get("accountAdditions", [])))
    ctx2.close()

    # --- P. v16: search tokens, review flags, marker, verification note ---
    check("P0 version label shows v22", "v22" in pg.locator("header").inner_text())

    pg.click("button[data-tab='entry']")
    pg.wait_for_timeout(200)
    before = count_journals()
    set_entry(debit="諸口", credit="売上高", amount="777", date="2026-04-20", summary="未相殺テスト")
    pg.click("#save-new"); pg.wait_for_timeout(200)
    check("P1 unbalanced shoroku entry saves (warning only)", count_journals() == before + 1, msg())

    pg.click("button[data-tab='list']")
    pg.wait_for_timeout(200)
    pg.fill("#f-from", "")
    pg.fill("#f-to", "")
    pg.wait_for_timeout(150)
    row = pg.locator("#journal-table tbody tr", has_text="未相殺テスト")
    check("P2 unbalanced row shows the 要確認 badge",
          row.count() == 1 and "要確認" in row.first.inner_text(),
          row.first.inner_text() if row.count() else "row missing")

    def list_row_count():
        return pg.locator("#journal-table tbody tr").count()

    pg.fill("#f-keyword", "777"); pg.wait_for_timeout(200)
    n_amount = list_row_count()
    pg.fill("#f-keyword", "未相殺 777"); pg.wait_for_timeout(200)
    n_and = list_row_count()
    pg.fill("#f-keyword", "未相殺 9999"); pg.wait_for_timeout(200)
    n_none = list_row_count()
    pg.fill("#f-keyword", "2026-04"); pg.wait_for_timeout(200)
    n_ym = list_row_count()
    has_target = pg.locator("#journal-table tbody tr", has_text="未相殺テスト").count() == 1
    pg.fill("#f-keyword", ""); pg.wait_for_timeout(200)
    check("P3 search tokens: amount / AND / no-match / year-month",
          n_amount == 1 and n_and == 1 and n_none == 0 and n_ym >= 1 and has_target,
          f"amount={n_amount} and={n_and} none={n_none} ym={n_ym} target={has_target}")

    pg.select_option("#f-status", value="flagged"); pg.wait_for_timeout(200)
    flagged_rows = pg.locator("#journal-table tbody tr")
    ftexts = [flagged_rows.nth(i).inner_text() for i in range(flagged_rows.count())]
    check("P4 flagged filter shows only flagged rows incl. the unbalanced one",
          len(ftexts) >= 1
          and all(("要確認" in t or "確認推奨" in t) for t in ftexts)
          and any("未相殺テスト" in t for t in ftexts),
          str(ftexts))
    check("P4b the list tab states where the review check lives and how many are flagged",
          "件あります" in pg.locator("#flag-info").inner_text()
          and "要確認チェック" in pg.locator("#tab-list").inner_text(),
          pg.locator("#flag-info").inner_text())
    pg.select_option("#f-status", value="all"); pg.wait_for_timeout(150)

    pg.click("button[data-tab='export']")
    pg.wait_for_timeout(200)
    export_text = pg.locator("#tab-export").inner_text()
    check("P5 verification-status section is published in the export tab",
          "対応形式と検証状況" in export_text and "未実施" in export_text)
    pg.check("#x-marker")
    path, _dlg = run_export("mf")
    rows = read_rows(path, "cp932")
    marked = [r for r in rows[1:] if len(r) > 18 and "未相殺テスト" in r[18]]
    check("P6 marker export prefixes 【要確認】 to the flagged summary",
          len(marked) == 1 and marked[0][18].startswith("【要確認】"),
          str(marked[:1]))
    pg.uncheck("#x-marker")

    # --- Q. v18: trial balance, account category, bookkeeping-requirement note ---
    check("Q0 export tab states the tool does not meet tax-law bookkeeping requirements",
          "税法で定められた帳簿の要件" in pg.locator("#tab-export").inner_text())
    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(200)
    check("Q0b masters: account categories are seeded （売上高 = revenue, 消耗品費 = expense)",
          get_master_value("#account-table", "売上高", "category") == "revenue"
          and get_master_value("#account-table", "消耗品費", "category") == "expense"
          and get_master_value("#account-table", "現金", "category") == "asset")

    pg.click("button[data-tab='settings']")
    pg.wait_for_timeout(200)
    pg.fill("#c-name", "会社C")
    pg.fill("#c-start", "2026-04-01")
    pg.fill("#c-end", "2027-03-31")
    pg.click("#c-save")
    pg.wait_for_timeout(300)
    pg.click("button[data-tab='entry']")
    pg.wait_for_timeout(200)
    set_entry(debit="現金", credit="売上高", amount="10000", date="2026-04-05", summary="売上")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    set_entry(debit="消耗品費", credit="現金", amount="3000", date="2026-04-06", summary="備品")
    pg.click("#save-new"); pg.wait_for_timeout(150)
    set_entry(debit="売上値引", credit="現金", amount="500", date="2026-04-07", summary="値引")
    pg.click("#save-new"); pg.wait_for_timeout(150)

    pg.click("button[data-tab='trial']")
    pg.wait_for_timeout(250)

    def tb_rows():
        out = {}
        rows = pg.locator("#tb-body-bs tr, #tb-body-pl tr")
        for i in range(rows.count()):
            if rows.nth(i).locator("td").count() < 7:
                continue  # category band row
            cells = [rows.nth(i).locator("td").nth(k).inner_text() for k in range(7)]
            out[cells[0]] = [c.replace(",", "") for c in cells[1:]]
        return out

    tb = tb_rows()
    check("Q1 trial balance rows aggregate per account",
          tb.get("現金") == ["", "", "10000", "3500", "6500", ""]
          and tb.get("売上高") == ["", "", "", "10000", "", "10000"]
          and tb.get("消耗品費") == ["", "", "3000", "", "3000", ""]
          and tb.get("売上値引") == ["", "", "500", "", "500", ""], str(tb))
    foot_bs = [pg.locator("#tb-foot-bs td").nth(k).inner_text().replace(",", "") for k in range(7)]
    foot_pl = [pg.locator("#tb-foot-pl td").nth(k).inner_text().replace(",", "") for k in range(7)]
    check("Q2 trial balance totals per side (BS left, PL right)",
          foot_bs == ["合計", "", "", "10000", "3500", "6500", ""]
          and foot_pl == ["合計", "", "", "3500", "10000", "3500", "10000"],
          str(foot_bs) + " / " + str(foot_pl))
    check("Q3 simple P/L: revenue 9,500 / expense 3,000 / profit 6,500",
          pg.locator("#tb-revenue").inner_text().replace(",", "") == "9500"
          and pg.locator("#tb-expense").inner_text().replace(",", "") == "3000"
          and pg.locator("#tb-profit").inner_text().replace(",", "") == "6500")
    paper_text = pg.locator("#tb-paper").inner_text()
    check("Q5 trial balance is presented as a paper document (title, company, period)",
          "合計残高試算表" in paper_text and "会社C" in paper_text
          and "自 2026年4月1日" in paper_text and "至 2027年3月31日" in paper_text
          and "（単位：円）" in paper_text, paper_text[:120])
    cols = pg.locator(".tb-col")
    box1 = cols.nth(0).bounding_box(); box2 = cols.nth(1).bounding_box()
    check("Q6 sheet is A4-landscape style: BS column on the left, PL column on the right",
          box1 is not None and box2 is not None
          and box2["x"] > box1["x"] and abs(box2["y"] - box1["y"]) < 2
          and pg.locator("#tb-fit-btn").count() == 0,
          f"{box1} / {box2}")
    check("Q6b column titles name the two statements",
          pg.locator(".tb-col-title").nth(0).inner_text() == "貸借対照表"
          and pg.locator(".tb-col-title").nth(1).inner_text() == "損益計算書")
    pg.fill("#tb-from", "2026-04-06")
    pg.locator("#tb-from").dispatch_event("change")
    pg.wait_for_timeout(250)
    tb2 = tb_rows()
    check("Q4 trial balance respects the date range",
          "売上高" not in tb2 and tb2.get("現金") == ["", "", "", "3500", "", "3500"], str(tb2))

    # ---- R. Total accounts, opening balances, carry-forward (v19/v20) ----
    pg.fill("#tb-from", "2026-04-01")
    pg.locator("#tb-from").dispatch_event("change")
    pg.wait_for_timeout(250)

    def master_row(name):
        rows = pg.locator("#account-table tbody tr")
        for i in range(rows.count()):
            if rows.nth(i).locator('[data-f="name"]').input_value() == name:
                return rows.nth(i)
        return None

    pg.click("button[data-tab='entry']")
    pg.wait_for_timeout(250)
    entry_names = entry_account_names(pg)
    check("R0 seeded total accounts are not offered in the entry form",
          "流動資産合計" not in entry_names and "現金" in entry_names, str(entry_names))

    pg.click("button[data-tab='trial']")
    pg.wait_for_timeout(250)
    tb3 = tb_rows()
    check("R1 seeded total rows sum their members in place",
          tb3.get("流動資産合計") == ["", "", "10000", "3500", "6500", ""]
          and tb3.get("収益合計") == ["", "", "500", "10000", "", "9500"]
          and tb3.get("費用合計") == ["", "", "3000", "", "3000", ""], str(tb3))
    band_texts = [pg.locator("#tb-body-bs tr.tb-band td, #tb-body-pl tr.tb-band td").nth(i).inner_text()
                  for i in range(pg.locator("#tb-body-bs tr.tb-band td, #tb-body-pl tr.tb-band td").count())]
    check("R1b category bands are shown on the paper",
          band_texts == ["資産", "収益", "費用"], str(band_texts))

    pg.click("button[data-tab='masters']")
    pg.wait_for_timeout(250)
    total_row = master_row("流動資産合計")
    check("R1c masters: 流動資産合計 is seeded as a total account and 現金 belongs to it",
          total_row is not None
          and total_row.locator('[data-f="kind"]').input_value() == "total"
          and master_row("現金").locator('[data-f="totalParentId"]').input_value() == "tot-current-assets")
    check("R1e masters explain that names are seeded and codes start blank",
          "科目名は初期設定されています" in pg.locator("#master-note").inner_text(),
          pg.locator("#master-note").inner_text()[:60])
    pg.fill("#acc-new-name", "現金預金合計")
    pg.locator("#acc-new-kind").select_option("total")
    pg.click("#acc-add")
    pg.wait_for_timeout(250)
    master_row("現金").locator('[data-f="totalParentId"]').select_option(label="現金預金合計")
    pg.wait_for_timeout(300)
    pg.click("button[data-tab='trial']")
    pg.wait_for_timeout(250)
    tb3b = tb_rows()
    check("R1d a user-made total account takes over its members",
          tb3b.get("現金預金合計") == ["", "", "10000", "3500", "6500", ""]
          and "流動資産合計" not in tb3b, str(tb3b))

    def ob_row(name):
        rows = pg.locator("#ob-body tr")
        for i in range(rows.count()):
            if rows.nth(i).locator("td").nth(0).inner_text() == name:
                return rows.nth(i)
        return None

    ob_cash = ob_row("現金")
    ob_cash.locator('[data-side="debit"]').fill("2000")
    ob_cash.locator('[data-side="debit"]').dispatch_event("change")
    pg.wait_for_timeout(300)
    tb4 = tb_rows()
    check("R2 opening balance flows into the closing balance",
          tb4.get("現金") == ["2000", "", "10000", "3500", "8500", ""]
          and tb4.get("現金預金合計") == ["2000", "", "10000", "3500", "8500", ""], str(tb4))
    check("R2b unbalanced opening balances raise a warning",
          "一致していません" in pg.locator("#ob-diff").inner_text(),
          pg.locator("#ob-diff").inner_text())

    pg.click("#tb-carry")
    pg.wait_for_timeout(500)
    check("R3 carry-forward switches to the next-period company",
          pg.locator("#company-period").inner_text() == "2027-04-01 〜 2028-03-31",
          pg.locator("#company-period").inner_text())
    tb5 = tb_rows()
    check("R3b closing balances became the next period's opening balances (profit into 繰越利益剰余金)",
          tb5.get("現金") == ["8500", "", "", "", "8500", ""]
          and tb5.get("繰越利益剰余金") == ["", "6500", "", "", "", "6500"], str(tb5))

    c2026 = pg.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('journalToolStateV1'));
      const c = s.companies.find((x) => x.name === '会社C' && x.periodStart === '2026-04-01');
      return c ? c.id : null;
    }""")
    pg.locator("#company-select").select_option(c2026)
    pg.wait_for_timeout(400)
    pg.click("#tb-carry")
    pg.wait_for_timeout(300)
    check("R4 a second carry-forward to an existing period is refused",
          "既にあります" in pg.locator("#tb-msg").inner_text(),
          pg.locator("#tb-msg").inner_text())

    # ---- S. Smartphone width: the whole A4 sheet fits, scaled down ----
    sp = b.new_page(viewport={"width": 390, "height": 844})
    sp.goto(BASE)
    sp.wait_for_timeout(400)
    sp.evaluate("""() => {
      localStorage.setItem('journalToolStateV1', JSON.stringify({
        version: 2, currentCompanyId: 'c1',
        companies: [{ id: 'c1', name: 'スマホ確認会社', periodStart: '2026-04-01', periodEnd: '2027-03-31',
          accountOverrides: {}, accountAdditions: [], accountDeleted: [],
          taxOverrides: {}, taxAdditions: [], taxDeleted: [],
          journals: [
            { id: 'j1', date: '2026-04-05', voucherNo: 1, debitAccountId: 'acc1', debitTaxId: 'tax-excluded', creditAccountId: 'acc5', creditTaxId: 'tax-sales10', amount: 10000, summary: '売上', exported: {} },
          ], templates: [], lastDate: '2026-04-05', openingBalances: {} }],
      }));
    }""")
    sp.reload()
    sp.wait_for_timeout(400)
    sp.click("button[data-tab='trial']")
    sp.wait_for_timeout(400)
    paper_box = sp.locator("#tb-paper").bounding_box()
    transform = sp.evaluate("() => document.getElementById('tb-paper').style.transform")
    check("S1 on a smartphone-width screen the whole sheet is visible, scaled to fit",
          paper_box is not None and paper_box["width"] <= 392 and paper_box["height"] > 150
          and transform.startswith("scale(0."), f"{paper_box} / {transform}")
    sp_cols = sp.locator(".tb-col")
    sb1 = sp_cols.nth(0).bounding_box(); sb2 = sp_cols.nth(1).bounding_box()
    check("S2 BS and PL stay side by side on the scaled sheet",
          sb1 is not None and sb2 is not None and sb2["x"] > sb1["x"], f"{sb1} / {sb2}")
    check("S3 the scaled sheet still shows both sides' rows",
          sp.locator("#tb-body-bs").inner_text().find("現金") >= 0
          and sp.locator("#tb-body-pl").inner_text().find("売上高") >= 0)
    sp.close()

    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} UI checks passed.")
sys.exit(1 if failed else 0)
