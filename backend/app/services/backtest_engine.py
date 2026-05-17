from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np

from .expression_engine import evaluate_expression, SafeExpressionError

#========原函数======
# def load_dataset(csv_path: str) -> pd.DataFrame:
#     df = pd.read_csv(csv_path)
#     # 期望存在列: ts_code, trade_date, close, pre_close 或 ret 等
#     if 'ts_code' not in df.columns or 'trade_date' not in df.columns:
#         raise ValueError("数据集至少需要 ts_code, trade_date 列")
#     # 尝试构造日收益率
#     if 'ret' not in df.columns:
#         if {'close', 'pre_close'}.issubset(df.columns):
#             df['ret'] = (df['close'] / df['pre_close'] - 1.0)
#         else:
#             # 退化为0收益，避免报错
#             df['ret'] = 0.0
#     # 统一索引
#     df = df.sort_values(['ts_code', 'trade_date'])
#     df = df.set_index(['ts_code', 'trade_date'])
#     return df

#======pickle尝试======
# import os

# def load_dataset_from_pickle(pickle_path: str) -> pd.DataFrame:
#     """
#     从 Pickle 文件加载数据集，并保持与原 CSV 加载逻辑一致的处理过程。
#     """
#     # 1. 读取数据
#     # read_pickle 通常比 read_csv 快 5-10 倍以上
#     df = pd.read_pickle(pickle_path)
    
#     # 2. 验证必要列
#     # 期望存在列: ts_code, trade_date, close, pre_close 或 ret 等
#     if 'ts_code' not in df.columns or 'trade_date' not in df.columns:
#         raise ValueError("数据集至少需要 ts_code, trade_date 列")
    
#     # 3. 构造日收益率 (ret)
#     if 'ret' not in df.columns:
#         if {'close', 'pre_close'}.issubset(df.columns):
#             # 使用简单的收益率公式: (收盘价 / 前收盘价) - 1
#             df['ret'] = (df['close'] / df['pre_close'] - 1.0)
#         else:
#             # 退化处理：如果数据缺失，填充 0.0 以保证后续代码不崩
#             df['ret'] = 0.0
            
#     # 4. 排序与设置索引
#     # 提示：如果你的 Pickle 文件在保存前已经排好序并设好了索引，
#     # 这里的步骤可以省略以进一步提速。
#     df = df.sort_values(['ts_code', 'trade_date'])
#     df = df.set_index(['ts_code', 'trade_date'])
    
#     return df

#=======parquet尝试=======
import pandas as pd
import os

def load_dataset(dataset_path: str) -> pd.DataFrame:
    """
    加载数据集（支持 Parquet 加速，并保留原有的收益率构造逻辑）
    """
    # -------------------------------------------------------------------------
    # 1. 数据读取层：优先尝试 Parquet 以获得极速加载体验
    # -------------------------------------------------------------------------
    parquet_path = dataset_path.replace('.csv', '.parquet')
    
    df = None
    if os.path.exists(parquet_path):
        print(f"🚀 加载 Parquet 加速文件: {parquet_path}")
        try:
            df = pd.read_parquet(parquet_path, engine='pyarrow')
        except Exception as e:
            print(f"⚠️ Parquet 读取失败 ({e})，尝试回退到 CSV...")
    
    if df is None:
        print(f"🐢 加载原始 CSV 文件: {dataset_path}")
        df = pd.read_csv(dataset_path)

    # -------------------------------------------------------------------------
    # 2. 数据清洗与索引统一层 (来自原函数逻辑，确保 Parquet 读出来也是对的)
    # -------------------------------------------------------------------------
    # 如果是 CSV 读入的，列可能还在 columns 里；如果是 Parquet，可能已经在 index 里了
    # 为了通用，我们先 reset_index 确保列都在 columns 里进行检查，最后再 set_index
    # (这样做虽然多了一步，但能兼容各种乱七八糟保存的 Parquet 格式)
    df = df.reset_index()

    # 检查必要列
    required_cols = {'ts_code', 'trade_date'}
    # 这一步是为了兼容：有时候 reset_index 后 index 列名可能会变成 'index' 或者 level_0，需确保字段名正确
    if not required_cols.issubset(df.columns):
        # 尝试看看是不是 reset_index 后名字不对，或者数据本身就缺列
        raise ValueError(f"数据集缺失必要列: {required_cols - set(df.columns)}")

    # 确保日期格式正确
    if df['trade_date'].dtype == 'object':
        df['trade_date'] = pd.to_datetime(df['trade_date'].astype(str))

    # 排序：这对时间序列回测至关重要！
    # 即使 Parquet 保存时有序，再排一次序的开销很小，但能买个心安
    df = df.sort_values(['ts_code', 'trade_date'])

    # -------------------------------------------------------------------------
    # 3. 业务逻辑层：构造收益率 (原函数的核心逻辑)
    # -------------------------------------------------------------------------
    if 'ret' not in df.columns:
        print("⚠️ 检测到数据缺失 'ret' 列，正在根据 close/pre_close 自动计算...")
        if {'close', 'pre_close'}.issubset(df.columns):
            # 避免除以0
            df['ret'] = (df['close'] / df['pre_close'] - 1.0).fillna(0.0)
        else:
            print("⚠️ 无法计算收益率（缺失 close 或 pre_close），将 ret 设为 0.0")
            df['ret'] = 0.0

    # -------------------------------------------------------------------------
    # 4. 索引设置层 (配合 operators.py 的 MultiIndex 要求)
    # -------------------------------------------------------------------------
    # 注意：根据你的 operators.py，很多算子用 groupby(level=1)，通常暗示索引顺序为 (日期, 代码) 或 (代码, 日期)
    # 原函数使用的是 ['ts_code', 'trade_date']，我们保持一致以免破坏这一层
    df = df.set_index(['ts_code', 'trade_date'])
    
    # 过滤掉不需要的临时列（如果有的话）并保持需要的列
    # df = df[['open', 'high', 'low', 'close', 'vol', 'amount', 'ret', ...]] 
    
    return df

