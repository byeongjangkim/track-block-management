"""tc11: block_order_documents (PDF BYTEA) · block_order_monitors · block_orders 확장

- block_order_documents : PDF 원문을 PostgreSQL BYTEA에 저장
- block_order_monitors  : 열차감시원 복수 보관 (기존 train_watcher 단수 레거시 유지)
- block_orders 추가 컬럼:
    document_id      → block_order_documents.id FK
    project_name     → 관련사업명
    approved_date    → 승인일자 (문서 발행일)
    block_method     → 차단방법 코드 (SS/SSS 등 고속선)
    contractor_phone → 시공사 연락처 (contractor 컬럼은 기존 유지)

Revision ID : tc11_block_order_documents
Revises     : tc10_drop_region_name
Create Date : 2026-06-07
"""

from alembic import op
import sqlalchemy as sa

revision = "tc11_block_order_documents"
down_revision = "tc10_drop_region_name"
branch_labels = None
depends_on = None


def upgrade():
    # ── block_order_documents ─────────────────────────────────────────────────
    op.create_table(
        "block_order_documents",
        sa.Column("id",                sa.Integer(),     primary_key=True),
        sa.Column("doc_no",            sa.String(100),   nullable=True),
        sa.Column("original_filename", sa.String(255),   nullable=False),
        sa.Column("file_data",         sa.LargeBinary(), nullable=False),
        sa.Column("file_size",         sa.Integer(),     nullable=True),
        sa.Column("content_type",      sa.String(50),    nullable=False,
                  server_default="application/pdf"),
        sa.Column("uploaded_at",       sa.DateTime(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.Column("uploaded_by",       sa.Integer(),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note",              sa.Text(),        nullable=True),
    )
    op.create_index("ix_bod_doc_no", "block_order_documents", ["doc_no"])

    # ── block_order_monitors ──────────────────────────────────────────────────
    op.create_table(
        "block_order_monitors",
        sa.Column("id",             sa.Integer(),  primary_key=True),
        sa.Column("block_order_id", sa.Integer(),
                  sa.ForeignKey("block_orders.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name",    sa.String(50),  nullable=False),
        sa.Column("phone",   sa.String(20),  nullable=True),
        sa.Column("company", sa.String(100), nullable=True),
    )
    op.create_index("ix_bom_block_order_id", "block_order_monitors", ["block_order_id"])

    # ── block_orders 컬럼 추가 ────────────────────────────────────────────────
    op.add_column("block_orders",
        sa.Column("document_id", sa.Integer(),
                  sa.ForeignKey("block_order_documents.id", ondelete="SET NULL"),
                  nullable=True))
    op.add_column("block_orders",
        sa.Column("project_name", sa.String(200), nullable=True))
    op.add_column("block_orders",
        sa.Column("approved_date", sa.Date(), nullable=True))
    op.add_column("block_orders",
        sa.Column("block_method", sa.String(20), nullable=True))
    op.add_column("block_orders",
        sa.Column("contractor_phone", sa.String(50), nullable=True))

    op.create_index("ix_block_orders_document_id", "block_orders", ["document_id"])


def downgrade():
    op.drop_index("ix_block_orders_document_id", "block_orders")
    op.drop_column("block_orders", "contractor_phone")
    op.drop_column("block_orders", "block_method")
    op.drop_column("block_orders", "approved_date")
    op.drop_column("block_orders", "project_name")
    op.drop_column("block_orders", "document_id")

    op.drop_index("ix_bom_block_order_id", "block_order_monitors")
    op.drop_table("block_order_monitors")

    op.drop_index("ix_bod_doc_no", "block_order_documents")
    op.drop_table("block_order_documents")
