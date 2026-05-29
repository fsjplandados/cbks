import sys
import json
import pandas as pd
import glob
import os
import argparse

# Força saída UTF-8 no Windows com line buffering para logs em background imediatos
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

# ─────────────────────────────────────────────
# VTEX – importação condicional
# ─────────────────────────────────────────────
try:
    from vtex_extractor import VTEXExtractor
    from config.settings import VTEXConfig
    VTEX_AVAILABLE = True
except ImportError as _vtex_err:
    VTEX_AVAILABLE = False
    print(f"[VTEX] ⚠️  Módulo não disponível: {_vtex_err}")


# ─────────────────────────────────────────────
# 1. SAP – carrega e filtra chargebacks
# ─────────────────────────────────────────────
def load_sap(folder_path: str) -> pd.DataFrame:
    """Lê todos os arquivos Excel SAP na pasta, filtra linhas de Chargeback e extrai as partes."""

    files = glob.glob(os.path.join(folder_path, "*.xlsx"))
    if not files:
        raise FileNotFoundError(f"Nenhum Excel encontrado em: {folder_path}")

    print(f"\n[SAP] Arquivos encontrados: {len(files)}")

    df_list = []
    for f in files:
        if os.path.basename(f).startswith("~$"):
            continue
        try:
            df = pd.read_excel(f)
        except Exception as e:
            print(f"[SAP] ❌ Erro ao ler {f}: {e}")
            continue

        # Detecta a coluna 'Denominação' (aceita variações de encoding/nomes)
        denom_col = next((c for c in df.columns if "Denomina" in c and "objeto" not in c), None)
        data_entrada_col = next((c for c in df.columns if "entrada" in c.lower()), None)
        data_lancamento_col = next((c for c in df.columns if "lançamento" in c.lower() or "lançamento" in c.lower() or "lanç" in c.lower()), None)

        if denom_col is None:
            print(f"[SAP] ⚠️ Coluna 'Denominação' não encontrada no arquivo {f}. Pulando...")
            continue

        # Filtra apenas linhas que contêm 'CHARGEBACK' na denominação
        mask = df[denom_col].str.upper().str.contains("CHARGEBACK", na=False)
        df_cb = df[mask].copy()

        # Extração via RegEx mais flexível
        # Encontra o código de exatamente 16 caracteres (Adyen PSP) após a palavra NSU, ignorando sufixos como -123 ou SCF
        df_cb["psp_reference_sap"] = df_cb[denom_col].astype(str).str.extract(r"NSU[^\w]*([A-Za-z0-9]{16})", expand=False)
        df_cb["nsu"] = df_cb[denom_col].astype(str).str.extract(r"[A-Za-z0-9]{16}[^\w]*([A-Za-z0-9]+)$", expand=False)
        df_cb["tipo"] = "CHARGEBACK"

        # A concatenação não é mais necessária pois já adicionamos as colunas diretamente no df_cb
        # Identifica a coluna de valor
        valor_col = next((c for c in df.columns if "Valor" in str(c) or "Montante" in str(c)), None)

        # Renomeia e seleciona
        rename_dict = {denom_col: "denominacao_sap"}
        if data_entrada_col:
            rename_dict[data_entrada_col] = "data_entrada_sap"
        if data_lancamento_col:
            rename_dict[data_lancamento_col] = "data_lancamento_sap"
        if valor_col:
            rename_dict[valor_col] = "valor_sap"

        df_cb = df_cb.rename(columns=rename_dict)

        keep = ["denominacao_sap", "tipo", "psp_reference_sap", "nsu"]
        if data_entrada_col:
            keep.append("data_entrada_sap")
        if data_lancamento_col:
            keep.append("data_lancamento_sap")
        if valor_col:
            keep.append("valor_sap")

        df_list.append(df_cb[keep])

    if not df_list:
        raise ValueError("Nenhum dado de Chargeback válido encontrado nos arquivos SAP.")

    df_sap_all = pd.concat(df_list, ignore_index=True)
    df_sap_all["sap_id"] = range(1, len(df_sap_all) + 1)
    print(f"[SAP] Total de linhas de Chargeback (consolidado): {len(df_sap_all)}")
    return df_sap_all