def compute_ic(signal: pd.Series, ret: pd.Series) -> pd.Series:
    # 截面IC: 每日在股票截面上计算Spearman相关
    def daily_ic(day_df: pd.DataFrame) -> float:
        s = day_df['signal']
        r = day_df['ret']
        if s.count() < 2:
            return np.nan
        return s.rank().corr(r.rank())

    df = pd.DataFrame({'signal': signal, 'ret': ret})
    ic = df.groupby(level=1).apply(daily_ic)
    return ic.dropna()


def build_weights(signal: pd.Series, mode: str = 'long_only', long_quantile: float = 0.3, short_quantile: float = 0.3) -> pd.Series:
    # 根据模式构建每日权重：等权分配
    # 注意：使用 group_keys=False，避免在 apply 后增加额外的分组层级
    g = signal.groupby(level=1, group_keys=False)
    def w_daily(s: pd.Series) -> pd.Series:
        if mode == 'long_only':
            th = s.quantile(1 - long_quantile)
            pick = s >= th
            if pick.sum() == 0:
                return s * 0
            w = np.where(pick, 1.0 / pick.sum(), 0.0)
            return pd.Series(w, index=s.index)
        elif mode == 'short_only':
            th = s.quantile(short_quantile)
            pick = s <= th
            if pick.sum() == 0:
                return s * 0
            w = np.where(pick, -1.0 / pick.sum(), 0.0)
            return pd.Series(w, index=s.index)
        else:  # long_short
            th_long = s.quantile(1 - long_quantile)
            th_short = s.quantile(short_quantile)
            pick_long = s >= th_long
            pick_short = s <= th_short
            n_long = pick_long.sum()
            n_short = pick_short.sum()
            w = np.zeros(len(s))
            if n_long > 0:
                w = w + np.where(pick_long, 1.0 / n_long, 0.0)
            if n_short > 0:
                w = w + np.where(pick_short, -1.0 / n_short, 0.0)
            return pd.Series(w, index=s.index)
    return g.apply(w_daily)


def portfolio_returns(ret: pd.Series, weights: pd.Series) -> pd.Series:
    # 每日加权收益；若当日任一成分存在 NaN，传播为当日组合 NaN
    df = pd.DataFrame({'ret': ret, 'w': weights})
    port = df.groupby(level=1).apply(lambda x: (x['ret'] * x['w']).sum(min_count=len(x)))
    return port


