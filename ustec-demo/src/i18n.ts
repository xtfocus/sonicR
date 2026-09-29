/**
 * Bilingual (English / Vietnamese) UI text for the whole web app —
 * `index.html` chart page and `help.html` documentation page.
 *
 * How it works
 * ------------
 * - Static HTML carries the English text plus a `data-i18n="key"`
 *   attribute (and `data-i18n-ph` / `data-i18n-title` for placeholder and
 *   title attributes), so pages render fine even before JS runs.
 * - {@link applyTranslations} swaps every marked node to the active
 *   language; {@link t} serves strings created dynamically in TypeScript.
 * - Language resolution order: `?lang=` URL param → localStorage →
 *   browser language → English. Changing it dispatches `langchange` on
 *   `window`, which `main.ts` / `help-main.ts` use to refresh dynamic
 *   text and rebuild generated sections.
 *
 * Missing keys fall back to English, then to the key itself — a stale
 * dictionary degrades to English, never to a blank UI.
 */

export type Lang = 'en' | 'vi';

export const LANGS: Lang[] = ['en', 'vi'];

const STORAGE_KEY = 'ustec-lang';

type Dictionary = Record<string, string>;

const en: Dictionary = {
  'help.intro':
    'Candlestick chart of USTEC (Nasdaq 100) minute data with replay, Sonic R tooling and a programmatic range-query API.',
  // ---- chart page (index.html) ----
  'app.title': 'USTEC M1 – Lightweight Charts',
  'help.chart.li1': 'Candlesticks rendered with',
  'app.help': 'Help',
  'replay.enter': 'Enter Replay',
  'replay.exit': 'Exit Replay',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.step': 'Step',
  'replay.speed': 'Speed:',
  'replay.jump': 'Jump time (UTC):',
  'select.range': 'Select Range',
  'select.selecting': 'Selecting…',
  'app.capture': 'Capture PNG',
  'report.title': 'USTEC Analysis Report',
  'report.generated': 'generated from analysis artifacts',
  'report.summary': 'Summary',
  'report.summaryPlaceholder': '(Assembled by the analysis pipeline: bias verdict → structure → zones → signals. Replace this text and add figures below.)',
  'report.charts': 'Charts',
  'indicators.waves': 'Show waves/legs',
  'indicators.orderBlocks': 'Order blocks (LuxAlgo OB)',
  'indicators.nyMacro': 'NY Macro Times',
  'app.lang': 'Language',

  // ---- help page shell ----
  'help.title': 'Help – USTEC M1 Demo',
  'help.heading': 'USTEC M1 Demo — Help',
  'help.back': '← back to the chart',
  'nav.chart': 'Chart',
  'nav.navigation': 'Navigation',
  'nav.replay': 'Replay',
  'nav.indicators': 'Indicators',
  'nav.selectRange': 'Select Range',
  'nav.api': 'window.ustec API',
  'nav.functions': 'Analysis functions',
  'nav.charts': 'Charts & reports',
  'nav.terminal': 'Terminal',
  'nav.data': 'Data',

  // ---- help: chart ----
  'help.chart.h': 'Chart & timeframes',
  'help.chart.li2.pre': 'Timeframe selector:',
  'help.chart.li2.post':
    '. Higher timeframes are resampled from the 1-minute source; buckets with no underlying candle are skipped.',

  // ---- help: navigation ----
  'help.navigation.h': 'Navigation',
  'help.navigation.li1': 'Mouse wheel: zoom the time axis. Drag: scroll the chart.',
  'help.navigation.li2':
    'Hold Space + left-drag: pan the visible window (chart cursor changes; other tools stand down while panning).',

  // ---- help: replay ----
  'help.replay.h': 'Bar replay',
  'help.replay.li1':
    'Enter Replay truncates the chart at the replay cursor and shows a trailing window (~1200 bars).',
  'help.replay.li2':
    'Controls: Play/Pause, Step, speed (1x–10x), position slider, and jump-to-time (DD/MM/YYYY HH:MM, UTC).',
  'help.replay.li3':
    'Everything is WYSIWYG in replay: indicators, session boxes and exports/API see only bars up to the cursor — the replayed future never leaks.',

  // ---- help: indicators ----
  'help.indicators.h': 'Indicators & overlays',
  'help.indicators.li1':
    'Sonic R — EMA structure with wave/leg patterns and entries; toggle Show waves/legs for details.',
  'help.indicators.li2': 'Order blocks — LuxAlgo-style bullish/bearish order blocks.',
  'help.indicators.li3': 'NY Macro Times — macro-time boxes for New York sessions.',
  'help.indicators.li4': 'Asia / London / New York session boxes are drawn automatically.',

  // ---- help: select range ----
  'help.select.h': 'Select Range tool',
  'help.select.step1': 'Click Select Range — the cursor becomes a crosshair.',
  'help.select.step2':
    'Press and drag left→right (either direction works); both edges snap to the nearest bar.',
  'help.select.step3':
    'On release a popup offers Export CSV (auto-named download), Copy Markdown (table to clipboard) and Clear.',
  'help.select.p':
    'Escape cancels an in-flight drag or clears the selection (the tool stays armed). The selection persists across timeframe switches — edges re-snap to bars of the active timeframe, and exports always contain the active timeframe’s bars. See DATA_EXPORT.md for the CSV/filename conventions.',

  // ---- help: API ----
  'help.api.h': 'Programmatic API — window.ustec',
  'help.api.p':
    'Query bars for a time range from the console or scripts. The API returns exactly what the Select Range tool would export for the same bounds (replay-aware, inclusive edges).',
  'help.api.methods': 'Methods',
  'help.api.methods.method': 'Method',
  'help.api.methods.returns': 'Returns',
  'help.api.methods.desc': 'Description',
  'help.api.m1.d': 'Bars with time in [start, end] (inclusive; swapped if reversed).',
  'help.api.m2.d': 'Re-queries the current on-chart selection; null when none.',
  'help.api.m3.d': 'CSV identical to the Export CSV payload.',
  'help.api.m4.d': 'Parses a time argument to UTC seconds.',
  'help.api.m5.d': 'Available timeframes as { label, seconds }.',
  'help.api.opts': 'Options (opts)',
  'help.api.opts.option': 'Option',
  'help.api.opts.type': 'Type',
  'help.api.opts.default': 'Default',
  'help.api.opts.meaning': 'Meaning',
  'help.api.opts.tf.d': "'5m', '1H', 300, … (case-insensitive)",
  'help.api.opts.tf.def': 'active chart timeframe',
  'help.api.opts.limit.d': 'Max rows returned, taken from the start of the range. Invalid values throw.',
  'help.api.opts.limit.def': 'unlimited',
  'help.api.result': 'Result shape',
  'help.api.result.field': 'Field',
  'help.api.result.meaning': 'Meaning',
  'help.api.r1': 'What was queried.',
  'help.api.r2': 'Normalized bounds, UTC seconds (lo before hi).',
  'help.api.r3':
    'First/last returned bar, YYYY-MM-DD HH:MM:SS UTC; reflect any limit truncation; null when empty.',
  'help.api.r4':
    'Row count and the bars: { time, open, high, low, close, volume } (tick volume), ascending.',
  'help.api.r5': 'Full extent of the queried (effective) dataset, UTC seconds.',
  'help.api.time': 'Time formats',
  'help.api.tf1': 'UTC epoch seconds: 1756724400',
  'help.api.tf2':
    "CSV convention (UTC): '2025-09-01 09:30', '2025-09-01 09:30:45' (space or T separator)",
  'help.api.tf3': "Date-only (UTC midnight): '2025-09-01'",
  'help.api.tf4': "ISO 8601 with timezone: '2025-09-01T09:30:00Z', '2025-09-01T11:30:00+02:00'",
  'help.api.tf.note':
    'Other ISO forms without a timezone are rejected — they would silently parse as local time. Unknown timeframes and invalid times throw with the accepted formats in the message.',
  'help.api.examples': 'Examples',
  'help.terminal.h': 'From the terminal — HTTP API & CLI',
  'help.terminal.p':
    'The same query core runs outside the browser (from ustec-demo/). Server-side there is no replay cursor: queries always see the full dataset. Default timeframe when omitted is 5m.',
  'help.terminal.note':
    'HTTP errors return 400 with { error }; unknown paths 404. CSV responses carry the UI’s export filename in Content-Disposition.',

  // ---- help: analysis functions (intro; the catalogue is generated) ----
  'help.functions.h': 'Analysis functions',
  'help.functions.p1':
    'A library of pure, point-in-time-safe functions over the OHLCV series — the Sonic R workflow as callable building blocks: swing structure (pivots/zigzag, BOS/CHoCH), zones (FVG, order blocks, supply/demand, liquidity) and composite entry signals with entry/stop/targets.',
  'help.functions.p2':
    'Every function runs from the CLI (npm run analyze) and the HTTP API (GET /api/analyze), so notebooks and AI agents can call them directly. GET /api/functions returns the same catalogue below as JSON.',
  'help.functions.param': 'Parameter',
  'help.functions.type': 'Type',
  'help.functions.default': 'Default',
  'help.functions.description': 'Description',
  'help.functions.needsLtf': 'also accepts ltfTimeframe (trigger series)',

  // ---- help: charts & reports ----
  'help.charts.h': 'Charts & reports',
  'help.charts.p1':
    'Every analysis function has a chart twin: server-rendered PNGs with a sidecar manifest, saved under reports/<session>/ for LLM report assembly.',
  'help.charts.p2':
    'Chart types: structure (zigzag + BOS/CHoCH), zones-merged (lifecycle-styled zones), liquidity, signal (entry/stop/target bracket + R:R), plus pois, equilibrium, bias-timeline, mtf-stack. The Capture PNG button on the chart page snapshots the live WYSIWYG view. See VISUALIZATION.md for the full spec, annotation grammar and the LLM assembly contract.',

  // ---- help: data ----
  'help.data.h': 'Data & conventions',
  'help.data.li1':
    'Source: MT5 tab-separated export USTEC_M1_202508010000_202603031408.csv (2025-08-01 → 2026-03-03, ~205k 1m candles).',
  'help.data.li2': 'All timestamps are UTC; volume is tick volume (TICKVOL), summed when resampled.',
  'help.data.li3':
    'CSV header: time,open,high,low,close,tickvol; export filenames follow <SYMBOL>_<TIMEFRAME>_<START>_<END>.csv with compact UTC stamps.',
};
const vi: Dictionary = {
  'help.intro':
    'Biểu đồ nến USTEC (Nasdaq 100) theo phút với replay, bộ công cụ Sonic R và API truy vấn khoảng tự lập trình.',
  'app.title': 'USTEC M1 – Lightweight Charts',
  'app.timeframe': 'Khung thời gian:',
  'app.help': 'Trợ giúp',
  'replay.enter': 'Vào chế độ Replay',
  'replay.exit': 'Thoát Replay',
  'replay.play': 'Chạy',
  'replay.pause': 'Tạm dừng',
  'replay.step': 'Từng nến',
  'replay.speed': 'Tốc độ:',
  'replay.jump': 'Nhảy tới (UTC):',
  'select.range': 'Chọn vùng',
  'select.selecting': 'Đang chọn…',
  'app.capture': 'Chụp PNG',
  'report.title': 'Báo cáo phân tích USTEC',
  'report.generated': 'được tạo từ các artifact phân tích',
  'report.summary': 'Tóm tắt',
  'report.summaryPlaceholder': '(Được lắp ráp bởi pipeline phân tích: phán quyết bias → cấu trúc → vùng → tín hiệu. Thay văn bản này và thêm các hình bên dưới.)',
  'report.charts': 'Biểu đồ',
  'indicators.waves': 'Hiện các chân sóng',
  'indicators.orderBlocks': 'Order blocks (LuxAlgo OB)',
  'indicators.nyMacro': 'Khung giờ Macro NY',
  'app.lang': 'Ngôn ngữ',

  // ---- khung trang trợ giúp ----
  'help.title': 'Trợ giúp – USTEC M1 Demo',
  'help.heading': 'USTEC M1 Demo — Trợ giúp',
  'help.back': '← quay lại biểu đồ',
  'nav.chart': 'Biểu đồ',
  'nav.navigation': 'Điều hướng',
  'nav.replay': 'Replay',
  'nav.indicators': 'Chỉ báo',
  'nav.selectRange': 'Chọn vùng',
  'nav.api': 'API window.ustec',
  'nav.functions': 'Hàm phân tích',
  'nav.charts': 'Biểu đồ & báo cáo',
  'nav.terminal': 'Terminal',
  'nav.data': 'Dữ liệu',

  // ---- trợ giúp: biểu đồ ----
  'help.chart.h': 'Biểu đồ & khung thời gian',
  'help.chart.li1': 'Nến được vẽ bằng',
  'help.chart.li2.pre': 'Bộ chọn khung thời gian:',
  'help.chart.li2.post':
    '. Khung cao hơn được resample từ dữ liệu 1 phút; các bucket không có nến sẽ bị bỏ qua.',

  // ---- trợ giúp: điều hướng ----
  'help.navigation.h': 'Điều hướng',
  'help.navigation.li1': 'Lăn chuột: thu phóng trục thời gian. Kéo: cuộn biểu đồ.',
  'help.navigation.li2':
    'Giữ Space + kéo chuột trái: panning vùng nhìn (con trỏ đổi hình; các công cụ khác tạm nhường trong khi panning).',

  // ---- trợ giúp: replay ----
  'help.replay.h': 'Replay theo nến',
  'help.replay.li1':
    'Vào chế độ Replay cắt biểu đồ tại con trỏ replay và hiển thị cửa sổ trailing (~1200 nến).',
  'help.replay.li2':
    'Điều khiển: Chạy/Tạm dừng, Từng nến, tốc độ (1x–10x), thanh trượt vị trí và nhảy tới thời điểm (DD/MM/YYYY HH:MM, UTC).',
  'help.replay.li3':
    'Mọi thứ trong replay đều WYSIWYG: chỉ báo, hộp phiên và xuất dữ liệu/API chỉ thấy các nến tới con trỏ — tương lai đã replay không bao giờ rò rỉ.',

  // ---- trợ giúp: chỉ báo ----
  'help.indicators.h': 'Chỉ báo & lớp phủ',
  'help.indicators.li1':
    'Sonic R — cấu trúc EMA với các mẫu chân sóng và điểm vào; bật Hiện các chân sóng để xem chi tiết.',
  'help.indicators.li2': 'Order blocks — khối lệnh tăng/giảm kiểu LuxAlgo.',
  'help.indicators.li3': 'Khung giờ Macro NY — hộp thời điểm macro phiên New York.',
  'help.indicators.li4': 'Hộp phiên Á / London / New York được vẽ tự động.',

  // ---- trợ giúp: chọn vùng ----
  'help.select.h': 'Công cụ Chọn vùng',
  'help.select.step1': 'Nhấn Chọn vùng — con trỏ thành hình chữ thập.',
  'help.select.step2': 'Nhấn và kéo trái→phải (hoặc ngược lại); hai mép bám vào nến gần nhất.',
  'help.select.step3':
    'Khi thả chuột, popup hiện Xuất CSV (tải về tự đặt tên), Copy Markdown (bảng vào clipboard) và Xóa.',
  'help.select.p':
    'Escape hủy thao tác kéo đang diễn ra hoặc xóa vùng chọn (công cụ vẫn bật). Vùng chọn giữ nguyên khi đổi khung thời gian — mép bám lại nến của khung đang bật, và bản xuất luôn chứa nến của khung hiện tại. Xem DATA_EXPORT.md về quy ước CSV/tên file.',

  // ---- trợ giúp: API ----
  'help.api.h': 'API lập trình — window.ustec',
  'help.api.p':
    'Truy vấn nến theo khoảng thời gian từ console hoặc script. API trả về đúng những gì công cụ Chọn vùng sẽ xuất cho cùng biên (nhận thức replay, mép bao trùm).',
  'help.api.methods': 'Phương thức',
  'help.api.methods.method': 'Phương thức',
  'help.api.methods.returns': 'Trả về',
  'help.api.methods.desc': 'Mô tả',
  'help.api.m1.d': 'Các nến có thời gian trong [start, end] (bao trùm; hoán đổi nếu đảo ngược).',
  'help.api.m2.d': 'Truy vấn lại vùng đang chọn trên biểu đồ; null nếu không có.',
  'help.api.m3.d': 'CSV giống hệt payload của nút Xuất CSV.',
  'help.api.m4.d': 'Phân tích đối số thời gian thành giây UTC.',
  'help.api.m5.d': 'Các khung thời gian khả dụng dạng { label, seconds }.',
  'help.api.opts': 'Tùy chọn (opts)',
  'help.api.opts.option': 'Tùy chọn',
  'help.api.opts.type': 'Kiểu',
  'help.api.opts.default': 'Mặc định',
  'help.api.opts.meaning': 'Ý nghĩa',
  'help.api.opts.tf.d': "'5m', '1H', 300, … (không phân biệt hoa thường)",
  'help.api.opts.tf.def': 'khung thời gian đang bật trên biểu đồ',
  'help.api.opts.limit.d': 'Số dòng tối đa trả về, tính từ đầu khoảng. Giá trị sai sẽ throw.',
  'help.api.opts.limit.def': 'không giới hạn',
  'help.api.result': 'Cấu trúc kết quả',
  'help.api.result.field': 'Trường',
  'help.api.result.meaning': 'Ý nghĩa',
  'help.api.r1': 'Những gì đã truy vấn.',
  'help.api.r2': 'Biên đã chuẩn hóa, giây UTC (lo trước hi).',
  'help.api.r3':
    'Nến đầu/cuối trả về, YYYY-MM-DD HH:MM:SS UTC; phản ánh giới hạn limit nếu có; null khi rỗng.',
  'help.api.r4': 'Số dòng và các nến: { time, open, high, low, close, volume } (tick volume), tăng dần.',
  'help.api.r5': 'Toàn bộ phạm vi của dataset (hiệu dụng) đã truy vấn, giây UTC.',
  'help.api.time': 'Định dạng thời gian',
  'help.api.tf1': 'Giây epoch UTC: 1756724400',
  'help.api.tf2':
    "Quy ước CSV (UTC): '2025-09-01 09:30', '2025-09-01 09:30:45' (dấu cách hoặc T)",
  'help.api.tf3': "Chỉ ngày (nửa đêm UTC): '2025-09-01'",
  'help.api.tf4': "ISO 8601 kèm múi giờ: '2025-09-01T09:30:00Z', '2025-09-01T11:30:00+02:00'",
  'help.api.tf.note':
    'Các dạng ISO khác không có múi giờ sẽ bị từ chối — chúng sẽ ngầm parse theo giờ máy. Khung thời gian không rõ và thời gian sai sẽ throw kèm các định dạng được chấp nhận trong thông báo.',
  'help.api.examples': 'Ví dụ',
  'help.terminal.h': 'Từ terminal — HTTP API & CLI',
  'help.terminal.p':
    'Cùng lõi truy vấn chạy ngoài trình duyệt (từ ustec-demo/). Phía server không có con trỏ replay: truy vấn luôn thấy toàn bộ dataset. Khung mặc định khi bỏ trống là 5m.',
  'help.terminal.note':
    'Lỗi HTTP trả về 400 với { error }; đường dẫn lạ 404. Phản hồi CSV mang tên file xuất của UI trong Content-Disposition.',

  // ---- trợ giúp: hàm phân tích ----
  'help.functions.h': 'Hàm phân tích',
  'help.functions.p1':
    'Thư viện hàm thuần, an toàn theo thời gian (point-in-time) trên chuỗi OHLCV — quy trình Sonic R dưới dạng các khối xây dựng gọi được: cấu trúc swing (pivots/zigzag, BOS/CHoCH), các vùng (FVG, order block, cung/cầu, thanh khoản) và tín hiệu vào lệnh tổng hợp kèm entry/stop/targets.',
  'help.functions.p2':
    'Mỗi hàm chạy được từ CLI (npm run analyze) và HTTP API (GET /api/analyze), nên notebook và AI agent có thể gọi trực tiếp. GET /api/functions trả về đúng catalogue dưới dạng JSON.',
  'help.functions.param': 'Tham số',
  'help.functions.type': 'Kiểu',
  'help.functions.default': 'Mặc định',
  'help.functions.description': 'Mô tả',
  'help.functions.needsLtf': 'chấp nhận thêm ltfTimeframe (chuỗi khung trigger)',

  // ---- trợ giúp: biểu đồ & báo cáo ----
  'help.charts.h': 'Biểu đồ & báo cáo',
  'help.charts.p1':
    'Mỗi hàm phân tích đều có bản biểu đồ: PNG được render phía server kèm sidecar manifest, lưu dưới reports/<session>/ để LLM lắp ráp báo cáo.',
  'help.charts.p2':
    'Các loại biểu đồ: structure (zigzag + BOS/CHoCH), zones-merged (vùng theo trạng thái), liquidity, signal (khung entry/stop/target + R:R), cùng pois, equilibrium, bias-timeline, mtf-stack. Nút Chụp PNG trên trang biểu đồ chụp nhanh khung nhìn WYSIWYG hiện tại. Xem VISUALIZATION.md về spec đầy đủ, cú pháp annotation và hợp đồng lắp ráp cho LLM.',

  // ---- trợ giúp: dữ liệu ----
  'help.data.h': 'Dữ liệu & quy ước',
  'help.data.li1':
    'Nguồn: bản export MT5 tab USTEC_M1_202508010000_202603031408.csv (2025-08-01 → 2026-03-03, ~205k nến 1 phút).',
  'help.data.li2': 'Mọi timestamp là UTC; volume là tick volume (TICKVOL), cộng dồn khi resample.',
  'help.data.li3':
    'Header CSV: time,open,high,low,close,tickvol; tên file xuất theo <SYMBOL>_<TIMEFRAME>_<START>_<END>.csv với timestamp UTC gọn.',
};

