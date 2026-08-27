# -*- coding: utf-8 -*-
"""
采购数字化数据看板 - 模拟数据生成脚本
产出: public/data/suppliers.json, public/data/orders.json, public/data/materials.json

刻意埋入的业务异常（用于演示异常检测与归因）:
  A1 华信精密:   近3个月 OTD 从 ~95% 骤降至 ~60%          -> 规则: OTD连续下滑
  A12 鑫源材料:  报价持续高于品类均值 2σ 以上                -> 规则: 价格离群
  品类[电子元器件]: 采购额 65% 集中在单一供应商 A07         -> 规则: 单一供应商依赖
  A03 蓝海智造:  单价全场最低, 但质量损失+运输成本高 -> TCO 最高 -> 规则: 低价高TCO
"""
import json, random, math, os

random.seed(42)

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data")
os.makedirs(OUT, exist_ok=True)

MONTHS = [  # 12个月: 2025-09 ~ 2026-08
    ("2025-09", 30), ("2025-10", 31), ("2025-11", 30), ("2025-12", 31),
    ("2026-01", 31), ("2026-02", 28), ("2026-03", 31), ("2026-04", 30),
    ("2026-05", 31), ("2026-06", 30), ("2026-07", 31), ("2026-08", 31),
]

CATEGORIES = [
    # (品类, 基准单价区间, 月订单量, 单一依赖供应商)
    ("电子元器件", (80, 160), 22, "A07"),
    ("结构件", (200, 420), 18, None),
    ("包装材料", (15, 45), 18, None),
    ("化工原料", (60, 130), 10, None),
    ("五金标准件", (8, 25), 16, None),
]

# 供应商: id, 名称, 主供品类, Kraljic(供应风险x, 业务影响y), 四维评分, 区域
SUPPLIERS_DEF = [
    ("A01", "华信精密",   "结构件",     0.82, 0.88, 92, 94, 88, 90, "华东"),
    ("A02", "恒达五金",   "五金标准件", 0.18, 0.25, 85, 90, 93, 87, "华南"),
    ("A03", "蓝海智造",   "结构件",     0.35, 0.55, 62, 71, 96, 65, "华东"),   # 低价高TCO
    ("A04", "泰隆化工",   "化工原料",   0.55, 0.48, 84, 82, 86, 80, "华北"),
    ("A05", "顺丰包装",   "包装材料",   0.12, 0.30, 90, 88, 91, 86, "华中"),
    ("A06", "瑞泰电子",   "电子元器件", 0.48, 0.52, 83, 80, 84, 82, "华南"),
    ("A07", "正扬微电子", "电子元器件", 0.88, 0.92, 93, 91, 78, 89, "华东"),   # 单一依赖
    ("A08", "联创包装",   "包装材料",   0.15, 0.22, 81, 85, 88, 84, "西南"),
    ("A09", "宏源五金",   "五金标准件", 0.22, 0.20, 88, 89, 90, 85, "华东"),
    ("A10", "佳信化工",   "化工原料",   0.42, 0.40, 79, 83, 85, 81, "华南"),
    ("A11", "中天结构件", "结构件",     0.65, 0.72, 89, 87, 82, 86, "华北"),
    ("A12", "鑫源材料",   "化工原料",   0.30, 0.35, 80, 84, 58, 78, "华东"),   # 价格离群
    ("A13", "德昌电子",   "电子元器件", 0.40, 0.45, 86, 85, 83, 84, "华南"),
    ("A14", "荣达五金",   "五金标准件", 0.10, 0.15, 84, 86, 89, 82, "西南"),
    ("A15", "安捷包装",   "包装材料",   0.20, 0.18, 87, 84, 90, 88, "华东"),
    ("A16", "华越化工",   "化工原料",   0.38, 0.44, 82, 79, 84, 80, "华中"),
    ("A17", "凯诺电子",   "电子元器件", 0.35, 0.38, 85, 83, 86, 83, "华北"),
    ("A18", "腾飞结构件", "结构件",     0.28, 0.50, 84, 86, 87, 85, "华南"),
    ("A19", "永泰五金",   "五金标准件", 0.16, 0.28, 86, 88, 85, 87, "华东"),
    ("A20", "嘉合材料",   "化工原料",   0.45, 0.30, 83, 81, 85, 82, "西南"),
]

# 每个品类允许的供应商池(主供+辅供)
CATEGORY_SUPPLIER_WEIGHTS = {
    "电子元器件": [("A07", 45), ("A06", 18), ("A13", 15), ("A17", 12)],
    "结构件":     [("A01", 30), ("A11", 25), ("A18", 25), ("A03", 20)],
    "包装材料":   [("A05", 40), ("A08", 30), ("A15", 30)],
    "化工原料":   [("A04", 28), ("A10", 22), ("A16", 20), ("A12", 18), ("A20", 12)],
    "五金标准件": [("A02", 30), ("A09", 28), ("A14", 20), ("A19", 22)],
}


