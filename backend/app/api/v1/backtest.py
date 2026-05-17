from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
from ...services.backtest_engine import run_backtest


router = APIRouter()


class BacktestRequest(BaseModel):
    expr: str
    dataset_path: str = 'dataset/all_historical_daily_data.csv'
    position_mode: str = 'long_only'  # 'short_only' | 'long_short'
    start_nav: float = 1.0
    # 选股分位阈值：长仓用 1-quantile，空仓用 quantile
    long_threshold: Optional[float] = 0.7  # 例如 0.7 表示取 top 30%
    short_threshold: Optional[float] = 0.3 # 例如 0.3 表示取 bottom 30%
    # 追加筛选与约束参数（均为可选，未提供则使用全量/默认）
    start_date: Optional[str] = None  # 格式: YYYYMMDD
    end_date: Optional[str] = None    # 格式: YYYYMMDD
    codes: Optional[List[str]] = None
    t_plus: str = 't1'                # 't0' | 't1'
    max_weight_per_stock: Optional[float] = None
    inf_to_nan: bool = True


@router.post('/backtest/run')
def backtest_run(req: BacktestRequest):
    result = run_backtest(
        csv_path=req.dataset_path,
        expr=req.expr,
        mode=req.position_mode,
        start_nav=req.start_nav,
        long_threshold=req.long_threshold,
        short_threshold=req.short_threshold,
        start_date=req.start_date,
        end_date=req.end_date,
        codes=req.codes,
        t_plus=req.t_plus,
        max_weight_per_stock=req.max_weight_per_stock,
        inf_to_nan=req.inf_to_nan,
    )
    return result