from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import admin, auth, block_orders, documents, facilities, map, organizations, rail_reference, routes, settings, stats, users

app = FastAPI(
    title="선로차단작업 관리 API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS — 개발 시 전체 허용 (운영 시 특정 IP로 제한)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
PREFIX = "/api/v1"
app.include_router(auth.router,          prefix=PREFIX)
app.include_router(users.router,         prefix=PREFIX)
app.include_router(organizations.router, prefix=PREFIX)
app.include_router(routes.router,        prefix=PREFIX)
app.include_router(facilities.router,    prefix=PREFIX)
app.include_router(block_orders.router,  prefix=PREFIX)
app.include_router(documents.router,     prefix=PREFIX)
app.include_router(stats.router,         prefix=PREFIX)
app.include_router(settings.router,      prefix=PREFIX)
app.include_router(admin.router,         prefix=PREFIX)
app.include_router(map.router,           prefix=PREFIX)
app.include_router(rail_reference.router, prefix=PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok"}