def weighted_choice(pairs):
    total = sum(w for _, w in pairs)
    r = random.uniform(0, total)
    acc = 0
    for v, w in pairs:
        acc += w
        if r <= acc:
            return v
    return pairs[-1][0]


def rand_date(month_str, days):
    return f"{month_str}-{random.randint(1, days):02d}"


def build_suppliers():
    suppliers = []
    for sid, name, cat, kx, ky, q, d, p, s, region in SUPPLIERS_DEF:
        entry = {
            "id": sid, "name": name, "category": cat, "region": region,
            "kraljic": {"supplyRisk": kx, "profitImpact": ky},
            "scores": {"quality": q, "delivery": d, "price": p, "service": s},
            # TCO 构成系数: 相对基准的乘数(质量损失/运输/管理)
            "tcoFactors": {"transportRate": round(random.uniform(0.03, 0.09), 3),
                          "qualityLossRate": round((100 - q) / 100 * 0.35 + random.uniform(0.01, 0.04), 3),
                          "adminRate": round(random.uniform(0.02, 0.05), 3)},
        }
        # A03 蓝海智造: 单价低 22%, 但运输/质量损失/管理成本极高 -> TCO 最高
        if sid == "A03":
            entry["tcoFactors"] = {"transportRate": 0.18, "qualityLossRate": 0.42, "adminRate": 0.05}
        suppliers.append(entry)
    return suppliers


def build_orders(suppliers):
    orders = []
    oid = 1
    cat_price = {}   # 品类 -> 单价累积统计
    for mi, (month, days) in enumerate(MONTHS):
        recent = mi >= 9  # 最后3个月触发 A01 异常
        for cat, (lo, hi), n_month, solo in CATEGORIES:
            for _ in range(n_month):
                sid = weighted_choice(CATEGORY_SUPPLIER_WEIGHTS[cat])
                # 单一依赖品类: 电子元器件将 A07 权重提到 65%
                if cat == "电子元器件" and random.random() < 0.62:
                    sid = "A07"
                sup = next(s for s in suppliers if s["id"] == sid)
                base_price = random.uniform(lo, hi)
                # 品类价格随时间轻微波动(电子元器件缓慢上涨~通胀故事)
                drift = 1.0 + (0.06 if cat == "电子元器件" else 0.02) * (mi / 11.0)
                price = base_price * drift
                # A12 鑫源材料: 持续溢价 ~50% (价格离群 >2σ)
                if sid == "A12":
                    price *= 1.5
                # A03 蓝海智造: 低价 ~22% (低价高TCO故事)
                if sid == "A03":
                    price *= 0.78
                qty = random.randint(20, 400)
                # A01 华信精密: OTD 前段~95% 后3个月骤降至~30%
                if sid == "A01":
                    otd_p = 0.30 if recent else 0.95
                else:
                    otd_p = min(0.97, max(0.70, sup["scores"]["delivery"] / 100 + random.uniform(-0.06, 0.06)))
                on_time = random.random() < otd_p
                lead_days = random.randint(7, 30)
                delay = 0 if on_time else random.randint(2, 15)
                # 质量合格率与供应商评分挂钩
                q_ok = random.random() < (sup["scores"]["quality"] / 100 * 1.02)
                cat_price.setdefault(cat, []).append(round(price, 2))
                orders.append({
                    "id": f"PO-{oid:05d}",
                    "month": month,
                    "date": rand_date(month, days),
                    "supplierId": sid,
                    "supplierName": sup["name"],
                    "category": cat,
                    "qty": qty,
                    "unitPrice": round(price, 2),
                    "amount": round(qty * price, 2),
                    "leadDays": lead_days,
                    "actualLeadDays": lead_days + delay,
                    "onTime": on_time,
                    "qualityPass": q_ok,
                })
                oid += 1
    return orders, cat_price


suppliers = build_suppliers()
orders, cat_price = build_orders(suppliers)

with open(os.path.join(OUT, "suppliers.json"), "w", encoding="utf-8") as f:
    json.dump({"suppliers": suppliers}, f, ensure_ascii=False, indent=1)

with open(os.path.join(OUT, "orders.json"), "w", encoding="utf-8") as f:
    json.dump({"orders": orders}, f, ensure_ascii=False, indent=1)

stats = {
    "orders": len(orders),
    "total_spend": round(sum(o["amount"] for o in orders), 2),
    "otd": round(100 * sum(1 for o in orders if o["onTime"]) / len(orders), 1),
}
print("generated:", stats)
print("categories:", {c: round(sum(o['amount'] for o in orders if o['category']==c)/stats['total_spend']*100,1) for c,_,_,_ in CATEGORIES})
