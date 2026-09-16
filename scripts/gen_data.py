# -*- coding: utf-8 -*-
"""
采购数字化数据看板 - 模拟数据生成脚本
产出: public/data/suppliers.json, public/data/orders.json

刻意埋入的业务异常（用于演示异常检测与归因）:
  A01 华信精密:   近3个月 OTD 从 ~91% 骤降至 ~14%           -> 规则: OTD连续下滑
  A12 鑫源材料:  报价持续高于品类均值 2σ 以上                -> 规则: 价格离群
  品类[电子元器件]: 采购额集中于单一供应商 A07               -> 规则: 单一供应商依赖
  A03 蓝海智造:  单价全场最低, 但质量损失+运输成本高 -> TCO 最高 -> 规则: 低价高TCO

节约率 v2 口径所需的基准价字段（material / benchmarkPrice / benchmarkSource）
由 attach_benchmarks() 挂载，见该函数注释。
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

# 供应商价格乘数: 用于构造异常故事(价格离群/低价高TCO),
# 同时作为物料规格归一化的除数 —— 保证这两处口径完全一致
SUPPLIER_PRICE_MULT = {"A12": 1.5, "A03": 0.78}

# 物料主数据: 每个品类 4 个规格档, 按价格由低到高排列
CATEGORY_MATERIALS = {
    "电子元器件": ["被动元件", "连接器", "电源管理 IC", "MCU 主控芯片"],
    "结构件":     ["钣金支架", "注塑面板", "铝合金外壳", "精密机加件"],
    "包装材料":   ["标签纸", "缠绕膜", "EPE 缓冲垫", "瓦楞纸箱"],
    "化工原料":   ["工业酒精", "硅胶密封胶", "环氧树脂", "钛白粉"],
    "五金标准件": ["平垫圈", "自攻螺钉", "六角螺栓", "弹簧卡扣"],
}

# 品类行情漂移：年内价格指数（电子元器件行情上行更快）
CAT_DRIFT = {cat: (0.06 if cat == "电子元器件" else 0.02) for cat, _, _, _ in CATEGORIES}
MONTH_IDX = {m: i for i, (m, _) in enumerate(MONTHS)}


def drift_at(cat, mi):
    """品类行情指数：按月份序号返回相对年初的价格倍数"""
    return 1.0 + CAT_DRIFT[cat] * (mi / 11.0)


def month_drift(cat, month):
    """品类行情指数：返回相对年初的价格倍数"""
    return drift_at(cat, MONTH_IDX[month])


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
                price = base_price * month_drift(cat, month)
                # A12 鑫源材料: 持续溢价 ~50% (价格离群 >2σ)
                # A03 蓝海智造: 低价 ~22% (低价高TCO故事)
                price *= SUPPLIER_PRICE_MULT.get(sid, 1.0)
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


# ---------------------------------------------------------------
# 基准价（benchmark）挂载 —— 节约率 v2 口径的数据地基
#
# 为什么需要它：v1 口径用「品类均价」当基准，而品类均价本身就是这批订单算出来的，
# 代入后数学上恒等于 0（推导见 README「口径 revision」）。v2 改为引入独立于
# 被评估订单的外部/历史基准价，四级优先级取数：
#     ① contract_price   年度框架合同价（年初按物料 determined，年度固定）
#     ② last_deal_price  同物料 + 同供应商 最近一次成交价（严格早于本单，12 个月内）
#     ③ best_quote       当期询价(RFQ)最低有效报价（围绕当期市场参考价竞争得出）
#     ④ hist_avg_12m     同物料 + 同供应商 滚动 12 个月成交均价（不含当期，≥3 笔）
#   取不到基准的订单 benchmarkPrice = None —— 不补默认值，由前端报「基准覆盖率」。
#
# 关键约束：所有随机数来自独立的 rng = random.Random(2026)，
# 不触碰上面 random.seed(42) 的随机流，因此存量的成交价格 / 数量 / 履约表现逐位不变。
# ---------------------------------------------------------------

# 基准价覆盖率的三个构成参数（可在 README「口径 revision」中调参复现）
FRAME_P = 0.52          # 品类×供应商 已签年度框架协议的比例 → 决定 ① 的可得率
RECORD_P = 0.65         # (物料,供应商) 已维护基准价档案的比例 → 覆盖率的主要来源
RFQ_P = 0.55            # 物料纳入询价(RFQ)池的比例          → 决定 ③ 的可得率


def attach_benchmarks(orders):
    rng = random.Random(2026)

    def norm_price(o):
        """基准口径单价：剔除供应商价格乘数与品类行情漂移，反映物料的真实规格价位"""
        return (o["unitPrice"] / SUPPLIER_PRICE_MULT.get(o["supplierId"], 1.0)
                / month_drift(o["category"], o["month"]))

    # 1) 物料挂载：按基准口径单价在品类内的分位确定规格档（低 → 高）
    for cat, mats in CATEGORY_MATERIALS.items():
        lst = [(norm_price(o), o) for o in orders if o["category"] == cat]
        lo = min(p for p, _ in lst)
        hi = max(p for p, _ in lst)
        for p, o in lst:
            pos = (p - lo) / (hi - lo) if hi > lo else 0.5
            o["material"] = mats[min(len(mats) - 1, int(pos * len(mats)))]

    # 2) 物料级基准价水平（年初口径）—— 外部锚，与被评估订单自身成交价无关
    mat_norm = {}
    for o in orders:
        mat_norm.setdefault(o["material"], []).append(norm_price(o))
    mat_ref = {m: sum(v) / len(v) for m, v in mat_norm.items()}

    # 3) 采购策略：品类 × 供应商 是否签年度框架协议 / 物料是否进入询价池
    pair_ref = {}   # (品类, 供应商) 的基准价水平
    for o in orders:
        pair_ref.setdefault((o["category"], o["supplierId"]), []).append(norm_price(o))
    pair_ref = {k: sum(v) / len(v) for k, v in pair_ref.items()}
    mat_list = sorted(mat_ref)
    pair_list = sorted(pair_ref)
    frame = {k: rng.random() < FRAME_P for k in pair_list}
    in_rfq = {m: rng.random() < RFQ_P for m in mat_list}
    # 年度框架合同价 = 该「品类 × 供应商」基准价 × 预期年均行情 × should-cost 余量。
    # 年初签订、全年固定、不随行就市 → 行情下行的品类越到年底越划算，行情上行的
    # 品类（如电子元器件）会被逐步击穿 —— 这个侵蚀效应本身就是有价值的信号。
    budget_factor = {k: rng.uniform(1.03, 1.07) for k in pair_list}
    contract_price = {k: round(pair_ref[k] * (1 + CAT_DRIFT[k[0]] * 0.5) * budget_factor[k], 2)
                      for k in pair_list}

    # (物料, 供应商) 组合上是否已维护基准价档案 —— 基准覆盖率的主要来源。
    # 现实中基准价不是自动就有的，需要采购员在系统里维护；维护完整度低正是
    # 本页面强制显示「基准覆盖率」的原因（见 README「口径 revision」）。
    pairs = {(o["material"], o["supplierId"]) for o in orders}
    has_record = {k: rng.random() < RECORD_P for k in pairs}

    # 4) 按时间顺序逐单取基准（只允许使用本单之前的信息，杜绝前视偏差）
    seen = {}   # (material, supplierId) -> [(month_idx, unitPrice, drift)]
    for o in sorted(orders, key=lambda x: (MONTH_IDX[x["month"]], x["date"], x["id"])):
        mat, cat = o["material"], o["category"]
        mi = MONTH_IDX[o["month"]]
        d_now = drift_at(cat, mi)
        key = (mat, o["supplierId"])
        hist = seen.get(key, [])
        h12 = [h for h in hist if mi - h[0] < 12]   # 滚动 12 个月内的历史成交
        h3 = [h for h in h12 if mi - h[0] < 3]      # 其中一季度内（可直接比价）

        src = price = None
        pk = (cat, o["supplierId"])
        if frame[pk]:                                             # ① 年度框架合同价（不折算行情）
            src, price = "contract_price", contract_price[pk]
        elif has_record[key] and h3:                              # ② 上次成交价 → 折算到本期口径
            _, p_last, d_last = h3[-1]
            src, price = "last_deal_price", round(p_last * d_now / d_last, 2)
        elif in_rfq[mat]:                                         # ③ 当期询价最低有效报价
            src, price = "best_quote", round(mat_ref[mat] * d_now * rng.uniform(0.96, 1.00), 2)
        elif has_record[key] and len(h12) >= 3:                   # ④ 滚动 12 个月均价 → 折算到本期口径
            src = "hist_avg_12m"
            price = sum(h[1] / h[2] for h in h12) / len(h12) * d_now

        o["benchmarkPrice"] = round(price, 2) if src else None
        o["benchmarkSource"] = src
        seen.setdefault(key, []).append((mi, o["unitPrice"], d_now))

    return orders


suppliers = build_suppliers()
orders, cat_price = build_orders(suppliers)
attach_benchmarks(orders)

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

# --- 节约率 v2 自检：与前端 src/utils/metrics.js 的 savingsRate() 同口径 ---
def savings_report(orders):
    cov = [o for o in orders if o["benchmarkPrice"]]
    base = sum(o["benchmarkPrice"] * o["qty"] for o in cov)
    save = sum((o["benchmarkPrice"] - o["unitPrice"]) * o["qty"] for o in cov)
    by_src = {}
    for o in cov:
        s = by_src.setdefault(o["benchmarkSource"], {"n": 0, "base": 0.0, "save": 0.0})
        s["n"] += 1
        s["base"] += o["benchmarkPrice"] * o["qty"]
        s["save"] += (o["benchmarkPrice"] - o["unitPrice"]) * o["qty"]
    return {
        "coverage": round(100 * len(cov) / len(orders), 1),
        "covered": len(cov),
        "uncovered": len(orders) - len(cov),
        "savings": round(save, 2),
        "benchmark_total": round(base, 2),
        "rate": round(100 * save / base, 2) if base else None,
        "by_source": {
            k: {
                "orders": v["n"],
                "rate": round(100 * v["save"] / v["base"], 2) if v["base"] else None,
                "savings": round(v["save"], 2),
            } for k, v in sorted(by_src.items())
        },
    }

print("savings_v2:", json.dumps(savings_report(orders), ensure_ascii=False))
