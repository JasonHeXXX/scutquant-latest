import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1.factor import router as factor_router
from .api.v1.backtest import router as backtest_router
# 1. 新增导入 copilot 路由
from .api.v1.copilot import router as copilot_router

app = FastAPI(title="SCUTQUANT Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(factor_router, prefix="/api/v1")
app.include_router(backtest_router, prefix="/api/v1")
# 2. 注册 copilot 路由
# 这样配置后，前端访问地址就是: POST http://127.0.0.1:8000/api/v1/copilot/chat
app.include_router(copilot_router, prefix="/api/v1/copilot", tags=["copilot"])