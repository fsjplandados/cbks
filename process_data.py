"""
Pipeline de Dados — Mapa Antifraude
Processa as 3 fontes (Adyen, SAP, ClearSale), cruza, enriquece com VTEX e gera:
  1. dashboard_data.json (para o dashboard web)
  2. consolidado_chargeback.xlsx (para análise manual)
"""
import sys
import os
import json
import glob
import argparse
import pandas as pd
import numpy as np
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

# ─────────────────────────────────────────────
# VTEX — importação condicional
# ─────────────────────────────────────────────
try:
    from vtex_extractor import VTEXExtractor
    from config.settings import VTEXConfig
    VTEX_AVAILABLE = True
except ImportError as _vtex_err:
    VTEX_AVAILABLE = False
    print(f"[VTEX] ⚠️  Módulo não disponível: {_vtex_err}")


# ══════════════════════════════════════════════
# 1. LOADERS
# ══════════════════════════════════════════════

def load_adyen(folder: str) -> pd.DataFrame:
    """Carrega todos os CSVs Adyen e filtra CB + NOC."""
    files = sorted(glob.glob(os.path.join(folder, "*.csv")))
    if not files:
        raise FileNotFoundError(f"Nenhum CSV Adyen em: {folder}")
    
    print(f"\n[Adyen] {len(files)} arquivos encontrados")
    dfs = []
    for f in files:
        try:
            df = pd.read_csv(f, sep=None, engine="python")
            # Normalizar datas
            for col in ["Record Date", "Payment Date", "Dispute Date", "Dispute End Date"]:
                if col in df.columns:
                    s = df[col].astype(str)
                    if s.str.contains("/", na=False).any():
                        df[col] = pd.to_datetime(df[col], format="mixed", dayfirst=True, errors="coerce")
                    else:
                        df[col] = pd.to_datetime(df[col], format="mixed", dayfirst=False, errors="coerce")
            dfs.append(df)
        except Exception as e:
            print(f"[Adyen] ❌ Erro: {f}: {e}")
    
    df_all = pd.concat(dfs, ignore_index=True)
    print(f"[Adyen] Total bruto: {len(df_all)}")
    
    # Filtra CB + NOC
    tipos = ["NotificationOfChargeback", "Chargeback"]
    df_cb = df_all[df_all["Record Type"].isin(tipos)].copy()
    
    # Extrai orderId do Metadata JSON
    def extract_order_id(meta):
        if pd.isna(meta):
            return None
        try:
            return json.loads(str(meta)).get("orderId")
        except (json.JSONDecodeError, TypeError):
            return None
    
    df_cb["vtex_order_id"] = df_cb["Metadata"].apply(extract_order_id)
    
    print(f"[Adyen] CB + NOC: {len(df_cb)}")
    print(df_cb["Record Type"].value_counts().to_string())
    return df_cb


def load_sap(folder: str) -> pd.DataFrame:
    """Carrega Excel SAP e filtra por CHARGEBACK na Denominação."""
    files = glob.glob(os.path.join(folder, "*.xlsx"))
    if not files:
        raise FileNotFoundError(f"Nenhum Excel SAP em: {folder}")
    
    print(f"\n[SAP] {len(files)} arquivos encontrados")
    dfs = []
    for f in files:
        if os.path.basename(f).startswith("~$"):
            continue
        try:
            df = pd.read_excel(f)
        except Exception as e:
            print(f"[SAP] ❌ Erro: {f}: {e}")
            continue
        
        denom_col = next((c for c in df.columns if "Denomina" in c and "objeto" not in c), None)
        data_entrada_col = next((c for c in df.columns if "entrada" in c.lower()), None)
        data_lancamento_col = next((c for c in df.columns if "lançamento" in c.lower() or "lanç" in c.lower()), None)
        valor_col = next((c for c in df.columns if "Valor" in str(c) or "Montante" in str(c)), None)
        
        if denom_col is None:
            print(f"[SAP] ⚠️ Coluna 'Denominação' não encontrada: {f}")
            continue
        
        mask = df[denom_col].str.upper().str.contains("CHARGEBACK", na=False)
        df_cb = df[mask].copy()
        
        # Extrai PSP Reference (16 chars alfanuméricos após NSU)
        df_cb["psp_reference_sap"] = df_cb[denom_col].astype(str).str.extract(r"NSU[^\w]*([A-Za-z0-9]{16})", expand=False)
        
        rename = {denom_col: "denominacao_sap"}
        if data_entrada_col:
            rename[data_entrada_col] = "data_entrada_sap"
        if data_lancamento_col:
            rename[data_lancamento_col] = "data_lancamento_sap"
        if valor_col:
            rename[valor_col] = "valor_sap"
        
        df_cb = df_cb.rename(columns=rename)
        
        keep = ["denominacao_sap", "psp_reference_sap"]
        for c in ["data_entrada_sap", "data_lancamento_sap", "valor_sap"]:
            if c in df_cb.columns:
                keep.append(c)
        
        dfs.append(df_cb[keep])
    
    if not dfs:
        raise ValueError("Nenhum dado de Chargeback SAP encontrado.")
    
    df_sap = pd.concat(dfs, ignore_index=True)
    print(f"[SAP] Total Chargebacks: {len(df_sap)}")
    return df_sap


