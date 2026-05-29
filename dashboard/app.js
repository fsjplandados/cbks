/**
 * MAPA ANTIFRAUDE — Dashboard App
 * Carrega dashboard_data.json e renderiza todos os gráficos e tabelas.
 */

// ── Global State ─────────────────────────────────
let DATA = null;
let monthlyChart = null;
let currentMonthlyMode = 'count';

// ── Chart.js Global Defaults ─────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(17, 17, 40, 0.95)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(99, 102, 241, 0.3)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 13 };
Chart.defaults.scale.grid = { color: 'rgba(255,255,255,0.04)' };
Chart.defaults.scale.border = { color: 'rgba(255,255,255,0.06)' };
Chart.defaults.animation = false; // Disable animations to fix invisible charts issue on some drivers

// ── Color Palettes ───────────────────────────────
const COLORS = {
    indigo: '#6366F1',
    pink: '#EC4899',
    purple: '#8B5CF6',
    sky: '#0EA5E9',
    amber: '#F59E0B',
    emerald: '#10B981',
    red: '#EF4444',
    rose: '#F43F5E',
    teal: '#14B8A6',
    orange: '#F97316',
    lime: '#84CC16',
    cyan: '#06B6D4',
};

const PALETTE = [
    COLORS.indigo, COLORS.pink, COLORS.purple, COLORS.sky,
    COLORS.amber, COLORS.emerald, COLORS.red, COLORS.rose,
    COLORS.teal, COLORS.orange, COLORS.lime, COLORS.cyan,
];

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const PALETTE_ALPHA = PALETTE.map(c => hexToRgba(c, 0.2));

// ── Helpers ──────────────────────────────────────
function fmt(n) {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat('pt-BR').format(n);
}

function fmtBRL(n) {
    if (n == null || isNaN(n)) return 'R$ —';
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(n);
}

function fmtBRL2(n) {
    if (n == null || isNaN(n)) return 'R$ —';
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(n);
}

function getCtx(id) {
    const el = document.getElementById(id);
    return el ? el.getContext('2d') : null;
}

function showNoData(canvasId, msg = 'Dados não disponíveis') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.style.display = 'none';
    const div = document.createElement('div');
    div.className = 'no-data';
    div.textContent = msg;
    parent.appendChild(div);
}