# ─────────────────────────────────────────────
# 2. Adyen – carrega, filtra e consolida CSVs
# ─────────────────────────────────────────────
def load_adyen(folder_path: str) -> pd.DataFrame:
    """Lê todos os CSVs Adyen, filtra por NotificationOfChargeback e Chargeback."""

    files = glob.glob(os.path.join(folder_path, "*.csv"))
    if not files:
        raise FileNotFoundError(f"Nenhum CSV encontrado em: {folder_path}")

    print(f"\n[Adyen] Arquivos encontrados: {len(files)}")

    df_list = []
    for f in files:
        try:
            # Usa sep=None e engine='python' para detectar automaticamente se o CSV usa , ou ;
            df = pd.read_csv(f, sep=None, engine='python')
            df["source_file"] = os.path.basename(f)
            
            # Normalização de datas direto na fonte
            date_cols = ["Record Date", "Payment Date", "Dispute Date", "Dispute End Date"]
            for col in date_cols:
                if col in df.columns:
                    s = df[col].astype(str)
                    # Checa se o arquivo usa barra (padrão brasileiro DD/MM) ou traço (ISO AAAA-MM-DD)
                    mask_slash = s.str.contains('/', na=False)
                    if mask_slash.any():
                        df[col] = pd.to_datetime(df[col], format="mixed", dayfirst=True, errors="coerce")
                    else:
                        df[col] = pd.to_datetime(df[col], format="mixed", dayfirst=False, errors="coerce")
                        
            df_list.append(df)
        except Exception as e:
            print(f"[Adyen] ❌ Erro ao ler {f}: {e}")
            continue

    if not df_list:
        raise ValueError("Nenhum dado válido carregado da Adyen.")

    df_all = pd.concat(df_list, ignore_index=True)
    print(f"[Adyen] Total de linhas brutas: {len(df_all)}")

    # Filtra apenas os tipos de interesse
    tipos_interesse = ["NotificationOfChargeback", "Chargeback"]
    mask = df_all["Record Type"].isin(tipos_interesse)
    df_filtered = df_all[mask].copy()
    df_filtered["adyen_id"] = range(1, len(df_filtered) + 1)
    
    print(f"[Adyen] Linhas após filtro (NotificationOfChargeback + Chargeback): {len(df_filtered)}")
    print(df_filtered["Record Type"].value_counts().to_string())
    return df_filtered


# ─────────────────────────────────────────────
# 3. Join: Adyen ← data_entrada do SAP
# ─────────────────────────────────────────────
def merge_adyen_sap(df_adyen: pd.DataFrame, df_sap: pd.DataFrame) -> pd.DataFrame:
    """Une o DataFrame Adyen com a data_entrada do SAP usando o PSP Reference."""

    # Colunas do SAP que queremos trazer para o Adyen
    sap_cols = ["sap_id", "psp_reference_sap", "nsu", "data_entrada_sap", "data_lancamento_sap", "denominacao_sap", "valor_sap"]
    sap_cols_existentes = [c for c in sap_cols if c in df_sap.columns]
    
    df_sap_ready = df_sap[sap_cols_existentes].copy()

    # Faz o join (OUTER) para preservar tanto Adyen sem SAP, quanto SAP sem Adyen
    df_final = pd.merge(
        df_adyen,
        df_sap_ready,
        left_on="Psp Reference",
        right_on="psp_reference_sap",
        how="outer"
    )

    # Identifica o que só tem no SAP
    sap_only = df_final["Psp Reference"].isna()
    df_final.loc[sap_only, "Record Type"] = "SAP Only"
    df_final.loc[sap_only, "Psp Reference"] = df_final.loc[sap_only, "psp_reference_sap"]

    total = len(df_final)
    com_match = df_final["psp_reference_sap"].notna().sum()
    print(f"\n[Merge] Linhas no resultado final: {total}")
    print(f"[Merge] Com correspondência SAP: {com_match} ({com_match/total*100:.1f}%)")
    print(f"[Merge] Sem correspondência SAP: {total - com_match}")

    # Extrai vtex_order_id do JSON na coluna Metadata (Adyen)
    if "Metadata" in df_final.columns:
        def _extract_order_id(meta):
            if pd.isna(meta):
                return None
            try:
                return json.loads(str(meta)).get("orderId")
            except (json.JSONDecodeError, TypeError):
                return None

        df_final["vtex_order_id"] = df_final["Metadata"].apply(_extract_order_id)
        found = df_final["vtex_order_id"].notna().sum()
        print(f"[Merge] VTEX order_id extraído do Metadata: {found} de {len(df_final)} linhas")

    return df_final