def load_clearsale(folder: str) -> pd.DataFrame:
    """Carrega ClearSale (HTML disfarçado de XLS ou CSV com ;)."""
    files = glob.glob(os.path.join(folder, "*.xls")) + glob.glob(os.path.join(folder, "*.csv"))
    if not files:
        print(f"[ClearSale] ⚠️ Nenhum arquivo em: {folder}")
        return pd.DataFrame()
    
    print(f"\n[ClearSale] {len(files)} arquivos encontrados")
    dfs = []
    for f in files:
        if os.path.basename(f).startswith("~$"):
            continue
        df = None
        # Tenta read_html (HTML disfarçado de XLS)
        try:
            tables = pd.read_html(f)
            if tables:
                df = tables[0]
        except Exception:
            pass
        
        # Tenta CSV com ;
        if df is None or "PEDIDO" not in df.columns:
            try:
                df = pd.read_csv(f, sep=";", encoding="utf-8-sig", on_bad_lines="skip")
            except Exception:
                try:
                    df = pd.read_csv(f, sep=";", encoding="latin1", on_bad_lines="skip")
                except Exception as e:
                    print(f"[ClearSale] ❌ Erro: {f}: {e}")
                    continue
        
        if df is not None and "PEDIDO" in df.columns:
            df["vtex_order_id"] = df["PEDIDO"].astype(str).str.split("-").str[0].str.strip()
            df["source_file_cs"] = os.path.basename(f)
            dfs.append(df)
        else:
            print(f"[ClearSale] ⚠️ PEDIDO não encontrado: {f}")
    
    if not dfs:
        return pd.DataFrame()
    
    df_cs = pd.concat(dfs, ignore_index=True)
    df_cs = df_cs.drop_duplicates(subset=["vtex_order_id"], keep="last")
    
    # Prefixar colunas
    rename = {col: f"cs_{col.lower().replace(' ', '_')}" for col in df_cs.columns 
              if col not in ["vtex_order_id", "source_file_cs"]}
    df_cs = df_cs.rename(columns=rename)
    
    print(f"[ClearSale] Pedidos únicos: {len(df_cs)}")
    return df_cs


# ══════════════════════════════════════════════
# 2. MERGE & ENRICH
# ══════════════════════════════════════════════