// ── Load Data & Filters ────────────────────────
async function loadData() {
    try {
        const rawOk = await loadRawData();
        if (rawOk) {
            applyFilters();
        } else {
            // Fallback para arquivo original agregado (sem filtro)
            const resp = await fetch('dashboard_data.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            DATA = await resp.json();
            renderAll();
        }
        document.getElementById('loading-overlay').classList.add('hidden');
        setupFilters();
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
        document.querySelector('.loading-spinner p').textContent =
            'Erro ao carregar os dados. Verifique a exportação RAW.';
    }
}

function applyFilters() {
    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;
    DATA = aggregateData(start, end);
    renderAll();
}

function setupFilters() {
    document.getElementById('filter-start').addEventListener('change', applyFilters);
    document.getElementById('filter-end').addEventListener('change', applyFilters);
}

// ── Render All ───────────────────────────────────
function renderAll() {
    renderHeader();
    renderKPIs();
    renderMonthlyChart(currentMonthlyMode);
    renderReasonChart();
    renderBandeiraChart();
    renderEntregaChart();
    renderUFChart();
    renderCidadeChart();
    renderLojaChart();
    renderProdutoChart();
    renderCSStatusChart();
    renderCategoriasChart();
    renderFonteChart();
    renderVirouChart();
    renderCrossValidation();
    renderTopEmails();
    renderTopRegistros();
}

// ── Header ───────────────────────────────────────
function renderHeader() {
    document.getElementById('periodo-label').textContent = DATA.periodo || '';
    document.getElementById('gerado-em').textContent = `Gerado: ${DATA.gerado_em || ''}`;
}

// ── KPIs ─────────────────────────────────────────
function renderKPIs() {
    const k = DATA.kpis;
    document.getElementById('kpi-cb-count').textContent = fmt(k.total_chargebacks);
    document.getElementById('kpi-cb-valor').textContent = fmtBRL(k.valor_total_cb);
    document.getElementById('kpi-noc-count').textContent = fmt(k.total_notifications);
    document.getElementById('kpi-noc-valor').textContent = fmtBRL(k.valor_total_noc);
    document.getElementById('kpi-taxa-value').textContent = `${k.taxa_conversao_noc_cb}%`;
    document.getElementById('kpi-taxa-detail').textContent = `${fmt(k.noc_que_viraram_cb)} de ${fmt(k.noc_total)}`;
    document.getElementById('kpi-ticket-value').textContent = fmtBRL2(k.ticket_medio_cb);
    document.getElementById('kpi-ticket-noc').textContent = `NOC: ${fmtBRL2(k.ticket_medio_noc)}`;
    
    const sapPct = DATA.cross_validation ? DATA.cross_validation.taxa_match_sap : 0;
    document.getElementById('kpi-sap-match').textContent = `${sapPct}%`;
    document.getElementById('kpi-sap-detail').textContent = `${fmt(k.com_sap)} registros`;
    document.getElementById('kpi-cs-match').textContent = fmt(k.com_clearsale);
    document.getElementById('kpi-cs-detail').textContent = 'registros cruzados';
}

// ── Monthly Chart ────────────────────────────────
function renderMonthlyChart(mode) {
    const ctx = getCtx('chart-monthly');
    if (!ctx || !DATA.evolucao_mensal) return;
    
    if (monthlyChart) monthlyChart.destroy();
    
    const em = DATA.evolucao_mensal;
    const labels = em.labels.map(l => {
        const [y, m] = l.split('-');
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return `${months[parseInt(m)-1]}/${y.slice(2)}`;
    });
    
    const cbData = mode === 'count' ? em.chargeback.count : em.chargeback.total;
    const nocData = mode === 'count' ? em.notification.count : em.notification.total;
    
    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Chargeback',
                    data: cbData,
                    backgroundColor: hexToRgba(COLORS.red, 0.6),
                    borderColor: COLORS.red,
                    borderWidth: 1
                },
                {
                    label: 'Notification',
                    data: nocData,
                    backgroundColor: hexToRgba(COLORS.amber, 0.6),
                    borderColor: COLORS.amber,
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const val = mode === 'count' ? fmt(ctx.parsed.y) : fmtBRL(ctx.parsed.y);
                            return `${ctx.dataset.label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'category',
                    grid: { drawOnChartArea: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (v) => mode === 'count' ? fmt(v) : fmtBRL(v),
                    }
                }
            }
        }
    });
}

function toggleMonthlyChart(mode) {
    currentMonthlyMode = mode;
    document.querySelectorAll('.chart-toggle .toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderMonthlyChart(mode);
}

// ── Reason Chart ─────────────────────────────────
function renderReasonChart() {
    const ctx = getCtx('chart-reason');
    if (!ctx || !DATA.por_motivo) return showNoData('chart-reason');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: DATA.por_motivo.labels,
            datasets: [{
                data: DATA.por_motivo.values,
                backgroundColor: PALETTE_ALPHA,
                borderColor: PALETTE,
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { callback: fmt } }
            }
        }
    });
}

// ── Bandeira Chart ───────────────────────────────
function renderBandeiraChart() {
    const ctx = getCtx('chart-bandeira');
    if (!ctx || !DATA.por_bandeira) return showNoData('chart-bandeira');
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: DATA.por_bandeira.labels.map(l => l.toUpperCase()),
            datasets: [{
                data: DATA.por_bandeira.values,
                backgroundColor: [COLORS.red, COLORS.indigo, COLORS.amber, COLORS.emerald, COLORS.purple],
                borderColor: 'transparent',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed)} (${((ctx.parsed / ctx.dataset.data.reduce((a,b)=>a+b,0)) * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });
}

// ── Entrega Chart ────────────────────────────────
function renderEntregaChart() {
    const ctx = getCtx('chart-entrega');
    if (!ctx || !DATA.por_entrega) return showNoData('chart-entrega', 'Dados de entrega requerem enriquecimento VTEX');
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: DATA.por_entrega.labels,
            datasets: [{
                data: DATA.por_entrega.values,
                backgroundColor: [COLORS.emerald, COLORS.sky, COLORS.amber, COLORS.purple, COLORS.pink],
                borderColor: 'transparent',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed)}`
                    }
                }
            }
        }
    });
}

