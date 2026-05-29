/**
 * MAPA ANTIFRAUDE — Dashboard App
 * Lógica e Estilização Premium de Gráficos (ApexCharts) e Tabelas
 */

// ── Global State ─────────────────────────────────
let DATA = null;
let monthlyChart = null;
let reasonChart = null;
let bandeiraChart = null;
let entregaChart = null;
let ufChart = null;
let cidadeChart = null;
let lojaChart = null;
let produtoChart = null;
let csStatusChart = null;
let categoriasChart = null;
let fonteChart = null;
let virouChart = null;
let currentMonthlyMode = 'count';

// ── Cores Temáticas Premium ─────────────────────
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

// ── Helpers de Formatação ────────────────────────
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

function showNoData(containerId, msg = 'Dados não disponíveis') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.style.display = 'none';
    const parent = el.parentElement;
    
    const existingNoData = parent.querySelector('.no-data');
    if (existingNoData) return;
    
    const div = document.createElement('div');
    div.className = 'no-data';
    div.textContent = msg;
    parent.appendChild(div);
}

// ── Criptografia SHA-256 ────────────────────────
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Lógica de Login (Gatekeeper) ─────────────────
function setupLoginForm() {
    const form = document.getElementById('login-form');
    const input = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error');
    
    if (!form || !input || !errorMsg) return;
    
    form.onsubmit = async (e) => {
        e.preventDefault();
        const pwd = input.value;
        const hash = await sha256(pwd);
        
        // Comparação segura contra hash de 'ecommerce1'
        if (hash === '477fe990ed2751a109865aa0b868790b43a9f4d08fb10a46dc84051e9c60c5df') {
            sessionStorage.setItem('authenticated', 'true');
            errorMsg.classList.add('hidden');
            loadData(); // Dispara o carregamento seguro dos dados!
        } else {
            errorMsg.classList.remove('hidden');
            input.value = '';
            input.focus();
        }
    };
}

// ── Carregamento de Dados ────────────────────────
async function loadData() {
    if (sessionStorage.getItem('authenticated') !== 'true') {
        // Exibe tela de login e oculta carregador de dados
        document.getElementById('login-overlay').classList.remove('hidden');
        document.getElementById('loading-overlay').classList.add('hidden');
        setupLoginForm();
        return;
    }
    
    // Oculta login e exibe carregamento
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('loading-overlay').classList.remove('hidden');

    try {
        const rawOk = await loadRawData();
        if (rawOk) {
            applyFilters();
        } else {
            // Fallback para arquivo original consolidado
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
            'Erro ao carregar os dados. Detalhe: ' + err.message;
    }
}

function applyFilters() {
    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;
    DATA = aggregateData(start, end);
    renderAll();
}

function setupFilters() {
    document.getElementById('filter-start').removeEventListener('change', applyFilters);
    document.getElementById('filter-end').removeEventListener('change', applyFilters);
    document.getElementById('filter-start').addEventListener('change', applyFilters);
    document.getElementById('filter-end').addEventListener('change', applyFilters);
}

// ── Renderização Geral ───────────────────────────
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

// ── 1. Evolução Mensal (Grouped Bar com Gradiente) ──
function renderMonthlyChart(mode) {
    const el = document.getElementById('chart-monthly');
    if (!el || !DATA.evolucao_mensal) return;
    
    const em = DATA.evolucao_mensal;
    const labels = em.labels.map(l => {
        const [y, m] = l.split('-');
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return `${months[parseInt(m)-1]}/${y.slice(2)}`;
    });
    
    const cbData = mode === 'count' ? em.chargeback.count : em.chargeback.total;
    const nocData = mode === 'count' ? em.notification.count : em.notification.total;
    
    const options = {
        series: [
            { name: 'Chargeback (Confirmados)', data: cbData },
            { name: 'Notificações (NOC)', data: nocData }
        ],
        chart: {
            type: 'bar',
            height: 330,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        colors: [COLORS.red, COLORS.amber],
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '45%',
                borderRadius: 6
            },
        },
        dataLabels: { enabled: false },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: { 
            categories: labels, 
            axisBorder: { show: false }, 
            axisTicks: { show: false },
            labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 } }
        },
        yaxis: {
            labels: {
                style: { colors: '#64748b', fontSize: '11px' },
                formatter: (val) => mode === 'count' ? fmt(val) : fmtBRL(val)
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'vertical',
                shadeIntensity: 0.3,
                inverseColors: false,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                stops: [0, 100],
                gradientToColors: [COLORS.rose, COLORS.orange] // Tons finais premium
            }
        },
        tooltip: {
            theme: 'dark',
            shared: true,
            intersect: false,
            y: {
                formatter: (val) => mode === 'count' ? fmt(val) : fmtBRL(val)
            }
        },
        grid: {
            borderColor: 'rgba(99, 102, 241, 0.06)'
        },
        legend: {
            position: 'top',
            horizontalAlign: 'right',
            fontWeight: 500,
            fontSize: '12px',
            markers: { radius: 12, width: 10, height: 10 }
        }
    };
    
    if (monthlyChart) monthlyChart.destroy();
    el.innerHTML = '';
    monthlyChart = new ApexCharts(el, options);
    monthlyChart.render();
}

