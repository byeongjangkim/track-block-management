import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import admin, auth, block_orders, documents, facilities, map, organizations, projects, rail_reference, routes, settings, stats, users

logger = logging.getLogger(__name__)

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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """미처리 예외를 JSON 500으로 변환.
    ExceptionMiddleware는 CORSMiddleware 외부에 있어 응답이 CORS 미들웨어를 우회하므로
    여기서 CORS 헤더를 직접 추가한다."""
    logger.exception("Unhandled exception: %s %s", request.method, request.url)
    response = JSONResponse(
        status_code=500,
        content={"detail": f"서버 내부 오류: {type(exc).__name__}"},
    )
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

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
app.include_router(projects.router,      prefix=PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok"}
