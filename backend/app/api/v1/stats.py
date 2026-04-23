from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.block_order import BlockOrder
from app.models.user import User

router = APIRouter(prefix="/stats", tags=["통계"])


@router.get("/daily")
def daily_stats(
    date_from: date,
    date_to: date,
    route_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(
        BlockOrder.work_date,
        func.count(BlockOrder.id).label("count"),
    ).filter(
        BlockOrder.work_date >= date_from,
        BlockOrder.work_date <= date_to,
    )
    if route_id is not None:
        q = q.filter(BlockOrder.route_id == route_id)

    rows = q.group_by(BlockOrder.work_date).order_by(BlockOrder.work_date).all()
    return [{"date": str(r.work_date), "count": r.count} for r in rows]
