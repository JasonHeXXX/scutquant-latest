from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import OpenAI
import os

router = APIRouter()

# =================配置区域=================
# 请将这里替换为你自己的 DeepSeek API Key
# 建议在系统环境变量中设置 DEEPSEEK_API_KEY，或者直接在这里填入字符串 "sk-xxxx"
API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-xxxx") 
BASE_URL = "https://api.deepseek.com"
# =========================================

# 初始化 OpenAI 客户端 (DeepSeek 兼容 OpenAI 协议)
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# 定义请求数据结构
class ChatRequest(BaseModel):
    messages: list[dict]  # 例如: [{"role": "user", "content": "写一个动量因子"}]
    temperature: float = 0.1 # 编程任务建议低温度，越低越严谨

# 核心：将 operators.py 的规则灌输给 LLM
SYSTEM_PROMPT = """
你是一个专业的量化因子挖掘助手 (SCUTQUANT Copilot)。
你的任务是将用户的自然语言投资逻辑转化为符合 SCUTQUANT 平台规范的因子表达式。

【核心规则】
1. 只能使用下方的【允许算子列表】中的函数。
2. 数据字段仅限：open, high, low, close, vol, amount, ret (收益率)。
3. 因子表达式必须是单行代码，可以直接被 python 的 eval() 执行。
4. 所有的输入字段 (如 close) 都是 Pandas Series，算子返回的也是 Series 或 DataFrame。
5. 如果用户需要技术指标（如 RSI, MACD），请用基础算子组合实现。

【允许算子列表】
- 时序算子 (TS):
  ts_mean(x, n), ts_std(x, n), ts_max(x, n), ts_min(x, n), ts_sum(x, n)
  ts_rank(x, n): 滚动排名
  ts_delta(x, n): x - x.shift(n)
  ts_delay(x, n): x.shift(n)
  ts_corr(x, y, n): 滚动相关系数
  ts_cov(x, y, n): 滚动协方差
  ts_decay(x, n): 线性衰减加权
  ts_ewma(x, half_life, n): 指数加权移动平均

- 截面算子 (CS):
  cs_rank(x): 截面排名(0~1)
  cs_zscore(x): 截面标准化
  cs_scale(x): 归一化
  cs_neutralize(x, target, features): 中性化

- 基础运算:
  log(x), abs(x), sign(x), sqrt(x)
  +, -, *, /
  comparison: >, <, == (返回 0/1)

【回答格式】
请直接给出因子表达式，不要废话。
如果是代码块，请使用 markdown 格式：
```python
ts_mean(close, 20) / close

"""

@router.post("/chat")
async def chat_with_copilot(request: ChatRequest):

    # 1. 检查 Key
    if not API_KEY.startswith("sk-"):
        raise HTTPException(
            status_code=500,
            detail="未配置有效的 DeepSeek API Key"
        )

    try:
        # 2. 构造消息
        full_messages = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ] + request.messages

        # 3. 调用模型
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=full_messages,
            temperature=request.temperature,
            max_tokens=1024,
            stream=False
        )

        # 4. 取结果
        content = response.choices[0].message.content

        return {
            "reply": content
        }

    except Exception as e:

        print("DeepSeek 调用失败:", e)

        raise HTTPException(
            status_code=500,
            detail=f"LLM 服务调用失败: {str(e)}"
        )
