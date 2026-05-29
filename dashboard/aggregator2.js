/**
 * Engine de Agregação Client-side
 * Recebe o RAW JSON e gera a estrutura DATA esperada pelo app.js
 */

let RAW_RECORDS = [];

async function loadRawData() {
    try {
        const ts = new Date().getTime();
        const resp = await fetch('dashboard_raw.json?v=' + ts);
        if (!resp.ok) throw new Error('RAW JSON não encontrado');
        RAW_RECORDS = await resp.json();
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

function aggregateData(startDateStr, endDateStr) {
    // startDateStr / endDateStr formato: YYYY-MM
    const filtered = RAW_RECORDS.filter(r => {
        if (!r.date || r.date === 'nan' || r.date === 'NaT') return false;
        const yyyymm = r.date.slice(0, 7);
        let pass = true;
        if (startDateStr && yyyymm < startDateStr) pass = false;
        if (endDateStr && yyyymm > endDateStr) pass = false;
        return pass;
    });

    const data = {
        periodo: `${startDateStr || 'Jan 2025'} — ${endDateStr || 'Mai 2026'}`,
        gerado_em: new Date().toLocaleString('pt-BR'),
        kpis: {},
        evolucao_mensal: { labels: [], chargeback: { count: [], total: [] }, notification: { count: [], total: [] } }
    };

    // Aux para agrupamento
    const groupCount = (arr, key) => {
        const map = {};
        arr.forEach(r => {
            let v = r[key];
            if (v && v !== 'nan') {
                if (key === 'pm') v = v.toUpperCase();
                map[v] = (map[v] || 0) + 1;
            }
        });
        const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]);
        return { labels: sorted.map(x=>x[0]), values: sorted.map(x=>x[1]) };
    };

    // KPIs
    const cb = filtered.filter(r => r.type === 'Chargeback');
    const noc = filtered.filter(r => r.type === 'NotificationOfChargeback');
    
    const sumCb = cb.reduce((acc, r) => acc + (r.amount || 0), 0);
    const sumNoc = noc.reduce((acc, r) => acc + (r.amount || 0), 0);
    const virouCb = filtered.filter(r => r.virou === 'Sim').length;
    
    data.kpis = {
        total_chargebacks: cb.length,
        total_notifications: noc.length,
        valor_total_cb: sumCb,
        valor_total_noc: sumNoc,
        ticket_medio_cb: cb.length ? sumCb / cb.length : 0,
        ticket_medio_noc: noc.length ? sumNoc / noc.length : 0,
        noc_que_viraram_cb: virouCb,
        noc_total: noc.length,
        taxa_conversao_noc_cb: noc.length ? ((virouCb / noc.length) * 100).toFixed(1) : 0,
        com_sap: filtered.filter(r => r.sap).length,
        com_clearsale: filtered.filter(r => r.cs_item || r.cs_status).length
    };

    // Evolução Mensal
    const monthly = {};
    filtered.forEach(r => {
        const m = r.date.slice(0, 7);
        if (!monthly[m]) monthly[m] = { cbCount: 0, cbTotal: 0, nocCount: 0, nocTotal: 0 };
        if (r.type === 'Chargeback') { monthly[m].cbCount++; monthly[m].cbTotal += r.amount || 0; }
        if (r.type === 'NotificationOfChargeback') { monthly[m].nocCount++; monthly[m].nocTotal += r.amount || 0; }
    });
    
    const months = Object.keys(monthly).sort();
    data.evolucao_mensal.labels = months;
    months.forEach(m => {
        data.evolucao_mensal.chargeback.count.push(monthly[m].cbCount);
        data.evolucao_mensal.chargeback.total.push(monthly[m].cbTotal);
        data.evolucao_mensal.notification.count.push(monthly[m].nocCount);
        data.evolucao_mensal.notification.total.push(monthly[m].nocTotal);
    });

    // Simples Groupings
    data.por_motivo = groupCount(filtered, 'reason');
    data.por_motivo.labels = data.por_motivo.labels.slice(0,10);
    data.por_motivo.values = data.por_motivo.values.slice(0,10);

    data.por_bandeira = groupCount(filtered, 'pm');
    data.cs_status_chargeback = groupCount(filtered, 'cs_status');
    data.por_entrega = groupCount(filtered, 'delivery');
    
    // Simplificar entrega
    const entregaMap = {};
    filtered.forEach(r => {
        if (!r.delivery || r.delivery === 'nan') return;
        const d = r.delivery.toLowerCase();
        let cat = 'Outros';
        if (d.includes('retira') || d.includes('pickup')) cat = 'Clique e Retire';
        else if (d.includes('entrega') || d.includes('normal') || d.includes('express')) cat = 'Entrega em Casa';
        entregaMap[cat] = (entregaMap[cat] || 0) + 1;
    });
    data.por_entrega = { labels: Object.keys(entregaMap), values: Object.values(entregaMap) };

    // UF
    const ufMap = {};
    filtered.forEach(r => {
        const u = r.uf && r.uf !== 'nan' ? r.uf : null;
        if (u) {
            if (!ufMap[u]) ufMap[u] = { count: 0, total: 0 };
            ufMap[u].count++;
            ufMap[u].total += r.amount || 0;
        }
    });
    const ufs = Object.entries(ufMap).sort((a,b) => b[1].count - a[1].count);
    data.por_uf = { labels: ufs.map(x=>x[0]), count: ufs.map(x=>x[1].count), total: ufs.map(x=>x[1].total) };

    // Cidade
    const cidMap = {};
    filtered.forEach(r => {
        const c = r.cidade && r.cidade !== 'nan' ? r.cidade : null;
        if (c) cidMap[c] = (cidMap[c] || 0) + 1;
    });
    const cids = Object.entries(cidMap).sort((a,b) => b[1]-a[1]).slice(0,20);
    data.por_cidade = { labels: cids.map(x=>x[0]), count: cids.map(x=>x[1]) };

    data.por_loja = groupCount(filtered, 'store');
    data.por_loja.labels = data.por_loja.labels.slice(0, 20);
    data.por_loja.values = data.por_loja.values.slice(0, 20);

    data.por_produto_cs = groupCount(filtered, 'cs_item');
    data.por_produto_cs.labels = data.por_produto_cs.labels.slice(0, 15);
    data.por_produto_cs.values = data.por_produto_cs.values.slice(0, 15);

    // Categorias VTEX
    const catMap = {};
    filtered.forEach(r => {
        if (r.vtex_categories && r.vtex_categories !== 'nan') {
            r.vtex_categories.split('|').forEach(c => {
                const ct = c.trim();
                if (ct) catMap[ct] = (catMap[ct] || 0) + 1;
            });
        }
    });
    const cats = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,15);
    data.por_categoria_vtex = { labels: cats.map(x=>x[0]), values: cats.map(x=>x[1]) };

    data.por_ferramenta = groupCount(filtered, 'fonte');
    data.virou_chargeback = groupCount(filtered, 'virou');

    // Cross Validation
    const match_sap = filtered.filter(r => r.sap).length;
    const match_cs = filtered.filter(r => r.cs_item || r.cs_status || r.cidade).length;
    data.cross_validation = {
        total_adyen_cb_noc: filtered.length,
        encontrados_no_sap: match_sap,
        nao_encontrados_sap: filtered.length - match_sap,
        taxa_match_sap: filtered.length ? ((match_sap/filtered.length)*100).toFixed(1) : 0,
        encontrados_no_clearsale: match_cs,
        nao_encontrados_clearsale: filtered.length - match_cs,
        taxa_match_clearsale: filtered.length ? ((match_cs/filtered.length)*100).toFixed(1) : 0
    };

    // Top Emails - raw payload missing shopper email, we skip this or mock
    data.top_emails = { labels: [], values: [] }; 

    // Top Registros
    data.top_registros = [...filtered].sort((a,b) => (b.amount||0) - (a.amount||0)).slice(0, 100).map(r => ({
        "Psp Reference": r['Psp Reference'] || r.psp || '—',
        "Record Type": r.type,
        "Dispute Amount": r.amount,
        "Dispute Reason": r.reason,
        "Payment Method": r.pm,
        "Record Date": r.date,
        "virou_chargeback": r.virou,
        "vtex_store": r.store,
        "vtex_cidade": r.cidade,
        "vtex_uf": r.uf,
        "vtex_delivery_type": r.delivery
    }));

    return data;
}