function toggleMonthlyChart(mode) {
    currentMonthlyMode = mode;
    document.querySelectorAll('.chart-toggle .toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderMonthlyChart(mode);
}

// ── 2. Motivo do Chargeback (Horizontal Indigo-to-Purple) ──
function renderReasonChart() {
    const el = document.getElementById('chart-reason');
    if (!el || !DATA.por_motivo) return showNoData('chart-reason');
    
    const options = {
        series: [{ name: 'Ocorrências', data: DATA.por_motivo.values }],
        chart: {
            type: 'bar',
            height: 290,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 5,
                barHeight: '60%'
            }
        },
        colors: [COLORS.indigo],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'horizontal',
                shadeIntensity: 0.4,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                gradientToColors: [COLORS.purple]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: DATA.por_motivo.labels,
            labels: { 
                formatter: fmt,
                style: { colors: '#64748b', fontSize: '11px' }
            },
            axisBorder: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 }
            }
        },
        grid: { borderColor: 'rgba(99, 102, 241, 0.06)' },
        tooltip: { theme: 'dark' }
    };
    
    if (reasonChart) reasonChart.destroy();
    el.innerHTML = '';
    reasonChart = new ApexCharts(el, options);
    reasonChart.render();
}

// ── 3. Bandeira (Donut Clean) ──
function renderBandeiraChart() {
    const el = document.getElementById('chart-bandeira');
    if (!el || !DATA.por_bandeira) return showNoData('chart-bandeira');
    
    const options = {
        series: DATA.por_bandeira.values,
        labels: DATA.por_bandeira.labels.map(l => l.toUpperCase()),
        chart: {
            type: 'donut',
            height: 250,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif"
        },
        theme: { mode: 'dark' },
        colors: [COLORS.indigo, COLORS.pink, COLORS.purple, COLORS.sky, COLORS.amber],
        stroke: { show: true, width: 2, colors: ['#111128'] },
        plotOptions: {
            pie: {
                donut: {
                    size: '68%',
                    labels: {
                        show: true,
                        name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 500 },
                        value: { show: true, color: '#f1f5f9', fontSize: '16px', fontWeight: 700, formatter: fmt },
                        total: {
                            show: true,
                            label: 'Total Geral',
                            color: '#64748b',
                            fontSize: '11px',
                            fontWeight: 600,
                            formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
                        }
                    }
                }
            }
        },
        legend: { 
            position: 'bottom',
            fontSize: '11px',
            fontWeight: 500,
            markers: { radius: 10, width: 8, height: 8 }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (bandeiraChart) bandeiraChart.destroy();
    el.innerHTML = '';
    bandeiraChart = new ApexCharts(el, options);
    bandeiraChart.render();
}

// ── 4. Forma de Entrega (Donut Clean) ──
function renderEntregaChart() {
    const el = document.getElementById('chart-entrega');
    if (!el || !DATA.por_entrega) return showNoData('chart-entrega', 'Dados de entrega indisponíveis');
    
    const options = {
        series: DATA.por_entrega.values,
        labels: DATA.por_entrega.labels,
        chart: {
            type: 'donut',
            height: 250,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif"
        },
        theme: { mode: 'dark' },
        colors: [COLORS.emerald, COLORS.sky, COLORS.purple],
        stroke: { show: true, width: 2, colors: ['#111128'] },
        plotOptions: {
            pie: {
                donut: {
                    size: '68%',
                    labels: {
                        show: true,
                        name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 500 },
                        value: { show: true, color: '#f1f5f9', fontSize: '16px', fontWeight: 700, formatter: fmt },
                        total: {
                            show: true,
                            label: 'Total Geral',
                            color: '#64748b',
                            fontSize: '11px',
                            fontWeight: 600,
                            formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
                        }
                    }
                }
            }
        },
        legend: { 
            position: 'bottom',
            fontSize: '11px',
            fontWeight: 500,
            markers: { radius: 10, width: 8, height: 8 }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (entregaChart) entregaChart.destroy();
    el.innerHTML = '';
    entregaChart = new ApexCharts(el, options);
    entregaChart.render();
}

// ── 5. Por UF (Double Column Indigo/Pink Gradiente) ──
function renderUFChart() {
    const el = document.getElementById('chart-uf');
    if (!el || !DATA.por_uf || DATA.por_uf.labels.length === 0) return showNoData('chart-uf');
    
    const options = {
        series: [
            { name: 'Qtd Incidentes', type: 'column', data: DATA.por_uf.count },
            { name: 'Valor Total (R$)', type: 'column', data: DATA.por_uf.total }
        ],
        chart: {
            type: 'line',
            height: 330,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        colors: [COLORS.indigo, COLORS.pink],
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: { 
            categories: DATA.por_uf.labels,
            labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 } }
        },
        yaxis: [
            {
                title: { text: 'Quantidade', style: { color: COLORS.indigo, fontWeight: 600, fontSize: '11px' } },
                labels: { 
                    style: { colors: '#64748b' },
                    formatter: fmt 
                }
            },
            {
                opposite: true,
                title: { text: 'Valor Total', style: { color: COLORS.pink, fontWeight: 600, fontSize: '11px' } },
                labels: { 
                    style: { colors: '#64748b' },
                    formatter: fmtBRL 
                }
            }
        ],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'vertical',
                shadeIntensity: 0.3,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                gradientToColors: [COLORS.sky, COLORS.rose]
            }
        },
        grid: { borderColor: 'rgba(99, 102, 241, 0.06)' },
        tooltip: {
            theme: 'dark',
            shared: true,
            intersect: false,
            y: {
                formatter: (val, opts) => {
                    if (opts.seriesIndex === 0) return fmt(val);
                    return fmtBRL(val);
                }
            }
        },
        legend: { 
            position: 'top', 
            horizontalAlign: 'right',
            fontSize: '12px',
            fontWeight: 500,
            markers: { radius: 12 }
        }
    };
    
    if (ufChart) ufChart.destroy();
    el.innerHTML = '';
    ufChart = new ApexCharts(el, options);
    ufChart.render();
}

