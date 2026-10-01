# LibreLink-ready

在現場幫客戶（尤其是不熟 3C 的長輩）確認手機能不能用 FreeStyle LibreLink。

資料來源：Abbott〈Mobile Device & OS Compatibility〉ART39109-001（目前為 Rev. BP，09/26）。
**判讀結果一律以官方最新清單為準。**

## 資料檔

| 檔案 | 內容 |
|---|---|
| `data/compatibility.json` | 從 PDF 英文版解析出的相容清單：iPhone 機型、iOS 版本、Android 品牌／機型、Android 版本（含 `*`、`†` 註記）、App 版本、註腳原文 |
| `data/android-models.json` | Android 型號代碼 → 產品名稱。`listed: true` 代表在清單上；`listed: false` 是台灣常見品牌的其他機型，只用來顯示名稱 |
| `data/raw/` | 原始 PDF 與 Google Play 機型表（不進版控，`scripts/update.sh` 會重新下載） |

## 檢測網頁（`web/`）

純靜態網頁，沒有後端，也不收集資料。三個分頁：
- **檢測這支手機**：打開就自動判讀，用紅綠燈大字顯示結果。Android + Chrome 另有「檢查 NFC」按鈕。
- **查詢型號**：輸入名稱或型號代碼（例如 `S23 Ultra`、`A79`、`SM-A156E`），給業務事前查詢用。
- **QR Code**：業務手機出示，讓客戶掃描開啟。

| 檔案 | 用途 |
|---|---|
| `web/check.js` | 偵測與判讀邏輯（純函式，不碰 DOM） |
| `web/app.js` | 畫面 |
| `web/data/` | 由 `scripts/update.sh` 從 `data/` 複製過來 |
| `web/vendor/qrcode.min.js` | QR Code 產生器（qrcode-generator 1.4.4，MIT） |

本機預覽：

```bash
python3 -m http.server 8123 --directory web
```

**模擬其他手機**：在網址加上參數，例如
`/?ua=Mozilla/5.0 (Linux; Android 10; K)&model=SM-S931B&pv=16.0.0`
（`ua` 是 user agent，`model` / `pv` 是 Android 型號與版本）。

**正式使用要放在 HTTPS 網址上**（GitHub Pages、Cloudflare Pages 等）。Android 讀取型號（Client Hints）和 Web NFC 都只在 HTTPS 下才能用。

測試：

```bash
node --test tests/*.test.mjs
```

## 每季更新

Abbott 發布新版 PDF 後：

```bash
scripts/update.sh <新版 PDF 網址>
```

會依序下載 PDF 與 Google Play 機型表、解析、重建兩個 JSON，最後列出「這次新增／移除了什麼」。
如果 PDF 版面改了，parser 會直接報錯停下來，不會悄悄產生錯誤的清單。看到報錯再來調整 `scripts/parse_compat.py`。

## 判讀規則（給檢測網頁用）

**iPhone**
- 網頁讀不到 iPhone 的型號，但 iOS 16 起只支援 iPhone 8 以後的機型，這些都在清單上
  → **iOS ≥ 16 就不必再問型號**，只要看 iOS 版本。
- iOS 15.x 可能是 6s／7 等不支援的舊機，需要請客戶到「設定 → 一般 → 關於本機」確認型號。
- 清單只列出特定的 iOS 版本（例如沒有 16.2～16.6），不在清單上的版本 → 建議更新到最新版。

**Android**
- Chrome／Samsung 瀏覽器可以透過 `navigator.userAgentData` 讀到型號代碼（如 `SM-A156E`）和 Android 版本。
- Android 8～10 有 `*` 註記：提醒客戶確認原廠是否仍提供支援。
- Samsung + Android 16（`†`）：安全性修補程式要在 2025 年 12 月以後。網頁讀不到，需要請客戶到「設定 → 關於手機 → 軟體資訊」查看。

## 已知限制
- 清單裡的「Galaxy A7」沒有標年份，目前對應到 Play 機型表裡名稱剛好叫「Galaxy A7」的型號（2015 款與日本版 SM-A750C）。國際版 A7 (2018) 不會被判定為在清單上。
- 「Galaxy S21 5G Olympic Games Edition」在 Play 機型表裡沒有獨立的條目，它和 docomo 的 Galaxy S21 5G（SC-51B）共用型號代碼。