// ── UF Chart ─────────────────────────────────────
function renderUFChart() {
    const ctx = getCtx('chart-uf');
    if (!ctx || !DATA.por_uf || DATA.por_uf.labels.length === 0) return showNoData('chart-uf');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: DATA.por_uf.labels,
            datasets: [
                {
                    label: 'Quantidade',
                    data: DATA.por_uf.count,
                    backgroundColor: hexToRgba(COLORS.indigo, 0.6),
                    borderColor: COLORS.indigo,
                    borderWidth: 1,
                    yAxisID: 'y',
                },
                {
                    label: 'Valor (R$)',
                    data: DATA.por_uf.total,
                    backgroundColor: hexToRgba(COLORS.pink, 0.33),
                    borderColor: COLORS.pink,
                    borderWidth: 1,
                    yAxisID: 'y1',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: {
                x: { type: 'category', grid: { drawOnChartArea: false } },
                y: { type: 'linear', beginAtZero: true, position: 'left', ticks: { callback: fmt } },
                y1: { type: 'linear', beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => fmtBRL(v) } },
            }
        }
    });
}

// ── Cidade Chart ─────────────────────────────────
function renderCidadeChart() {
    const ctx = getCtx('chart-cidade');
    if (!ctx || !DATA.por_cidade || DATA.por_cidade.labels.length === 0) return showNoData('chart-cidade');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: DATA.por_cidade.labels,
            datasets: [{
                data: DATA.por_cidade.count,
                backgroundColor: PALETTE_ALPHA,
                borderColor: PALETTE,
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { callback: fmt } } }
        }
    });
}

// ── Loja Chart ───────────────────────────────────
function renderLojaChart() {
    const ctx = getCtx('chart-loja');
    if (!ctx || !DATA.por_loja) return showNoData('chart-loja', 'Dados de loja requerem enriquecimento VTEX');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: DATA.por_loja.labels.slice(0, 20),
            datasets: [{
                data: DATA.por_loja.values.slice(0, 20),
                backgroundColor: PALETTE_ALPHA,
                borderColor: PALETTE,
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { callback: fmt } } }
        }
    });
}

// ── Produto Chart ────────────────────────────────
function renderProdutoChart() {
    const ctx = getCtx('chart-produto');
    if (!ctx || !DATA.por_produto_cs) return showNoData('chart-produto');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: DATA.por_produto_cs.labels.slice(0, 15),
            datasets: [{
                data: DATA.por_produto_cs.values.slice(0, 15),
                backgroundColor: hexToRgba(COLORS.purple, 0.53),
                borderColor: COLORS.purple,
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { callback: fmt } } }
        }
    });
}

// ── ClearSale Status Chart ───────────────────────
function renderCSStatusChart() {
    const ctx = getCtx('chart-cs-status');
    if (!ctx || !DATA.cs_status_chargeback) return showNoData('chart-cs-status');
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: DATA.cs_status_chargeback.labels,
            datasets: [{
                data: DATA.cs_status_chargeback.values,
                backgroundColor: [COLORS.red, COLORS.rose, COLORS.amber, COLORS.purple, COLORS.sky],
                borderColor: 'transparent',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

// ── Categorias Chart ─────────────────────────────
function renderCategoriasChart() {
    const ctx = getCtx('chart-categorias');
    if (!ctx || !DATA.por_categoria_vtex) return showNoData('chart-categorias', 'Dados requerem enriquecimento VTEX');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: DATA.por_categoria_vtex.labels.slice(0, 15),
            datasets: [{
                data: DATA.por_categoria_vtex.values.slice(0, 15),
                backgroundColor: hexToRgba(COLORS.teal, 0.53),
                borderColor: COLORS.teal,
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { callback: fmt } } }
        }
    });
}