// ── 6. Top 20 Cidades (Horizontal Sky-to-Teal) ──
function renderCidadeChart() {
    const el = document.getElementById('chart-cidade');
    if (!el || !DATA.por_cidade || DATA.por_cidade.labels.length === 0) return showNoData('chart-cidade');
    
    const options = {
        series: [{ name: 'Ocorrências', data: DATA.por_cidade.count }],
        chart: {
            type: 'bar',
            height: 320,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                barHeight: '65%'
            }
        },
        colors: [COLORS.sky],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'horizontal',
                shadeIntensity: 0.4,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                gradientToColors: [COLORS.teal]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: DATA.por_cidade.labels,
            labels: { 
                formatter: fmt,
                style: { colors: '#64748b', fontSize: '11px' }
            },
            axisBorder: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 }
            }
        },
        grid: { borderColor: 'rgba(99, 102, 241, 0.06)' },
        tooltip: { theme: 'dark' }
    };
    
    if (cidadeChart) cidadeChart.destroy();
    el.innerHTML = '';
    cidadeChart = new ApexCharts(el, options);
    cidadeChart.render();
}

// ── 7. Por Loja (Horizontal Purple-to-Pink) ──
function renderLojaChart() {
    const el = document.getElementById('chart-loja');
    if (!el || !DATA.por_loja) return showNoData('chart-loja', 'Dados de loja requerem enriquecimento VTEX');
    
    const options = {
        series: [{ name: 'Ocorrências', data: DATA.por_loja.values.slice(0, 20) }],
        chart: {
            type: 'bar',
            height: 320,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                barHeight: '65%'
            }
        },
        colors: [COLORS.purple],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'horizontal',
                shadeIntensity: 0.4,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                gradientToColors: [COLORS.pink]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: DATA.por_loja.labels.slice(0, 20),
            labels: { 
                formatter: fmt,
                style: { colors: '#64748b', fontSize: '11px' }
            },
            axisBorder: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 }
            }
        },
        grid: { borderColor: 'rgba(99, 102, 241, 0.06)' },
        tooltip: { theme: 'dark' }
    };
    
    if (lojaChart) lojaChart.destroy();
    el.innerHTML = '';
    lojaChart = new ApexCharts(el, options);
    lojaChart.render();
}