def merge_all(df_adyen: pd.DataFrame, df_sap: pd.DataFrame, df_cs: pd.DataFrame) -> pd.DataFrame:
    """Cruza as 3 fontes."""
    
    # 1. Adyen ↔ SAP via PSP Reference
    sap_cols = [c for c in ["psp_reference_sap", "denominacao_sap", "data_entrada_sap", 
                             "data_lancamento_sap", "valor_sap"] if c in df_sap.columns]
    
    df = pd.merge(
        df_adyen,
        df_sap[sap_cols].drop_duplicates(subset=["psp_reference_sap"]),
        left_on="Psp Reference",
        right_on="psp_reference_sap",
        how="left"
    )
    
    match_sap = df["psp_reference_sap"].notna().sum()
    print(f"\n[Merge] Adyen ↔ SAP: {match_sap}/{len(df)} ({match_sap/len(df)*100:.1f}%)")
    
    # 2. Adyen ↔ ClearSale via vtex_order_id
    if not df_cs.empty:
        df["vtex_order_id_str"] = df["vtex_order_id"].astype(str).str.strip()
        df_cs["vtex_order_id_str"] = df_cs["vtex_order_id"].astype(str).str.strip()
        
        cs_cols = [c for c in df_cs.columns if c != "vtex_order_id"]
        df = pd.merge(df, df_cs[cs_cols], on="vtex_order_id_str", how="left")
        df = df.drop(columns=["vtex_order_id_str"], errors="ignore")
        
        cs_match_col = next((c for c in df.columns if c.startswith("cs_pedido")), None)
        if cs_match_col:
            match_cs = df[cs_match_col].notna().sum()
            print(f"[Merge] Adyen ↔ ClearSale: {match_cs}/{len(df)} ({match_cs/len(df)*100:.1f}%)")
    
    # 3. Identificar NOC → CB
    cb_psps = set(df.loc[df["Record Type"] == "Chargeback", "Psp Reference"].dropna().unique())
    noc_mask = df["Record Type"] == "NotificationOfChargeback"
    df["virou_chargeback"] = "N/A"
    df.loc[noc_mask, "virou_chargeback"] = df.loc[noc_mask, "Psp Reference"].isin(cb_psps).map(
        {True: "Sim", False: "Não"}
    )
    df.loc[df["Record Type"] == "Chargeback", "virou_chargeback"] = "É Chargeback"
    
    # 4. Fonte de dados
    has_sap = df["psp_reference_sap"].notna()
    cs_cols_check = [c for c in df.columns if c.startswith("cs_")]
    has_cs = df[cs_cols_check].notna().any(axis=1) if cs_cols_check else pd.Series(False, index=df.index)
    
    def get_fonte(sap, cs):
        fontes = ["Adyen"]
        if sap:
            fontes.append("SAP")
        if cs:
            fontes.append("ClearSale")
        return " + ".join(fontes)
    
    df["fonte"] = [get_fonte(s, c) for s, c in zip(has_sap, has_cs)]
    
    print(f"[Merge] Resultado final: {len(df)} linhas")
    print(f"[Merge] NOCs que viraram CB: {(df['virou_chargeback'] == 'Sim').sum()}")
    return df


