# frontend — 웹 클라이언트

React 18 + TypeScript 기반 SPA. 캘린더 뷰, SVG 노선도 시각화, PDF 문서 뷰어, 집계/통계 화면을 제공한다.

---

## 환경

- **Node.js:** 22 (시스템 설치, arm64)
- **빌드 도구:** Vite
- **개발 서버:** `npm run dev -- --host 0.0.0.0` (LAN 접속 가능)

---

## 기술 스택

| 구분 | 라이브러리 | 비고 |
|---|---|---|
| 프레임워크 | React 18 + TypeScript | |
| 빌드 | Vite | M2에서 빠름 |
| 라우팅 | React Router v6 | |
| 서버 상태 | TanStack Query v5 | API 데이터 캐싱·로딩 처리 |
| 클라이언트 상태 | Zustand | 로그인 등 전역 상태 |
| 지도 시각화 | D3.js v7 | SVG 줌·패닝·오버레이 |
| 캘린더 | react-big-calendar | |
| PDF 뷰어 | react-pdf (PDF.js) | |
| HTTP 클라이언트 | Axios | |
| UI | shadcn/ui + Tailwind CSS v4 | |

---

## 디렉토리 구조

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── CalendarPage.tsx       # 날짜별 차단명령 캘린더
│   │   ├── MapPage.tsx            # 노선도 시각화
│   │   ├── DocumentPage.tsx       # PDF 업로드/뷰어
│   │   └── StatsPage.tsx          # 집계·통계
│   ├── components/
│   │   ├── map/
│   │   │   ├── RailwayMap.tsx     # 메인 SVG 노선도 (D3.js)
│   │   │   ├── BlockOverlay.tsx   # 차단구간 색상 오버레이
│   │   │   ├── FacilityMarker.tsx # 시설물 마커
│   │   │   └── StationSubmap.tsx  # 역구내 배선도 팝업 (Phase 3)
│   │   ├── calendar/
│   │   ├── document/
│   │   └── common/
│   ├── api/
│   │   ├── client.ts              # Axios 인스턴스 (baseURL 환경변수)
│   │   ├── blockOrders.ts
│   │   ├── routes.ts
│   │   └── facilities.ts
│   ├── store/
│   │   └── authStore.ts           # 로그인 상태 (Zustand)
│   ├── types/
│   │   └── index.ts               # 공통 타입 정의
│   └── utils/
│       └── mapCoord.ts            # 거리정 ↔ SVG 좌표 변환
├── public/
│   └── maps/                      # SVG 노선도 파일 (maps/ 에서 복사, git 포함)
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

---

## 개발 시작

```bash
cd frontend
npm install

# LAN 접속 가능하게 실행 (폰·태블릿에서 테스트 가능)
npm run dev -- --host 0.0.0.0
```

접속 주소: `http://[맥IP]:5173` — 맥 IP는 `ipconfig getifaddr en0` 으로 확인.

---

## API URL 설정 (환경변수)

모든 API 호출 주소는 `VITE_API_URL` 환경변수로 관리한다. 코드는 변경하지 않고 `.env.local` 파일만 교체한다.

### `src/api/client.ts`

```typescript
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
});
```

### `.env.local` 환경별 설정 (git 제외)

```bash
# MacBook — PC에서 접속
VITE_API_URL=http://localhost:8000

# MacBook — 폰/태블릿 LAN 테스트 (맥 IP 사용)
VITE_API_URL=http://192.168.0.10:8000

# Linux 서버 운영
VITE_API_URL=http://서버IP:8000
```

> **주의:** 폰에서 접속 시 `localhost`는 폰 자신을 가리킴 — 반드시 맥의 LAN IP 사용.

---

## 코드 작성 규칙 (서버 이전 대비)

### 서버 배포 시 빌드

Mac에서는 Vite 개발 서버(`npm run dev`)를 사용하지만, Linux 서버에서는 정적 빌드 후 Nginx/Caddy로 서빙한다.

```bash
# Linux 서버에서
npm install
VITE_API_URL=http://서버IP:8000 npm run build
# → dist/ 폴더 생성 → Nginx/Caddy로 서빙
```

### `.gitignore` (frontend/)

```
node_modules/
dist/
.env.local
.env.*.local
```

---

## 핵심 컴포넌트

### RailwayMap (노선도 뷰어)
- `public/maps/[노선코드].svg` 파일을 D3.js로 렌더링
- 줌(wheel) / 패닝(drag) — `d3.zoom()` 사용
- `BlockOverlay`: 차단구간을 선 위에 색상 레이어로 표시
- 거리정 → SVG 좌표 변환은 `mapCoord.ts`의 선형 보간 함수 사용

### mapCoord.ts (거리정 ↔ SVG 좌표 변환)

```typescript
// 앵커 포인트 배열을 선형 보간해 임의 km → SVG 좌표 계산
function kmToSvgCoord(km: number, anchors: Anchor[]): { x: number; y: number }
```

### CalendarPage
- 월간 캘린더에 날짜별 차단명령 건수 배지 표시
- 날짜 클릭 → 당일 차단명령 목록 + 노선도 오버레이 연동

---

## 타입 정의 (핵심)

```typescript
type Direction = 'UP' | 'DOWN'; // 상선 | 하선

interface BlockOrder {
  id: number;
  routeId: number;
  direction: Direction;
  startKm: number;
  endKm: number;
  workDate: string;       // YYYY-MM-DD
  startTime: string;      // HH:mm
  endTime: string;
  field: string;
  blockType: string;
  hasEquipment: boolean;
  hasManpower: boolean;
  isExternal: boolean;
  documentPath?: string;
}

interface Facility {
  id: number;
  routeId: number;
  type: 'STATION' | 'CROSSING' | 'OVERPASS' | 'SUBSTATION' | 'TUNNEL' | 'BRIDGE';
  km: number;
  name: string;
  hasStationMap: boolean;
}
```

---

## 주의사항

- `public/maps/` SVG 파일은 git에 포함 — `maps/` 파이프라인에서 생성 후 복사
- 모바일 반응형은 Phase 3에서 적용, Phase 1·2는 PC(1280px 이상) 우선
- `react-pdf`는 PDF.js worker 설정 필요 — `vite.config.ts`에서 worker 파일 복사 처리
