from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.facility import Facility
from app.schemas.facility import FacilityResponse

router = APIRouter(prefix="/facilities", tags=["시설물"])


@router.get("", response_model=list[FacilityResponse])
def list_facilities(
    route_id: int | None = None,
    type: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Facility)
    if route_id is not None:
        q = q.filter(Facility.route_id == route_id)
    if type is not None:
        q = q.filter(Facility.type == type)
    return q.order_by(Facility.route_id, Facility.km).all()
