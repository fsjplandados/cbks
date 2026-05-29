"""Script temporário para inspecionar as fontes de dados."""
import pandas as pd
import glob
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

# ── ADYEN ──
print("=" * 80)
print("ADYEN - Amostra de colunas e dados")
print("=" * 80)
adyen_files = glob.glob("data/adyen/*.csv")
if adyen_files:
    df = pd.read_csv(adyen_files[0], sep=None, engine='python', nrows=5)
    print(f"Arquivo: {adyen_files[0]}")
    print(f"Colunas ({len(df.columns)}): {list(df.columns)}")
    print(f"\nPrimeiras linhas:")
    print(df.to_string())
    print(f"\nRecord Types únicos (all files):")
    all_types = set()
    for f in adyen_files:
        try:
            dft = pd.read_csv(f, sep=None, engine='python', usecols=["Record Type"])
            all_types.update(dft["Record Type"].unique())
        except:
            pass
    print(sorted(all_types))

# ── SAP ──
print("\n" + "=" * 80)
print("SAP - Amostra de colunas e dados")
print("=" * 80)
sap_files = glob.glob("data/SAP/*.xlsx")
for f in sap_files:
    if os.path.basename(f).startswith("~$"):
        continue
    df = pd.read_excel(f, nrows=5)
    print(f"\nArquivo: {f}")
    print(f"Colunas ({len(df.columns)}): {list(df.columns)}")
    print(f"\nPrimeiras linhas:")
    print(df.to_string())

# ── CLEARSALE ──
print("\n" + "=" * 80)
print("CLEARSALE - Amostra de colunas e dados")
print("=" * 80)
cs_files = glob.glob("data/ClearSale/*.xls") + glob.glob("data/ClearSale/*.csv")
for f in cs_files:
    if os.path.basename(f).startswith("~$"):
        continue
    try:
        df = pd.read_csv(f, sep=";", encoding="utf-8-sig", nrows=5, on_bad_lines="skip")
    except:
        try:
            df = pd.read_csv(f, sep=";", encoding="latin1", nrows=5, on_bad_lines="skip")
        except:
            dfs = pd.read_html(f)
            df = dfs[0].head(5) if dfs else pd.DataFrame()
    print(f"\nArquivo: {f}")
    print(f"Colunas ({len(df.columns)}): {list(df.columns)}")
    print(f"\nPrimeiras linhas:")
    print(df.to_string())
