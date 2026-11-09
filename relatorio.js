/* ═══════════════════════════════════════════════════════════════════════════
   relatorio.js — Relatório Semanal (e resumo do mês) para enviar à equipe
   ───────────────────────────────────────────────────────────────────────────
   Fontes automáticas:
     • Aba "Ocorrencias"  → devoluções e ocorrências do período (já carregada
       pelo app.js na variável global `ocorrencias`).
     • Aba do mês (ex: "NOVEMBRO 2026", mesmo oculta) → quantidade de vendas.
   Campos manuais (desistências, adicionados ao estoque, total em estoque,
   Shopee, observações) ficam salvos neste navegador (localStorage).
   ═══════════════════════════════════════════════════════════════════════════ */

const REL_MES_ABBR = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const relMonthCache = {};       // 'YYYY-MM' → Promise<{ ok, rows }>
let relInit = false;
let relToken = 0;
let relState = null;            // último cálculo (usado pela prévia)

// ── helpers ────────────────────────────────────────────────────────────────
function relEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function relEscBr(s) { return relEsc(s).replace(/\n/g, '<br>'); }
function relISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function relFromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function relMonthKey(ano, mesIdx) { return ano + '-' + String(mesIdx + 1).padStart(2, '0'); }
function relDM(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
function relDMY(d) { return d.toLocaleDateString('pt-BR'); }
function relN(n) { return n == null || isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR'); }
function relPctNum(n, base) { return base ? n / base * 100 : null; }
function relPct(n, base) {
  const p = relPctNum(n, base);
  return p == null ? '—' : p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function relMoney(v) { return v == null || isNaN(v) ? '' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function relStoreGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; }
}
function relStoreSet(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* sem storage: segue sem salvar */ }
}
function relStoreKeys(prefix) {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.push(k); } } catch (e) {}
  return out;
}
function relNumOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// "DEVOLUÇÃO - DEFEITO" → "Defeito"; "ERRO - OPERAÇÃO" → "Operação"
function relSubtipo(tipo) {
  const t = (tipo || '').trim();
  const idx = t.indexOf('-');
  let s = idx >= 0 ? t.slice(idx + 1).trim() : t;
  if (!s) s = t;
  s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Motivo da devolução, pela coluna B (tipo) — e, se ela não disser, pelo texto
// do defeito. 'arrep' = arrependimento/desistência do cliente; 'defeito' =
// problema no aparelho (defeito, qualidade, manutenção); 'outro' = o resto
// (bounce/não entregue, erro de operação, etc.).
function relDevMotivo(o) {
  const t = stripAccents(o.tipo || '').toUpperCase();
  if (t.includes('ARREPEND')) return 'arrep';
  if (t.includes('DEFEITO') || t.includes('QUALIDADE') || t.includes('MANUTEN')) return 'defeito';
  if (t.includes('BOUNCE') || t.includes('ERRO') || t.includes('OPERA') || t.includes('CANCEL')) return 'outro';
  const d = stripAccents(o.defeito || '').toUpperCase();
  if (d.includes('ARREPEND')) return 'arrep';
  return 'outro';
}
const REL_MOTIVOS = {
  defeito: { label: 'Devoluções por defeito', curto: 'Defeito', cor: '#ef4444', fg: '#b91c1c', bg: '#fdecec' },
  arrep:   { label: 'Devoluções por arrependimento', curto: 'Arrependimento', cor: '#f97316', fg: '#c2410c', bg: '#ffedd5' },
  outro:   { label: 'Outras devoluções', curto: 'Outros motivos', cor: '#94a3b8', fg: '#475569', bg: '#f1f5f9' },
};
function relSplitDev(lista) {
  const out = { defeito: [], arrep: [], outro: [] };
  lista.forEach(o => out[relDevMotivo(o)].push(o));
  return out;
}

function relWeekKey(ini, fim) { return 'relW:' + ini + '_' + fim; }
function relItemKey(o) { return 'relI:' + (o.venda || o.os || o.produto) + '|' + relISO(o.data) + '|' + (o.tipo || ''); }

// Sábado a sexta da semana de `ref` (deslocada `offsetWeeks` semanas).
function relWeekRange(ref, offsetWeeks) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  // Semana do relatório: sábado a sexta (assim as vendas do fim de semana
  // entram no relatório da sexta seguinte e nenhum dia fica de fora).
  const desdeSabado = (d.getDay() + 1) % 7; // sáb 0, dom 1, seg 2 … sex 6
  const ini = new Date(d); ini.setDate(d.getDate() - desdeSabado + 7 * offsetWeeks);
  const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
  return { ini, fim };
}

// ── vendas: aba do mês ───────────────────────────────────────────────────────
// Busca a aba pelo NOME (funciona mesmo com a aba oculta). Atenção: se a aba
// não existir, o Google devolve a primeira aba da planilha — por isso só
// aceitamos linhas cuja data seja do mês esperado.
function relLoadMonth(ano, mesIdx, force) {
  const key = relMonthKey(ano, mesIdx);
  if (relMonthCache[key] && !force) return relMonthCache[key];
  const nome = MESES_PT[mesIdx].toUpperCase() + ' ' + ano;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(nome)}&cachebust=${Date.now()}`;
  const p = fetch(url, { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(text => {
      const rows = [];
      relParseCSV(text).forEach(r => {
        const venda = (r[1] || '').trim();
        if (!venda.startsWith('#')) return;
        const m = (r[0] || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zç]{3})/);
        if (!m) return;
        const mi = REL_MES_ABBR[m[2]];
        if (mi !== mesIdx) return;
        const qtd = parseInt(r[5], 10);
        const hm = relHoraMin(r[0]);
        rows.push({
          date: new Date(ano, mi, +m[1], hm.h, hm.m),
          venda,
          produto: (r[2] || '').trim(),
          valor: parseNum(r[3]),
          qtd: isNaN(qtd) || qtd <= 0 ? 1 : qtd,
        });
      });
      return { ok: rows.length > 0, rows, nome };
    })
    .catch(err => {
      console.warn('Aba de vendas "' + nome + '" não carregada:', err.message);
      delete relMonthCache[key];
      return { ok: false, rows: [], nome };
    });
  relMonthCache[key] = p;
  return p;
}

// "7 nov 11:37 hs" → { h: 11, m: 37 } (sem hora → 00:00)
function relHoraMin(txt) {
  const m = String(txt || '').match(/(\d{1,2}):(\d{2})/);
  return m ? { h: +m[1], m: +m[2] } : { h: 0, m: 0 };
}

// Horário de corte da sexta: vendas de sexta DEPOIS desse horário não entram no
// relatório daquela sexta (já foi enviado) e passam para o da semana seguinte.
const REL_CORTE_PADRAO = '17:00';
function relGetCorte() {
  let v = '';
  try { v = localStorage.getItem('relCorte') || ''; } catch (e) {}
  return /^\d{1,2}:\d{2}$/.test(v) ? v : REL_CORTE_PADRAO;
}
function relCorteHM() { const [h, m] = relGetCorte().split(':').map(Number); return { h, m }; }

// ── vendas: aba "Produtos caros" ─────────────────────────────────────────────
// Coluna A = dia que o aparelho saiu ("6 nov 09:01 hs"), sem ano. O ano é
// deduzido pela data mais próxima do período consultado.
const REL_ABA_CAROS = 'Produtos caros';
let relCarosCache = null;
function relLoadCaros(force) {
  if (relCarosCache && !force) return relCarosCache;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(REL_ABA_CAROS)}&cachebust=${Date.now()}`;
  relCarosCache = fetch(url, { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(text => {
      const rows = [];
      relParseCSV(text).forEach(r => {
        const venda = (r[1] || '').trim();
        if (!venda.startsWith('#')) return;
        const m = (r[0] || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zç]{3})/);
        if (!m || REL_MES_ABBR[m[2]] == null) return;
        const qtd = parseInt(r[5], 10);
        const hm = relHoraMin(r[0]);
        rows.push({ dia: +m[1], mesIdx: REL_MES_ABBR[m[2]], h: hm.h, m: hm.m, venda, qtd: isNaN(qtd) || qtd <= 0 ? 1 : qtd });
      });
      // A aba não existe → o Google devolve a 1ª aba; confere o cabeçalho
      const ok = rows.length > 0 && /VENDA/i.test(text.slice(0, 400));
      return { ok, rows: ok ? rows : [] };
    })
    .catch(err => { console.warn('Aba "Produtos caros" não carregada:', err.message); relCarosCache = null; return { ok: false, rows: [] }; });
  return relCarosCache;
}