// ── Fonte Chart ──────────────────────────────────
function renderFonteChart() {
    const ctx = getCtx('chart-fonte');
    if (!ctx || !DATA.por_ferramenta) return showNoData('chart-fonte');
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: DATA.por_ferramenta.labels,
            datasets: [{
                data: DATA.por_ferramenta.values,
                backgroundColor: [COLORS.indigo, COLORS.emerald, COLORS.amber, COLORS.pink, COLORS.purple],
                borderColor: 'transparent',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

// ── Virou CB Chart ───────────────────────────────
function renderVirouChart() {
    const ctx = getCtx('chart-virou');
    if (!ctx || !DATA.virou_chargeback) return showNoData('chart-virou');
    
    const colorMap = {
        'Sim': COLORS.red,
        'Não': COLORS.emerald,
        'É Chargeback': COLORS.amber,
        'N/A': COLORS.sky,
    };
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: DATA.virou_chargeback.labels,
            datasets: [{
                data: DATA.virou_chargeback.values,
                backgroundColor: DATA.virou_chargeback.labels.map(l => colorMap[l] || COLORS.purple),
                borderColor: 'transparent',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

// ── Cross Validation ─────────────────────────────
function renderCrossValidation() {
    const cv = DATA.cross_validation;
    if (!cv) return;
    
    const container = document.getElementById('cross-validation');
    
    const cards = [
        { value: fmt(cv.total_adyen_cb_noc), label: 'Total Adyen (CB+NOC)', sub: 'Registros base' },
        { value: `${cv.taxa_match_sap}%`, label: 'Match com SAP', sub: `${fmt(cv.encontrados_no_sap)} encontrados` },
        { value: fmt(cv.nao_encontrados_sap), label: 'Sem Match SAP', sub: 'Somente na Adyen' },
    ];
    
    if (cv.encontrados_no_clearsale != null) {
        cards.push(
            { value: `${cv.taxa_match_clearsale}%`, label: 'Match ClearSale', sub: `${fmt(cv.encontrados_no_clearsale)} encontrados` },
            { value: fmt(cv.nao_encontrados_clearsale), label: 'Sem Match ClearSale', sub: 'Sem dados ClearSale' }
        );
    }
    
    container.innerHTML = cards.map(c => `
        <div class="cv-card">
            <div class="cv-value">${c.value}</div>
            <div class="cv-label">${c.label}</div>
            <div class="cv-sub">${c.sub}</div>
        </div>
    `).join('');
}

// ── Top Emails Table ─────────────────────────────
function renderTopEmails() {
    const container = document.getElementById('top-emails-table');
    if (!container || !DATA.top_emails) return;
    
    const html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Email</th>
                    <th>Ocorrências</th>
                </tr>
            </thead>
            <tbody>
                ${DATA.top_emails.labels.map((email, i) => `
                    <tr>
                        <td class="rank">${i + 1}</td>
                        <td>${email}</td>
                        <td><span class="badge ${DATA.top_emails.values[i] >= 5 ? 'badge-danger' : 'badge-warning'}">${DATA.top_emails.values[i]}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

// ── Top Registros Table ──────────────────────────
function renderTopRegistros() {
    const container = document.getElementById('top-registros-table');
    if (!container || !DATA.top_registros) return;
    
    const typeBadge = (type) => {
        if (type === 'Chargeback') return '<span class="badge badge-danger">CB</span>';
        if (type === 'NotificationOfChargeback') return '<span class="badge badge-warning">NOC</span>';
        return `<span class="badge badge-info">${type || '—'}</span>`;
    };
    
    const html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>PSP Reference</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                    <th>Motivo</th>
                    <th>Bandeira</th>
                    <th>Data</th>
                    <th>Virou CB</th>
                    <th>Loja</th>
                    <th>Cidade</th>
                    <th>UF</th>
                    <th>Entrega</th>
                </tr>
            </thead>
            <tbody>
                ${DATA.top_registros.map((r, i) => `
                    <tr>
                        <td class="rank">${i + 1}</td>
                        <td>${r['Psp Reference'] || '—'}</td>
                        <td>${typeBadge(r['Record Type'])}</td>
                        <td style="font-weight:600; color: #f1f5f9;">${fmtBRL2(r['Dispute Amount'])}</td>
                        <td>${r['Dispute Reason'] || '—'}</td>
                        <td>${(r['Payment Method'] || '—').toUpperCase()}</td>
                        <td>${r['Record Date'] ? r['Record Date'].slice(0, 10) : '—'}</td>
                        <td>${r['virou_chargeback'] === 'Sim' ? '<span class="badge badge-danger">Sim</span>' : r['virou_chargeback'] || '—'}</td>
                        <td>${r['vtex_store'] || '—'}</td>
                        <td>${r['vtex_cidade'] || '—'}</td>
                        <td>${r['vtex_uf'] || '—'}</td>
                        <td>${r['vtex_delivery_type'] || '—'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

// ── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadData);
