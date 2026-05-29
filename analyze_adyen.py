import pandas as pd, sys, glob
sys.stdout.reconfigure(encoding="utf-8")

all_dfs = []
for f in sorted(glob.glob("data/adyen/*.csv")):
    df = pd.read_csv(f, sep=None, engine="python")
    all_dfs.append(df)

df_all = pd.concat(all_dfs, ignore_index=True)
mask = df_all["Record Type"].isin(["Chargeback", "NotificationOfChargeback"])
df_cb = df_all[mask]

print("Dispute Reason (top 15):")
print(df_cb["Dispute Reason"].value_counts().head(15).to_string())
print()
print("Payment Method:")
print(df_cb["Payment Method"].value_counts().to_string())
print()
print("Shopper Interaction:")
print(df_cb["Shopper Interaction"].value_counts().to_string())
print()

# Totals
cb_only = df_cb[df_cb["Record Type"]=="Chargeback"]
noc_only = df_cb[df_cb["Record Type"]=="NotificationOfChargeback"]
total_cb = cb_only["Dispute Amount"].sum()
total_noc = noc_only["Dispute Amount"].sum()
print(f"Total CB amount: R$ {total_cb:,.2f} ({len(cb_only)} rows)")
print(f"Total NOC amount: R$ {total_noc:,.2f} ({len(noc_only)} rows)")

# Monthly breakdown
df_cb_copy = df_cb.copy()
df_cb_copy["Record Date"] = pd.to_datetime(df_cb_copy["Record Date"], format="mixed", errors="coerce")
df_cb_copy["month"] = df_cb_copy["Record Date"].dt.to_period("M")
monthly = df_cb_copy.groupby(["month", "Record Type"]).agg(
    count=("Dispute Amount", "count"),
    total=("Dispute Amount", "sum")
).reset_index()
print("\nMonthly breakdown:")
print(monthly.to_string())