def portfolio_returns_with_lots(
    ret: pd.Series,
    close: pd.Series,
    weights: pd.Series,
    start_nav: float = 1.0,
    lot_size: int = 100,
) -> pd.Series:
    """
    基于“买入必须按100股整数倍、卖出不受该限制”的规则进行持仓模拟，返回组合的每日收益率序列。

    说明与假设：
    - 采用日频再平衡，权重序列已按 t_plus 处理（例如 t1 则已 shift(1)）。
    - 以前一日收盘价（pre_close）作为当日开盘的成交价格；如缺失，则用 close/(1+ret) 估算。
    - 对 delta_shares>0 的买入动作按 lot_size（默认100股）向下取整；卖出按整数股执行，但不需满足100股倍数。
    - 允许空头（负权重）产生负持仓股数；不考虑融资融券/费用。
    - 若当日存在价格/收益缺失，忽略该成分的价值变动（对组合贡献记为0）。
    """
    # 组装需要的数据框，保留原始两层索引
    df = pd.DataFrame({'ret': ret, 'close': close, 'w': weights})
    # 推导 pre_close：优先使用显式列，否则用 close/(1+ret)
    # 若无法推导则以 NaN 处理，该成分当日不产生价值变动
    pre_close = None
    if 'pre_close' in df.columns:
        pre_close = df['pre_close']
    else:
        with np.errstate(divide='ignore', invalid='ignore'):
            pre_close = df['close'] / (1.0 + df['ret'])

    # 初始化持仓（股数）与现金
    dates = df.index.get_level_values(1).unique().tolist()
    shares = pd.Series(dtype=float)  # index: ts_code, value: shares (can be negative)
    cash = float(start_nav)
    out = []  # daily portfolio returns

    for d in dates:
        # 提取当日数据，索引仅为 ts_code，便于对齐
        day = df.xs(d, level=1)
        # 当日权重（可能包含 NaN），忽略 NaN 权重的标的
        w_d = day['w'].dropna()
        # 当日前收盘价与收益
        pre_d = pre_close.xs(d, level=1)
        r_d = day['ret']
        # 当前持仓按当日股票集合对齐（未在当日出现的股票持仓保持原值，但本日价值变动不会计入）
        current_shares = shares.reindex(day.index).fillna(0.0)
        # 组合开盘总市值（估值时仅考虑当日出现的股票）
        port_val_open = cash + (current_shares * pre_d.reindex(day.index).fillna(0.0)).sum()

        # 目标持仓（股数）：按权重将开盘总市值分配到各标的
        target_val_per_symbol = (port_val_open * w_d)
        target_shares = target_val_per_symbol / pre_d.reindex(w_d.index).replace(0.0, np.nan)
        target_shares = target_shares.fillna(0.0)
        delta = target_shares - current_shares.reindex(w_d.index).fillna(0.0)

        # 先卖出（delta<0），整数股，不受100股倍数约束
        sell_delta = delta.clip(upper=0)
        sell_shares = (-sell_delta).apply(lambda x: int(np.floor(x)))
        sell_cash = (sell_shares * pre_d.reindex(w_d.index)).sum()
        # 更新当日股票集合上的持仓与现金
        current_shares = current_shares - sell_shares.reindex(current_shares.index).fillna(0)
        cash = cash + float(sell_cash)

        # 再买入（delta>0），按 lot_size 向下取整
        buy_delta = (target_shares - current_shares.reindex(w_d.index).fillna(0.0)).clip(lower=0)
        buy_shares = buy_delta.apply(lambda x: int(np.floor(x / lot_size)) * lot_size)
        buy_cost = (buy_shares * pre_d.reindex(w_d.index)).sum()
        if buy_cost > cash and buy_cost > 0:
            ratio = min(1.0, cash / float(buy_cost))
            buy_shares = buy_delta.apply(lambda x: int(np.floor((x * ratio) / lot_size)) * lot_size)
            buy_cost = (buy_shares * pre_d.reindex(w_d.index)).sum()

        current_shares = current_shares + buy_shares.reindex(current_shares.index).fillna(0)
        shares = current_shares.combine_first(shares)  # 写回全局持仓
        cash = cash - float(buy_cost)

        # 当日组合价值变动（仅对当日有数据的股票计入）
        valid = (~r_d.isna()) & (~pre_d.reindex(day.index).isna())
        value_change = ((shares.reindex(day.index).fillna(0.0)[valid] * pre_d.reindex(day.index)[valid]) * r_d[valid]).sum()
        # 收益率：避免除零
        port_ret_d = 0.0 if port_val_open == 0 else float(value_change) / float(port_val_open)
        out.append((d, port_ret_d))

    # 输出为按日期索引的 Series
    port_series = pd.Series({d: r for d, r in out})
    port_series.index.name = ret.index.names[1]
    return port_series


def nav_and_drawdown(port_ret: pd.Series, start_nav: float = 1.0) -> (List[Dict[str, Any]], List[Dict[str, Any]]): # pyright: ignore[reportInvalidTypeForm]
    # 不对 NaN 进行填充，让其在净值与回撤中自然传播；输出阶段将 NaN 转为 None 以保证 JSON 可序列化
    nav = (port_ret + 1.0).cumprod() * start_nav
    peak = nav.cummax()
    dd = (nav - peak) / peak
    def _sf(x: float) -> Optional[float]:
        try:
            return None if pd.isna(x) else float(x)
        except Exception:
            return None
    pnl = [{'date': str(d), 'value': _sf(v)} for d, v in nav.items()]
    drawdown = [{'date': str(d), 'value': _sf(v)} for d, v in dd.items()]
    return pnl, drawdown