def enrich_vtex(df: pd.DataFrame, ssl_verify: bool = True) -> pd.DataFrame:
    """Enriquece com dados da API VTEX (loja, entrega, produto, cidade/UF)."""
    if not VTEX_AVAILABLE:
        print("[VTEX] Enriquecimento indisponível.")
        return df
    
    config = VTEXConfig()
    extractor = VTEXExtractor(config)
    extractor.session.verify = ssl_verify
    
    if not extractor.ping():
        print("[VTEX] ❌ Ping falhou. Enriquecimento cancelado.")
        return df
    
    # Colunas VTEX
    vtex_cols = ["vtex_store", "vtex_installments", "vtex_installment_value",
                 "vtex_coupon", "vtex_discount_value", "vtex_invoice_number",
                 "vtex_invoice_key", "vtex_cidade", "vtex_uf", "vtex_delivery_type",
                 "vtex_products", "vtex_categories"]
    for col in vtex_cols:
        if col not in df.columns:
            df[col] = None
    
    # Order IDs válidos
    mask_valid = df["vtex_order_id"].notna() & df["vtex_order_id"].astype(str).str.strip().ne("")
    order_ids = [str(oid).strip() for oid in df.loc[mask_valid, "vtex_order_id"].unique()]
    print(f"\n[VTEX] {len(order_ids)} pedidos únicos para enriquecer")
    
    # Cache
    cache_path = os.path.join("data", "vtex_cache.json")
    os.makedirs("data", exist_ok=True)
    vtex_cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                vtex_cache = json.load(f)
            print(f"[VTEX Cache] {len(vtex_cache)} pedidos no cache")
        except Exception:
            pass
    
    missing = [oid for oid in order_ids if oid not in vtex_cache]
    print(f"[VTEX] {len(order_ids) - len(missing)} do cache, {len(missing)} pendentes")
    
    if missing:
        if not ssl_verify:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        def fetch_one(oid):
            formatos = [oid] if "-" in oid else [f"{oid}-01", oid, f"{oid}-02"]
            for fmt in formatos:
                try:
                    detail = extractor.get_order_detail(fmt)
                    flat = extractor._flatten_detail(detail)
                    return oid, {
                        "vtex_store": flat.get("vtex_store"),
                        "vtex_installments": flat.get("vtex_installments"),
                        "vtex_installment_value": flat.get("vtex_installment_value"),
                        "vtex_coupon": flat.get("vtex_coupon"),
                        "vtex_discount_value": flat.get("vtex_discount_value"),
                        "vtex_invoice_number": flat.get("invoice_number"),
                        "vtex_invoice_key": flat.get("invoice_key"),
                        "vtex_cidade": flat.get("cidade"),
                        "vtex_uf": flat.get("uf"),
                        "vtex_delivery_type": f"{flat.get('sla_type') or ''} ({flat.get('address_type') or ''})".strip(" ()"),
                        "vtex_products": flat.get("vtex_products"),
                        "vtex_categories": flat.get("vtex_categories"),
                    }
                except KeyError:
                    continue
                except Exception:
                    continue
            return oid, {k: None for k in vtex_cols}
        
        completed = 0
        with ThreadPoolExecutor(max_workers=15) as executor:
            futures = {executor.submit(fetch_one, oid): oid for oid in missing}
            for future in as_completed(futures):
                oid, result = future.result()
                vtex_cache[oid] = result
                completed += 1
                if completed % 100 == 0 or completed == len(missing):
                    print(f"[VTEX API] {completed}/{len(missing)} consultados...", flush=True)
                    try:
                        with open(cache_path, "w", encoding="utf-8") as f:
                            json.dump(vtex_cache, f, ensure_ascii=False, indent=2)
                    except Exception:
                        pass
        
        # Salvar cache final
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(vtex_cache, f, ensure_ascii=False, indent=2)
            print(f"[VTEX Cache] ✅ Salvo com {len(vtex_cache)} pedidos")
        except Exception:
            pass
    
    # Mapear cache → DataFrame
    df_oid = df["vtex_order_id"].astype(str).str.strip()
    for col in vtex_cols:
        col_map = {oid: data.get(col) for oid, data in vtex_cache.items()}
        df[col] = df_oid.map(col_map)
    
    found = df["vtex_store"].notna().sum()
    print(f"[VTEX] ✅ {found} linhas enriquecidas")
    return df


# ══════════════════════════════════════════════
# 3. AGGREGATIONS → JSON
# ══════════════════════════════════════════════

