from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.route import Route
from app.models.rail_baseline import RailRoute
from app.schemas.route import RouteResponse

router = APIRouter(prefix="/routes", tags=["노선"])


def _enrich_route(route: Route, db: Session) -> RouteResponse:
    """rail_routes에서 default_track_count를 조회해 RouteResponse를 구성."""
    rail = db.query(RailRoute).filter(RailRoute.name == route.name).first()
    track_count = rail.default_track_count if rail else 2
    line_type = rail.line_type if rail else None
    data = {
        "id": route.id,
        "code": route.code,
        "name": route.name,
        "start_km": route.start_km,
        "end_km": route.end_km,
        "start_station": route.start_station,
        "end_station": route.end_station,
        "up_direction": route.up_direction,
        "down_direction": route.down_direction,
        "default_track_count": track_count,
        "line_type": line_type,
    }
    return RouteResponse(**data)


@router.get("", response_model=list[RouteResponse])
def list_routes(db: Session = Depends(get_db)):
    routes = db.query(Route).order_by(Route.id).all()
    return [_enrich_route(r, db) for r in routes]


@router.get("/{route_id}", response_model=RouteResponse)
def get_route(route_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException, status
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="노선을 찾을 수 없습니다")
    return _enrich_route(route, db)
