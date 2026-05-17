from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import pandas as pd
from ...services.expression_engine import evaluate_expression, SafeExpressionError, list_available_functions
from ...services.backtest_engine import load_dataset


router = APIRouter()


class PreviewRequest(BaseModel):
    expr: str
    dataset_path: str = 'dataset/all_historical_daily_data.csv'
    head_rows: int = 5
    inf_to_nan: bool = True


@router.post('/factor/preview')
def factor_preview(req: PreviewRequest):
    df = load_dataset(req.dataset_path)
    try:
        signal = evaluate_expression(df, req.expr, inf_to_nan=req.inf_to_nan)
    except SafeExpressionError as e:
        return {'ok': False, 'error': str(e)}
    # 返回前几行样例：支持 Series 或 DataFrame，统一展开为 DataFrame
    if isinstance(signal, pd.Series):
        # 保持名称一致性：若存在 name 则沿用，否则使用 'signal'
        out_df = signal.to_frame(signal.name or 'signal')
    elif isinstance(signal, pd.DataFrame):
        out_df = signal
    else:
        return {'ok': False, 'error': '表达式输出必须为 Series 或 DataFrame'}
    sample = out_df.reset_index().head(req.head_rows)
    # 将数值列转换为 object，再把 NaN 转为 None，确保 JSON 可序列化
    sample_jsonable = sample.astype(object).where(pd.notna(sample), None)
    return JSONResponse({
        'ok': True,
        'columns': list(sample_jsonable.columns),
        'sample': sample_jsonable.to_dict(orient='records'),
        'note': '支持多列信号预览；每列为一个独立信号',
    })


@router.get('/factor/operators')
def factor_operators():
    """返回当前表达式可用函数列表，供前端联想提示使用。"""
    try:
        funcs = list_available_functions()
        return JSONResponse({'ok': True, 'functions': funcs})
    except Exception as e:
        return JSONResponse({'ok': False, 'error': str(e)})