def safe_json(obj):
    """Converte tipos numpy/pandas para JSON-serializáveis."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return round(float(obj), 2)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if pd.isna(obj):
        return None
    return obj


def generate_dashboard_json(df: pd.DataFrame, output_path: str):
    """Gera o JSON com métricas agregadas para o dashboard."""
    
    data = {}
    
    # ── Período
    data["periodo"] = "Janeiro 2025 — Maio 2026"
    data["gerado_em"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # ── KPIs gerais
    cb = df[df["Record Type"] == "Chargeback"]
    noc = df[df["Record Type"] == "NotificationOfChargeback"]
    
    data["kpis"] = {
        "total_chargebacks": int(len(cb)),
        "total_notifications": int(len(noc)),
        "valor_total_cb": round(float(cb["Dispute Amount"].sum()), 2),
        "valor_total_noc": round(float(noc["Dispute Amount"].sum()), 2),
        "ticket_medio_cb": round(float(cb["Dispute Amount"].mean()), 2) if len(cb) > 0 else 0,
        "ticket_medio_noc": round(float(noc["Dispute Amount"].mean()), 2) if len(noc) > 0 else 0,
        "noc_que_viraram_cb": int((df["virou_chargeback"] == "Sim").sum()),
        "noc_total": int(len(noc)),
        "taxa_conversao_noc_cb": round(
            (df["virou_chargeback"] == "Sim").sum() / max(len(noc), 1) * 100, 1
        ),
        "com_sap": int(df["psp_reference_sap"].notna().sum()),
        "com_clearsale": int(df[[c for c in df.columns if c.startswith("cs_")]].notna().any(axis=1).sum()) if any(c.startswith("cs_") for c in df.columns) else 0,
    }
    
    # ── Evolução mensal
    df_temp = df.copy()
    df_temp["month"] = df_temp["Record Date"].dt.to_period("M").astype(str)
    
    monthly = df_temp.groupby(["month", "Record Type"]).agg(
        count=("Dispute Amount", "count"),
        total=("Dispute Amount", "sum")
    ).reset_index()
    
    months_list = sorted(df_temp["month"].dropna().unique())
    data["evolucao_mensal"] = {
        "labels": months_list,
        "chargeback": {
            "count": [int(monthly.loc[(monthly["month"] == m) & (monthly["Record Type"] == "Chargeback"), "count"].sum()) for m in months_list],
            "total": [round(float(monthly.loc[(monthly["month"] == m) & (monthly["Record Type"] == "Chargeback"), "total"].sum()), 2) for m in months_list],
        },
        "notification": {
            "count": [int(monthly.loc[(monthly["month"] == m) & (monthly["Record Type"] == "NotificationOfChargeback"), "count"].sum()) for m in months_list],
            "total": [round(float(monthly.loc[(monthly["month"] == m) & (monthly["Record Type"] == "NotificationOfChargeback"), "total"].sum()), 2) for m in months_list],
        }
    }
    
    # ── Valores SAP por mês (referência)
    sap_rows = df_temp[df_temp["psp_reference_sap"].notna()].copy()
    if "valor_sap" in sap_rows.columns:
        sap_rows["valor_sap"] = pd.to_numeric(sap_rows["valor_sap"], errors="coerce")
        sap_monthly = sap_rows.groupby("month").agg(
            count=("valor_sap", "count"),
            total=("valor_sap", "sum")
        ).reset_index()
        data["sap_mensal"] = {
            "labels": sap_monthly["month"].tolist(),
            "count": sap_monthly["count"].astype(int).tolist(),
            "total": [round(float(v), 2) for v in sap_monthly["total"]],
        }
    
    # ── Por Ferramenta (fonte)
    fonte_counts = df["fonte"].value_counts()
    data["por_ferramenta"] = {
        "labels": fonte_counts.index.tolist(),
        "values": fonte_counts.values.astype(int).tolist(),
    }
    
    # ── Dispute Reason
    reason_counts = df["Dispute Reason"].value_counts().head(10)
    data["por_motivo"] = {
        "labels": reason_counts.index.tolist(),
        "values": reason_counts.values.astype(int).tolist(),
    }
    
    # ── Payment Method / Bandeira
    pm_counts = df["Payment Method"].value_counts()
    data["por_bandeira"] = {
        "labels": pm_counts.index.tolist(),
        "values": pm_counts.values.astype(int).tolist(),
    }
    
    # ── ClearSale Status do Chargeback
    cs_status_col = next((c for c in df.columns if "cs_status_do_chargeback" in c), None)
    if cs_status_col:
        cs_status = df[cs_status_col].dropna().value_counts()
        data["cs_status_chargeback"] = {
            "labels": cs_status.index.tolist(),
            "values": cs_status.values.astype(int).tolist(),
        }
    
    # ── Localização (UF) — combina VTEX + ClearSale
    cs_uf_col = next((c for c in df.columns if c == "cs_uf"), None)
    
    df_temp["uf_combined"] = None
    if "vtex_uf" in df.columns:
        df_temp["uf_combined"] = df["vtex_uf"]
    if cs_uf_col:
        if df_temp["uf_combined"] is None or df_temp["uf_combined"].isna().all():
            df_temp["uf_combined"] = df[cs_uf_col]
        else:
            df_temp["uf_combined"] = df_temp["uf_combined"].fillna(df[cs_uf_col])
    
    if df_temp["uf_combined"].notna().any():
        uf_data = df_temp.groupby("uf_combined").agg(
            count=("Dispute Amount", "count"),
            total=("Dispute Amount", "sum")
        ).sort_values("count", ascending=False).reset_index()
        uf_data = uf_data[uf_data["uf_combined"].notna()]
        
        data["por_uf"] = {
            "labels": uf_data["uf_combined"].tolist(),
            "count": uf_data["count"].astype(int).tolist(),
            "total": [round(float(v), 2) for v in uf_data["total"]],
        }
    else:
        data["por_uf"] = {"labels": [], "count": [], "total": []}
    
    # ── Localização (Cidade) — top 20
    cs_cidade_col = next((c for c in df.columns if c == "cs_cidade"), None)
    
    df_temp["cidade_combined"] = None
    if "vtex_cidade" in df.columns:
        df_temp["cidade_combined"] = df["vtex_cidade"]
    if cs_cidade_col:
        if df_temp["cidade_combined"] is None or (isinstance(df_temp["cidade_combined"], pd.Series) and df_temp["cidade_combined"].isna().all()):
            df_temp["cidade_combined"] = df[cs_cidade_col]
        elif isinstance(df_temp["cidade_combined"], pd.Series):
            df_temp["cidade_combined"] = df_temp["cidade_combined"].fillna(df[cs_cidade_col])
    
    if df_temp["cidade_combined"].notna().any():
        cidade_data = df_temp.groupby("cidade_combined").agg(
            count=("Dispute Amount", "count"),
            total=("Dispute Amount", "sum")
        ).sort_values("count", ascending=False).head(20).reset_index()
        
        data["por_cidade"] = {
            "labels": cidade_data["cidade_combined"].tolist(),
            "count": cidade_data["count"].astype(int).tolist(),
            "total": [round(float(v), 2) for v in cidade_data["total"]],
        }
    
    # ── Forma de Entrega (VTEX delivery_type)
    if "vtex_delivery_type" in df.columns:
        delivery = df["vtex_delivery_type"].dropna()
        if not delivery.empty:
            # Simplificar: agrupar em "Entrega em Casa" vs "Clique e Retire" vs "Outros"
            def classify_delivery(d):
                d_lower = str(d).lower()
                if any(k in d_lower for k in ["retirada", "retire", "retira", "pickup", "retirar"]):
                    return "Clique e Retire"
                elif any(k in d_lower for k in ["entrega", "delivery", "normal", "expressa", "sedex", "pac", "correios", "economic"]):
                    return "Entrega em Casa"
                elif d_lower.strip() == "" or d_lower == "nan":
                    return None
                else:
                    return str(d)
            
            df_temp["delivery_simplified"] = df["vtex_delivery_type"].apply(classify_delivery)
            delivery_counts = df_temp["delivery_simplified"].dropna().value_counts()
            
            data["por_entrega"] = {
                "labels": delivery_counts.index.tolist(),
                "values": delivery_counts.values.astype(int).tolist(),
            }
            
            # Detalhado
            delivery_detail = df["vtex_delivery_type"].dropna().value_counts().head(15)
            data["por_entrega_detalhe"] = {
                "labels": delivery_detail.index.tolist(),
                "values": delivery_detail.values.astype(int).tolist(),
            }
    
    # ── Tipo de Produto (VTEX categories + ClearSale item principal)
    # VTEX categories
    if "vtex_categories" in df.columns:
        cats = df["vtex_categories"].dropna()
        if not cats.empty:
            all_cats = []
            for c in cats:
                all_cats.extend([x.strip() for x in str(c).split("|") if x.strip()])
            cat_series = pd.Series(all_cats).value_counts().head(20)
            data["por_categoria_vtex"] = {
                "labels": cat_series.index.tolist(),
                "values": cat_series.values.astype(int).tolist(),
            }
    
    # ClearSale item principal
    cs_item_col = next((c for c in df.columns if "cs_item_principal" in c), None)
    if cs_item_col:
        items = df[cs_item_col].dropna().value_counts().head(20)
        data["por_produto_cs"] = {
            "labels": [str(l)[:60] for l in items.index.tolist()],
            "values": items.values.astype(int).tolist(),
        }
    
    # ── Loja (VTEX store)
    if "vtex_store" in df.columns:
        stores = df["vtex_store"].dropna().value_counts().head(30)
        if not stores.empty:
            data["por_loja"] = {
                "labels": stores.index.tolist(),
                "values": stores.values.astype(int).tolist(),
            }
    
    # ── Cross-validation: comparação SAP vs Adyen
    data["cross_validation"] = {
        "total_adyen_cb_noc": int(len(df)),
        "encontrados_no_sap": int(df["psp_reference_sap"].notna().sum()),
        "nao_encontrados_sap": int(df["psp_reference_sap"].isna().sum()),
        "taxa_match_sap": round(df["psp_reference_sap"].notna().sum() / max(len(df), 1) * 100, 1),
    }
    
    cs_cols_any = [c for c in df.columns if c.startswith("cs_")]
    if cs_cols_any:
        cs_match = df[cs_cols_any].notna().any(axis=1).sum()
        data["cross_validation"]["encontrados_no_clearsale"] = int(cs_match)
        data["cross_validation"]["nao_encontrados_clearsale"] = int(len(df) - cs_match)
        data["cross_validation"]["taxa_match_clearsale"] = round(cs_match / max(len(df), 1) * 100, 1)
    
    # ── Top emails (possíveis fraudadores recorrentes)
    if "Shopper Email" in df.columns:
        email_counts = df["Shopper Email"].dropna().value_counts().head(15)
        data["top_emails"] = {
            "labels": email_counts.index.tolist(),
            "values": email_counts.values.astype(int).tolist(),
        }
    
    # ── Virou Chargeback breakdown
    virou = df["virou_chargeback"].value_counts()
    data["virou_chargeback"] = {
        "labels": virou.index.tolist(),
        "values": virou.values.astype(int).tolist(),
    }
    
    # ── Record Type completo (todos os tipos na Adyen original)
    rt = df["Record Type"].value_counts()
    data["record_types"] = {
        "labels": rt.index.tolist(),
        "values": rt.values.astype(int).tolist(),
    }
    
    # ── Tabela detalhada para exportação (top 100 por valor)
    detail_cols = ["Psp Reference", "Record Type", "Dispute Amount", "Dispute Reason",
                   "Payment Method", "Record Date", "virou_chargeback", "fonte",
                   "vtex_order_id", "vtex_store", "vtex_cidade", "vtex_uf",
                   "vtex_delivery_type", "vtex_categories", "cs_item_principal", "psp_reference_sap", "cs_status_do_chargeback"]
    detail_cols = [c for c in detail_cols if c in df.columns]
    
    top_records = df.nlargest(100, "Dispute Amount")[detail_cols].copy()
    top_records["Record Date"] = top_records["Record Date"].astype(str)
    top_records["Dispute Amount"] = top_records["Dispute Amount"].round(2)
    data["top_registros"] = top_records.to_dict(orient="records")
    
    # Salvar JSON agregado (legado/fallback)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=safe_json)
        
    # Salvar JSON RAW (para filtro no JS)
    raw_path = output_path.replace("dashboard_data.json", "dashboard_raw.json")
    df_raw = df[detail_cols].copy()
    df_raw["Record Date"] = df_raw["Record Date"].astype(str).str.slice(0, 10)
    df_raw["Dispute Amount"] = df_raw["Dispute Amount"].round(2)
    
    # Simplificar nomes para diminuir payload
    rename_map = {
        "Record Type": "type", "Dispute Amount": "amount", "Record Date": "date",
        "Dispute Reason": "reason", "Payment Method": "pm", "virou_chargeback": "virou",
        "vtex_store": "store", "vtex_cidade": "cidade", "vtex_uf": "uf",
        "vtex_delivery_type": "delivery", "psp_reference_sap": "sap",
        "cs_item_principal": "cs_item", "cs_status_do_chargeback": "cs_status"
    }
    df_raw = df_raw.rename(columns=rename_map)
    df_raw["sap"] = df_raw["sap"].notna() # boolean para facilitar match
    
    # Substituir NaN por None para gerar JSON válido em JS (null)
    df_raw = df_raw.where(pd.notnull(df_raw), None)
    
    raw_records = df_raw.to_dict(orient="records")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw_records, f, ensure_ascii=False, separators=(',', ':'), default=safe_json, allow_nan=False)
    print(f"\n✅ JSON RAW gerado para dashboard: {raw_path}")
    
    print(f"\n✅ JSON gerado: {output_path}")
    return data


# ══════════════════════════════════════════════
# 4. EXCEL EXPORT
# ══════════════════════════════════════════════

def export_excel(df: pd.DataFrame, output_path: str):
    """Exporta o DataFrame consolidado para Excel com múltiplas abas."""
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        # Aba 1: Consolidado completo
        df.to_excel(writer, sheet_name="Consolidado", index=False)
        
        # Aba 2: Só Chargebacks
        cb = df[df["Record Type"] == "Chargeback"]
        if not cb.empty:
            cb.to_excel(writer, sheet_name="Chargebacks", index=False)
        
        # Aba 3: Só Notifications
        noc = df[df["Record Type"] == "NotificationOfChargeback"]
        if not noc.empty:
            noc.to_excel(writer, sheet_name="Notifications", index=False)
        
        # Aba 4: NOC que viraram CB
        virou = df[df["virou_chargeback"] == "Sim"]
        if not virou.empty:
            virou.to_excel(writer, sheet_name="Virou_Chargeback", index=False)
        
        # Aba 5: Resumo mensal
        df_temp = df.copy()
        df_temp["Mês"] = df_temp["Record Date"].dt.to_period("M").astype(str)
        resumo = df_temp.groupby(["Mês", "Record Type"]).agg(
            Quantidade=("Dispute Amount", "count"),
            Valor_Total=("Dispute Amount", "sum"),
            Ticket_Medio=("Dispute Amount", "mean")
        ).round(2).reset_index()
        resumo.to_excel(writer, sheet_name="Resumo_Mensal", index=False)
    
    print(f"✅ Excel salvo: {output_path}")


# ══════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pipeline Mapa Antifraude")
    parser.add_argument("--no-vtex", action="store_true", help="Pula enriquecimento VTEX")
    parser.add_argument("--no-ssl", action="store_true", help="Desabilita SSL (proxy corporativo)")
    args = parser.parse_args()
    
    SAP_FOLDER = "data/SAP"
    ADYEN_FOLDER = "data/adyen"
    CS_FOLDER = "data/ClearSale"
    JSON_OUTPUT = "dashboard/dashboard_data.json"
    EXCEL_OUTPUT = "consolidado_chargeback.xlsx"
    
    print("=" * 60)
    print("  MAPA ANTIFRAUDE — Pipeline de Dados")
    print("=" * 60)
    
    # 1. Carrega fontes
    df_adyen = load_adyen(ADYEN_FOLDER)
    df_sap = load_sap(SAP_FOLDER)
    df_cs = load_clearsale(CS_FOLDER)
    
    # 2. Cruza tudo
    df_final = merge_all(df_adyen, df_sap, df_cs)
    
    # 3. Enriquece com VTEX
    if not args.no_vtex:
        df_final = enrich_vtex(df_final, ssl_verify=not args.no_ssl)
    else:
        print("\n[VTEX] Enriquecimento pulado (--no-vtex)")
    
    # 4. Gera saídas
    os.makedirs("dashboard", exist_ok=True)
    generate_dashboard_json(df_final, JSON_OUTPUT)
    export_excel(df_final, EXCEL_OUTPUT)
    
    print("\n" + "=" * 60)
    print("  ✅ Pipeline concluído!")
    print(f"  → JSON: {JSON_OUTPUT}")
    print(f"  → Excel: {EXCEL_OUTPUT}")
    print(f"  → Shape: {df_final.shape}")
    print("=" * 60)