// Data completa de uma linha, escolhendo o ano mais próximo da referência.
function relCarosDate(row, ref) {
  let best = null;
  [-1, 0, 1].forEach(dy => {
    const d = new Date(ref.getFullYear() + dy, row.mesIdx, row.dia, row.h || 0, row.m || 0);
    if (!best || Math.abs(d - ref) < Math.abs(best - ref)) best = d;
  });
  return best;
}

function relMonthsBetween(ini, fim) {
  const out = [];
  const d = new Date(ini.getFullYear(), ini.getMonth(), 1);
  while (d <= fim) { out.push({ ano: d.getFullYear(), mesIdx: d.getMonth() }); d.setMonth(d.getMonth() + 1); }
  return out;
}

// CSV com suporte a aspas e quebras de linha dentro das células (independente
// do app.js, para a página funcionar mesmo se o navegador tiver uma versão
// antiga dele em cache).
function relParseCSV(text) {
  const rows = [];
  let row = [], cell = '', inside = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inside) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inside = false; }
      else cell += ch;
    } else if (ch === '"') inside = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

// ── inicialização ───────────────────────────────────────────────────────────
let relDataLoaded = false;
let relLastSync = null;

function renderRelatorio(opts = {}) {
  const page = document.getElementById('page-relatorio');
  if (!page) return;
  if (opts.reload) { relDataLoaded = true; relLastSync = new Date(); }

  if (!relInit) {
    relInit = true;
    const { ini, fim } = relWeekRange(new Date(), 0);
    document.getElementById('relIni').value = relISO(ini);
    document.getElementById('relFim').value = relISO(fim);
    relBindEvents();
    relOnPeriodChange(true);
    return;
  }
  if (opts.reload) {
    Object.keys(relMonthCache).forEach(k => delete relMonthCache[k]);
    relCarosCache = null;
    relRecompute();
  }
}

// Inicializa sozinho (não depende do app.js chamar) e recalcula ao abrir a aba.
document.addEventListener('DOMContentLoaded', () => {
  renderRelatorio();
  const nav = document.querySelector('.nav-item[data-page="relatorio"]');
  if (nav) nav.addEventListener('click', () => {
    if (!relDataLoaded && typeof ocorrencias !== 'undefined' && ocorrencias.length) { relDataLoaded = true; relLastSync = new Date(); }
    relRecompute();
  });
});

function relRenderStatus(text, kind) {
  const el = document.getElementById('relStatus');
  if (!el) return;
  el.className = 'rel-status' + (kind ? ' rel-status-' + kind : '');
  el.innerHTML = `<span class="rel-dot"></span>${text}`;
}

function relRenderAutoList() {
  const el = document.getElementById('relAutoList');
  if (!el || !relState) return;
  const loading = '<span class="rel-auto-loading">lendo…</span>';
  const ml = relState.vendasSemana != null ? relN(relState.vendasSemana)
    : (relState.abasFaltando && relState.abasFaltando.length ? '<span class="rel-auto-warn">aba não encontrada</span>' : loading);
  const w = relState.range ? relStoreGet(relWeekKey(relState.range.iniISO, relState.range.fimISO)) : {};
  const mlCorr = relNumOrNull(w.vendasML);
  const linha = (cor, label, val, sub) => `<div class="rel-auto-row"><span class="rel-auto-dot" style="background:${cor}"></span><span class="rel-auto-label">${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${val}</b></div>`;
  el.innerHTML =
    linha('#2ab5b5', 'Vendas Mercado Livre', mlCorr != null ? relN(mlCorr) : ml, mlCorr != null ? 'corrigido por você' : 'aba do mês, 2 contas') +
    linha('#64748b', 'Vendas produtos caros', relNumOrNull(w.caros) != null ? relN(relNumOrNull(w.caros)) : (relState.carosSemana != null ? relN(relState.carosSemana) : (relState.carosOk === false ? '<span class="rel-auto-warn">aba não encontrada</span>' : loading)), relNumOrNull(w.caros) != null ? 'corrigido por você' : 'aba Produtos caros') +
    (() => {
      const sp = relSplitDev(relState.devolucoes);
      return linha(REL_MOTIVOS.defeito.cor, 'Devoluções por defeito', relDataLoaded ? relN(sp.defeito.length) : loading, 'aba Ocorrências') +
        linha(REL_MOTIVOS.arrep.cor, 'Devoluções por arrependimento', relDataLoaded ? relN(sp.arrep.length) : loading, 'aba Ocorrências') +
        (sp.outro.length ? linha(REL_MOTIVOS.outro.cor, 'Outras devoluções', relN(sp.outro.length), 'bounce, erro etc.') : '');
    })() +
    linha('#3b82f6', 'Ocorrências', relDataLoaded ? relN(relState.ocorrList.length) : loading, 'aba Ocorrências');
}

function relRenderFaltando(d) {
  const el = document.getElementById('relFaltando');
  if (!el) return;
  const falta = [];
  if (d.semana.desist == null) falta.push('Desistências');
  if (d.semana.adic == null) falta.push('Adicionados ao estoque');
  if (d.semana.estoque == null) falta.push('Total em estoque');
  if (d.semana.vendasML == null) falta.push('Vendas Mercado Livre');
  el.className = 'rel-check-line ' + (falta.length ? 'rel-check-warn' : 'rel-check-ok');
  el.innerHTML = falta.length
    ? `<b>Falta preencher:</b> ${falta.join(', ')}`
    : '<b>✓ Tudo preenchido.</b> Pode baixar a imagem ou copiar para o e-mail.';
}

function relBindEvents() {
  document.querySelectorAll('[data-rel-semana]').forEach(btn => btn.addEventListener('click', () => {
    const { ini, fim } = relWeekRange(new Date(), +btn.getAttribute('data-rel-semana'));
    document.getElementById('relIni').value = relISO(ini);
    document.getElementById('relFim').value = relISO(fim);
    relOnPeriodChange(true);
  }));
  ['relIni', 'relFim'].forEach(id => document.getElementById(id).addEventListener('change', () => relOnPeriodChange(true)));

  document.querySelectorAll('[data-rel-w]').forEach(el => el.addEventListener('input', () => {
    const r = relGetRange(); if (!r) return;
    const key = relWeekKey(r.iniISO, r.fimISO);
    const obj = relStoreGet(key);
    obj[el.getAttribute('data-rel-w')] = el.value;
    relStoreSet(key, obj);
    relUpdateMonthAutos();
    relRenderAutoList();
    relRenderPreview();
  }));

  document.querySelectorAll('[data-rel-m]').forEach(el => el.addEventListener('input', () => {
    const mk = document.getElementById('relMes').value; if (!mk) return;
    const obj = relStoreGet('relM:' + mk);
    obj[el.getAttribute('data-rel-m')] = el.value;
    relStoreSet('relM:' + mk, obj);
    relRenderPreview();
  }));

  document.getElementById('relMes').addEventListener('change', () => { relLoadMonthFields(); relRecompute(); });
  document.getElementById('relIncluirMes').addEventListener('change', () => {
    relSyncMesBox();
    relRenderPreview();
  });

  document.getElementById('relItens').addEventListener('input', e => {
    const box = e.target.closest('[data-rel-item]'); if (!box) return;
    const key = box.getAttribute('data-rel-item');
    const obj = relStoreGet(key);
    if (e.target.matches('input[type=checkbox]')) { obj.excluir = !e.target.checked; box.classList.toggle('rel-item-off', !e.target.checked); }
    if (e.target.matches('textarea')) obj.obs = e.target.value;
    relStoreSet(key, obj);
    relRenderPreview();
  });

  const corteEl = document.getElementById('relCorte');
  if (corteEl) {
    corteEl.value = relGetCorte();
    corteEl.addEventListener('change', () => {
      if (!/^\d{1,2}:\d{2}$/.test(corteEl.value)) return;
      try { localStorage.setItem('relCorte', corteEl.value); } catch (e) {}
      relRecompute();
    });
  }
  document.getElementById('relCopiarHtml').addEventListener('click', relCopyHtml);
  document.getElementById('relCopiarTexto').addEventListener('click', relCopyText);
  document.getElementById('relBaixarImg').addEventListener('click', relDownloadImage);
  document.getElementById('relCopiarImg').addEventListener('click', relCopyImage);
}

