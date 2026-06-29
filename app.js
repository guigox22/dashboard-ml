/* ═══════════════════════════════════════════════════════════════════════════
   app.js — Dashboard Mercado Livre
   ═══════════════════════════════════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID               = '1OU-wXa3pfMTzPzRCdCtc3Jhzk08zpI_E';
const SHEET_NUEVOS_ID        = '1YSsGmikzlfryiXtdHBCPZ3Qb8LakZvAQAVikuohvRw8';
const GID_DASHBOARD          = '199181687';
const GID_ESTOQUE            = '620201163';
const GID_NUEVOS_PRODUCTOS   = '1121502030';

// Usar /pub?output=csv para evitar bloqueio de CORS em planilhas públicas
const CSV_URL        = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_DASHBOARD}`;
const CSV_ESTOQUE    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_ESTOQUE}`;
const CSV_ENTRADAS   = `https://docs.google.com/spreadsheets/d/e/2PACX-1vRfGWqVSMfpdACAxc80A9aR34U_F8imvSnqWo98qP1eV7To00ZUVQQR__uORP_h2ePXm13ff9Sjyuft/pub?output=csv`;

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
let mesFiltro     = 'todos'; // 'todos' | 3 | 6 | 12

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

  // Filtro de meses
  document.addEventListener('click', e => {
    const btn = e.target.closest('.month-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.month-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const val = btn.getAttribute('data-months');
    mesFiltro = val === 'todos' ? 'todos' : parseInt(val);
    buildDashboard();
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

async function fetchCSV(url) {
  // Tenta fetch normal primeiro (funciona se a planilha for pública)
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao buscar ' + url);
  return await resp.text();
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
    const cb = '&cachebust=' + Date.now();
    const cbP = (CSV_ENTRADAS.includes('?') ? '&' : '?') + 'cachebust=' + Date.now();

    // Carrega planilha principal (obrigatória) e as demais em paralelo com falha silenciosa
    const [text, textEA, textEN] = await Promise.all([
      fetchCSV(CSV_URL + cb),
      fetchCSV(CSV_ESTOQUE + cb).catch(() => ''),
      fetchCSV(CSV_ENTRADAS + cbP).catch(err => {
        console.warn('Entradas não carregadas:', err.message);
        return '';
      })
    ]);

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
        <small style="opacity:.7;display:block;margin-top:6px">
          Verifique se a planilha principal está pública:<br>
          <strong>Planilha → Compartilhar → Qualquer pessoa com o link pode ver</strong><br>
          E também: <strong>Arquivo → Compartilhar → Publicar na web → CSV</strong>
        </small>
      </div>
      <button class="sync-btn" onclick="loadData()" style="margin-top:12px;max-width:200px">↻ Tentar novamente</button>`;
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
// Layout da planilha:
// Col A: Mês | B-F: 1ª-5ª Semana | G: Total | H: Produtos Ok para Venda
function processEntradaCSV(text) {
  entradasNovas = [];
  if (!text || !text.trim()) return;

  const lines = text.split('\n').map(parseCSVLine);

  // Ordem cronológica dos meses para detectar virada de ano
  const ordemMes = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  const normMes = s => (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().trim().slice(0, 3);

  const isMonth = s => ordemMes.includes(normMes(s));

  let anoAtual   = null;
  let idxAnterior = -1;

  for (let i = 0; i < lines.length; i++) {
    const r    = lines[i];
    const colA = (r[0] || '').trim();  // Mês
    const colG = (r[6] || '').trim();  // Total
    const colH = (r[7] || '').trim();  // Produtos Ok para Venda

    if (!isMonth(colA)) continue;

    const norm3    = normMes(colA);
    const idxAtual = ordemMes.indexOf(norm3);

    // Inicializa: primeiro mês encontrado → descobre ano pela posição (ago-dez = 2025)
    if (anoAtual === null) {
      anoAtual = idxAtual >= 7 ? 2025 : 2026; // ago(7)..dez(11) = 2025
    } else if (idxAtual <= idxAnterior) {
      // Voltou para um mês anterior ou igual → virou o ano
      anoAtual++;
    }

    idxAnterior = idxAtual;

    const total   = parseNum(colG);
    const okVenda = parseNum(colH);

    if (total != null) {
      entradasNovas.push({
        ano: anoAtual,
        mes: capitalize(colA),
        qtd: total,
        okVenda: okVenda || 0
      });
    }
  }

  console.log(`✅ Entradas carregadas: ${entradasNovas.length} registros`, entradasNovas);
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

  // Filtro por ano
  let df = anoFiltro === 'todos' ? dados : dados.filter(d => d.ano === anoFiltro);
  let ef = anoFiltro === 'todos' ? entradasNovas : entradasNovas.filter(e => e.ano === anoFiltro);

  // Filtro por quantidade de meses (pega os N mais recentes)
  if (mesFiltro !== 'todos') {
    df = df.slice(-mesFiltro);
    ef = ef.slice(-mesFiltro);
  }

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
  const totalOkVenda  = ef.reduce((a, b) => a + (b.okVenda || 0), 0);
  set('kpi-totalEntradas', totalEntradas.toLocaleString('pt-BR'));
  set('kpi-totalOkVenda',  totalOkVenda.toLocaleString('pt-BR'));

  const tbEntradas = document.getElementById('tabelaEntradas');
  if (tbEntradas) {
    if (ef.length) {
      tbEntradas.innerHTML = ef.map(e => {
        const pct = e.qtd > 0 ? Math.round((e.okVenda / e.qtd) * 100) : 0;
        return `<tr>
          <td>${e.mes}</td>
          <td>${e.ano}</td>
          <td>${e.qtd}</td>
          <td>${e.okVenda || 0}</td>
          <td><span class="badge ${pct >= 80 ? 'badge-green' : pct >= 50 ? 'badge-yellow' : 'badge-red'}">${pct}%</span></td>
        </tr>`;
      }).join('');
      const dbg = document.getElementById('entradasDebug');
      if (dbg) dbg.style.display = 'none';
    } else {
      tbEntradas.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#7a8a9a;padding:16px">Nenhum dado carregado da planilha de entradas.<br><small>Certifique-se que a planilha está publicada na web como CSV.</small></td></tr>';
      const dbg = document.getElementById('entradasDebug');
      if (dbg) {
        dbg.style.display = 'block';
        dbg.innerHTML = `⚠️ <strong>Dica:</strong> A planilha de entradas precisa estar publicada.<br>
          No Google Sheets: <strong>Arquivo → Compartilhar → Publicar na web</strong> → selecione a aba → formato <strong>CSV</strong> → Publicar.`;
      }
    }
  }

  // Gráfico de Entrada de Novos Produtos — página de entradas
  mkChart('chartEntradas', {
    type: 'bar',
    data: {
      labels: ef.map(e => e.mes.slice(0,3) + '/' + String(e.ano).slice(2)),
      datasets: [
        { label: 'Total Entradas', data: ef.map(e => e.qtd),          backgroundColor: '#8b5cf6', borderRadius: 3 },
        { label: 'Ok para Venda',  data: ef.map(e => e.okVenda || 0), backgroundColor: '#2ab5b5', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#5a6a7a', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#7a8a9a', font: { size: 10 }, maxRotation: 45, autoSkip: false }, grid: { color: 'rgba(0,0,0,0.06)' } },
        y: { ticks: { color: '#7a8a9a', font: { size: 10 }, callback: v => v + ' un' }, grid: { color: 'rgba(0,0,0,0.06)' } }
      }
    }
  });

  // Restante das renderizações padrões (Vendas, Margens, Metas...)
  const totalV = df.reduce((a, d) => a + d.v, 0);
  const totalR = df.reduce((a, d) => a + d.r, 0);
  const totalQ = df.reduce((a, d) => a + d.q, 0);
  set('kpi-totalVendas', fmtRk(totalV));
  set('kpi-resultado',   fmtRk(totalR));
  set('kpi-qtd',         totalQ.toLocaleString('pt-BR'));
  set('kpi-ticket',      fmtR(totalV / totalQ));

  const margemGeral = totalV > 0 ? (totalR / totalV * 100).toFixed(1) : '—';
  set('kpi-margemGeral', 'Margem ' + margemGeral + '%');

  // ── chartVC: Vendas vs Custos ────────────────────────────────────────────
  mkChart('chartVC', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Vendas', data: df.map(d => d.v), backgroundColor: '#3b82f6', borderRadius: 3 },
        { label: 'Custos', data: df.map(d => d.c), backgroundColor: '#ef4444', borderRadius: 3 }
      ]
    },
    options: { ...baseOpts(), plugins: { legend: { display: false } } }
  });

  // ── chartRes: Resultado mensal ───────────────────────────────────────────
  mkChart('chartRes', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Resultado', data: df.map(d => d.r),
        borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)',
        tension: 0.3, fill: true, pointRadius: 4, pointBackgroundColor: '#22c55e'
      }]
    },
    options: baseOpts()
  });

  // ── Resumo por ano ───────────────────────────────────────────────────────
  const anos = [...new Set(df.map(d => d.ano))].sort();
  const tabelaAnos = document.getElementById('tabelaAnos');
  if (tabelaAnos) {
    tabelaAnos.innerHTML = anos.map(ano => {
      const ad = df.filter(d => d.ano === ano);
      const av = ad.reduce((a, d) => a + d.v, 0);
      const ar = ad.reduce((a, d) => a + d.r, 0);
      const am = av > 0 ? (ar / av * 100).toFixed(1) : '—';
      return `<tr><td>${ano}</td><td>${fmtR(av)}</td><td>${fmtR(ar)}</td><td>${am}%</td><td>${ad.length}</td></tr>`;
    }).join('');
  }

  // ── PÁGINA MENSAL ────────────────────────────────────────────────────────
  const melhor  = df.reduce((a, b) => b.v > a.v ? b : a, df[0]);
  const menor   = df.reduce((a, b) => b.v < a.v ? b : a, df[0]);
  const maiorV  = df.reduce((a, b) => b.q > a.q ? b : a, df[0]);
  const maiorM  = df.reduce((a, b) => b.m > a.m ? b : a, df[0]);

  set('kpi-melhorMes',    melhor.mes);
  set('kpi-melhorVal',    fmtR(melhor.v));
  set('kpi-menorMes',     menor.mes);
  set('kpi-menorVal',     fmtR(menor.v));
  set('kpi-maiorVol',     maiorV.mes);
  set('kpi-maiorVolVal',  maiorV.q + ' un');
  set('kpi-maiorMargem',  maiorM.mes);
  set('kpi-maiorMargemVal', fmtM(maiorM.m));

  // Gráfico mensal separado por ano
  const mesesOrdem = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const d25 = df.filter(d => d.ano === 2025);
  const d26 = df.filter(d => d.ano === 2026);
  const labMensal = [...new Set(df.map(d => d.mes.slice(0,3).toLowerCase()))].sort((a,b) => mesesOrdem.indexOf(a) - mesesOrdem.indexOf(b));

  mkChart('chartMensal', {
    type: 'bar',
    data: {
      labels: labMensal.map(m => m.charAt(0).toUpperCase() + m.slice(1)),
      datasets: [
        { label: '2025', data: labMensal.map(m => { const r = d25.find(d => d.mes.toLowerCase().startsWith(m)); return r ? r.v : null; }), backgroundColor: '#3b82f6', borderRadius: 3 },
        { label: '2026', data: labMensal.map(m => { const r = d26.find(d => d.mes.toLowerCase().startsWith(m)); return r ? r.v : null; }), backgroundColor: '#f59e0b', borderRadius: 3 }
      ]
    },
    options: { ...baseOpts(), plugins: { legend: { display: true, labels: { color: tc, font: { size: 11 } } } } }
  });

  // Tabela mensal completa
  const tabelaMensal = document.getElementById('tabelaMensal');
  if (tabelaMensal) {
    tabelaMensal.innerHTML = df.map(d => {
      const bc = d.r >= 0 ? 'badge-green' : 'badge-red';
      return `<tr>
        <td>${d.mes}</td><td>${d.ano}</td>
        <td>${fmtR(d.v)}</td><td>${fmtR(d.c)}</td>
        <td><span class="badge ${bc}">${fmtR(d.r)}</span></td>
        <td>${d.q}</td><td>${fmtR(d.tm)}</td><td>${fmtM(d.m)}</td>
      </tr>`;
    }).join('');
  }

  // ── PÁGINA METAS ─────────────────────────────────────────────────────────
  if (metas.length) {
    const metaTotal   = metas.reduce((a, m) => a + (m.meta || 0), 0);
    const mesesAcima  = metas.filter(m => m.pct != null && m.pct >= 1).length;
    const melhorMeta  = metas.reduce((a, b) => (b.pct || 0) > (a.pct || 0) ? b : a, metas[0]);
    const piorMeta    = metas.reduce((a, b) => (b.pct || 1) < (a.pct || 1) ? b : a, metas[0]);

    set('kpi-metaTotal',    fmtRk(metaTotal));
    set('kpi-mesesAcima',   mesesAcima + ' de ' + metas.length);
    set('kpi-melhorMeta',   melhorMeta ? fmtM(melhorMeta.pct) : '—');
    // Adiciona o mês abaixo do valor de melhor atingimento
    const melhorMetaSub = document.querySelector('#kpi-melhorMeta + .kpi-sub, #kpi-melhorMeta ~ .kpi-sub');
    if (melhorMeta) {
      const el = document.getElementById('kpi-melhorMeta');
      if (el && el.nextElementSibling) el.nextElementSibling.textContent = melhorMeta.mes;
    }
    set('kpi-piorMeta',     piorMeta   ? fmtM(piorMeta.pct)   : '—');
    set('kpi-piorMetaMes',  piorMeta   ? piorMeta.mes          : '—');

    mkChart('chartMetas', {
      type: 'bar',
      data: {
        labels: metas.map(m => m.mes),
        datasets: [{
          label: '% Meta', data: metas.map(m => m.pct != null ? +(m.pct * 100).toFixed(1) : null),
          backgroundColor: metas.map(m => (m.pct || 0) >= 1 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'),
          borderRadius: 3
        }]
      },
      options: {
        ...baseOpts(v => v + '%'),
        plugins: { legend: { display: false }, annotation: {} }
      }
    });

    const metasBars = document.getElementById('metasBars');
    if (metasBars) {
      metasBars.innerHTML = metas.map(m => {
        const pct = m.pct != null ? Math.min(m.pct * 100, 150) : 0;
        const clr = pct >= 100 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
        return `<div class="prog-row">
          <div class="prog-label"><span>${m.mes}</span><span>${m.pct != null ? fmtM(m.pct) : '—'}</span></div>
          <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${clr}"></div></div>
        </div>`;
      }).join('');
    }
  }

  // ── PÁGINA MARGEM ────────────────────────────────────────────────────────
  const d2025 = df.filter(d => d.ano === 2025);
  const d2026 = df.filter(d => d.ano === 2026);
  const avg = arr => arr.length ? arr.reduce((a, d) => a + d.m, 0) / arr.length : null;

  set('kpi-m2025', d2025.length ? fmtM(avg(d2025)) : '—');
  set('kpi-m2026', d2026.length ? fmtM(avg(d2026)) : '—');

  const picoM = df.reduce((a, b) => b.m > a.m ? b : a, df[0]);
  const minM  = df.reduce((a, b) => b.m < a.m ? b : a, df[0]);
  set('kpi-picoMargem',    fmtM(picoM.m));
  set('kpi-picoMargemMes', picoM.mes + '/' + picoM.ano);
  set('kpi-minMargem',     fmtM(minM.m));
  set('kpi-minMargemMes',  minM.mes + '/' + minM.ano);

  mkChart('chartMargem', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Margem (%)', data: df.map(d => +(d.m * 100).toFixed(1)),
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',
          tension: 0.3, fill: true, pointRadius: 4, pointBackgroundColor: '#3b82f6'
        },
        {
          label: 'Meta 30%', data: df.map(() => 30),
          borderColor: '#f59e0b', borderDash: [6, 3], borderWidth: 1.5,
          pointRadius: 0, fill: false
        }
      ]
    },
    options: {
      ...baseOpts(v => v + '%'),
      plugins: { legend: { display: true, labels: { color: tc, font: { size: 11 } } } }
    }
  });

  // ── PÁGINA QUINZENAS ─────────────────────────────────────────────────────
  if (quinzenas.length) {
    mkChart('chartQ', {
      type: 'bar',
      data: {
        labels: quinzenas.map(q => q.mes),
        datasets: [
          { label: '1ª Quinzena', data: quinzenas.map(q => q.q1), backgroundColor: '#3b82f6', borderRadius: 3 },
          { label: '2ª Quinzena', data: quinzenas.map(q => q.q2), backgroundColor: '#f59e0b', borderRadius: 3 }
        ]
      },
      options: { ...baseOpts(), plugins: { legend: { display: true, labels: { color: tc, font: { size: 11 } } } } }
    });

    const tabelaQ = document.getElementById('tabelaQ');
    if (tabelaQ) {
      tabelaQ.innerHTML = quinzenas.map(q => {
        const prop = q.total > 0 ? (q.q1 / q.total * 100).toFixed(0) : '—';
        return `<tr><td>${q.mes}</td><td>${fmtR(q.q1)}</td><td>${fmtR(q.q2)}</td><td>${fmtR(q.total)}</td><td>${prop}%</td></tr>`;
      }).join('');
    }
  }

  // Tabela mensal na visão geral + resumo últimos 3 meses
  const tabelaMensalVisao = document.getElementById('tabelaMensalVisao');
  if (tabelaMensalVisao) {
    const dfDesc = [...df].reverse(); // mais recente primeiro
    const last3  = dfDesc.slice(0, 3);
    const last3Keys = new Set(last3.map(d => d.ano + '-' + d.mes));

    tabelaMensalVisao.innerHTML = dfDesc.map(d => {
      const bc      = d.r >= 0 ? 'badge-green' : 'badge-red';
      const mc      = (d.m * 100) >= 30 ? 'kpi-up' : 'kpi-down';
      const isRecent = last3Keys.has(d.ano + '-' + d.mes);
      const rowStyle = isRecent ? 'background:rgba(42,181,181,0.06);font-weight:500;' : '';
      const recTag   = isRecent ? '<span style="font-size:9px;background:var(--teal);color:#fff;border-radius:10px;padding:1px 6px;margin-left:5px;font-weight:600;vertical-align:middle">RECENTE</span>' : '';
      return `<tr style="${rowStyle}">
        <td>${d.mes}${recTag}</td>
        <td>${d.ano}</td>
        <td>${fmtR(d.v)}</td>
        <td><span class="badge ${bc}">${fmtR(d.r)}</span></td>
        <td class="${mc}">${fmtM(d.m)}</td>
        <td>${d.q}</td>
        <td>${fmtR(d.tm)}</td>
      </tr>`;
    }).join('');
  }

  // Cards de resumo — últimos 3 meses
  const resumo3El = document.getElementById('resumo3meses');
  if (resumo3El) {
    const dfDesc3 = [...df].reverse().slice(0, 3);
    resumo3El.innerHTML = dfDesc3.map(d => {
      const mc  = (d.m * 100) >= 30 ? '#1a7a45' : '#b91c1c';
      const rc  = d.r >= 0 ? '#1a7a45' : '#b91c1c';
      return `<div style="flex:1;min-width:180px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:.9rem 1.1rem;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--grad)"></div>
        <div style="font-size:10px;font-weight:700;color:var(--muted2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">${d.mes} ${d.ano}</div>
        <div style="font-size:18px;font-weight:700;font-family:'DM Mono',monospace;color:var(--text);letter-spacing:-.02em;margin-bottom:4px">${fmtR(d.v)}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:4px">
          <span>Resultado: <strong style="color:${rc}">${fmtR(d.r)}</strong></span>
          <span>Margem: <strong style="color:${mc}">${fmtM(d.m)}</strong></span>
          <span>Qtd: <strong>${d.q} un</strong></span>
        </div>
      </div>`;
    }).join('');
  }

  // Gráfico de entradas na visão geral — usa ef (já filtrado por ano e meses)
  const efLabels = ef.map(e => e.mes.slice(0,3) + '/' + String(e.ano).slice(2));
  mkChart('chartEntradasVisao', {
    type: 'bar',
    data: {
      labels: efLabels,
      datasets: [
        { label: 'Total entradas', data: ef.map(e => e.qtd),           backgroundColor: '#8b5cf6', borderRadius: 3 },
        { label: 'Ok para venda',  data: ef.map(e => e.okVenda || 0),  backgroundColor: '#2ab5b5', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#5a6a7a', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#7a8a9a', font: { size: 10 }, maxRotation: 45, autoSkip: false }, grid: { color: 'rgba(0,0,0,0.05)' } },
        y: { ticks: { color: '#7a8a9a', font: { size: 10 }, callback: v => v + ' un' }, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    }
  });

  buildEstoque();
}

function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, cfg);
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }