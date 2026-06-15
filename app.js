/* ═══════════════════════════════════════════════════════════════════════════
   app.js — Dashboard Mercado Livre
   ═══════════════════════════════════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID       = '1OU-wXa3pfMTzPzRCdCtc3Jhzk08zpI_E';
const GID_DASHBOARD  = '199181687';
const GID_ESTOQUE    = '620201163';
const CSV_URL        = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_DASHBOARD}`;
const CSV_ESTOQUE    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_ESTOQUE}`;

// ── PAGE TITLES ───────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  visao:    'Visão Geral',
  mensal:   'Vendas Mensais',
  metas:    'Metas',
  margem:   'Análise de Margem',
  quinzena: 'Primeira vs Segunda Quinzena',
  estoque:  'Estoque Antigo · Vendas com Prejuízo',
};

// ── STATE ─────────────────────────────────────────────────────────────────────
let dados      = [];
let metas      = [];
let quinzenas  = [];
let estoqueAntigo = [];
const charts   = {};
let anoFiltro  = 'todos'; // 'todos' | 2025 | 2026

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function showPage(id) {
  // pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');

  // nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${id}"]`);
  if (navItem) navItem.classList.add('active');

  // topbar title
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[id] || id;
}

// Wire up sidebar clicks
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.getAttribute('data-page');
      if (page) showPage(page);
    });
  });

  // Filtro de ano
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.getAttribute('data-year');
      anoFiltro = val === 'todos' ? 'todos' : parseInt(val);
      buildDashboard();
    });
  });

  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) syncBtn.addEventListener('click', loadData);

  loadData();
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmtR(v)  { return v == null || isNaN(v) ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'); }
function fmtRk(v) { return v == null || isNaN(v) ? '—' : 'R$ ' + (v / 1000).toFixed(0) + 'k'; }
function fmtM(v)  { return v == null || isNaN(v) ? '—' : (v * 100).toFixed(1) + '%'; }
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function parseNum(s) {
  if (!s || s === '' || s.startsWith('#')) return null;
  const clean = String(s)
    .replace(/R\$\s*/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/\s/g, '')
    .trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function parsePct(s) {
  if (!s || s === '' || s.startsWith('#')) return null;
  const clean = String(s).replace('%', '').replace(',', '.').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n / 100;
}

// ── LOAD DATA ─────────────────────────────────────────────────────────────────
async function loadData() {
  const loadingEl  = document.getElementById('loadingState');
  const dashEl     = document.getElementById('dashContent');
  const statusDot  = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const syncTime   = document.getElementById('syncTime');

  loadingEl.style.display  = 'flex';
  dashEl.style.display     = 'none';
  statusText.textContent   = 'Atualizando...';
  statusDot.style.background = '#f59e0b';
  statusDot.style.boxShadow  = '0 0 6px #f59e0b';

  try {
    const [resp, respEA] = await Promise.all([
      fetch(CSV_URL     + '&cachebust=' + Date.now()),
      fetch(CSV_ESTOQUE + '&cachebust=' + Date.now())
    ]);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text   = await resp.text();
    const textEA = respEA.ok ? await respEA.text() : '';

    processCSV(text);
    if (textEA) processEstoqueCSV(textEA);
    buildDashboard();

    loadingEl.style.display    = 'none';
    dashEl.style.display       = 'block';
    statusText.textContent     = 'Online · Atualizado';
    statusDot.style.background = '#22c55e';
    statusDot.style.boxShadow  = '0 0 6px #22c55e';
    syncTime.textContent       = 'Última sync: ' + new Date().toLocaleTimeString('pt-BR');

  } catch (err) {
    loadingEl.innerHTML = `
      <div class="error-box">
        ❌ Erro ao carregar dados: ${err.message}<br>
        <small style="opacity:.7">Verifique se a planilha está pública (qualquer pessoa com o link pode ver).</small>
      </div>
      <button class="sync-btn" onclick="loadData()" style="margin-top:12px;max-width:180px">↻ Tentar novamente</button>`;
    statusText.textContent     = 'Erro de conexão';
    statusDot.style.background = '#ef4444';
    statusDot.style.boxShadow  = '0 0 6px #ef4444';
  }
}

