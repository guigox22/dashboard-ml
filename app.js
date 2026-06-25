/* ═══════════════════════════════════════════════════════════════════════════
   app.js — Dashboard Mercado Livre
   ═══════════════════════════════════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID               = '1OU-wXa3pfMTzPzRCdCtc3Jhzk08zpI_E';
const SHEET_NUEVOS_ID        = '1YSsGmikzlfryiXtdHBCPZ3Qb8LakZvAQAVikuohvRw8';
const GID_DASHBOARD          = '199181687';
const GID_ESTOQUE            = '620201163';
const GID_NUEVOS_PRODUCTOS   = '1121502030';

const CSV_URL        = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_DASHBOARD}`;
const CSV_ESTOQUE    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_ESTOQUE}`;
const CSV_ENTRADAS   = `https://docs.google.com/spreadsheets/d/${SHEET_NUEVOS_ID}/export?format=csv&gid=${GID_NUEVOS_PRODUCTOS}`;

// ── PAGE TITLES ───────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  visao:    'Visão Geral',
  mensal:   'Vendas Mensais',
  metas:    'Metas',
  entradas: 'Entrada de Novos Produtos',
  margem:   'Análise de Margem',
  quinzena: 'Primeira vs Segunda Quinzena',
  estoque:  'Estoque Antigo · Vendas com Prejuízo',
};

// ── STATE ─────────────────────────────────────────────────────────────────────
let dados         = [];
let metas         = [];
let quinzenas     = [];
let estoqueAntigo = [];
let entradasNovas = [];
const charts      = {};
let anoFiltro     = 'todos'; // 'todos' | 2025 | 2026

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${id}"]`);
  if (navItem) navItem.classList.add('active');

  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[id] || id;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.getAttribute('data-page');
      if (page) showPage(page);
    });
  });

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
    const [resp, respEA, respEN] = await Promise.all([
      fetch(CSV_URL     + '&cachebust=' + Date.now()),
      fetch(CSV_ESTOQUE + '&cachebust=' + Date.now()),
      fetch(CSV_ENTRADAS + '&cachebust=' + Date.now())
    ]);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text   = await resp.text();
    const textEA = respEA.ok ? await respEA.text() : '';
    const textEN = respEN.ok ? await respEN.text() : '';

    processCSV(text);
    if (textEA) processEstoqueCSV(textEA);
    if (textEN) processEntradaCSV(textEN);
    
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

  if (!dados.length) useFallbackData();
}

function processEstoqueCSV(text) {
  estoqueAntigo = [];
  const mMap = {jan:'Jan',fev:'Fev',mar:'Mar',abr:'Abr',mai:'Mai',jun:'Jun',jul:'Jul',ago:'Ago',set:'Set',out:'Out',nov:'Nov',dez:'Dez'};
  const lines = text.split('\n').map(parseCSVLine);

  for (let i = 0; i < lines.length; i++) {
    const r    = lines[i];
    const colA = (r[0] || '').trim();
    const colC = (r[2] || '').trim();
    const colD = (r[3] || '').trim();
    const colE = (r[4] || '').trim();
    const colF = (r[5] || '').trim();
    const colG = (r[6] || '').trim();

    if (!colA || colA.toUpperCase() === 'DATA' || !colA.match(/\d/)) continue;
    if (!colC || colC.toUpperCase() === 'PRODUTO') continue;

    const vendido = parseNum(colD);
    const custo   = parseNum(colE);
    const qtd     = parseNum(colF);

    if (vendido == null || custo == null) continue;

    let mes = 'Desconhecido';
    if (colG) {
      const norm = colG.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().slice(0,3);
      mes = mMap[norm] || colG;
    } else {
      const mMatch = colA.toLowerCase().match(/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/);
      if (mMatch && mMap[mMatch[1]]) mes = mMap[mMatch[1]];
    }

    estoqueAntigo.push({ data: colA, produto: colC, vendido, custo, qtd: qtd || 1, res: vendido - custo, mes });
  }
}

// ── PARSE ENTRADA DE NOVOS PRODUTOS ──────────────────────────────────────────
function processEntradaCSV(text) {
  entradasNovas = [];
  const lines = text.split('\n').map(parseCSVLine);
  const monthNames = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

  let currentYear = null;

  for (let i = 0; i < lines.length; i++) {
    const r = lines[i];
    const colB = (r[1] || '').trim(); // Ano ou Mês
    const colC = (r[2] || '').trim(); // Mês se colB for Ano
    const colE = (r[4] || '').trim(); // Quantidade de novos produtos (Supondo coluna E/Qtd baseada na estrutura de vendas)

    if (colB === '2025' || colB === '2026') currentYear = parseInt(colB);

    const isMonth = s => monthNames.includes((s || '').toLowerCase());
    if (isMonth(colC) || isMonth(colB)) {
      const mes = isMonth(colC) ? colC : colB;
      const qtdEntrada = parseNum(r[5]) || parseNum(r[4]) || 0; // Adaptado para ler a coluna numérica de volumes
      
      if (currentYear) {
        entradasNovas.push({ ano: currentYear, mes: capitalize(mes), qtd: qtdEntrada });
      }
    }
  }
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
  entradasNovas = [
    {ano:2025, mes:'Abril', qtd:15}, {ano:2025, mes:'Maio', qtd:42}, {ano:2025, mes:'Junho', qtd:38},
    {ano:2025, mes:'Julho', qtd:29}, {ano:2025, mes:'Agosto', qtd:50}, {ano:2026, mes:'Jan', qtd:31},
    {ano:2026, mes:'Fev', qtd:22}, {ano:2026, mes:'Março', qtd:60}
  ];
}

function buildEstoque() {
  if (!estoqueAntigo.length) return;
  const gc = 'rgba(0,0,0,0.06)', tc = '#7a8a9a';
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

  const porMes = {};
  estoqueAntigo.forEach(d => {
    if (!porMes[d.mes]) porMes[d.mes] = { v: 0, c: 0, r: 0 };
    porMes[d.mes].v += d.vendido; porMes[d.mes].c += d.custo; porMes[d.mes].r += d.res;
  });
  
  const tb = document.getElementById('tabelaEA');
  if (tb) {
    tb.innerHTML = estoqueAntigo.map(d => {
      const margPct = d.vendido > 0 ? ((d.res / d.vendido) * 100).toFixed(1) : 0;
      const bc = d.res >= 0 ? 'badge-green' : 'badge-red';
      return `<tr><td>${d.data}</td><td>${d.produto}</td><td>${fmtR(d.vendido)}</td><td>${fmtR(d.custo)}</td><td>${fmtR(d.res)}</td><td><span class="badge ${bc}">${margPct}%</span></td></tr>`;
    }).join('');
  }
}

// ── BUILD DASHBOARD ───────────────────────────────────────────────────────────
function buildDashboard() {
  if (!dados.length) return;

  const df = anoFiltro === 'todos' ? dados : dados.filter(d => d.ano === anoFiltro);
  const ef = anoFiltro === 'todos' ? entradasNovas : entradasNovas.filter(e => e.ano === anoFiltro);

  if (!df.length) return;

  const labels = df.map(d => d.mes.slice(0,3) + '/' + String(d.ano).slice(2));
  const gc     = 'rgba(0,0,0,0.06)';
  const tc     = '#7a8a9a';

  const baseOpts = (yFmt) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: tc, font: { size: 10 }, maxRotation: 45, autoSkip: false }, grid: { color: gc } },
      y: { ticks: { color: tc, font: { size: 10 }, callback: yFmt || (v => 'R$' + (v/1000).toFixed(0) + 'k') }, grid: { color: gc } }
    }
  });

  // Renderizar a Tabela e KPIs de Entrada de Produtos
  const totalEntradas = ef.reduce((a, b) => a + b.qtd, 0);
  set('kpi-totalEntradas', totalEntradas.toLocaleString('pt-BR'));

  const tbEntradas = document.getElementById('tabelaEntradas');
  if (tbEntradas) {
    tbEntradas.innerHTML = ef.map(e => `<tr><td>${e.mes}</td><td>${e.ano}</td><td>${e.qtd} un</td></tr>`).join('');
  }

  // Gráfico de Entrada de Novos Produtos
  mkChart('chartEntradas', {
    type: 'bar',
    data: {
      labels: ef.map(e => e.mes.slice(0,3) + '/' + String(e.ano).slice(2)),
      datasets: [{ label: 'Entradas', data: ef.map(e => e.qtd), backgroundColor: '#8b5cf6', borderRadius: 3 }]
    },
    options: baseOpts(v => v + ' un')
  });

  // Restante das renderizações padrões (Vendas, Margens, Metas...)
  const totalV = df.reduce((a, d) => a + d.v, 0);
  const totalR = df.reduce((a, d) => a + d.r, 0);
  const totalQ = df.reduce((a, d) => a + d.q, 0);
  set('kpi-totalVendas', fmtRk(totalV));
  set('kpi-resultado', fmtRk(totalR));
  set('kpi-qtd', totalQ.toLocaleString('pt-BR'));
  set('kpi-ticket', fmtR(totalV / totalQ));

  // (Manter os demais gráficos originais como chartVC, chartRes, chartMargem etc.)
  mkChart('chartVC', {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Vendas', data: df.map(d => d.v), backgroundColor: '#2ab5b5' }] },
    options: baseOpts()
  });
}

function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, cfg);
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }