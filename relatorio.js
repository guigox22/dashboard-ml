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

function relWeekKey(ini, fim) { return 'relW:' + ini + '_' + fim; }
function relItemKey(o) { return 'relI:' + (o.venda || o.os || o.produto) + '|' + relISO(o.data) + '|' + (o.tipo || ''); }

// Segunda a sexta da semana de `ref` (deslocada `offsetWeeks` semanas).
function relWeekRange(ref, offsetWeeks) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay(); // 0 dom … 6 sáb
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const ini = new Date(d); ini.setDate(d.getDate() + toMonday + 7 * offsetWeeks);
  const fim = new Date(ini); fim.setDate(ini.getDate() + 4);
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
      parseCSVFull(text).forEach(r => {
        const venda = (r[1] || '').trim();
        if (!venda.startsWith('#')) return;
        const m = (r[0] || '').trim().toLowerCase().match(/^(\d{1,2})\s+([a-zç]{3})/);
        if (!m) return;
        const mi = REL_MES_ABBR[m[2]];
        if (mi !== mesIdx) return;
        const qtd = parseInt(r[5], 10);
        rows.push({
          date: new Date(ano, mi, +m[1]),
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

function relMonthsBetween(ini, fim) {
  const out = [];
  const d = new Date(ini.getFullYear(), ini.getMonth(), 1);
  while (d <= fim) { out.push({ ano: d.getFullYear(), mesIdx: d.getMonth() }); d.setMonth(d.getMonth() + 1); }
  return out;
}

// ── inicialização ───────────────────────────────────────────────────────────
function renderRelatorio(opts = {}) {
  const page = document.getElementById('page-relatorio');
  if (!page) return;

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
    relRecompute();
  }
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

  document.getElementById('relCopiarHtml').addEventListener('click', relCopyHtml);
  document.getElementById('relCopiarTexto').addEventListener('click', relCopyText);
}

function relGetRange() {
  const iniISO = document.getElementById('relIni').value;
  const fimISO = document.getElementById('relFim').value;
  if (!iniISO || !fimISO) return null;
  let ini = relFromISO(iniISO), fim = relFromISO(fimISO);
  if (fim < ini) [ini, fim] = [fim, ini];
  const fimEnd = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate(), 23, 59, 59, 999);
  return { ini, fim, fimEnd, iniISO: relISO(ini), fimISO: relISO(fim) };
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
    const ini = k.slice(5, 15);
    if (ini.slice(0, 7) !== mk) return;
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

  relState = Object.assign(relState || {}, { range: r, devolucoes, ocorrList, vendasSemana: null, vendasSemanaOk: false });
  relRenderItems();
  relRenderPreview();

  // Vendas da semana (pode cruzar dois meses)
  const meses = relMonthsBetween(r.ini, r.fim);
  const mk = document.getElementById('relMes').value;
  const [ano, mm] = mk.split('-').map(Number);
  const [resSemana, resMes] = await Promise.all([
    Promise.all(meses.map(m => relLoadMonth(m.ano, m.mesIdx))),
    relLoadMonth(ano, mm - 1),
  ]);
  if (token !== relToken) return;

  const okSemana = resSemana.every(x => x.ok);
  const vendasSemana = resSemana.flatMap(x => x.rows)
    .filter(v => v.date >= r.ini && v.date <= r.fimEnd)
    .reduce((a, v) => a + v.qtd, 0);
  relState.vendasSemana = okSemana ? vendasSemana : null;
  relState.vendasSemanaOk = okSemana;
  relState.abasFaltando = resSemana.filter(x => !x.ok).map(x => x.nome);

  relState.mesVendas = resMes.ok ? resMes.rows.reduce((a, v) => a + v.qtd, 0) : null;
  relState.mesAbaNome = resMes.nome;
  relState.mesAbaOk = resMes.ok;

  relUpdateMonthAutos();
  relRenderPreview();
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
    devol: devMes.length,
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
  setAuto('relM_devol', a.devol, 'aba Ocorrências');
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
    desist: relNumOrNull(w.desist),
    adic: relNumOrNull(w.adic),
    estoque: relNumOrNull(w.estoque),
    obs: (w.obs || '').trim(),
    devolucoes: relState.devolucoes.filter(itemFilter),
    ocorrencias: relState.ocorrList.filter(itemFilter),
  };
  semana.devolTotal = relState.devolucoes.length;
  semana.ocorrTotal = relState.ocorrList.length;

  let mes = null;
  if (document.getElementById('relIncluirMes').checked) {
    const a = relMonthAuto();
    const m = relStoreGet('relM:' + a.mk);
    mes = {
      nome: MESES_PT[a.mesIdx], ano: a.ano,
      vendasML: pick(m.vendasML, a.vendasML),
      shopee: pick(m.shopee, a.shopee.total),
      devol: pick(m.devol, a.devol),
      desist: pick(m.desist, a.desist.semanas ? a.desist.total : null),
      ocorr: pick(m.ocorr, a.ocorr),
      adic: pick(m.adic, a.adic.semanas ? a.adic.total : null),
      valorDevolvido: a.valorDevolvido,
    };
    mes.vendasTotal = (mes.vendasML || 0) + (mes.shopee || 0);
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

// ── e-mail (HTML com estilos inline, compatível com Gmail/Outlook) ───────────
const REL_C = {
  text: '#1a2332', muted: '#5a6a7a', soft: '#7a8a9a', line: '#e4eaef', bg: '#f4f7f9',
  green: '#1a7a45', teal: '#2ab5b5', red: '#b91c1c', redBg: '#fdecec', amber: '#92400e', amberBg: '#fef3c7',
  blue: '#1d4ed8', blueBg: '#e8f0fe', okBg: '#e7f6ee',
};

function relTile(label, value, sub, color) {
  return `<td width="25%" valign="top" style="padding:5px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-radius:8px;background:#ffffff">
      <tr><td style="padding:12px 12px 11px">
        <div style="font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:${REL_C.soft};font-weight:bold">${label}</div>
        <div style="font-size:26px;line-height:1.15;font-weight:bold;color:${color || REL_C.text};margin-top:4px">${value}</div>
        <div style="font-size:11px;color:${REL_C.soft};margin-top:2px">${sub || '&nbsp;'}</div>
      </td></tr>
    </table>
  </td>`;
}

function relBadge(txt, fg, bg) {
  return `<span style="display:inline-block;font-size:10.5px;font-weight:bold;color:${fg};background:${bg};border-radius:999px;padding:2px 9px;margin-left:6px;white-space:nowrap">${relEsc(txt)}</span>`;
}

function relStatusBadge(o) {
  const st = statusResolucao(o);
  if (st.key === 'reembolsado') return relBadge('Reembolsado', REL_C.green, REL_C.okBg);
  if (st.key === 'pendente') return relBadge('Aguardando chegar', REL_C.amber, REL_C.amberBg);
  return '';
}

function relSectionTitle(txt, count, color) {
  return `<tr><td style="padding:22px 24px 8px">
    <div style="font-size:15px;font-weight:bold;color:${REL_C.text};border-left:4px solid ${color};padding-left:10px">${txt} <span style="color:${REL_C.soft};font-weight:normal">(${count})</span></div>
  </td></tr>`;
}

function relRow(label, html) {
  if (!html) return '';
  return `<div style="font-size:13px;line-height:1.5;color:${REL_C.text};margin-top:6px"><span style="color:${REL_C.muted};font-weight:bold">${label}:</span> ${html}</div>`;
}

function relItemCard(o, isDev) {
  const s = relStoreGet(relItemKey(o));
  const cor = isDev ? '#ef4444' : '#3b82f6';
  const metaParts = [
    `<b style="color:${REL_C.text}">OS ${relEsc(o.os || '—')}</b>`,
    relDMY(o.data),
    o.precoVenda != null ? 'Venda ' + relMoney(o.precoVenda) : '',
    o.freteDevolucao != null ? 'Frete devolução ' + relMoney(o.freteDevolucao) : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  let troca = '';
  if (!isDev) {
    const linhas = [];
    if (o.custoPrimeiro != null) linhas.push('Custo do 1º aparelho: ' + relMoney(o.custoPrimeiro));
    if (o.ocorrencia1) linhas.push(relEsc(o.ocorrencia1) + (o.custo1 != null ? ' — ' + relMoney(o.custo1) : ''));
    if (o.ocorrencia2) linhas.push(relEsc(o.ocorrencia2) + (o.custo2 != null ? ' — ' + relMoney(o.custo2) : ''));
    if (linhas.length) troca = relRow('Troca / envio', linhas.join('<br>'));
  }

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-left:4px solid ${cor};border-radius:8px;margin:0 0 10px;background:#ffffff">
    <tr><td style="padding:12px 14px">
      <div style="font-size:14px;font-weight:bold;color:${REL_C.text}">${relEsc(o.produto || 'Produto não informado')}${relBadge(relSubtipo(o.tipo), isDev ? REL_C.red : REL_C.blue, isDev ? REL_C.redBg : REL_C.blueBg)}</div>
      <div style="font-size:12px;color:${REL_C.muted};margin-top:3px">${metaParts}</div>
      ${relRow('Descrição', relEscBr(o.defeito))}
      ${troca}
      ${relRow('Resolução', (o.resolucao ? relEscBr(o.resolucao) : '—') + ' ' + relStatusBadge(o))}
      ${s.obs ? `<div style="font-size:12.5px;line-height:1.5;color:${REL_C.amber};background:${REL_C.amberBg};border-radius:6px;padding:7px 10px;margin-top:8px"><b>Obs:</b> ${relEscBr(s.obs)}</div>` : ''}
    </td></tr>
  </table>`;
}

function relBar(pct, color) {
  const w = pct == null ? 0 : Math.max(2, Math.min(100, pct));
  return `<table width="110" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${REL_C.bg};border-radius:4px"><tr>
    <td width="${w}%" style="background:${color};height:8px;font-size:0;line-height:0;border-radius:4px">&nbsp;</td>${w < 100 ? '<td style="font-size:0;line-height:0">&nbsp;</td>' : ''}
  </tr></table>`;
}

function relMesRow(label, qtd, base, color, bold) {
  const pct = base && qtd != null && color ? relPctNum(qtd, base) : null;
  return `<tr>
    <td style="padding:9px 10px;border-bottom:1px solid ${REL_C.line};font-size:13px;color:${REL_C.text};${bold ? 'font-weight:bold' : ''}">${label}</td>
    <td align="right" style="padding:9px 10px;border-bottom:1px solid ${REL_C.line};font-size:14px;font-weight:bold;color:${color || REL_C.text}">${qtd == null ? '<span style="color:#b0bac4;font-weight:normal">não informado</span>' : relN(qtd)}</td>
    <td align="right" style="padding:9px 10px;border-bottom:1px solid ${REL_C.line};font-size:13px;font-weight:bold;color:${color || REL_C.soft}">${pct != null ? relPct(qtd, base) : ''}</td>
    <td style="padding:9px 10px;border-bottom:1px solid ${REL_C.line}">${pct != null ? relBar(pct, color) : ''}</td>
  </tr>`;
}

function relBuildEmailHtml(d) {
  const { r, semana: s, mes } = d;
  const periodo = `${relDM(r.ini)} a ${relDMY(r.fim)}`;
  const saud = (() => { const h = new Date().getHours(); return h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite'; })();
  const nn = v => (v == null ? '<span style="color:#b0bac4">—</span>' : relN(v));

  let html = `<div style="background:${REL_C.bg};padding:16px 0;font-family:Arial,Helvetica,sans-serif">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-collapse:separate;background:#ffffff;border:1px solid ${REL_C.line};border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:${REL_C.text}">
    <tr><td style="background-color:${REL_C.teal};background-image:linear-gradient(135deg,#3cb878 0%,#2ab5b5 100%);padding:22px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e9fff7;font-weight:bold">Relatório semanal${mes ? ' + resumo do mês' : ''}</div>
      <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-top:4px">${periodo}</div>
      <div style="font-size:12.5px;color:#e9fff7;margin-top:2px">Vendas, devoluções e ocorrências</div>
    </td></tr>
    <tr><td style="padding:20px 24px 6px;font-size:14px;line-height:1.6">
      Olá pessoal, ${saud}. Tudo bem?<br>Segue o relatório semanal.
    </td></tr>
    ${s.obs ? `<tr><td style="padding:6px 24px 0"><div style="font-size:13px;line-height:1.55;background:${REL_C.bg};border-radius:8px;padding:10px 12px">${relEscBr(s.obs)}</div></td></tr>` : ''}

    <tr><td style="padding:14px 19px 0">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${REL_C.muted};font-weight:bold;padding:0 5px 4px">Vendas e estoque</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        ${relTile('Vendas Mercado Livre', nn(s.vendasML), 'total 2 contas', REL_C.green)}
        ${relTile('Vendas Shopee', nn(s.shopee), '&nbsp;')}
        ${relTile('Adicionados ao estoque', nn(s.adic), 'entradas na semana')}
        ${relTile('Total em estoque', nn(s.estoque), 'aparelhos')}
      </tr></table>
    </td></tr>
    <tr><td style="padding:10px 19px 0">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${REL_C.muted};font-weight:bold;padding:0 5px 4px">Pós-venda</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        ${relTile('Devoluções', nn(s.devolTotal), 'abertas na semana', REL_C.red)}
        ${relTile('Desistências', nn(s.desist), '&nbsp;', REL_C.amber)}
        ${relTile('Ocorrências', nn(s.ocorrTotal), 'trocas / erros', REL_C.blue)}
        <td width="25%" style="padding:5px">&nbsp;</td>
      </tr></table>
    </td></tr>`;

  html += relSectionTitle('Devoluções', s.devolucoes.length, '#ef4444');
  html += `<tr><td style="padding:0 24px">${s.devolucoes.length
    ? s.devolucoes.map(o => relItemCard(o, true)).join('')
    : `<div style="font-size:13px;color:${REL_C.soft}">Nenhuma devolução nesta semana.</div>`}</td></tr>`;

  html += relSectionTitle('Ocorrências', s.ocorrencias.length, '#3b82f6');
  html += `<tr><td style="padding:0 24px">${s.ocorrencias.length
    ? s.ocorrencias.map(o => relItemCard(o, false)).join('')
    : `<div style="font-size:13px;color:${REL_C.soft}">Nenhuma ocorrência nesta semana.</div>`}</td></tr>`;

  if (mes) {
    const base = mes.vendasTotal;
    const destaque = base && mes.devol != null
      ? `Em ${mes.nome} vendemos <b>${relN(base)}</b> produtos e tivemos <b style="color:${REL_C.red}">${relN(mes.devol)}</b> devoluções — <b style="color:${REL_C.red}">${relPct(mes.devol, base)}</b> das vendas.`
      : '';
    const problemas = [mes.devol, mes.desist, mes.ocorr].every(v => v != null) ? mes.devol + mes.desist + mes.ocorr : null;
    html += `<tr><td style="padding:24px 24px 4px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${REL_C.line};border-radius:10px;background:#fbfcfd">
        <tr><td style="padding:16px 16px 6px">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${REL_C.teal};font-weight:bold">Resumo do mês</div>
          <div style="font-size:19px;font-weight:bold;color:${REL_C.text};margin-top:2px">${mes.nome} ${mes.ano}</div>
          ${destaque ? `<div style="font-size:13.5px;line-height:1.55;margin-top:8px">${destaque}</div>` : ''}
        </td></tr>
        <tr><td style="padding:6px 6px 10px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
            <tr>
              <td style="padding:6px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:${REL_C.soft};font-weight:bold;border-bottom:1px solid ${REL_C.line}">Indicador</td>
              <td align="right" style="padding:6px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:${REL_C.soft};font-weight:bold;border-bottom:1px solid ${REL_C.line}">Qtd</td>
              <td align="right" style="padding:6px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:${REL_C.soft};font-weight:bold;border-bottom:1px solid ${REL_C.line}">% das vendas</td>
              <td style="border-bottom:1px solid ${REL_C.line}"></td>
            </tr>
            ${relMesRow('Vendas Mercado Livre <span style="color:' + REL_C.soft + ';font-weight:normal">(2 contas)</span>', mes.vendasML, null, null)}
            ${relMesRow('Vendas Shopee', mes.shopee, null, null)}
            ${relMesRow('Total de vendas', base, null, REL_C.green, true)}
            ${relMesRow('Devoluções', mes.devol, base, '#dc2626')}
            ${relMesRow('Desistências', mes.desist, base, '#d97706')}
            ${relMesRow('Ocorrências', mes.ocorr, base, '#2563eb')}
            ${problemas != null ? relMesRow('Total de problemas pós-venda', problemas, base, '#7c3aed', true) : ''}
            ${relMesRow('Adicionados ao estoque', mes.adic, null, null)}
          </table>
          ${mes.valorDevolvido ? `<div style="font-size:11.5px;color:${REL_C.soft};padding:8px 10px 0">Valor de venda dos aparelhos devolvidos no mês: <b style="color:${REL_C.red}">${relMoney(mes.valorDevolvido)}</b></div>` : ''}
        </td></tr>
      </table>
    </td></tr>`;
  }

  html += `<tr><td style="padding:18px 24px 22px;font-size:11px;color:${REL_C.soft};border-top:1px solid ${REL_C.line}">
      Relatório gerado a partir da planilha de controle em ${new Date().toLocaleDateString('pt-BR')}. Qualquer dúvida, é só chamar.
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
  if (s.obs) { L.push(''); L.push(s.obs); }
  L.push('');
  L.push(`• Vendas Mercado Livre: ${v(s.vendasML)} (total 2 contas)`);
  L.push(`• Vendas Shopee: ${v(s.shopee)}`);
  L.push(`• Devoluções: ${v(s.devolTotal)}`);
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
  bloco('DEVOLUÇÕES', s.devolucoes, true);
  bloco('OCORRÊNCIAS', s.ocorrencias, false);

  if (mes) {
    const base = mes.vendasTotal;
    const p = x => (x != null && base ? ` (${relPct(x, base)} das vendas)` : '');
    L.push(''); L.push(`RESUMO DO MÊS DE ${mes.nome.toUpperCase()} ${mes.ano}`); L.push('');
    L.push(`• Vendas Mercado Livre: ${v(mes.vendasML)} (total 2 contas)`);
    L.push(`• Vendas Shopee: ${v(mes.shopee)}`);
    L.push(`• Total de vendas: ${v(base)}`);
    L.push(`• Devoluções: ${v(mes.devol)}${p(mes.devol)}`);
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
  el.innerHTML = relBuildEmailHtml(relCollect());
}

function relToast(msg) {
  const t = document.getElementById('relToast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(relToast._t);
  relToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function relCopyHtml() {
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
  const txt = relBuildText(relCollect());
  try { await navigator.clipboard.writeText(txt); relToast('Texto copiado!'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    relToast(ok ? 'Texto copiado!' : 'Não consegui copiar o texto.');
  }
}