// ── PARSE CSV ─────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const cells = [];
  let inside = false, cell = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inside = !inside; }
    else if (line[i] === ',' && !inside) { cells.push(cell.trim()); cell = ''; }
    else { cell += line[i]; }
  }
  cells.push(cell.trim());
  return cells;
}

function processCSV(text) {
  dados = []; metas = []; quinzenas = [];
  const lines = text.split('\n').map(parseCSVLine);
  const monthNames = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const metaMeses  = ['ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ','JAN','FEV','MAR'];

  let currentYear = null;

  for (let i = 0; i < lines.length; i++) {
    const r   = lines[i];
    const colB = (r[1] || '').trim();
    const colC = (r[2] || '').trim();
    const isMonth = s => monthNames.includes((s || '').toLowerCase());

    if (colB === '2025' || colB === '2026') currentYear = parseInt(colB);

    if (isMonth(colC) || isMonth(colB)) {
      const mes    = isMonth(colC) ? colC : colB;
      const custos = parseNum(r[3]);
      const vendas = parseNum(r[4]);
      const qtd    = parseNum(r[5]);
      const ticket = parseNum(r[6]);
      const res    = parseNum(r[7]);
      const margem = parsePct(r[8]);
      if (vendas != null && currentYear) {
        dados.push({ ano: currentYear, mes, v: vendas, c: custos || 0, r: res || 0, q: qtd || 0, tm: ticket || 0, m: margem || 0 });
      }
    }

    if (metaMeses.includes(colB.toUpperCase())) {
      const meta    = parseNum(r[2]);
      const vendido = parseNum(r[4]);
      const q1      = parseNum(r[7]);
      const q2      = parseNum(r[8]);
      const pct     = parsePct(r[9]);
      if (meta != null) {
        metas.push({ mes: colB.toUpperCase(), meta, vendido, pct });
        if (q1 != null && q2 != null) {
          quinzenas.push({ mes: colB.toUpperCase(), q1, q2, total: (q1 || 0) + (q2 || 0) });
        }
      }
    }
  }

  // Fallback: se CSV não carregou dados (planilha privada ou formato diferente), usa dados embutidos
  if (!dados.length) useFallbackData();
}