function relGetRange() {
  const iniISO = document.getElementById('relIni').value;
  const fimISO = document.getElementById('relFim').value;
  if (!iniISO || !fimISO) return null;
  let ini = relFromISO(iniISO), fim = relFromISO(fimISO);
  if (fim < ini) [ini, fim] = [fim, ini];
  const fimEnd = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate(), 23, 59, 59, 999);
  // Janela das VENDAS: se termina numa sexta, vai até o horário de corte; se
  // começa num sábado, inclui a sexta anterior depois do corte.
  const c = relCorteHM();
  const fimSexta = fim.getDay() === 5;
  const iniSabado = ini.getDay() === 6;
  const vendasFim = fimSexta ? new Date(fim.getFullYear(), fim.getMonth(), fim.getDate(), c.h, c.m, 0, 0) : fimEnd;
  const vendasIni = iniSabado ? new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() - 1, c.h, c.m, 0, 1) : ini;
  return { ini, fim, fimEnd, vendasIni, vendasFim, iniSabado, fimSexta, corte: relGetCorte(), iniISO: relISO(ini), fimISO: relISO(fim) };
}

// Quando muda o período: recarrega os campos salvos, decide o mês do resumo
// (se a semana contém o último dia de um mês, já sugere o resumo desse mês).
function relOnPeriodChange(autoMes) {
  const r = relGetRange(); if (!r) return;

  document.querySelectorAll('[data-rel-semana]').forEach(b => {
    const w = relWeekRange(new Date(), +b.getAttribute('data-rel-semana'));
    b.classList.toggle('active', relISO(w.ini) === r.iniISO && relISO(w.fim) === r.fimISO);
  });

  const saved = relStoreGet(relWeekKey(r.iniISO, r.fimISO));
  document.querySelectorAll('[data-rel-w]').forEach(el => { el.value = saved[el.getAttribute('data-rel-w')] || ''; });

  if (autoMes) {
    let fechaMes = null;
    for (let d = new Date(r.ini); d <= r.fim; d.setDate(d.getDate() + 1)) {
      const amanha = new Date(d); amanha.setDate(d.getDate() + 1);
      if (amanha.getDate() === 1) { fechaMes = { ano: d.getFullYear(), mesIdx: d.getMonth() }; break; }
    }
    // Última semana do mês (ex: 24 a 28 em mês que termina num fim de semana)
    if (!fechaMes) {
      const fimMes = new Date(r.fim.getFullYear(), r.fim.getMonth() + 1, 0);
      const diasUteisDepois = [];
      for (let d = new Date(r.fim); d < fimMes;) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) diasUteisDepois.push(d); }
      if (diasUteisDepois.length === 0) fechaMes = { ano: r.fim.getFullYear(), mesIdx: r.fim.getMonth() };
    }
    const alvo = fechaMes || { ano: r.fim.getFullYear(), mesIdx: r.fim.getMonth() };
    relFillMesSelect(relMonthKey(alvo.ano, alvo.mesIdx));
    document.getElementById('relIncluirMes').checked = !!fechaMes;
    relSyncMesBox();
    relLoadMonthFields();
  }
  relRecompute();
}

function relSyncMesBox() {
  const on = document.getElementById('relIncluirMes').checked;
  document.getElementById('relMesBox').classList.toggle('rel-dim', !on);
}

function relFillMesSelect(selected) {
  const sel = document.getElementById('relMes');
  const keys = new Set();
  const hoje = new Date();
  for (let i = 0; i < 12; i++) { const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); keys.add(relMonthKey(d.getFullYear(), d.getMonth())); }
  if (selected) keys.add(selected);
  const sorted = [...keys].sort().reverse();
  sel.innerHTML = sorted.map(k => {
    const [y, m] = k.split('-');
    return `<option value="${k}">${MESES_PT[+m - 1]} ${y}</option>`;
  }).join('');
  sel.value = selected || sorted[0];
}

function relLoadMonthFields() {
  const mk = document.getElementById('relMes').value;
  const saved = relStoreGet('relM:' + mk);
  document.querySelectorAll('[data-rel-m]').forEach(el => { el.value = saved[el.getAttribute('data-rel-m')] || ''; });
}

// Soma dos campos manuais das semanas salvas que começam no mês.
function relSumWeeks(mk, field) {
  let total = 0, semanas = 0;
  relStoreKeys('relW:').forEach(k => {
    // A semana conta para o mês em que ela termina (a sexta-feira)
    const fim = k.slice(16, 26);
    if (fim.slice(0, 7) !== mk) return;
    const v = relNumOrNull(relStoreGet(k)[field]);
    if (v != null) { total += v; semanas++; }
  });
  return { total, semanas };
}