const dictionaries: Record<Lang, Dictionary> = { en, vi };

/** Resolve the initial language: ?lang= → localStorage → browser → en. */
export function resolveInitialLang(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'vi') return fromUrl;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'vi') return stored;
  } catch {
    // localStorage unavailable (private mode) — fall through.
  }
  return navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

let currentLang: Lang = resolveInitialLang();

/** The active UI language. */
export function getLang(): Lang {
  return currentLang;
}

/**
 * Switch the active language: persists it, syncs `<html lang>` and the
 * document title, re-translates marked nodes and dispatches
 * `langchange` on `window` for dynamic-content owners.
 */
export function setLang(lang: Lang): void {
  if (!LANGS.includes(lang) || lang === currentLang) return;
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Persistence is best-effort.
  }
  // Marked nodes — including <title data-i18n> — re-translate here; pages
  // set their own title key, so no manual assignment is needed.
  applyTranslations();
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

/** Translate a key; falls back to English, then to the key itself. */
export function t(key: string): string {
  return dictionaries[currentLang][key] ?? en[key] ?? key;
}

/**
 * Apply translations to all marked nodes under `root` (default: the whole
 * document). `data-i18n` sets textContent, `data-i18n-ph` the placeholder
 * attribute, `data-i18n-title` the title attribute.
 */
export function applyTranslations(root: ParentNode = document): void {
  document.documentElement.lang = currentLang;
  // [data-i18n] covers regular elements and <title>; static pages carry
  // English as the pre-JS default.
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key != null) el.textContent = t(key);
  }
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) {
    const key = el.getAttribute('data-i18n-ph');
    if (key != null) el.placeholder = t(key);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.getAttribute('data-i18n-title');
    if (key != null) el.title = t(key);
  }
}

/**
 * Wire a `<select>` (options `en`/`vi`) as the language toggle and apply
 * the initial translation once. Returns an unsubscribe function.
 */
export function initLangSelect(select: HTMLSelectElement): () => void {
  select.value = currentLang;
  const onChange = () => {
    if (select.value === 'en' || select.value === 'vi') setLang(select.value);
  };
  select.addEventListener('change', onChange);
  document.documentElement.lang = currentLang;
  applyTranslations();
  return () => select.removeEventListener('change', onChange);
}
