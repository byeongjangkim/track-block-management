import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_db, require_org_admin
from app.models.block_order import BlockOrder
from app.models.block_order_document import BlockOrderDocument
from app.models.user import User
from app.schemas.block_order import BlockOrderDocumentResponse
from app.services.pdf_parser_service import (
    parse_block_order_pdf,
    parse_cover_pdf,
    parse_detail_pdf,
    merge_parse_results,
)

router = APIRouter(prefix="/documents", tags=["문서"])

ALLOWED_CONTENT_TYPES = {"application/pdf"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


@router.post("/upload/{order_id}")
async def upload_document(
    order_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    order = db.query(BlockOrder).filter(BlockOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="차단명령을 찾을 수 없습니다")

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF 파일만 업로드할 수 있습니다")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="파일 크기는 20MB 이하여야 합니다")

    filename = f"{uuid.uuid4().hex}.pdf"
    file_path = settings.UPLOAD_DIR / filename
    file_path.write_bytes(content)

    # 기존 파일 삭제
    if order.document_path:
        old_path = settings.UPLOAD_DIR / Path(order.document_path).name
        if old_path.exists():
            old_path.unlink()

    order.document_path = filename
    db.commit()

    return {"filename": filename}


@router.post("/parse-pdf")
async def parse_pdf(
    file: UploadFile,
    _: User = Depends(require_org_admin),
):
    """
    PDF 업로드 → 차단명령 필드 자동 추출 → JSON 반환.
    DB 저장 없음 — 추출 결과만 반환하며, 프론트엔드에서 검토 후 저장한다.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF 파일만 업로드할 수 있습니다")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="파일 크기는 20MB 이하여야 합니다")

    return parse_block_order_pdf(content)


@router.post("/bulk-parse")
async def bulk_parse_pdf(
    cover_file: Optional[UploadFile] = File(None),
    detail_file: Optional[UploadFile] = File(None),
    route_name: Optional[str] = Form(None),
    _: User = Depends(require_org_admin),
):
    """
    시행문 + 세부내역 PDF 동시 업로드 → 차단명령 후보 목록 반환.

    - cover_file:  시행문 PDF (선택)
    - detail_file: 세부내역 PDF (선택)
    - route_name:  사용자가 확인/선택한 노선명 (Step1에서 전달)

    두 파일 중 하나만 업로드해도 동작하며, 결과를 병합해 반환한다.
    DB 저장 없음 — 프론트엔드에서 검토 후 /block-orders/bulk로 저장.
    """
    if not cover_file and not detail_file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="시행문 또는 세부내역 PDF 중 하나 이상을 업로드하세요",
        )

    cover_result = None
    detail_result = None

    if cover_file:
        if cover_file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다 (시행문)")
        content = await cover_file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="시행문 파일이 20MB를 초과합니다")
        cover_result = parse_cover_pdf(content)

    if detail_file:
        if detail_file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다 (세부내역)")
        content = await detail_file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="세부내역 파일이 20MB를 초과합니다")
        detail_result = parse_detail_pdf(content, route_name=route_name)

    return merge_parse_results(cover_result, detail_result, route_name=route_name)


@router.get("/{filename}")
def download_document(
    filename: str,
    _: User = Depends(get_current_user),
):
    # 경로 순회 방지
    safe_name = Path(filename).name
    file_path = settings.UPLOAD_DIR / safe_name

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="파일을 찾을 수 없습니다")

    return FileResponse(path=file_path, media_type="application/pdf", filename=safe_name)


# ── DB 저장 방식 (PostgreSQL BYTEA) ──────────────────────────────────────────

@router.post("/db/upload", response_model=BlockOrderDocumentResponse)
async def upload_document_to_db(
    file: UploadFile,
    order_id: Optional[int] = Form(None),
    doc_no: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    승인원문 PDF를 PostgreSQL BYTEA에 저장한다.
    order_id가 주어지면 해당 block_order.document_id를 자동 연결한다.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="PDF 파일만 업로드할 수 있습니다")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="파일 크기는 20MB 이하여야 합니다")

    doc = BlockOrderDocument(
        doc_no=doc_no,
        original_filename=file.filename or "document.pdf",
        file_data=content,
        file_size=len(content),
        content_type="application/pdf",
        uploaded_by=current_user.id,
        note=note,
    )
    db.add(doc)
    db.flush()  # id 획득

    if order_id is not None:
        order = db.query(BlockOrder).filter(BlockOrder.id == order_id).first()
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="차단명령을 찾을 수 없습니다")
        order.document_id = doc.id

    db.commit()
    db.refresh(doc)
    return doc


@router.get("/db/{doc_id}/info", response_model=BlockOrderDocumentResponse)
def get_document_info(
    doc_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """메타데이터만 반환 (파일 바이너리 제외)."""
    doc = db.query(BlockOrderDocument).filter(BlockOrderDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="문서를 찾을 수 없습니다")
    return doc


@router.get("/db/{doc_id}/view")
def view_document_from_db(
    doc_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """PDF 바이너리를 스트림으로 반환 (브라우저에서 직접 열기)."""
    doc = db.query(BlockOrderDocument).filter(BlockOrderDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="문서를 찾을 수 없습니다")
    headers = {
        "Content-Disposition": f'inline; filename="{doc.original_filename}"',
        "Content-Length": str(len(doc.file_data)),
    }
    return Response(content=doc.file_data, media_type="application/pdf", headers=headers)


@router.delete("/db/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document_from_db(
    doc_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """DB에서 PDF 삭제. 연결된 block_orders.document_id는 SET NULL."""
    doc = db.query(BlockOrderDocument).filter(BlockOrderDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="문서를 찾을 수 없습니다")
    db.delete(doc)
    db.commit()