// ── cálculo ──────────────────────────────────────────────────────────────────
async function relRecompute() {
  const r = relGetRange(); if (!r) return;
  const token = ++relToken;

  const lista = (typeof ocorrencias !== 'undefined' ? ocorrencias : [])
    .filter(o => o.data >= r.ini && o.data <= r.fimEnd)
    .sort((a, b) => a.data - b.data);
  const devolucoes = lista.filter(o => o.categoria === 'Devolução');
  const ocorrList  = lista.filter(o => o.categoria !== 'Devolução');

  if (!relDataLoaded && typeof ocorrencias !== 'undefined' && ocorrencias.length) { relDataLoaded = true; relLastSync = new Date(); }
  // Planilha ainda não chegou: tenta de novo em instantes (sem depender do app.js avisar)
  if (!relDataLoaded) setTimeout(() => { if (token === relToken) relRecompute(); }, 1500);
  relState = Object.assign(relState || {}, { range: r, devolucoes, ocorrList, vendasSemana: null, vendasSemanaOk: false, abasFaltando: [] });
  relRenderItems();
  relRenderAutoList();
  relRenderPreview();
  relRenderStatus('Lendo a planilha…', 'loading');

  // Vendas da semana (pode cruzar dois meses)
  const meses = relMonthsBetween(r.vendasIni, r.fim);
  const mk = document.getElementById('relMes').value;
  const [ano, mm] = mk.split('-').map(Number);
  const [resSemana, resMes, resCaros] = await Promise.all([
    Promise.all(meses.map(m => relLoadMonth(m.ano, m.mesIdx))),
    relLoadMonth(ano, mm - 1),
    relLoadCaros(),
  ]);
  if (token !== relToken) return;

  const okSemana = resSemana.every(x => x.ok);
  const naJanela = v => v.date >= r.vendasIni && v.date <= r.vendasFim;
  const rowsSemana = resSemana.flatMap(x => x.rows).filter(naJanela);
  const vendasSemana = rowsSemana.reduce((a, v) => a + v.qtd, 0);

  // Produtos caros: na semana e no mês do resumo
  const carosSemanaRows = resCaros.rows.map(v => Object.assign({}, v, { date: relCarosDate(v, r.fim) }))
    .filter(naJanela);
  const refMes = new Date(ano, mm - 1, 15);
  relState.carosOk = resCaros.ok;
  relState.carosSemana = resCaros.ok ? carosSemanaRows.reduce((a, v) => a + v.qtd, 0) : null;
  relState.mesCaros = resCaros.ok
    ? resCaros.rows.filter(v => { const d = relCarosDate(v, refMes); return d.getFullYear() === ano && d.getMonth() === mm - 1; }).reduce((a, v) => a + v.qtd, 0)
    : null;

  const todasSemana = rowsSemana.concat(carosSemanaRows);
  const dias = [];
  if (r.iniSabado) {
    const sexAnt = new Date(r.ini); sexAnt.setDate(r.ini.getDate() - 1);
    dias.push({ date: sexAnt, noite: true, qtd: todasSemana.filter(v => v.date < r.ini).reduce((a, v) => a + v.qtd, 0) });
  }
  for (let d = new Date(r.ini); d <= r.fim; d.setDate(d.getDate() + 1)) {
    const iso = relISO(d);
    dias.push({ date: new Date(d), qtd: todasSemana.filter(v => relISO(v.date) === iso).reduce((a, v) => a + v.qtd, 0) });
  }
  relState.vendasPorDia = okSemana ? dias : null;
  relState.vendasSemana = okSemana ? vendasSemana : null;
  relState.vendasSemanaOk = okSemana;
  relState.abasFaltando = resSemana.filter(x => !x.ok).map(x => x.nome);

  relState.mesVendas = resMes.ok ? resMes.rows.reduce((a, v) => a + v.qtd, 0) : null;
  relState.mesAbaNome = resMes.nome;
  relState.mesAbaOk = resMes.ok;

  relUpdateMonthAutos();
  relRenderAutoList();
  relRenderPreview();
  const hora = (relLastSync || new Date()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (!relDataLoaded) relRenderStatus('Lendo a planilha…', 'loading');
  else if (relState.abasFaltando.length) relRenderStatus(`Aba “${relState.abasFaltando.join('”, “')}” não encontrada — digite as vendas em “Corrigir vendas”`, 'warn');
  else relRenderStatus(`Planilha lida às ${hora}`, 'ok');
}

function relMonthAuto() {
  const mk = document.getElementById('relMes').value;
  const [ano, mm] = mk.split('-').map(Number);
  const doMes = (typeof ocorrencias !== 'undefined' ? ocorrencias : []).filter(o => o.ano === ano && o.mesIdx === mm - 1);
  const devMes = doMes.filter(o => o.categoria === 'Devolução');
  return {
    mk, ano, mesIdx: mm - 1,
    vendasML: relState && relState.mesVendas != null ? relState.mesVendas : null,
    shopee: relSumWeeks(mk, 'shopee'),
    caros: relState && relState.mesCaros != null ? relState.mesCaros : null,
    devol: devMes.length,
    devDef: devMes.filter(o => relDevMotivo(o) === 'defeito').length,
    devArr: devMes.filter(o => relDevMotivo(o) === 'arrep').length,
    devOutro: devMes.filter(o => relDevMotivo(o) === 'outro').length,
    ocorr: doMes.length - devMes.length,
    desist: relSumWeeks(mk, 'desist'),
    adic: relSumWeeks(mk, 'adic'),
    valorDevolvido: devMes.reduce((a, o) => a + (o.precoVenda || 0), 0),
  };
}

function relUpdateMonthAutos() {
  const a = relMonthAuto();
  const setAuto = (id, val, txt) => {
    const input = document.getElementById(id);
    const span = document.getElementById(id + '_auto');
    if (input) input.placeholder = val == null ? '—' : String(val);
    if (span) span.textContent = txt || '';
  };
  setAuto('relM_vendasML', a.vendasML,
    relState && relState.mesAbaOk === false ? `aba “${relState.mesAbaNome}” não encontrada` : `aba ${relState ? relState.mesAbaNome || '' : ''}`);
  setAuto('relM_shopee', a.shopee.total, `soma de ${a.shopee.semanas} semana(s)`);
  setAuto('relM_caros', a.caros, relState && relState.carosOk === false ? 'aba “Produtos caros” não encontrada' : 'aba Produtos caros');
  const wc = document.getElementById('relW_caros');
  if (wc) wc.placeholder = relState && relState.carosSemana != null ? String(relState.carosSemana) : '…';
  setAuto('relM_devDef', a.devDef, 'aba Ocorrências');
  setAuto('relM_devArr', a.devArr, 'aba Ocorrências' + (a.devOutro ? ` · +${a.devOutro} outros motivos` : ''));
  setAuto('relM_ocorr', a.ocorr, 'aba Ocorrências');
  setAuto('relM_desist', a.desist.total, `soma de ${a.desist.semanas} semana(s)`);
  setAuto('relM_adic', a.adic.total, `soma de ${a.adic.semanas} semana(s)`);

  const wIn = document.getElementById('relW_vendasML');
  const wSpan = document.getElementById('relW_vendasML_auto');
  if (relState && relState.vendasSemana != null) {
    wIn.placeholder = String(relState.vendasSemana);
    wSpan.textContent = 'automático da planilha';
  } else if (relState && relState.abasFaltando && relState.abasFaltando.length) {
    wIn.placeholder = 'preencher';
    wSpan.textContent = `aba “${relState.abasFaltando.join('”, “')}” não encontrada`;
  } else {
    wIn.placeholder = '…';
    wSpan.textContent = 'carregando…';
  }
}

// Junta automático + manual num único objeto com os números finais.
function relCollect() {
  const r = relState.range;
  const w = relStoreGet(relWeekKey(r.iniISO, r.fimISO));
  const pick = (manual, auto) => { const m = relNumOrNull(manual); return m != null ? m : auto; };

  const itemFilter = o => !relStoreGet(relItemKey(o)).excluir;
  const semana = {
    vendasML: pick(w.vendasML, relState.vendasSemana),
    shopee: pick(w.shopee, 0),
    outras: pick(w.caros, relState.carosSemana),
    vendasPorDia: relState.vendasPorDia,
    desist: relNumOrNull(w.desist),
    adic: relNumOrNull(w.adic),
    estoque: relNumOrNull(w.estoque),
    obs: (w.obs || '').trim(),
    devolucoes: relState.devolucoes.filter(itemFilter),
    ocorrencias: relState.ocorrList.filter(itemFilter),
  };
  semana.devolTotal = relState.devolucoes.length;
  semana.devSplit = relSplitDev(semana.devolucoes);
  semana.devSplitTotal = relSplitDev(relState.devolucoes);
  semana.ocorrTotal = relState.ocorrList.length;
  semana.vendasTotal = semana.vendasML == null ? null : semana.vendasML + (semana.shopee || 0) + (semana.outras || 0);

  let mes = null;
  if (document.getElementById('relIncluirMes').checked) {
    const a = relMonthAuto();
    const m = relStoreGet('relM:' + a.mk);
    mes = {
      nome: MESES_PT[a.mesIdx], ano: a.ano,
      vendasML: pick(m.vendasML, a.vendasML),
      shopee: pick(m.shopee, a.shopee.total),
      outras: pick(m.caros, a.caros),
      devDef: pick(m.devDef, a.devDef),
      devArr: pick(m.devArr, a.devArr),
      devOutro: a.devOutro,
      desist: pick(m.desist, a.desist.semanas ? a.desist.total : null),
      ocorr: pick(m.ocorr, a.ocorr),
      adic: pick(m.adic, a.adic.semanas ? a.adic.total : null),
      valorDevolvido: a.valorDevolvido,
    };
    mes.vendasTotal = (mes.vendasML || 0) + (mes.shopee || 0) + (mes.outras || 0);
    mes.devol = (mes.devDef || 0) + (mes.devArr || 0) + (mes.devOutro || 0);
  }
  return { r, semana, mes };
}

// ── lista de itens (painel lateral) ─────────────────────────────────────────
function relRenderItems() {
  const el = document.getElementById('relItens');
  const { devolucoes, ocorrList } = relState;
  const all = [...devolucoes, ...ocorrList];
  document.getElementById('relItensCount').textContent =
    `${devolucoes.length} devolução(ões) · ${ocorrList.length} ocorrência(s)`;
  if (!all.length) { el.innerHTML = '<div class="rel-hint">Nenhum registro na aba Ocorrências neste período.</div>'; return; }

  el.innerHTML = all.map(o => {
    const key = relItemKey(o);
    const s = relStoreGet(key);
    const isDev = o.categoria === 'Devolução';
    return `
      <div class="rel-item ${s.excluir ? 'rel-item-off' : ''}" data-rel-item="${relEsc(key)}">
        <label class="rel-item-head">
          <input type="checkbox" ${s.excluir ? '' : 'checked'}>
          <span class="rel-item-tag ${isDev ? 'rel-tag-dev' : 'rel-tag-oc'}">${isDev ? 'Devolução' : 'Ocorrência'}</span>
          <span class="rel-item-title">${relEsc(o.produto || 'Produto não informado')}</span>
        </label>
        <div class="rel-item-meta">OS ${relEsc(o.os || '—')} · ${relDMY(o.data)} · ${relEsc(relSubtipo(o.tipo))}</div>
        <textarea rows="1" placeholder="Observação (ex: cliente não responde há 3 dias)">${relEsc(s.obs || '')}</textarea>
      </div>`;
  }).join('');
}

// ── e-mail / imagem (HTML com estilos inline, compatível com Gmail/Outlook) ──
const REL_C = {
  text: '#1a2332', muted: '#5a6a7a', soft: '#7a8a9a', line: '#e4eaef', bg: '#f4f7f9',
  green: '#1a7a45', greenBar: '#3cb878', teal: '#2ab5b5', red: '#b91c1c', redBar: '#ef4444', redBg: '#fdecec',
  amber: '#92400e', amberBar: '#f59e0b', amberBg: '#fef3c7',
  blue: '#1d4ed8', blueBar: '#3b82f6', blueBg: '#e8f0fe', okBg: '#e7f6ee', purple: '#7c3aed',
};
const REL_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function relTile(label, value, sub, color, accent) {
  return `<td width="25%" valign="top" style="padding:5px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-top:3px solid ${accent || REL_C.line};border-radius:8px;background:#ffffff">
      <tr><td style="padding:11px 12px 10px">
        <div style="font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${REL_C.soft};font-weight:bold">${label}</div>
        <div style="font-size:28px;line-height:1.1;font-weight:bold;color:${color || REL_C.text};margin-top:5px">${value}</div>
        <div style="font-size:11px;color:${REL_C.soft};margin-top:3px">${sub || '&nbsp;'}</div>
      </td></tr>
    </table>
  </td>`;
}

function relBadge(txt, fg, bg) {
  return `<span style="display:inline-block;font-size:10.5px;font-weight:bold;color:${fg};background:${bg};border-radius:999px;padding:2px 9px;white-space:nowrap">${relEsc(txt)}</span>`;
}

function relStatusBadge(o) {
  const st = statusResolucao(o);
  if (st.key === 'reembolsado') return relBadge('✓ Reembolsado', REL_C.green, REL_C.okBg);
  if (st.key === 'pendente') return relBadge('⏳ Aguardando chegar', REL_C.amber, REL_C.amberBg);
  return relBadge('Em andamento', REL_C.muted, REL_C.bg);
}

function relPanel(title, inner) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-radius:10px;background:#ffffff">
    <tr><td style="padding:13px 14px 12px">
      <div style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${REL_C.muted};font-weight:bold;margin-bottom:10px">${title}</div>
      ${inner}
    </td></tr>
  </table>`;
}

function relSectionTitle(txt, count, color, extra) {
  return `<tr><td style="padding:22px 24px 10px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
      <td style="font-size:16px;font-weight:bold;color:${REL_C.text}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color};margin-right:8px"></span>${txt}
        <span style="display:inline-block;font-size:12px;color:#ffffff;background:${color};border-radius:999px;padding:1px 9px;margin-left:6px;vertical-align:2px">${count}</span>
      </td>
      <td align="right" style="font-size:12px;color:${REL_C.soft}">${extra || ''}</td>
    </tr></table>
  </td></tr>`;
}

// Barras verticais: vendas por dia
function relDayChart(dias) {
  if (!dias || !dias.length) return `<div style="font-size:12px;color:${REL_C.soft}">Sem dados de vendas por dia.</div>`;
  const max = Math.max(1, ...dias.map(d => d.qtd));
  const H = 84;
  const cols = dias.map(d => {
    const h = d.qtd ? Math.max(8, Math.round(d.qtd / max * H)) : 3;
    return `<td align="center" valign="bottom" style="padding:0 4px;height:${H + 18}px">
      <div style="font-size:12px;font-weight:bold;color:${d.qtd ? REL_C.text : '#b0bac4'};margin-bottom:3px">${d.qtd}</div>
      <div style="height:${h}px;background:${d.qtd ? REL_C.greenBar : REL_C.line};border-radius:4px 4px 0 0;font-size:0;line-height:0">&nbsp;</div>
    </td>`;
  }).join('');
  const labels = dias.map(d => `<td align="center" style="padding:5px 2px 0;font-size:10.5px;color:${REL_C.soft};border-top:1px solid ${REL_C.line}"><b style="color:${REL_C.muted}">${REL_DIAS[d.date.getDay()]}${d.noite ? '*' : ''}</b><br>${relDM(d.date)}</td>`).join('');
  const nota = dias.some(d => d.noite) ? `<div style="font-size:10px;color:${REL_C.soft};margin-top:6px">* sexta anterior, depois das ${relEsc(relGetCorte())}</div>` : '';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed"><tr>${cols}</tr><tr>${labels}</tr></table>${nota}`;
}