// ── 8. Tipo de Produto (Horizontal Amber-to-Orange) ──
function renderProdutoChart() {
    const el = document.getElementById('chart-produto');
    if (!el || !DATA.por_produto_cs) return showNoData('chart-produto');
    
    const options = {
        series: [{ name: 'Ocorrências', data: DATA.por_produto_cs.values.slice(0, 15) }],
        chart: {
            type: 'bar',
            height: 320,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                barHeight: '65%'
            }
        },
        colors: [COLORS.amber],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'horizontal',
                shadeIntensity: 0.4,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                gradientToColors: [COLORS.orange]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: DATA.por_produto_cs.labels.slice(0, 15),
            labels: { 
                formatter: fmt,
                style: { colors: '#64748b', fontSize: '11px' }
            },
            axisBorder: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 }
            }
        },
        grid: { borderColor: 'rgba(99, 102, 241, 0.06)' },
        tooltip: { theme: 'dark' }
    };
    
    if (produtoChart) produtoChart.destroy();
    el.innerHTML = '';
    produtoChart = new ApexCharts(el, options);
    produtoChart.render();
}

// ── 9. Status ClearSale (Donut Semantic Red) ──
function renderCSStatusChart() {
    const el = document.getElementById('chart-cs-status');
    if (!el || !DATA.cs_status_chargeback) return showNoData('chart-cs-status');
    
    const options = {
        series: DATA.cs_status_chargeback.values,
        labels: DATA.cs_status_chargeback.labels,
        chart: {
            type: 'donut',
            height: 250,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif"
        },
        theme: { mode: 'dark' },
        colors: [COLORS.red, COLORS.orange, COLORS.amber],
        stroke: { show: true, width: 2, colors: ['#111128'] },
        plotOptions: {
            pie: {
                donut: {
                    size: '68%',
                    labels: {
                        show: true,
                        name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 500 },
                        value: { show: true, color: '#f1f5f9', fontSize: '16px', fontWeight: 700, formatter: fmt },
                        total: {
                            show: true,
                            label: 'Total Geral',
                            color: '#64748b',
                            fontSize: '11px',
                            fontWeight: 600,
                            formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
                        }
                    }
                }
            }
        },
        legend: { 
            position: 'bottom',
            fontSize: '11px',
            fontWeight: 500,
            markers: { radius: 10, width: 8, height: 8 }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (csStatusChart) csStatusChart.destroy();
    el.innerHTML = '';
    csStatusChart = new ApexCharts(el, options);
    csStatusChart.render();
}

// ── 10. Categorias VTEX (Horizontal Teal-to-Emerald) ──
function renderCategoriasChart() {
    const el = document.getElementById('chart-categorias');
    if (!el || !DATA.por_categoria_vtex) return showNoData('chart-categorias', 'Dados requerem enriquecimento VTEX');
    
    const options = {
        series: [{ name: 'Ocorrências', data: DATA.por_categoria_vtex.values.slice(0, 15) }],
        chart: {
            type: 'bar',
            height: 320,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif",
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                barHeight: '65%'
            }
        },
        colors: [COLORS.teal],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'horizontal',
                shadeIntensity: 0.4,
                opacityFrom: 0.85,
                opacityTo: 0.95,
                gradientToColors: [COLORS.emerald]
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: DATA.por_categoria_vtex.labels.slice(0, 15),
            labels: { 
                formatter: fmt,
                style: { colors: '#64748b', fontSize: '11px' }
            },
            axisBorder: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 }
            }
        },
        grid: { borderColor: 'rgba(99, 102, 241, 0.06)' },
        tooltip: { theme: 'dark' }
    };
    
    if (categoriasChart) categoriasChart.destroy();
    el.innerHTML = '';
    categoriasChart = new ApexCharts(el, options);
    categoriasChart.render();
}