def monthly_heatmap(port_ret: pd.Series) -> List[Dict[str, Any]]:
    s = port_ret.copy()
    idx = pd.to_datetime(s.index.astype(str))
    df = pd.DataFrame({'ret': s.values}, index=idx)
    # 若某月存在任一 NaN，则该月值为 NaN（使用 min_count 传播）
    monthly = df['ret'].resample('M').apply(lambda x: x.sum(min_count=len(x)))
    def _sf(x: float) -> Optional[float]:
        return None if pd.isna(x) else float(x)
    return [{'month': d.strftime('%Y-%m'), 'ret': _sf(v)} for d, v in monthly.items()]


def histogram(port_ret: pd.Series, bins: int = 20) -> List[Dict[str, Any]]:
    # 直方图仅基于非 NaN 值统计
    hist, edges = np.histogram(port_ret.dropna().values, bins=bins)
    out = []
    for i in range(len(hist)):
        out.append({'left': float(edges[i]), 'right': float(edges[i+1]), 'count': int(hist[i])})
    return out


def rolling_metrics(port_ret: pd.Series, window: int = 60) -> Dict[str, List[Dict[str, Any]]]:
    """
    为满足“时间窗口为全部时间”的需求，这里将原来的滚动统计调整为累计（expanding）统计：
    - 累计波动率：使用 expanding.std(ddof=0) * sqrt(252)，使得从首日即可有定义（首日为0）。
    - 累计夏普：expanding.mean / expanding.std(ddof=0) * sqrt(252)。若标准差为0则返回 NaN。

    保持键名不变（rolling_*），以兼容现有前端；前端标题将展示为“累计…”。
    """
    r = port_ret.copy()
    # 累计均值与方差（使用总体标准差 ddof=0，保证首日为0）
    exp_mean = r.expanding(min_periods=1).mean()
    exp_std = r.expanding(min_periods=1).std(ddof=0)
    exp_vol = exp_std * np.sqrt(252)
    # 避免除以0：std==0 时置为 NaN
    safe_sharpe = np.where(exp_std.values == 0, np.nan, (exp_mean.values / (exp_std.values)) * np.sqrt(252))
    exp_sharpe = pd.Series(safe_sharpe, index=r.index)
    def _sf(x: float) -> Optional[float]:
        # 将 NaN 转换为 None，保证 JSON 可序列化
        return None if pd.isna(x) else float(x)
    return {
        'rolling_vol': [{'date': str(d), 'value': _sf(v)} for d, v in exp_vol.items()],
        'rolling_sharpe': [{'date': str(d), 'value': _sf(v)} for d, v in exp_sharpe.items()],
    }


def decile_spread(signal: pd.Series, ret: pd.Series, n: int = 10) -> List[Dict[str, Any]]:
    # 每日按因子分位计算收益，然后汇总为top-bottom spread
    df = pd.DataFrame({'signal': signal, 'ret': ret})
    def day_spread(x: pd.DataFrame) -> float:
        s = x['signal'].rank(pct=True)
        # 若当日存在 NaN，忽略这些样本；如无有效样本则返回 NaN
        mask = s.notna() & x['ret'].notna()
        if mask.sum() == 0:
            return np.nan
        s = s[mask]
        r = x['ret'][mask]
        q = np.floor(s.clip(0, 1 - 1e-9) * n).astype(int).clip(0, n-1)
        avg_ret = r.groupby(q).mean()
        return float(avg_ret.get(n-1, np.nan) - avg_ret.get(0, np.nan))
    spread = df.groupby(level=1).apply(day_spread).dropna()
    return [{'date': str(d), 'value': float(v)} for d, v in spread.items()]


def _cap_and_normalize(weights: pd.Series, cap: Optional[float]) -> pd.Series:
    if cap is None:
        return weights
    # 对每日权重进行截断并按绝对值归一到 1
    def _proc_day(s: pd.Series) -> pd.Series:
        w = np.clip(s.values, -cap, cap)
        denom = np.sum(np.abs(w))
        if denom > 0:
            w = w / denom
        return pd.Series(w, index=s.index)
    # 保持原始两层索引，不引入额外分组层级
    return weights.groupby(level=1, group_keys=False).apply(_proc_day)