// Barras horizontais: [{label, qtd, color}]
function relHBars(items, total) {
  if (!items.length) return `<div style="font-size:12px;color:${REL_C.soft}">Nada nesta semana.</div>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${items.map(it => {
    const w = total ? Math.max(4, Math.round(it.qtd / total * 100)) : 0;
    return `<tr>
      <td style="font-size:12px;color:${REL_C.text};padding:4px 8px 4px 0;white-space:nowrap" width="1%">${relEsc(it.label)}</td>
      <td style="padding:4px 0">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${REL_C.bg};border-radius:5px"><tr>
          <td width="${w}%" style="background:${it.color};height:14px;border-radius:5px;font-size:0;line-height:0">&nbsp;</td>${w < 100 ? '<td style="font-size:0;line-height:0">&nbsp;</td>' : ''}
        </tr></table>
      </td>
      <td align="right" width="1%" style="font-size:12.5px;font-weight:bold;color:${REL_C.text};padding:4px 0 4px 8px;white-space:nowrap">${it.qtd}</td>
    </tr>`;
  }).join('')}</table>`;
}

function relAgrupar(lista, fnLabel, cores) {
  const map = new Map();
  lista.forEach(o => { const k = fnLabel(o); map.set(k, (map.get(k) || 0) + 1); });
  const palette = cores || ['#ef4444', '#f59e0b', '#8b5cf6', '#3b82f6', '#14b8a6', '#64748b'];
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, qtd], i) => ({ label, qtd, color: palette[i % palette.length] }));
}

