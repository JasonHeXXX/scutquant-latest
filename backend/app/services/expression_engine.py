import ast
from typing import Any, Dict, Set, Callable
import pandas as pd
import importlib.util
import sys
import os

"""
算子库加载策略（相对导入优先）：
- 优先通过模块名 `operators` 进行相对导入（依赖当前工作目录为项目根）；
- 若模块导入失败，则回退为按当前文件的相对路径查找项目根，再从 `<repo_root>/operators.py` 加载；
- 不再使用任何硬编码的绝对文件系统路径。
"""
ops = None
try:
    # 优先尝试常规模块导入（要求项目根在 sys.path）
    ops = importlib.import_module("operators")
except Exception:
    # 回退：基于本文件位置推导项目根并按相对路径加载
    try:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        candidate = os.path.join(repo_root, "operators.py")
        if os.path.isfile(candidate):
            spec = importlib.util.spec_from_file_location("operators", candidate)
            _mod = importlib.util.module_from_spec(spec)
            assert spec and spec.loader
            spec.loader.exec_module(_mod)
            ops = _mod
        else:
            ops = None
    except Exception:
        ops = None


class SafeExpressionError(Exception):
    pass


class SafeEvaluator(ast.NodeVisitor):
    """
    安全表达式求值：
    - 仅允许算术运算、括号、常量、名称、受限函数调用
    - 名称会映射到 DataFrame 列或允许的常量
    - 函数调用仅限于当前求值环境暴露的可调用对象
    """

    allowed_nodes: Set[type] = {
        ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow,
        ast.Mod, ast.USub, ast.UAdd, ast.Load, ast.Name, ast.Constant, ast.Call,
        ast.Compare, ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE,
        ast.BoolOp, ast.And, ast.Or,
        ast.Subscript, ast.Index, ast.Attribute, ast.Tuple, ast.List,
        ast.IfExp
    }

    def __init__(self, env: Dict[str, Any]):
        self.env = env

    def visit(self, node):
        if type(node) not in self.allowed_nodes:
            raise SafeExpressionError(f"不允许的语法节点: {type(node).__name__}")
        return super().visit(node)

    def eval(self, expr: str):
        """
        支持多语句执行与赋值：
        - 解析为 exec 模式，允许使用 `a = close/open - 1` 形式的变量定义；
        - 最后一个表达式（非赋值）作为返回值；若全部为赋值则报错。
        """
        try:
            tree = ast.parse(expr, mode='exec')
        except SyntaxError as e:
            raise SafeExpressionError(f"表达式语法错误: {e}")
        result = None
        for node in tree.body:
            if isinstance(node, ast.Assign):
                self._eval_assign(node)
                result = None
            elif isinstance(node, ast.Expr):
                result = self._eval_node(node.value)
            else:
                raise SafeExpressionError(f"不支持的语句类型: {type(node).__name__}")
        if result is None:
            raise SafeExpressionError("表达式未产生输出（最后一条语句应为表达式）")
        return result

    def _eval_node(self, node):
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Tuple):
            return tuple(self._eval_node(el) for el in node.elts)
        if isinstance(node, ast.List):
            return [self._eval_node(el) for el in node.elts]
        if isinstance(node, ast.Name):
            if node.id in self.env:
                return self.env[node.id]
            raise SafeExpressionError(f"未知名称: {node.id}")
        if isinstance(node, ast.UnaryOp):
            operand = self._eval_node(node.operand)
            if isinstance(node.op, ast.USub):
                return -operand
            if isinstance(node.op, ast.UAdd):
                return +operand
        if isinstance(node, ast.BinOp):
            left = self._eval_node(node.left)
            right = self._eval_node(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                return left ** right
            if isinstance(node.op, ast.Mod):
                return left % right
        if isinstance(node, ast.Compare):
            left = self._eval_node(node.left)
            result = True
            for op, comparator in zip(node.ops, node.comparators):
                right = self._eval_node(comparator)
                if isinstance(op, ast.Gt):
                    result = result and (left > right)
                elif isinstance(op, ast.GtE):
                    result = result and (left >= right)
                elif isinstance(op, ast.Lt):
                    result = result and (left < right)
                elif isinstance(op, ast.LtE):
                    result = result and (left <= right)
                elif isinstance(op, ast.Eq):
                    result = result and (left == right)
                elif isinstance(op, ast.NotEq):
                    result = result and (left != right)
                left = right
            return result
        if isinstance(node, ast.BoolOp):
            values = [self._eval_node(v) for v in node.values]
            if isinstance(node.op, ast.And):
                out = values[0]
                for v in values[1:]:
                    out = out & v
                return out
            if isinstance(node.op, ast.Or):
                out = values[0]
                for v in values[1:]:
                    out = out | v
                return out
        if isinstance(node, ast.Call):
            func = node.func
            # 仅允许对求值环境中存在的可调用对象进行调用
            if isinstance(func, ast.Name):
                fname = func.id
                if fname not in self.env:
                    raise SafeExpressionError(f"未知函数: {fname}")
                f = self.env[fname]
            elif isinstance(func, ast.Attribute):
                # 禁止属性调用（如 np.log）；请使用环境中直接暴露的函数名
                raise SafeExpressionError("不支持的函数调用形式（禁止属性访问调用）")
            else:
                raise SafeExpressionError("不支持的函数调用形式")
            if not callable(f):
                raise SafeExpressionError(f"名称不可调用: {fname}")
            args = [self._eval_node(a) for a in node.args]
            kwargs = {kw.arg: self._eval_node(kw.value) for kw in node.keywords}
            return f(*args, **kwargs)
        if isinstance(node, ast.IfExp):
            test = self._eval_node(node.test)
            return self._eval_node(node.body) if self._truthy(test) else self._eval_node(node.orelse)
        if isinstance(node, ast.Attribute):
            # 禁止越权访问，仅允许通过环境显式暴露的函数进行操作
            raise SafeExpressionError("不允许属性访问")
        if isinstance(node, ast.Subscript):
            value = self._eval_node(node.value)
            slc = self._eval_node(node.slice) if hasattr(node, 'slice') else None
            return value[slc]
        raise SafeExpressionError(f"不支持的表达式节点: {type(node).__name__}")

    def _eval_assign(self, node: ast.Assign) -> None:
        # 仅允许 Name = <expr> 的简单赋值；禁止多目标与复杂目标（如切片、属性）
        if len(node.targets) != 1:
            raise SafeExpressionError("仅允许单一目标赋值")
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            raise SafeExpressionError("仅允许对名称进行赋值（禁止属性或下标赋值）")
        val = self._eval_node(node.value)
        self.env[target.id] = val

    def _truthy(self, v):
        if isinstance(v, pd.Series):
            return v.astype(bool)
        return bool(v)


# 不再提供任何内置时间序列/截面函数回退，全部以 operators.py 为准


def list_available_functions() -> list[str]:
    """
    返回当前可用的表达式函数名称列表，仅来源于用户算子库 operators.py。
    不做任何回退或补充。
    """
    if ops is None:
        raise SafeExpressionError("未加载 operators（相对导入失败）。请确认项目根包含 operators.py 并作为当前工作目录运行后端。")
    names = set()
    for name, obj in vars(ops).items():
        if name.startswith('_'):
            continue
        try:
            if callable(obj):
                names.add(name)
        except Exception:
            continue
    return sorted(names)


def build_env_from_df(df: pd.DataFrame) -> Dict[str, Any]:
    """
    构建表达式求值环境：
    - 暴露完整的 DataFrame 为名称 `df`（便于使用 df["col"] 取列）
    - 每个列名同时映射为“单列 DataFrame”（而非 Series），以兼容 operators 中的 DataFrame 类型签名
    - 暴露 operators 模块中的全部可调用函数
    - 保持 MultiIndex（level=0: ts_code, level=1: trade_date）
    """
    # 使用MultiIndex: level=0为股票代码，level=1为交易日期
    if not isinstance(df.index, pd.MultiIndex):
        df = df.set_index(['ts_code', 'trade_date']).sort_index()
    env: Dict[str, Any] = {}
    # 暴露底层 DataFrame
    env['df'] = df.copy()
    # 兼容别名：允许用户直接使用 "data" 指代完整数据集（与 df 等价）
    env['data'] = df.copy()
    # 将每个列名映射为“单列 DataFrame”（与 operators 的签名更兼容）
    for col in df.columns:
        env[col] = df[[col]]
    # 暴露算子库的全部可调用符号（严格要求已加载）
    if ops is None:
        raise SafeExpressionError("未加载 operators（相对导入失败）。请确认项目根包含 operators.py 并作为当前工作目录运行后端。")
    for name, obj in vars(ops).items():
        if name.startswith('_'):
            continue
        try:
            if callable(obj):
                env[name] = obj
        except Exception:
            continue
    return env


# 仅通过构建的环境显式暴露函数，避免固定白名单约束


def evaluate_expression(df: pd.DataFrame, expr: str, inf_to_nan: bool = True) -> Any:
    """
    安全求值表达式，返回因子 signal：可为 Series 或 DataFrame（支持多列）。
    - 暴露 operators.py 全部可调用符号；禁止属性访问。
    - 支持列表/元组参数与赋值语法；最后一个表达式的值作为返回结果。
    - 返回对象需与 df 的 MultiIndex 对齐（列为一个或多个信号）。
    """
    env = build_env_from_df(df)
    evaluator = SafeEvaluator(env=env)
    out = evaluator.eval(expr)
    # 基本校验：必须是 Series 或 DataFrame（不再做 inf→NaN 兼容屏蔽，完全以 operators.py 行为为准）
    if isinstance(out, pd.Series):
        return out
    if isinstance(out, pd.DataFrame):
        if out.shape[1] == 0:
            raise SafeExpressionError("表达式返回空的DataFrame")
        return out
    raise SafeExpressionError("表达式输出必须为 Series 或 DataFrame")