def run_backtest(
    csv_path: str,
    expr: str,
    mode: str = 'long_only',
    start_nav: float = 1.0,
    long_threshold: Optional[float] = None,
    short_threshold: Optional[float] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    codes: Optional[List[str]] = None,
    t_plus: str = 't1',
    max_weight_per_stock: Optional[float] = None,
    inf_to_nan: bool = True,
) -> Dict[str, Any]:
    df = load_dataset(csv_path)
    # 过滤股票与日期
    if codes:
        df = df[df.index.get_level_values(0).isin(codes)]
    # 与索引类型对齐：CSV中的 trade_date 多为 int64，这里将字符串日期安全转换为整数
    if start_date:
        try:
            start_val = int(start_date)
        except Exception:
            start_val = start_date
        df = df[df.index.get_level_values(1) >= start_val]
    if end_date:
        try:
            end_val = int(end_date)
        except Exception:
            end_val = end_date
        df = df[df.index.get_level_values(1) <= end_val]
    try:
        signal = evaluate_expression(df, expr, inf_to_nan=inf_to_nan)
    except SafeExpressionError as e:
        return {'ok': False, 'error': str(e)}
    ret = df['ret']

    def _sf(x: float) -> Optional[float]:
        return None if pd.isna(x) else float(x)

    def _run_one(sig: pd.Series, label: str) -> Dict[str, Any]:
        # 权重 & 组合收益
        # 将用户输入的分位阈值转换为内部量化参数：
        # long_threshold 为如 0.7 的分位点，内部 long_quantile=1-0.7=0.3；short 使用原始分位 0.3
        lt = None if long_threshold is None else max(0.0, min(1.0, long_threshold))
        st = None if short_threshold is None else max(0.0, min(1.0, short_threshold))
        lq = 0.3 if lt is None else (1.0 - lt)
        sq = 0.3 if st is None else st
        w = build_weights(sig, mode=mode, long_quantile=lq, short_quantile=sq)
        if t_plus == 't1':
            w = w.groupby(level=0).shift(1)
        w = _cap_and_normalize(w, max_weight_per_stock)
        # 使用按手（100股）买入取整的持仓模拟，卖出不受该限制
        # 在数据集中优先使用 close 与 ret 推导 pre_close
        close = df.get('close', pd.Series(index=ret.index, dtype=float))
        port_ret = portfolio_returns_with_lots(ret, close, w, start_nav=start_nav, lot_size=100)
        # 指标与图表
        pnl, dd = nav_and_drawdown(port_ret, start_nav=start_nav)
        # 期末资金（最后一个非空净值）
        final_nav_val: Optional[float] = None
        for item in reversed(pnl):
            v = item.get('value')
            if v is not None:
                final_nav_val = float(v)
                break
        ic = compute_ic(sig, ret)
        ic_series = [{'date': str(d), 'value': float(v)} for d, v in ic.items()]
        ir = float(np.nanmean(ic)) / float(np.nanstd(ic)) if np.nanstd(ic) != 0 else float('nan')
        monthly = monthly_heatmap(port_ret)
        hist = histogram(port_ret)
        roll = rolling_metrics(port_ret)
        spread = decile_spread(sig, ret)
        return {
            'label': label,
            'pnl': pnl,
            'drawdown': dd,
            'metrics': {
                'days': int(port_ret.shape[0]),
                'cum_ret': _sf((port_ret + 1.0).prod() - 1.0),
                'avg_ret': _sf(port_ret.mean()),
                'vol': _sf(port_ret.std() * np.sqrt(252)),
                'sharpe': _sf((port_ret.mean() / (port_ret.std() + 1e-12)) * np.sqrt(252)),
                'ic_mean': _sf(np.nanmean(ic)),
                'ic_ir': _sf(ir),
                'start_nav': _sf(start_nav),
                'final_nav': _sf(final_nav_val),
            },
            'extra': {
                'monthly_heatmap': monthly,
                'histogram': hist,
                'rolling_vol': roll['rolling_vol'],
                'rolling_sharpe': roll['rolling_sharpe'],
                'decile_spread': spread,
                'ic_series': ic_series,
            }
        }

    # 单列或多列信号分别回测
    results: List[Dict[str, Any]] = []
    if isinstance(signal, pd.Series):
        results.append(_run_one(signal, label='signal'))
    elif isinstance(signal, pd.DataFrame):
        for col in signal.columns:
            results.append(_run_one(signal[col], label=str(col)))
    else:
        return {'ok': False, 'error': '表达式输出必须为 Series 或 DataFrame'}

    # 同时保留兼容的单信号顶层输出（取第一条）
    head = results[0]
    return {
        'ok': True,
        'pnl': head['pnl'],
        'drawdown': head['drawdown'],
        'metrics': head['metrics'],
        'extra': head['extra'],
        'signals': results,
    }