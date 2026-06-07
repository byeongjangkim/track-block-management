from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.block_order import BlockOrder
from app.models.project import Project
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["공사/사업"])


def _to_resp(proj: Project, db: Session) -> ProjectResponse:
    count = db.query(func.count(BlockOrder.id)).filter(BlockOrder.project_id == proj.id).scalar() or 0
    resp = ProjectResponse.model_validate(proj)
    resp.block_order_count = count
    return resp


@router.get("", response_model=list[ProjectResponse])
def list_projects(
    organization_id: int | None = Query(None),
    status: str | None = Query(None),
    project_type: str | None = Query(None),
    name: str | None = Query(None, description="이름 부분 검색"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Project)
    if organization_id:
        q = q.filter(Project.organization_id == organization_id)
    if status:
        q = q.filter(Project.status == status)
    if project_type:
        q = q.filter(Project.project_type == project_type)
    if name:
        q = q.filter(Project.name.ilike(f"%{name}%"))
    projects = q.order_by(Project.created_at.desc()).all()
    return [_to_resp(p, db) for p in projects]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    proj = Project(
        **body.model_dump(),
        created_by=user.id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return _to_resp(proj, db)


@router.get("/lookup/by-name", response_model=ProjectResponse | None)
def lookup_by_name(
    name: str = Query(..., description="정확한 이름 또는 포함 검색"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """PDF 파싱된 관련사업명으로 기존 프로젝트 조회 (자동 연결용)."""
    proj = (
        db.query(Project)
        .filter(Project.name == name)
        .first()
    )
    if not proj:
        proj = (
            db.query(Project)
            .filter(Project.name.ilike(f"%{name}%"))
            .first()
        )
    return _to_resp(proj, db) if proj else None


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    return _to_resp(proj, db)


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    body: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if user.role not in ("system_superuser", "org_admin"):
        raise HTTPException(status_code=403, detail="수정 권한이 없습니다.")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(proj, field, val)
    db.commit()
    db.refresh(proj)
    return _to_resp(proj, db)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "system_superuser":
        raise HTTPException(status_code=403, detail="삭제는 시스템관리자만 가능합니다.")
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    db.delete(proj)
    db.commit()