function relItemCard(o, isDev, n) {
  const s = relStoreGet(relItemKey(o));
  const mt = isDev ? REL_MOTIVOS[relDevMotivo(o)] : null;
  const fg = isDev ? mt.fg : REL_C.blue, bg = isDev ? mt.bg : REL_C.blueBg;
  const meta = [`OS <b style="color:${REL_C.text}">${relEsc(o.os || '—')}</b>`, relDMY(o.data)].join(' &nbsp;·&nbsp; ');

  let troca = '';
  if (!isDev) {
    const linhas = [];
    if (o.ocorrencia1) linhas.push('↪ ' + relEsc(o.ocorrencia1) + (o.custo1 != null ? ` <b>${relMoney(o.custo1)}</b>` : ''));
    if (o.ocorrencia2) linhas.push('↪ ' + relEsc(o.ocorrencia2) + (o.custo2 != null ? ` <b>${relMoney(o.custo2)}</b>` : ''));
    if (o.custoPrimeiro != null) linhas.push(`Custo do 1º aparelho: <b>${relMoney(o.custoPrimeiro)}</b>`);
    if (linhas.length) troca = `<div style="font-size:12px;line-height:1.5;color:${REL_C.blue};background:${REL_C.blueBg};border-radius:6px;padding:6px 9px;margin-top:7px">${linhas.join('<br>')}</div>`;
  }

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-radius:10px;margin:0 0 8px;background:#ffffff">
    <tr>
      <td width="44" valign="top" style="padding:12px 0 12px 12px">
        <div style="width:30px;height:30px;border-radius:15px;background:${bg};color:${fg};font-weight:bold;font-size:13px;line-height:30px;text-align:center">${n}</div>
      </td>
      <td valign="top" style="padding:11px 10px 11px 6px">
        <div style="font-size:14px;font-weight:bold;color:${REL_C.text};line-height:1.3">${relEsc(o.produto || 'Produto não informado')}</div>
        <div style="margin-top:4px">${relBadge(relSubtipo(o.tipo), fg, bg)} <span style="font-size:11.5px;color:${REL_C.soft};margin-left:4px">${meta}</span></div>
        ${o.defeito ? `<div style="font-size:12.5px;line-height:1.5;color:${REL_C.muted};margin-top:7px">“${relEscBr(o.defeito)}”</div>` : ''}
        ${troca}
        ${o.resolucao ? `<div style="font-size:12px;line-height:1.45;color:${REL_C.text};margin-top:7px"><b style="color:${REL_C.muted}">Resolução:</b> ${relEscBr(o.resolucao)}</div>` : ''}
        ${s.obs ? `<div style="font-size:12px;line-height:1.5;color:${REL_C.amber};background:${REL_C.amberBg};border-radius:6px;padding:6px 9px;margin-top:7px"><b>Obs:</b> ${relEscBr(s.obs)}</div>` : ''}
      </td>
      <td width="130" valign="top" align="right" style="padding:12px 12px 12px 0">
        ${relStatusBadge(o)}
        ${o.precoVenda != null ? `<div style="font-size:15px;font-weight:bold;color:${REL_C.text};margin-top:8px">${relMoney(o.precoVenda)}</div><div style="font-size:10.5px;color:${REL_C.soft}">valor da venda</div>` : ''}
        ${o.freteDevolucao != null ? `<div style="font-size:11px;color:${REL_C.red};margin-top:4px">frete ${relMoney(o.freteDevolucao)}</div>` : ''}
      </td>
    </tr>
  </table>`;
}

function relRateTile(label, qtd, base, color, bg, width) {
  const pct = qtd != null && base ? relPctNum(qtd, base) : null;
  const w = pct == null ? 0 : Math.max(3, Math.min(100, Math.round(pct)));
  return `<td width="${width || '33%'}" valign="top" style="padding:5px;vertical-align:top">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-radius:10px;background:${bg}">
      <tr><td style="padding:13px 14px 12px">
        <div style="font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${color};font-weight:bold">${label}</div>
        <div style="font-size:30px;line-height:1.1;font-weight:bold;color:${color};margin-top:5px">${pct == null ? '—' : relPct(qtd, base)}</div>
        <div style="font-size:11.5px;color:${REL_C.muted};margin:3px 0 9px">${qtd == null ? 'não informado' : `${relN(qtd)} de ${relN(base)} vendas`}</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:rgba(255,255,255,.75);border-radius:4px"><tr>
          ${w ? `<td width="${w}%" style="background:${color};height:7px;border-radius:4px;font-size:0;line-height:0">&nbsp;</td>` : ''}${w < 100 ? '<td style="height:7px;font-size:0;line-height:0">&nbsp;</td>' : ''}
        </tr></table>
      </td></tr>
    </table>
  </td>`;
}

function relBuildEmailHtml(d) {
  const { r, semana: s, mes } = d;
  const periodo = `${relDM(r.ini)} a ${relDMY(r.fim)}`;
  const saud = (() => { const h = new Date().getHours(); return h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite'; })();
  const nn = v => (v == null ? '<span style="color:#b0bac4">—</span>' : relN(v));
  const valorDev = s.devolucoes.reduce((a, o) => a + (o.precoVenda || 0), 0);
  const subVendas = [`ML ${relN(s.vendasML)}`, s.shopee ? `Shopee ${relN(s.shopee)}` : '', s.outras ? `Caros ${relN(s.outras)}` : ''].filter(Boolean).join(' · ');

  const motivos = ['defeito', 'arrep', 'outro']
    .map(k => ({ label: REL_MOTIVOS[k].curto, qtd: s.devSplit[k].length, color: REL_MOTIVOS[k].cor }))
    .filter(it => it.qtd > 0);
  const situacao = relAgrupar(s.devolucoes, o => {
    const k = statusResolucao(o).key;
    return k === 'reembolsado' ? 'Reembolsado' : k === 'pendente' ? 'Aguardando chegar' : 'Em andamento';
  }).map(it => Object.assign(it, { color: it.label === 'Reembolsado' ? REL_C.greenBar : it.label === 'Aguardando chegar' ? REL_C.amberBar : '#94a3b8' }));

  let html = `<div style="background:${REL_C.bg};padding:16px 0;font-family:Arial,Helvetica,sans-serif">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;border-collapse:separate;background:#ffffff;border:1px solid ${REL_C.line};border-radius:14px;font-family:Arial,Helvetica,sans-serif;color:${REL_C.text}">
    <tr><td style="background-color:${REL_C.teal};background-image:linear-gradient(135deg,#3cb878 0%,#2ab5b5 100%);padding:24px 26px;border-radius:14px 14px 0 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        <td>
          <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#e9fff7;font-weight:bold">Grupo PLL · Relatório semanal${mes ? ' + resumo do mês' : ''}</div>
          <div style="font-size:26px;font-weight:bold;color:#ffffff;margin-top:5px">${periodo}</div>
          <div style="font-size:13px;color:#e9fff7;margin-top:3px">${r.iniSabado ? `Vendas de sexta ${relDM(new Date(r.vendasIni))} (depois das ${relEsc(r.corte)}) até ${r.fimSexta ? `sexta ${relDM(r.fim)} (${relEsc(r.corte)})` : relDM(r.fim)}` : 'Vendas, devoluções e ocorrências da semana'}</div>
        </td>
        <td align="right" valign="middle" width="120">
          <div style="display:inline-block;background:rgba(255,255,255,.18);border-radius:12px;padding:10px 14px;text-align:center">
            <div style="font-size:30px;font-weight:bold;color:#ffffff;line-height:1">${nn(s.vendasTotal)}</div>
            <div style="font-size:10.5px;color:#e9fff7;text-transform:uppercase;letter-spacing:.06em;margin-top:3px">vendas</div>
          </div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:18px 26px 4px;font-size:14px;line-height:1.6">
      Olá pessoal, ${saud}. Tudo bem? Segue o resumo da semana.
    </td></tr>
    ${s.obs ? `<tr><td style="padding:6px 26px 0"><div style="font-size:13px;line-height:1.55;background:${REL_C.bg};border-left:3px solid ${REL_C.teal};border-radius:6px;padding:10px 12px">${relEscBr(s.obs)}</div></td></tr>` : ''}

    <tr><td style="padding:12px 21px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        ${relTile('Total de vendas', nn(s.vendasTotal), subVendas, REL_C.green, REL_C.greenBar)}
        ${relTile('Mercado Livre', nn(s.vendasML), '2 contas', null, REL_C.teal)}
        ${relTile('Shopee', nn(s.shopee), '&nbsp;', null, '#f97316')}
        ${relTile('Produtos caros', nn(s.outras), 'aba Produtos caros', null, '#64748b')}
      </tr><tr>
        ${relTile('Dev. por defeito', nn(s.devSplitTotal.defeito.length), 'problema no aparelho', REL_MOTIVOS.defeito.fg, REL_MOTIVOS.defeito.cor)}
        ${relTile('Dev. arrependimento', nn(s.devSplitTotal.arrep.length), 'cliente desistiu', REL_MOTIVOS.arrep.fg, REL_MOTIVOS.arrep.cor)}
        ${relTile('Desistências', nn(s.desist), 'vendas canceladas', REL_C.amber, REL_C.amberBar)}
        ${relTile('Ocorrências', nn(s.ocorrTotal), 'trocas / erros', REL_C.blue, REL_C.blueBar)}
      </tr><tr>
        ${relTile('Total devoluções', nn(s.devolTotal), valorDev ? relMoney(valorDev) + ' em vendas' : '&nbsp;', REL_C.red, '#b91c1c')}
        ${relTile('Adicionados ao estoque', nn(s.adic), 'na semana', null, '#14b8a6')}
        ${relTile('Total em estoque', nn(s.estoque), 'aparelhos', null, REL_C.purple)}
        <td width="25%" style="padding:5px">&nbsp;</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:12px 21px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        <td width="50%" valign="top" style="padding:5px">${relPanel('Vendas por dia', relDayChart(s.vendasPorDia))}</td>
        <td width="50%" valign="top" style="padding:5px">${relPanel('Devoluções · motivo', relHBars(motivos, s.devolucoes.length))}
          <div style="height:10px;font-size:0;line-height:0">&nbsp;</div>
          ${relPanel('Devoluções · situação', relHBars(situacao, s.devolucoes.length))}</td>
      </tr></table>
    </td></tr>`;

  ['defeito', 'arrep', 'outro'].forEach(k => {
    const lista = s.devSplit[k];
    if (k === 'outro' && !lista.length) return;
    const mt = REL_MOTIVOS[k];
    const val = lista.reduce((a, o) => a + (o.precoVenda || 0), 0);
    html += relSectionTitle(mt.label, lista.length, mt.cor, val ? `Total em vendas: <b style="color:${mt.fg}">${relMoney(val)}</b>` : '');
    html += `<tr><td style="padding:0 26px">${lista.length
      ? lista.map((o, i) => relItemCard(o, true, i + 1)).join('')
      : `<div style="font-size:13px;color:${REL_C.soft};background:${REL_C.bg};border-radius:8px;padding:12px">✓ Nenhuma nesta semana.</div>`}</td></tr>`;
  });

  html += relSectionTitle('Ocorrências', s.ocorrencias.length, REL_C.blueBar);
  html += `<tr><td style="padding:0 26px">${s.ocorrencias.length
    ? s.ocorrencias.map((o, i) => relItemCard(o, false, i + 1)).join('')
    : `<div style="font-size:13px;color:${REL_C.soft};background:${REL_C.bg};border-radius:8px;padding:12px">✓ Nenhuma ocorrência nesta semana.</div>`}</td></tr>`;

  if (mes) {
    const base = mes.vendasTotal;
    const problemas = [mes.devol, mes.desist, mes.ocorr].every(v => v != null) ? mes.devol + mes.desist + mes.ocorr : null;
    const destaque = base && mes.devol != null
      ? `Em ${mes.nome} vendemos <b>${relN(base)}</b> produtos e tivemos <b style="color:${REL_C.red}">${relN(mes.devol)}</b> devoluções — <b style="color:${REL_C.red}">${relPct(mes.devol, base)}</b> das vendas: <b style="color:${REL_MOTIVOS.defeito.fg}">${relN(mes.devDef)} por defeito (${relPct(mes.devDef, base)})</b> e <b style="color:${REL_MOTIVOS.arrep.fg}">${relN(mes.devArr)} por arrependimento (${relPct(mes.devArr, base)})</b>${mes.devOutro ? ` e ${relN(mes.devOutro)} por outros motivos` : ''}.`
      : '';
    const linha = (label, val, bold) => `<tr>
      <td style="padding:7px 0;border-bottom:1px solid ${REL_C.line};font-size:13px;color:${REL_C.text};${bold ? 'font-weight:bold' : ''}">${label}</td>
      <td align="right" style="padding:7px 0;border-bottom:1px solid ${REL_C.line};font-size:14px;font-weight:bold;color:${bold ? REL_C.green : REL_C.text}">${val == null ? '<span style="color:#b0bac4;font-weight:normal">não informado</span>' : relN(val)}</td>
    </tr>`;

    html += `<tr><td style="padding:26px 26px 4px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-radius:12px;background:#fbfcfd">
        <tr><td style="padding:16px 18px 6px">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${REL_C.teal};font-weight:bold">Resumo do mês</div>
          <div style="font-size:21px;font-weight:bold;color:${REL_C.text};margin-top:2px">${mes.nome} ${mes.ano}</div>
          ${destaque ? `<div style="font-size:13.5px;line-height:1.55;margin-top:6px">${destaque}</div>` : ''}
        </td></tr>
        <tr><td style="padding:6px 13px 4px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
            ${relRateTile('Por defeito', mes.devDef, base, REL_MOTIVOS.defeito.fg, REL_MOTIVOS.defeito.bg, '25%')}
            ${relRateTile('Arrependimento', mes.devArr, base, REL_MOTIVOS.arrep.fg, REL_MOTIVOS.arrep.bg, '25%')}
            ${relRateTile('Desistências', mes.desist, base, REL_C.amber, REL_C.amberBg, '25%')}
            ${relRateTile('Ocorrências', mes.ocorr, base, REL_C.blue, REL_C.blueBg, '25%')}
          </tr></table>
        </td></tr>
        <tr><td style="padding:8px 18px 14px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
            <td width="48%" valign="top" style="vertical-align:top">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                ${linha('Vendas Mercado Livre (2 contas)', mes.vendasML)}
                ${linha('Vendas Shopee', mes.shopee)}
                ${linha('Vendas produtos caros', mes.outras)}
                ${linha('Total de vendas', base, true)}
              </table>
            </td>
            <td width="4%">&nbsp;</td>
            <td width="48%" valign="top" style="vertical-align:top">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                ${linha('Devoluções por defeito', mes.devDef)}
                ${linha('Devoluções por arrependimento', mes.devArr)}
                ${mes.devOutro ? linha('Outras devoluções', mes.devOutro) : ''}
                ${linha('Total de devoluções', mes.devol)}
                ${linha('Desistências', mes.desist)}
                ${linha('Ocorrências', mes.ocorr)}
                ${linha('Adicionados ao estoque', mes.adic)}
              </table>
            </td>
          </tr></table>
          ${problemas != null && base ? `<div style="font-size:12.5px;color:${REL_C.text};background:#f3eefe;border-radius:8px;padding:9px 12px;margin-top:12px">Total de problemas pós-venda: <b style="color:${REL_C.purple}">${relN(problemas)}</b> (${relPct(problemas, base)} das vendas)${mes.valorDevolvido ? ` · Valor dos aparelhos devolvidos: <b style="color:${REL_C.red}">${relMoney(mes.valorDevolvido)}</b>` : ''}</div>` : ''}
        </td></tr>
      </table>
    </td></tr>`;
  }

  html += `<tr><td style="padding:18px 26px 22px;font-size:11px;color:${REL_C.soft}">
      Gerado a partir da planilha de controle em ${new Date().toLocaleDateString('pt-BR')}. Qualquer dúvida, é só chamar.
    </td></tr>
  </table></div>`;
  return html;
}

// ── versão texto (WhatsApp / e-mail simples) ────────────────────────────────
function relBuildText(d) {
  const { r, semana: s, mes } = d;
  const v = x => (x == null ? '—' : relN(x));
  const L = [];
  L.push('Olá pessoal, boa tarde. Tudo bem?');
  L.push(`Segue relatório semanal (${relDM(r.ini)} a ${relDMY(r.fim)})`);
  if (r.iniSabado) L.push(`(vendas de sexta ${relDM(new Date(r.vendasIni))} depois das ${r.corte} até ${r.fimSexta ? `sexta ${relDM(r.fim)} às ${r.corte}` : relDM(r.fim)})`);
  if (s.obs) { L.push(''); L.push(s.obs); }
  L.push('');
  L.push(`• Vendas Mercado Livre: ${v(s.vendasML)} (total 2 contas)`);
  L.push(`• Vendas Shopee: ${v(s.shopee)}`);
  L.push(`• Vendas produtos caros: ${v(s.outras)}`);
  L.push(`• Total de vendas: ${v(s.vendasTotal)}`);
  L.push(`• Devoluções por defeito: ${v(s.devSplitTotal.defeito.length)}`);
  L.push(`• Devoluções por arrependimento: ${v(s.devSplitTotal.arrep.length)}`);
  if (s.devSplitTotal.outro.length) L.push(`• Outras devoluções: ${v(s.devSplitTotal.outro.length)}`);
  L.push(`• Desistências: ${v(s.desist)}`);
  L.push(`• Adicionados ao estoque: ${v(s.adic)}`);
  L.push(`• Total estoque: ${v(s.estoque)}`);
  L.push(`• Ocorrências: ${v(s.ocorrTotal)}`);

  const bloco = (titulo, itens, isDev) => {
    L.push(''); L.push(`${titulo} (${itens.length})`);
    if (!itens.length) { L.push('Nenhuma nesta semana.'); return; }
    itens.forEach(o => {
      const st = statusResolucao(o);
      const obs = relStoreGet(relItemKey(o)).obs;
      L.push('');
      L.push(`• OS ${o.os || '—'} — ${o.produto || 'Produto não informado'} (${relSubtipo(o.tipo)}) — ${relDMY(o.data)}`);
      if (o.defeito) L.push(`  Descrição: ${o.defeito.replace(/\n/g, ' ')}`);
      if (!isDev) {
        if (o.ocorrencia1) L.push(`  Troca: ${o.ocorrencia1}${o.custo1 != null ? ' — ' + relMoney(o.custo1) : ''}`);
        if (o.ocorrencia2) L.push(`  Troca 2: ${o.ocorrencia2}${o.custo2 != null ? ' — ' + relMoney(o.custo2) : ''}`);
      }
      L.push(`  Resolução: ${o.resolucao || '—'}${['pendente', 'reembolsado'].includes(st.key) ? ' [' + st.label + ']' : ''}`);
      if (obs) L.push(`  Obs: ${obs.replace(/\n/g, ' ')}`);
    });
  };
  bloco('DEVOLUÇÕES POR DEFEITO', s.devSplit.defeito, true);
  bloco('DEVOLUÇÕES POR ARREPENDIMENTO', s.devSplit.arrep, true);
  if (s.devSplit.outro.length) bloco('OUTRAS DEVOLUÇÕES', s.devSplit.outro, true);
  bloco('OCORRÊNCIAS', s.ocorrencias, false);

  if (mes) {
    const base = mes.vendasTotal;
    const p = x => (x != null && base ? ` (${relPct(x, base)} das vendas)` : '');
    L.push(''); L.push(`RESUMO DO MÊS DE ${mes.nome.toUpperCase()} ${mes.ano}`); L.push('');
    L.push(`• Vendas Mercado Livre: ${v(mes.vendasML)} (total 2 contas)`);
    L.push(`• Vendas Shopee: ${v(mes.shopee)}`);
    L.push(`• Vendas produtos caros: ${v(mes.outras)}`);
    L.push(`• Total de vendas: ${v(base)}`);
    L.push(`• Devoluções por defeito: ${v(mes.devDef)}${p(mes.devDef)}`);
    L.push(`• Devoluções por arrependimento: ${v(mes.devArr)}${p(mes.devArr)}`);
    if (mes.devOutro) L.push(`• Outras devoluções: ${v(mes.devOutro)}${p(mes.devOutro)}`);
    L.push(`• Total de devoluções: ${v(mes.devol)}${p(mes.devol)}`);
    L.push(`• Desistências: ${v(mes.desist)}${p(mes.desist)}`);
    L.push(`• Ocorrências: ${v(mes.ocorr)}${p(mes.ocorr)}`);
    L.push(`• Adicionados ao estoque: ${v(mes.adic)}`);
  }
  return L.join('\n');
}

// ── prévia e cópia ───────────────────────────────────────────────────────────
function relRenderPreview() {
  const el = document.getElementById('relPreview');
  if (!el || !relState || !relState.range) return;
  if (!relDataLoaded) { el.innerHTML = '<div class="rel-empty">Lendo a planilha…</div>'; return; }
  const d = relCollect();
  el.innerHTML = relBuildEmailHtml(d);
  relRenderFaltando(d);
}

function relToast(msg) {
  const t = document.getElementById('relToast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(relToast._t);
  relToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function relCopyHtml() {
  if (!relDataLoaded || !relState) { relToast('Aguarde um instante: a planilha ainda está carregando.'); return; }
  const d = relCollect();
  const html = relBuildEmailHtml(d);
  const txt = relBuildText(d);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([txt], { type: 'text/plain' }),
    })]);
    relToast('Copiado! Agora é só colar (Ctrl+V) no corpo do e-mail.');
  } catch (e) {
    // Plano B: seleciona a prévia e usa o copiar do navegador
    const el = document.getElementById('relPreview');
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    relToast(ok ? 'Copiado! Agora é só colar (Ctrl+V) no corpo do e-mail.' : 'Não consegui copiar. Selecione a prévia e use Ctrl+C.');
  }
}

async function relCopyText() {
  if (!relDataLoaded || !relState) { relToast('Aguarde um instante: a planilha ainda está carregando.'); return; }
  const txt = relBuildText(relCollect());
  try { await navigator.clipboard.writeText(txt); relToast('Texto copiado!'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    relToast(ok ? 'Texto copiado!' : 'Não consegui copiar o texto.');
  }
}

// ── imagem (PNG) ─────────────────────────────────────────────────────────────
// Renderiza o relatório numa área fora da tela, com largura fixa, e converte
// em PNG com html2canvas (carregado só quando for usado).
let relH2CPromise = null;
function relLoadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!relH2CPromise) {
    relH2CPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      sc.onload = () => resolve(window.html2canvas);
      sc.onerror = () => { relH2CPromise = null; reject(new Error('sem conexão para carregar o gerador de imagem')); };
      setTimeout(() => { if (!window.html2canvas) { relH2CPromise = null; reject(new Error('o gerador de imagem demorou para carregar, tente de novo')); } }, 15000);
      document.head.appendChild(sc);
    });
  }
  return relH2CPromise;
}

async function relRenderPng() {
  const h2c = await relLoadHtml2Canvas();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#f4f7f9;';
  host.innerHTML = relBuildEmailHtml(relCollect());
  document.body.appendChild(host);
  try {
    const canvas = await h2c(host, { scale: 2, backgroundColor: '#f4f7f9', useCORS: true, logging: false });
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  } finally {
    host.remove();
  }
}

function relImgName() {
  const r = relState.range;
  return `relatorio-semanal_${r.iniISO}_a_${r.fimISO}.png`;
}

async function relWithBusy(btnId, fn) {
  const btn = document.getElementById(btnId);
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando…';
  try { await fn(); } catch (e) { console.warn(e); relToast('Não consegui gerar a imagem: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = old; }
}

function relDownloadImage() {
  if (!relDataLoaded || !relState) { relToast('Aguarde um instante: a planilha ainda está carregando.'); return; }
  return relWithBusy('relBaixarImg', async () => {
    const blob = await relRenderPng();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = relImgName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    relToast('Imagem baixada! Pode anexar no e-mail ou enviar no WhatsApp.');
  });
}

function relCopyImage() {
  if (!relDataLoaded || !relState) { relToast('Aguarde um instante: a planilha ainda está carregando.'); return; }
  return relWithBusy('relCopiarImg', async () => {
    const blob = await relRenderPng();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    relToast('Imagem copiada! Cole (Ctrl+V) no WhatsApp ou no e-mail.');
  });
}

// ── aviso de versão nova ─────────────────────────────────────────────────────
// O GitHub Pages deixa o navegador guardar a página por alguns minutos. Aqui
// conferimos se o index.html publicado aponta para uma versão mais nova deste
// arquivo e, se sim, mostramos um aviso para recarregar.
const REL_VERSION = '20261109d';
async function relCheckVersion() {
  try {
    const r = await fetch('index.html?check=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.text()).match(/relatorio\.js\?v=([\w-]+)/);
    if (!m || m[1] === REL_VERSION || document.getElementById('relUpdateBar')) return;
    const bar = document.createElement('div');
    bar.id = 'relUpdateBar';
    bar.className = 'rel-update-bar';
    bar.innerHTML = '<span>✨ Saiu uma versão nova do painel.</span><button type="button">Atualizar agora</button>';
    bar.querySelector('button').addEventListener('click', () => {
      location.href = location.pathname + '?v=' + m[1] + location.hash;
    });
    document.body.appendChild(bar);
  } catch (e) { /* sem internet: ignora */ }
}
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(relCheckVersion, 3000);
  setInterval(relCheckVersion, 10 * 60 * 1000);
});
