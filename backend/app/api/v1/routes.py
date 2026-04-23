from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.route import Route
from app.schemas.route import RouteResponse

router = APIRouter(prefix="/routes", tags=["노선"])


@router.get("", response_model=list[RouteResponse])
def list_routes(db: Session = Depends(get_db)):
    return db.query(Route).order_by(Route.id).all()


@router.get("/{route_id}", response_model=RouteResponse)
def get_route(route_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException, status
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="노선을 찾을 수 없습니다")
    return route