function useFallbackData() {
  dados = [
    {ano:2025,mes:'Abril',  v:40581,     c:20543,    r:20038,    q:20, tm:2029,  m:0.494},
    {ano:2025,mes:'Maio',   v:138192.93, c:65756.14, r:72436.79, q:56, tm:2467,  m:0.524},
    {ano:2025,mes:'Junho',  v:165861.83, c:82290.47, r:83571.36, q:75, tm:2211,  m:0.504},
    {ano:2025,mes:'Julho',  v:145599.56, c:98082.4,  r:47517.16, q:54, tm:2696,  m:0.326},
    {ano:2025,mes:'Agosto', v:171394.08, c:92348.15, r:79045.93, q:77, tm:2226,  m:0.461},
    {ano:2025,mes:'Set',    v:119323.53, c:73802.36, r:45521.17, q:53, tm:2251,  m:0.381},
    {ano:2025,mes:'Out',    v:137689.28, c:84024.53, r:53664.75, q:49, tm:2810,  m:0.390},
    {ano:2025,mes:'Nov',    v:125959.55, c:82842.07, r:43117.48, q:52, tm:2422,  m:0.342},
    {ano:2025,mes:'Dez',    v:89027.8,   c:58431,    r:30596.8,  q:41, tm:2171,  m:0.344},
    {ano:2026,mes:'Jan',    v:97495.56,  c:70335.55, r:27160.01, q:44, tm:2216,  m:0.279},
    {ano:2026,mes:'Fev',    v:41017.09,  c:30409.66, r:10607.43, q:18, tm:2413,  m:0.259},
    {ano:2026,mes:'Março',  v:196385.82, c:125630.89,r:70754.93, q:99, tm:1983,  m:0.360},
    {ano:2026,mes:'Abril',  v:113066.23, c:67382.9,  r:45683.33, q:64, tm:1795,  m:0.404},
    {ano:2026,mes:'Maio',   v:161122.35, c:93822.43, r:67299.92, q:78, tm:2066,  m:0.418},
    {ano:2026,mes:'Jun*',   v:23484,     c:13297.19, r:10186.81, q:5,  tm:3917,  m:0.434},
  ];
  metas = [
    {mes:'ABR/25', meta:20000,    vendido:40581,     pct:2.029},
    {mes:'MAI/25', meta:100000,   vendido:138192.93, pct:1.382},
    {mes:'JUN/25', meta:104500,   vendido:165861.83, pct:1.587},
    {mes:'JUL/25', meta:109202.5, vendido:145599.56, pct:1.333},
    {mes:'AGO/25', meta:114116.6, vendido:171394.08, pct:1.502},
    {mes:'SET/25', meta:119251.9, vendido:119323.53, pct:1.001},
    {mes:'OUT/25', meta:124618.2, vendido:137689.28, pct:1.105},
    {mes:'NOV/25', meta:130226,   vendido:125959.55, pct:0.967},
    {mes:'DEZ/25', meta:136086.2, vendido:89027.8,   pct:0.654},
    {mes:'JAN/26', meta:125000,   vendido:97495.56,  pct:0.780},
    {mes:'FEV/26', meta:130625,   vendido:41017.09,  pct:0.314},
    {mes:'MAR/26', meta:136503.1, vendido:196385.82, pct:1.439},
  ];
  quinzenas = [
    {mes:'MAI/25', q1:0,         q2:138192.93, total:138192.93},
    {mes:'JUN/25', q1:46212.49,  q2:119649.34, total:165861.83},
    {mes:'JUL/25', q1:74606.33,  q2:70993.23,  total:145599.56},
    {mes:'AGO/25', q1:48212.8,   q2:123181.28, total:171394.08},
    {mes:'SET/25', q1:38704.55,  q2:80618.98,  total:119323.53},
    {mes:'OUT/25', q1:62746,     q2:74943.28,  total:137689.28},
    {mes:'NOV/25', q1:57761.14,  q2:68198.41,  total:125959.55},
    {mes:'DEZ/25', q1:40283.73,  q2:48744.07,  total:89027.8},
    {mes:'JAN/26', q1:68419.66,  q2:29075.9,   total:97495.56},
    {mes:'FEV/26', q1:27644.99,  q2:13372.1,   total:41017.09},
    {mes:'MAR/26', q1:100088.7,  q2:66476.26,  total:196385.82},
    {mes:'ABR/26', q1:61767.16,  q2:51299.07,  total:113066.23},
    {mes:'MAI/26', q1:63506.12,  q2:97616.23,  total:161122.35},
    {mes:'JUN/26', q1:23484,     q2:0,          total:23484},
  ];
}

// ── PARSE ESTOQUE ANTIGO CSV ─────────────────────────────────────────────────
function processEstoqueCSV(text) {
  estoqueAntigo = [];
  const lines = text.split('\n').map(parseCSVLine);

  const MESES_HEADER = ['MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO','JANEIRO','FEVEREIRO','MARCO','MARÇO','ABRIL'];
  const mMap = {jan:'Jan',fev:'Fev',mar:'Mar',abr:'Abr',mai:'Mai',jun:'Jun',jul:'Jul',ago:'Ago',set:'Set',out:'Out',nov:'Nov',dez:'Dez'};

  let mesCorrente = 'Desconhecido';

  for (let i = 0; i < lines.length; i++) {
    const r = lines[i];
    const allCells = r.map(c => (c || '').trim().toUpperCase());

    // Detecta cabeçalho de mês em qualquer coluna e atualiza mês corrente
    const mesHeader = MESES_HEADER.find(m => allCells.some(c => c === m));
    if (mesHeader) {
      const norm = mesHeader.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().slice(0,3);
      mesCorrente = mMap[norm] || mesHeader.charAt(0) + mesHeader.slice(1,3).toLowerCase();
      continue;
    }

    const colA = (r[0] || '').trim(); // Data
    const colC = (r[2] || '').trim(); // Produto

    // Pula cabeçalho de coluna e linhas vazias
    if (!colA || colA.toUpperCase() === 'DATA') continue;
    if (!colC || colC.toUpperCase() === 'PRODUTO' || colC === '') continue;

    const vendido = parseNum((r[3] || '').trim()); // Vendido
    const custo   = parseNum((r[4] || '').trim()); // Custo Total
    const qtd     = parseNum((r[5] || '').trim()); // Qtd

    if (vendido == null || custo == null) continue;

    // Tenta extrair mês da data (ex: "26 mai 18:48 hs"), senão usa mês do cabeçalho
    let mes = mesCorrente;
    const mMatch = colA.toLowerCase().match(/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/);
    if (mMatch && mMap[mMatch[1]]) mes = mMap[mMatch[1]];

    estoqueAntigo.push({
      data:    colA,
      produto: colC,
      vendido,
      custo,
      qtd:     qtd || 1,
      res:     vendido - custo,
      mes
    });
  }
}

