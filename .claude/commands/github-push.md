# GitHub Push Skill

GitHub 원격 저장소에 현재 작업 내용을 커밋하고 푸시합니다.

## 실행 절차

다음 단계를 순서대로 실행하세요:

### 1. 현재 상태 확인
```bash
git status
git log --oneline -5
```

### 2. 원격 저장소 확인
```bash
git remote -v
```
원격 저장소(origin)가 없으면 사용자에게 GitHub 저장소 URL을 물어보고 추가합니다:
```bash
git remote add origin <URL>
```

### 3. 변경 사항 스테이징 (민감 파일 제외)
절대 포함하면 안 되는 파일 확인:
- `backend/.env` (시크릿 키, DB URL)
- `backend/db.sqlite3` (데이터베이스)
- `backend/uploads/` (PDF 파일)
- `**/__pycache__/`, `**/.venv/` (가상환경, 캐시)
- `frontend/dist/` (빌드 결과물)

`.gitignore`에 위 항목이 있는지 확인 후 스테이징:
```bash
git add -A
git status  # 포함된 파일 최종 확인
```

### 4. 커밋 메시지 작성
변경 사항을 요약하여 커밋합니다:
```bash
git commit -m "$(cat <<'EOF'
<변경 내용 요약>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 5. 브랜치 확인 및 푸시
```bash
git branch  # 현재 브랜치 확인
git push -u origin main  # 최초 푸시 또는 추적 브랜치 설정
# 이후에는: git push
```

### 6. 결과 확인
```bash
git log --oneline -3
```

## 주의사항

- **절대 force push 금지** (`git push --force` 사용 불가 — 히스토리 손실 위험)
- `.env` 파일, `db.sqlite3`, `uploads/` 는 절대 커밋 금지
- 커밋 전 `git status`로 스테이징된 파일 목록 반드시 확인
- main 브랜치에 직접 푸시하는 구조 (Phase 1 단독 개발 환경)
- GitHub CLI(`gh`)가 설치된 경우 `gh repo view` 로 저장소 상태 확인 가능

## 빠른 실행 (원격 설정 완료 후)

```bash
git add -A && git status
# 파일 목록 확인 후:
git commit -m "작업 내용" && git push
```