// ── 11. Fonte de Dados (Donut Indigo-to-Purple Scale) ──
function renderFonteChart() {
    const el = document.getElementById('chart-fonte');
    if (!el || !DATA.por_ferramenta) return showNoData('chart-fonte');
    
    const options = {
        series: DATA.por_ferramenta.values,
        labels: DATA.por_ferramenta.labels,
        chart: {
            type: 'donut',
            height: 250,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif"
        },
        theme: { mode: 'dark' },
        colors: [COLORS.indigo, COLORS.emerald, COLORS.amber, COLORS.pink, COLORS.purple],
        stroke: { show: true, width: 2, colors: ['#111128'] },
        plotOptions: {
            pie: {
                donut: {
                    size: '68%',
                    labels: {
                        show: true,
                        name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 500 },
                        value: { show: true, color: '#f1f5f9', fontSize: '16px', fontWeight: 700, formatter: fmt },
                        total: {
                            show: true,
                            label: 'Total Geral',
                            color: '#64748b',
                            fontSize: '11px',
                            fontWeight: 600,
                            formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
                        }
                    }
                }
            }
        },
        legend: { 
            position: 'bottom',
            fontSize: '11px',
            fontWeight: 500,
            markers: { radius: 10, width: 8, height: 8 }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (fonteChart) fonteChart.destroy();
    el.innerHTML = '';
    fonteChart = new ApexCharts(el, options);
    fonteChart.render();
}

// ── 12. NOC → Chargeback (Donut Semântico Red/Emerald) ──
function renderVirouChart() {
    const el = document.getElementById('chart-virou');
    if (!el || !DATA.virou_chargeback) return showNoData('chart-virou');
    
    const colorMap = {
        'Sim': COLORS.red,
        'Não': COLORS.emerald,
        'É Chargeback': COLORS.amber,
        'N/A': COLORS.sky,
    };
    
    const colors = DATA.virou_chargeback.labels.map(l => colorMap[l] || COLORS.purple);
    
    const options = {
        series: DATA.virou_chargeback.values,
        labels: DATA.virou_chargeback.labels,
        chart: {
            type: 'donut',
            height: 250,
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: "'Inter', sans-serif"
        },
        theme: { mode: 'dark' },
        colors: colors,
        stroke: { show: true, width: 2, colors: ['#111128'] },
        plotOptions: {
            pie: {
                donut: {
                    size: '68%',
                    labels: {
                        show: true,
                        name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 500 },
                        value: { show: true, color: '#f1f5f9', fontSize: '16px', fontWeight: 700, formatter: fmt },
                        total: {
                            show: true,
                            label: 'Total Geral',
                            color: '#64748b',
                            fontSize: '11px',
                            fontWeight: 600,
                            formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
                        }
                    }
                }
            }
        },
        legend: { 
            position: 'bottom',
            fontSize: '11px',
            fontWeight: 500,
            markers: { radius: 10, width: 8, height: 8 }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (virouChart) virouChart.destroy();
    el.innerHTML = '';
    virouChart = new ApexCharts(el, options);
    virouChart.render();
}

// ── 13. Cross Validation Cards ────────────────────
function renderCrossValidation() {
    const cv = DATA.cross_validation;
    if (!cv) return;
    
    const container = document.getElementById('cross-validation');
    
    const cards = [
        { value: fmt(cv.total_adyen_cb_noc), label: 'Total Adyen (CB+NOC)', sub: 'Registros base' },
        { value: `${cv.taxa_match_sap}%`, label: 'Match com SAP', sub: `${fmt(cv.encontrados_no_sap)} cruzados` },
        { value: fmt(cv.nao_encontrados_sap), label: 'Sem Match SAP', sub: 'Pendentes de conciliação' },
    ];
    
    if (cv.encontrados_no_clearsale != null) {
        cards.push(
            { value: `${cv.taxa_match_clearsale}%`, label: 'Match ClearSale', sub: `${fmt(cv.encontrados_no_clearsale)} cruzados` },
            { value: fmt(cv.nao_encontrados_clearsale), label: 'Sem Match ClearSale', sub: 'Sem fraude registrada' }
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

// ── 14. Tabela de Emails Recorrentes ─────────────
function renderTopEmails() {
    const container = document.getElementById('top-emails-table');
    if (!container || !DATA.top_emails) return;
    
    const html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width: 70px;">Rank</th>
                    <th>Shopper Email (Recorrente)</th>
                    <th style="width: 150px;">Ocorrências</th>
                </tr>
            </thead>
            <tbody>
                ${DATA.top_emails.labels.map((email, i) => `
                    <tr>
                        <td class="rank">#${i + 1}</td>
                        <td style="font-weight: 500; color: #f1f5f9;">${email}</td>
                        <td><span class="badge ${DATA.top_emails.values[i] >= 50 ? 'badge-danger' : 'badge-warning'}">${DATA.top_emails.values[i]}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

// ── 15. Tabela de Registros Individuais ───────────
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
                    <th>Rank</th>
                    <th>PSP Reference</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                    <th>Motivo da Disputa</th>
                    <th>Bandeira</th>
                    <th>Data Registro</th>
                    <th>Virou CB</th>
                    <th>Loja VTEX</th>
                    <th>Cidade</th>
                    <th>UF</th>
                    <th>Entrega</th>
                </tr>
            </thead>
            <tbody>
                ${DATA.top_registros.map((r, i) => `
                    <tr>
                        <td class="rank">#${i + 1}</td>
                        <td style="font-family: monospace; font-size: 0.78rem; color: var(--accent-indigo); font-weight: 500;">${r['Psp Reference'] || '—'}</td>
                        <td>${typeBadge(r['Record Type'])}</td>
                        <td style="font-weight: 600; color: #f1f5f9;">${fmtBRL2(r['Dispute Amount'])}</td>
                        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r['Dispute Reason'] || '—'}</td>
                        <td style="font-weight: 600;">${(r['Payment Method'] || '—').toUpperCase()}</td>
                        <td>${r['Record Date'] ? r['Record Date'].slice(0, 10) : '—'}</td>
                        <td>${r['virou_chargeback'] === 'Sim' ? '<span class="badge badge-danger">Sim</span>' : r['virou_chargeback'] || '—'}</td>
                        <td style="font-weight: 500;">${r['vtex_store'] || '—'}</td>
                        <td>${r['vtex_cidade'] || '—'}</td>
                        <td style="font-weight: 600;">${r['vtex_uf'] || '—'}</td>
                        <td>${r['vtex_delivery_type'] || '—'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

function setupHelpModal() {
    const helpBtn = document.getElementById('help-btn');
    const modal = document.getElementById('help-modal');
    const closeBtn = document.getElementById('close-modal-btn');
    
    if (helpBtn && modal && closeBtn) {
        helpBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
        });
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
        // Fecha o modal ao clicar fora da área de conteúdo
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }
}

// ── Inicialização ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupHelpModal();
});
