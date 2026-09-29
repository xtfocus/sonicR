/**
 * Cases page bootstrap: lists analysis cases from the API server and
 * links to each report. The API base defaults to the local serve-api
 * port; override with `?api=http://host:port` (the server sends permissive
 * CORS, so a separate vite dev server can call it).
 */

import { getLang, initLangSelect, t } from './i18n';

/** `?api=` override, else the standard serve-api port. */
const API_BASE = new URLSearchParams(window.location.search).get('api') ?? 'http://localhost:5200';

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

async function loadCases(): Promise<void> {
  const status = document.getElementById('status')!;
  const tbody = document.querySelector('#cases-table tbody')!;
  const apiBase = document.getElementById('api-base')!;
  apiBase.textContent = `api: ${API_BASE}`;
  status.textContent = '';
  tbody.textContent = '';

  let data: { cases: Array<{ caseId: string; charts: unknown[]; bars: Array<{ timeframe: string; rows: number }>; createdAt: string }> };
  try {
    const res = await fetch(`${API_BASE}/api/artifacts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as typeof data;
  } catch (err) {
    status.className = 'error';
    status.textContent =
      getLang() === 'vi'
        ? `Không thể kết nối API tại ${API_BASE}. Chạy: npm run serve-api (hoặc mở bằng ?api=<url>). ${err instanceof Error ? err.message : ''}`
        : `Cannot reach the API at ${API_BASE}. Start it with: npm run serve-api (or open this page with ?api=<url>). ${err instanceof Error ? err.message : ''}`;
    return;
  }

  if (data.cases.length === 0) {
    status.className = 'muted';
    status.textContent = t('cases.empty');
    return;
  }

  for (const c of data.cases) {
    const tr = document.createElement('tr');

    const tdCase = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = c.caseId;
    tdCase.appendChild(code);
    tr.appendChild(tdCase);

    const tdCharts = document.createElement('td');
    tdCharts.textContent = String(c.charts.length);
    tr.appendChild(tdCharts);

    const tdBars = document.createElement('td');
    tdBars.textContent = c.bars.map((b) => `${b.timeframe} (${b.rows})`).join(', ') || '—';
    tr.appendChild(tdBars);

    const tdCreated = document.createElement('td');
    tdCreated.textContent = iso(Date.parse(c.createdAt) / 1000) || c.createdAt;
    tr.appendChild(tdCreated);

    const tdReport = document.createElement('td');
    const link = document.createElement('a');
    link.href = `${API_BASE}/cases/${encodeURIComponent(c.caseId)}/report/index.html`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = t('cases.open');
    tdReport.appendChild(link);
    tr.appendChild(tdReport);

    tbody.appendChild(tr);
  }
}

const langSelect = document.getElementById('lang-select') as HTMLSelectElement | null;
if (langSelect) initLangSelect(langSelect);

const refresh = document.getElementById('refresh');
if (refresh) refresh.addEventListener('click', loadCases);

loadCases().catch(console.error);