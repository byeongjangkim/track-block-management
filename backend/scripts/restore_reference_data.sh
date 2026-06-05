#!/bin/bash
# 기준데이터 복원 (신규 서버 초기화 또는 데이터 재적재)
# 사용: cd backend && bash scripts/restore_reference_data.sh [덤프파일경로]
#
# 전제: alembic upgrade head 가 완료된 상태에서 실행

set -e

DB_NAME="${DB_NAME:-track_block}"
DUMP_FILE="${1:-}"

if [ -z "$DUMP_FILE" ]; then
    # 가장 최신 덤프 파일 자동 선택
    DUMP_FILE=$(ls -t "$(dirname "$0")/dumps"/reference_data_*.sql 2>/dev/null | head -1)
fi

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
    echo "오류: 덤프 파일을 찾을 수 없습니다."
    echo "사용법: bash scripts/restore_reference_data.sh [덤프파일경로]"
    exit 1
fi

echo "=== 기준데이터 복원: $DB_NAME ==="
echo "파일: $DUMP_FILE"
echo ""

# FK 제약 임시 비활성화 후 복원
psql -d "$DB_NAME" -c "SET session_replication_role = replica;" 2>/dev/null || true
psql -d "$DB_NAME" -f "$DUMP_FILE"
psql -d "$DB_NAME" -c "SET session_replication_role = DEFAULT;" 2>/dev/null || true

# 시퀀스 갱신
psql -d "$DB_NAME" -c "
DO \$\$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('alembic_version')
    LOOP
        BEGIN
            EXECUTE format(
                'SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE(MAX(id), 1)) FROM %I',
                r.tablename, 'id', r.tablename
            );
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END;
\$\$;
" 2>/dev/null

echo ""
echo "복원 완료. seed 스크립트 실행:"
echo "  python scripts/seed/01_organizations.py   # 조직 재확인"
echo "  python scripts/seed/02_system_settings.py # 설정 재확인"
echo "  python scripts/seed/03_initial_user.py    # 관리자 계정 생성"