# ─────────────────────────────────────────────
# 4. ClearSale – carrega relatórios e extrai order id
# ─────────────────────────────────────────────
def load_clearsale(folder_path: str) -> pd.DataFrame:
    """Lê os arquivos da ClearSale (CSV disfarçado de XLS) e extrai vtex_order_id."""
    files = glob.glob(os.path.join(folder_path, "*.xls")) + glob.glob(os.path.join(folder_path, "*.csv"))
    if not files:
        print(f"[ClearSale] ⚠️ Nenhum arquivo encontrado em: {folder_path}")
        return pd.DataFrame()

    print(f"\n[ClearSale] Arquivos encontrados: {len(files)}")
    df_list = []
    for f in files:
        if os.path.basename(f).startswith("~$"):
            continue
        try:
            # Arquivo ClearSale geralmente é separado por ';' com BOM utf-8 ou iso-8859-1
            df = pd.read_csv(f, sep=";", encoding="utf-8-sig", on_bad_lines="skip")
            if "PEDIDO" not in df.columns:
                raise ValueError("PEDIDO ausente no CSV")
        except Exception:
            try:
                df = pd.read_csv(f, sep=";", encoding="latin1", on_bad_lines="skip")
                if "PEDIDO" not in df.columns:
                    raise ValueError("PEDIDO ausente no CSV latin1")
            except Exception:
                try:
                    # Pode ser um arquivo HTML disfarçado de XLS
                    dfs = pd.read_html(f)
                    if dfs:
                        df = dfs[0]
                except Exception as e3:
                    print(f"[ClearSale] ❌ Erro ao ler {f}: {e3}")
                    continue
        
        if "PEDIDO" in df.columns:
            # Extrai a primeira parte do UUID, que é enviada como orderId na Adyen
            df["vtex_order_id"] = df["PEDIDO"].astype(str).str.split("-").str[0].str.strip()
            df_list.append(df)
        else:
            print(f"[ClearSale] ⚠️ Coluna 'PEDIDO' não encontrada no arquivo {f}.")
            
    if not df_list:
        return pd.DataFrame()
        
    df_all = pd.concat(df_list, ignore_index=True)
    df_all = df_all.drop_duplicates(subset=["vtex_order_id"], keep="last")
    print(f"[ClearSale] Total de pedidos únicos carregados: {len(df_all)}")
    
    # Prefixar colunas com 'clearsale_' para facilitar identificação (menos a chave)
    rename_cols = {col: f"clearsale_{col.lower().replace(' ', '_')}" for col in df_all.columns if col != "vtex_order_id"}
    df_all = df_all.rename(columns=rename_cols)
    
    return df_all