// ── BUILD ESTOQUE ANTIGO ──────────────────────────────────────────────────────
function buildEstoque() {
  if (!estoqueAntigo.length) return;

  const gc = 'rgba(0,0,0,0.06)';
  const tc = '#7a8a9a';

  const totalV   = estoqueAntigo.reduce((a, d) => a + d.vendido, 0);
  const totalC   = estoqueAntigo.reduce((a, d) => a + d.custo,   0);
  const totalR   = totalV - totalC;
  const totalQ   = estoqueAntigo.reduce((a, d) => a + d.qtd,     0);
  const markup   = totalC > 0 ? ((totalV - totalC) / totalC) * 100 : 0;
  const margem   = totalV > 0 ? ((totalV - totalC) / totalV) * 100 : 0;

  set('ea-totalVendido', fmtR(totalV));
  set('ea-totalCusto',   fmtR(totalC));
  set('ea-resultado',    fmtR(totalR));
  set('ea-markup',       'Markup ' + markup.toFixed(1) + '% · Margem ' + margem.toFixed(1) + '%');
  set('ea-qtd',          totalQ.toString());

  // Agrupa por mês
  const porMes = {};
  estoqueAntigo.forEach(d => {
    if (!porMes[d.mes]) porMes[d.mes] = { v: 0, c: 0, r: 0 };
    porMes[d.mes].v += d.vendido;
    porMes[d.mes].c += d.custo;
    porMes[d.mes].r += d.res;
  });
  const mesLabels = Object.keys(porMes);
  const mesV      = mesLabels.map(m => porMes[m].v);
  const mesC      = mesLabels.map(m => porMes[m].c);
  const mesR      = mesLabels.map(m => porMes[m].r);

  // Chart vendido vs custo
  mkChart('chartEA', {
    type: 'bar',
    data: {
      labels: mesLabels,
      datasets: [
        { label: 'Vendido', data: mesV, backgroundColor: '#2ab5b5', borderRadius: 3 },
        { label: 'Custo',   data: mesC, backgroundColor: '#ef4444', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } },
        y: { ticks: { color: tc, font: { size: 10 }, callback: v => 'R$' + (v/1000).toFixed(0) + 'k' }, grid: { color: gc } }
      }
    }
  });

  // Chart resultado (prejuízo)
  mkChart('chartEARes', {
    type: 'bar',
    data: {
      labels: mesLabels,
      datasets: [{
        label: 'Resultado',
        data: mesR,
        backgroundColor: mesR.map(v => v < 0 ? '#ef4444' : '#22c55e'),
        borderRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } },
        y: { ticks: { color: tc, font: { size: 10 }, callback: v => 'R$' + (v/1000).toFixed(0) + 'k' }, grid: { color: gc } }
      }
    }
  });

  // Tabela produtos
  const tb = document.getElementById('tabelaEA');
  if (tb) {
    tb.innerHTML = estoqueAntigo.map(d => {
      const margPct = d.vendido > 0 ? ((d.res / d.vendido) * 100).toFixed(1) : 0;
      const bc = d.res >= 0 ? 'badge-green' : 'badge-red';
      return `<tr>
        <td style="color:var(--muted2);font-size:11px">${d.data}</td>
        <td>${d.produto}</td>
        <td>${fmtR(d.vendido)}</td>
        <td>${fmtR(d.custo)}</td>
        <td>${fmtR(d.res)}</td>
        <td><span class="badge ${bc}">${margPct}%</span></td>
      </tr>`;
    }).join('');
  }
}

// ── BUILD DASHBOARD ───────────────────────────────────────────────────────────
function buildDashboard() {
  if (!dados.length) return;

  // Aplica filtro de ano
  const df = anoFiltro === 'todos' ? dados : dados.filter(d => d.ano === anoFiltro);
  const mf = anoFiltro === 'todos' ? metas : metas.filter(m => {
    // metas tem formato 'ABR/25', 'JAN/26' etc — filtra pelo sufixo do ano
    const sufixo = String(anoFiltro).slice(2);
    return m.mes.includes('/' + sufixo);
  });
  const qf = anoFiltro === 'todos' ? quinzenas : quinzenas.filter(q => {
    const sufixo = String(anoFiltro).slice(2);
    return q.mes.includes('/' + sufixo);
  });

  if (!df.length) return;

  const labels = df.map(d => d.mes.slice(0,3) + '/' + String(d.ano).slice(2));
  const gc     = 'rgba(0,0,0,0.06)';
  const tc     = '#7a8a9a';

  const baseOpts = (yFmt) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: tc, font: { size: 10 }, maxRotation: 45, autoSkip: false }, grid: { color: gc } },
      y: { ticks: { color: tc, font: { size: 10 }, callback: yFmt || (v => 'R$' + (v/1000).toFixed(0) + 'k') }, grid: { color: gc } }
    }
  });

  // ── Totais
  const totalV   = df.reduce((a, d) => a + d.v, 0);
  const totalR   = df.reduce((a, d) => a + d.r, 0);
  const totalQ   = df.reduce((a, d) => a + d.q, 0);
  const mGeral   = totalR / totalV;

  set('kpi-totalVendas', fmtRk(totalV));
  set('kpi-resultado',   fmtRk(totalR));
  set('kpi-margemGeral', '▲ Margem ' + fmtM(mGeral));
  set('kpi-qtd',         totalQ.toLocaleString('pt-BR'));
  set('kpi-ticket',      fmtR(totalV / totalQ));

  // ── Tabela anos
  const anos = {};
  df.forEach(d => {
    if (!anos[d.ano]) anos[d.ano] = { v: 0, r: 0, n: 0 };
    anos[d.ano].v += d.v; anos[d.ano].r += d.r; anos[d.ano].n++;
  });
  const tbAnos = document.getElementById('tabelaAnos');
  if (tbAnos) {
    tbAnos.innerHTML = Object.entries(anos).map(([a, x]) => {
      const m  = x.r / x.v;
      const bc = m >= 0.38 ? 'badge-green' : m >= 0.3 ? 'badge-yellow' : 'badge-red';
      return `<tr><td>${a}</td><td>${fmtR(x.v)}</td><td>${fmtR(x.r)}</td><td><span class="badge ${bc}">${fmtM(m)}</span></td><td>${x.n} meses</td></tr>`;
    }).join('') +
    `<tr style="font-weight:600"><td>Total</td><td>${fmtR(totalV)}</td><td>${fmtR(totalR)}</td><td><span class="badge badge-green">${fmtM(mGeral)}</span></td><td>${df.length} meses</td></tr>`;
  }

  // ── Mensal KPIs
  const melhor   = df.reduce((a, b) => b.v > a.v ? b : a);
  const menor    = df.reduce((a, b) => b.v < a.v ? b : a);
  const maiorVol = df.reduce((a, b) => b.q > a.q ? b : a);
  const maiorM   = df.reduce((a, b) => b.m > a.m ? b : a);
  set('kpi-melhorMes',     cap(melhor.mes, 3) + '/' + melhor.ano);
  set('kpi-melhorVal',     fmtR(melhor.v));
  set('kpi-maiorVol',      cap(maiorVol.mes, 3) + '/' + maiorVol.ano);
  set('kpi-maiorVolVal',   maiorVol.q + ' unidades');
  set('kpi-menorMes',      cap(menor.mes, 3) + '/' + menor.ano);
  set('kpi-menorVal',      fmtR(menor.v));
  set('kpi-maiorMargem',   fmtM(maiorM.m));
  set('kpi-maiorMargemVal', cap(maiorM.mes, 3) + '/' + maiorM.ano);

  // ── Tabela mensal
  const tbMensal = document.getElementById('tabelaMensal');
  if (tbMensal) {
    tbMensal.innerHTML = df.map(d => {
      const bc = d.m >= 0.4 ? 'badge-green' : d.m >= 0.3 ? 'badge-yellow' : 'badge-red';
      return `<tr>
        <td>${capitalize(d.mes)}</td><td>${d.ano}</td>
        <td>${fmtR(d.v)}</td><td>${fmtR(d.c)}</td><td>${fmtR(d.r)}</td>
        <td>${d.q}</td><td>${fmtR(d.tm)}</td>
        <td><span class="badge ${bc}">${fmtM(d.m)}</span></td>
      </tr>`;
    }).join('');
  }

  // ── Metas KPIs
  const metasOk = mf.filter(m => m.pct != null);
  if (metasOk.length) {
    const totalMeta  = mf.reduce((a, m) => a + (m.meta || 0), 0);
    const acima      = metasOk.filter(m => m.pct >= 1).length;
    const melhorMeta = metasOk.reduce((a, b) => b.pct > a.pct ? b : a);
    const piorMeta   = metasOk.reduce((a, b) => b.pct < a.pct ? b : a);
    set('kpi-metaTotal',    fmtRk(totalMeta));
    set('kpi-mesesAcima',   acima + ' de ' + metasOk.length);
    set('kpi-melhorMeta',   fmtM(melhorMeta.pct));
    set('kpi-melhorMetaMes', melhorMeta.mes);
    set('kpi-piorMeta',     fmtM(piorMeta.pct));
    set('kpi-piorMetaMes',  piorMeta.mes);
  }

  // ── Metas bars
  const metasBars = document.getElementById('metasBars');
  if (metasBars) {
    metasBars.innerHTML = mf.filter(m => m.pct != null).map(m => {
      const p     = Math.min(m.pct * 100, 200);
      const color = m.pct >= 1 ? '#3cb878' : '#ef4444';
      return `<div class="prog-row">
        <div class="prog-label">
          <span>${m.mes}</span>
          <span style="color:${color}">${(m.pct * 100).toFixed(1)}%</span>
        </div>
        <div class="prog-bar">
          <div class="prog-fill" style="width:${Math.min(p / 2, 100)}%;background:${color}"></div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Margem KPIs
  const d2025  = df.filter(d => d.ano === 2025);
  const d2026  = df.filter(d => d.ano === 2026);
  const m2025  = d2025.reduce((a,d)=>a+d.v,0) > 0 ? d2025.reduce((a,d)=>a+d.r,0)/d2025.reduce((a,d)=>a+d.v,0) : 0;
  const m2026  = d2026.reduce((a,d)=>a+d.v,0) > 0 ? d2026.reduce((a,d)=>a+d.r,0)/d2026.reduce((a,d)=>a+d.v,0) : 0;
  const picoM  = df.reduce((a, b) => b.m > a.m ? b : a);
  const minM   = df.reduce((a, b) => b.m < a.m ? b : a);
  set('kpi-m2025',        fmtM(m2025));
  set('kpi-m2026',        fmtM(m2026));
  set('kpi-picoMargem',   fmtM(picoM.m));
  set('kpi-picoMargemMes', cap(picoM.mes,3) + '/' + picoM.ano);
  set('kpi-minMargem',    fmtM(minM.m));
  set('kpi-minMargemMes', cap(minM.mes,3) + '/' + minM.ano);

  // ── Quinzenas tabela
  const tbQ = document.getElementById('tabelaQ');
  if (tbQ) {
    tbQ.innerHTML = qf.map(q => {
      const prop = q.total > 0 ? ((q.q1 / q.total) * 100).toFixed(0) + '%' : '—';
      return `<tr><td>${q.mes}</td><td>${fmtR(q.q1)}</td><td>${fmtR(q.q2)}</td><td>${fmtR(q.total)}</td><td>${prop}</td></tr>`;
    }).join('');
  }

  // ── Build Estoque Antigo
  buildEstoque();

  // ═══════════════════════════════ CHARTS ═══════════════════════════════════

  // Vendas vs Custos
  mkChart('chartVC', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Vendas', data: df.map(d => d.v), backgroundColor: '#2ab5b5', borderRadius: 3 },
        { label: 'Custos', data: df.map(d => d.c), backgroundColor: '#ef4444', borderRadius: 3 }
      ]
    },
    options: baseOpts()
  });

  // Resultado
  mkChart('chartRes', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Resultado',
        data: df.map(d => d.r),
        borderColor: '#3cb878',
        backgroundColor: 'rgba(60,184,120,0.10)',
        fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#3cb878'
      }]
    },
    options: baseOpts()
  });

  // Mensal
  mkChart('chartMensal', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Vendas',
        data: df.map(d => d.v),
        backgroundColor: df.map(d => d.ano === 2025 ? '#2ab5b5' : '#3cb878'),
        borderRadius: 3
      }]
    },
    options: baseOpts()
  });

  // Metas
  const metLabels = mf.filter(m => m.pct != null).map(m => m.mes);
  const metPcts   = mf.filter(m => m.pct != null).map(m => parseFloat((m.pct * 100).toFixed(1)));
  mkChart('chartMetas', {
    type: 'bar',
    data: {
      labels: metLabels,
      datasets: [{
        label: '% Meta',
        data: metPcts,
        backgroundColor: metPcts.map(p => p >= 100 ? '#3cb878' : '#ef4444'),
        borderRadius: 3
      }]
    },
    options: {
      ...baseOpts(v => v + '%'),
      scales: {
        x: { ticks: { color: tc, font: { size: 10 }, maxRotation: 45, autoSkip: false }, grid: { color: gc } },
        y: { min: 0, ticks: { color: tc, font: { size: 10 }, callback: v => v + '%' }, grid: { color: gc } }
      }
    }
  });

  // Margem
  mkChart('chartMargem', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Margem %', data: df.map(d => parseFloat((d.m * 100).toFixed(1))), borderColor: '#2ab5b5', backgroundColor: 'rgba(42,181,181,0.08)', fill: true, tension: 0.4, pointRadius: 3 },
        { label: 'Meta 40%', data: df.map(() => 40), borderColor: '#f59e0b', borderDash: [5, 5], pointRadius: 0, fill: false }
      ]
    },
    options: {
      ...baseOpts(v => v + '%'),
      scales: {
        x: { ticks: { color: tc, font: { size: 10 }, maxRotation: 45, autoSkip: false }, grid: { color: gc } },
        y: { min: 0, max: 65, ticks: { color: tc, font: { size: 10 }, callback: v => v + '%' }, grid: { color: gc } }
      }
    }
  });

  // Quinzenas
  if (qf.length) {
    mkChart('chartQ', {
      type: 'bar',
      data: {
        labels: qf.map(q => q.mes),
        datasets: [
          { label: '1ª quinzena', data: qf.map(q => q.q1), backgroundColor: '#2ab5b5', borderRadius: 3 },
          { label: '2ª quinzena', data: qf.map(q => q.q2), backgroundColor: '#3cb878', borderRadius: 3 }
        ]
      },
      options: baseOpts()
    });
  }
}

// ── CHART FACTORY ──────────────────────────────────────────────────────────────
function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, cfg);
}

// ── STRING HELPERS ─────────────────────────────────────────────────────────────
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function cap(s, n)     { return s ? s.charAt(0).toUpperCase() + s.slice(1, n) : s; }