# ─────────────────────────────────────────────
def enrich_with_vtex(
    df: pd.DataFrame,
    vtex_app_token: str = "",
    order_id_col: str = "vtex_order_id",
    ssl_verify: bool = True,
) -> pd.DataFrame:
    """
    Para cada linha do DataFrame que possui um order_id VTEX (coluna `order_id_col`),
    busca via API (usando concorrência e cache local):
      - vtex_store:        loja onde o pedido foi feito
      - vtex_installments: número de parcelas
      - vtex_coupon:       cupom de desconto (se usado)

    Args:
        df:             DataFrame resultado do merge Adyen × SAP.
        vtex_app_token: App Token da VTEX (usa default do config se vazio).
        order_id_col:   Coluna que contém o order_id VTEX (default: 'vtex_order_id').
        ssl_verify:     False para redes com proxy Fortinet (desabilita SSL).

    Returns:
        DataFrame enriquecido com as 3 colunas VTEX.
    """
    if not VTEX_AVAILABLE:
        print("[VTEX] Enriquecimento pulado — módulo não disponível.")
        return df

    if vtex_app_token:
        config = VTEXConfig(app_token=vtex_app_token)
    else:
        config = VTEXConfig()  # usa default do settings.py
    extractor = VTEXExtractor(config)
    extractor.session.verify = ssl_verify

    # Testa conexão antes de iterar
    if not extractor.ping():
        print("[VTEX] ❌ Ping falhou — verifique credenciais/rede. Enriquecimento cancelado.")
        return df

    # Garante que as colunas de destino existam
    for col in ["vtex_store", "vtex_installments", "vtex_installment_value", "vtex_coupon", "vtex_discount_value", "vtex_invoice_number", "vtex_invoice_key",
                "vtex_cidade", "vtex_uf", "vtex_delivery_type", "vtex_products", "vtex_categories"]:
        if col not in df.columns:
            df[col] = None

    # Verifica se a coluna existe
    if order_id_col not in df.columns:
        print(f"[VTEX] ❌ Coluna '{order_id_col}' não encontrada. Enriquecimento cancelado.")
        return df

    # Identifica linhas com order_id válido (não nulo, não vazio)
    mask_valid = df[order_id_col].notna() & df[order_id_col].astype(str).str.strip().ne("")
    order_ids = df.loc[mask_valid, order_id_col].unique()
    order_ids = [str(oid).strip() for oid in order_ids]

    print(f"\n[VTEX] Identificados {len(order_ids)} pedidos únicos para enriquecimento.")

    # 1. Carrega Cache Local
    cache_path = os.path.join("data", "vtex_cache.json")
    os.makedirs("data", exist_ok=True)
    vtex_cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                vtex_cache = json.load(f)
            print(f"[VTEX Cache] {len(vtex_cache)} pedidos carregados do cache local.")
        except Exception as e:
            print(f"[VTEX Cache] ⚠️ Falha ao ler cache ({e}). Iniciando cache vazio.")

    # Identifica pedidos que precisam de consulta na API (não estão no cache)
    missing_ids = [oid for oid in order_ids if oid not in vtex_cache]
    print(f"[VTEX] {len(order_ids) - len(missing_ids)} pedidos já resolvidos via Cache.")
    print(f"[VTEX] {len(missing_ids)} pedidos pendentes de consulta na API.")

    if missing_ids:
        # Desabilita warnings de SSL se ssl_verify for False para não poluir
        if not ssl_verify:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        from concurrent.futures import ThreadPoolExecutor, as_completed
        max_workers = 15  # número ótimo de threads para balancear velocidade e limites
        print(f"[VTEX] Consultando API com {max_workers} threads em paralelo...")

        def _fetch_one(oid):
            oid_str = str(oid).strip()
            # Formatos a tentar para o order_id:
            # 1. Com sufixo '-01' (padrão absoluto do VTEX OMS para pedidos unitários)
            # 2. ID bruto (como vem do Metadata)
            # 3. Com sufixo '-02' (split de entrega de seller)
            formatos = [oid_str] if "-" in oid_str else [f"{oid_str}-01", oid_str, f"{oid_str}-02"]
            
            for fmt in formatos:
                try:
                    detail = extractor.get_order_detail(fmt)
                    flat = extractor._flatten_detail(detail)
                    return oid_str, {
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
                    # 404 Not Found (que agora lança KeyError), tenta o próximo formato sem retries nem delays
                    continue
                except Exception:
                    # Qualquer outro erro de rede ou rate limit
                    continue
            
            # Se falhar em todos os formatos, retorna None nos campos para salvar no cache e evitar novas requisições repetidas
            return oid_str, {
                "vtex_store": None,
                "vtex_installments": None,
                "vtex_installment_value": None,
                "vtex_coupon": None,
                "vtex_discount_value": None,
                "vtex_invoice_number": None,
                "vtex_invoice_key": None,
                "vtex_cidade": None,
                "vtex_uf": None,
                "vtex_delivery_type": None,
                "vtex_products": None,
                "vtex_categories": None,
            }

        # Executa em paralelo
        completed_count = 0
        new_updates = 0
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_fetch_one, oid): oid for oid in missing_ids}
            for future in as_completed(futures):
                oid, result = future.result()
                vtex_cache[oid] = result
                completed_count += 1
                new_updates += 1
                
                # Print de progresso a cada 100 pedidos e salvamento incremental no cache
                if completed_count % 100 == 0 or completed_count == len(missing_ids):
                    print(f"[VTEX API] {completed_count}/{len(missing_ids)} pedidos consultados...", flush=True)
                    try:
                        with open(cache_path, "w", encoding="utf-8") as f:
                            json.dump(vtex_cache, f, ensure_ascii=False, indent=2)
                    except Exception as e:
                        pass

        # Salva o Cache atualizado se houve novidades
        if new_updates > 0:
            try:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(vtex_cache, f, ensure_ascii=False, indent=2)
                print(f"[VTEX Cache] ✅ Cache atualizado com {new_updates} novos pedidos e salvo em '{cache_path}'.")
            except Exception as e:
                print(f"[VTEX Cache] ⚠️ Falha ao salvar arquivo de cache: {e}")

    # 3. Mapeia os dados do cache de volta para o DataFrame de forma otimizada
    store_map = {oid: data.get("vtex_store") for oid, data in vtex_cache.items()}
    installments_map = {oid: data.get("vtex_installments") for oid, data in vtex_cache.items()}
    installment_value_map = {oid: data.get("vtex_installment_value") for oid, data in vtex_cache.items()}
    coupon_map = {oid: data.get("vtex_coupon") for oid, data in vtex_cache.items()}
    discount_value_map = {oid: data.get("vtex_discount_value") for oid, data in vtex_cache.items()}
    invoice_number_map = {oid: data.get("vtex_invoice_number") for oid, data in vtex_cache.items()}
    invoice_key_map = {oid: data.get("vtex_invoice_key") for oid, data in vtex_cache.items()}
    cidade_map = {oid: data.get("vtex_cidade") for oid, data in vtex_cache.items()}
    uf_map = {oid: data.get("vtex_uf") for oid, data in vtex_cache.items()}
    delivery_type_map = {oid: data.get("vtex_delivery_type") for oid, data in vtex_cache.items()}
    products_map = {oid: data.get("vtex_products") for oid, data in vtex_cache.items()}
    categories_map = {oid: data.get("vtex_categories") for oid, data in vtex_cache.items()}

    # Converte a coluna do df para string limpa para mapear corretamente
    df_oid_str = df[order_id_col].astype(str).str.strip()
    df["vtex_store"] = df_oid_str.map(store_map)
    df["vtex_installments"] = df_oid_str.map(installments_map)
    df["vtex_installment_value"] = df_oid_str.map(installment_value_map)
    df["vtex_coupon"] = df_oid_str.map(coupon_map)
    df["vtex_discount_value"] = df_oid_str.map(discount_value_map)
    df["vtex_invoice_number"] = df_oid_str.map(invoice_number_map)
    df["vtex_invoice_key"] = df_oid_str.map(invoice_key_map)
    df["vtex_cidade"] = df_oid_str.map(cidade_map)
    df["vtex_uf"] = df_oid_str.map(uf_map)
    df["vtex_delivery_type"] = df_oid_str.map(delivery_type_map)
    df["vtex_products"] = df_oid_str.map(products_map)
    df["vtex_categories"] = df_oid_str.map(categories_map)

    found = df["vtex_store"].notna().sum()
    print(f"[VTEX] ✅ {found} linhas enriquecidas com dados VTEX.")
    return df



# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reconciliação Adyen × SAP × VTEX")
    parser.add_argument(
        "--vtex-token",
        default=os.environ.get("VTEX_APP_TOKEN", ""),
        help="App Token da VTEX (ou defina a variável VTEX_APP_TOKEN no ambiente).",
    )
    parser.add_argument(
        "--no-vtex",
        action="store_true",
        help="Pula o enriquecimento VTEX (útil para testes sem acesso à API).",
    )
    parser.add_argument(
        "--no-ssl",
        action="store_true",
        help="Desabilita verificação SSL (redes com proxy Fortinet).",
    )
    args = parser.parse_args()

    SAP_FOLDER   = "data/SAP"
    ADYEN_FOLDER = "data/adyen"
    CLEARSALE_FOLDER = "data/ClearSale"
    OUTPUT_FILE  = "resultado_chargeback.xlsx"

    # 1. Carrega dados base
    df_sap   = load_sap(SAP_FOLDER)
    df_adyen = load_adyen(ADYEN_FOLDER)

    # 2. Une pelo PSP Reference
    df_final = merge_adyen_sap(df_adyen, df_sap)

    # 3. Carrega e junta ClearSale
    df_cs = load_clearsale(CLEARSALE_FOLDER)
    if not df_cs.empty:
        df_final["vtex_order_id_str"] = df_final["vtex_order_id"].astype(str).str.strip()
        df_cs["vtex_order_id_str"] = df_cs["vtex_order_id"].astype(str).str.strip()
        
        df_final = pd.merge(df_final, df_cs.drop(columns=["vtex_order_id"]), on="vtex_order_id_str", how="left")
        df_final = df_final.drop(columns=["vtex_order_id_str"])
        
        found_cs = df_final["clearsale_pedido"].notna().sum()
        print(f"[ClearSale] ✅ {found_cs} linhas cruzadas com dados ClearSale.")

    # 4. Enriquece com dados VTEX (loja, parcelamento, cupom)
    if not args.no_vtex:
        df_final = enrich_with_vtex(
            df_final,
            vtex_app_token=args.vtex_token,
            order_id_col="vtex_order_id",
            ssl_verify=not args.no_ssl,
        )
    else:
        print("[VTEX] Enriquecimento pulado (--no-vtex).")

    # 4. Salva resultados
    # Salva o consolidado
    df_final.to_excel(OUTPUT_FILE, index=False)
    print(f"\n✅ Arquivo consolidado salvo: {OUTPUT_FILE}")
    print(f"   Shape final: {df_final.shape}")

    # Salva filtrado: Chargeback
    mask_cb = df_final["Record Type"] == "Chargeback"
    if mask_cb.any():
        df_cb = df_final[mask_cb]
        df_cb.to_excel("chargeback.xlsx", index=False)
        print(f"✅ Arquivo Chargeback salvo: chargeback.xlsx (Linhas: {len(df_cb)})")

    # Salva filtrado: NotificationOfChargeback
    mask_notif = df_final["Record Type"] == "NotificationOfChargeback"
    if mask_notif.any():
        df_notif = df_final[mask_notif].copy()
        df_notif.to_excel("notification_chargeback.xlsx", index=False)
        print(f"✅ Arquivo NotificationOfChargeback salvo: notification_chargeback.xlsx (Linhas: {len(df_notif)})")

    # Nova Planilha: virou_chargeback.xlsx com todas as linhas de notificação e chargeback
    mask_both = df_final["Record Type"].isin(["NotificationOfChargeback", "Chargeback"])
    if mask_both.any():
        df_virou = df_final[mask_both].copy()
        
        if mask_cb.any():
            cb_psp_refs = df_final.loc[mask_cb, "Psp Reference"].dropna().unique()
            # Marca 'Sim' ou 'Não' para as notificações
            is_notif = df_virou["Record Type"] == "NotificationOfChargeback"
            df_virou.loc[is_notif, "virou_chargeback"] = df_virou.loc[is_notif, "Psp Reference"].isin(cb_psp_refs).map({True: "Sim", False: "Não"})
            
            # Para os registros que já são o Chargeback em si
            is_cb = df_virou["Record Type"] == "Chargeback"
            df_virou.loc[is_cb, "virou_chargeback"] = "Sim"
        else:
            df_virou["virou_chargeback"] = "Não"
            
        # Determina a fonte de dados (Adyen, SAP, ClearSale)
        has_sap = df_virou["psp_reference_sap"].notna()
        cs_cols = [c for c in df_virou.columns if c.startswith("clearsale_")]
        if cs_cols:
            has_cs = df_virou[cs_cols].notna().any(axis=1)
        else:
            has_cs = pd.Series(False, index=df_virou.index)

        def get_fonte(sap, cs):
            fontes = ["Adyen"]
            if sap: fontes.append("SAP")
            if cs: fontes.append("ClearSale")
            return " + ".join(fontes)

        df_virou["fonte"] = [get_fonte(s, c) for s, c in zip(has_sap, has_cs)]
            
        # Move as colunas 'virou_chargeback' e 'fonte' para o início para facilitar a visualização
        cols = list(df_virou.columns)
        if 'fonte' in cols:
            cols.insert(0, cols.pop(cols.index('fonte')))
        if 'virou_chargeback' in cols:
            cols.insert(0, cols.pop(cols.index('virou_chargeback')))
            
        df_virou = df_virou[cols]

        df_virou.to_excel("virou_chargeback.xlsx", index=False)
        print(f"✅ Arquivo de verificação salvo: virou_chargeback.xlsx (Linhas: {len(df_virou)})")

    print("\nPrimeiras linhas:")
    cols_preview = ["Psp Reference", "Merchant Reference", "Record Type", "vtex_order_id",
                    "vtex_store", "vtex_installments", "vtex_installment_value",
                    "vtex_coupon", "vtex_discount_value", "vtex_invoice_number", "vtex_invoice_key",
                    "vtex_cidade", "vtex_uf", "vtex_delivery_type", "vtex_products", "vtex_categories",
                    "clearsale_status_finalizacao", "clearsale_score"]
    cols_preview = [c for c in cols_preview if c in df_final.columns]
    print(df_final[cols_preview].head(15).to_string())

