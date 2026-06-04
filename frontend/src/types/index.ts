// 선로 이름
// 일반선: 상선/하선(단선·복선), 상1~상3·하1~하3(2복선·3복선)
// 고속선: T1(하1)·T3(하2)·T5(하3)·T7(하4) / T2(상1)·T4(상2)·T6(상3)·T8(상4)
export type TrackName =
  | '상선' | '하선'
  | '상1' | '상2' | '상3' | '하1' | '하2' | '하3'
  | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';

/** 선로 수에 따른 선택 가능한 선로 목록 */
export function availableTracks(trackCount: number): TrackName[] {
  if (trackCount === 1) return ['상선'];
  if (trackCount === 2) return ['상선', '하선'];
  if (trackCount === 4) return ['상1', '상2', '하1', '하2'];
  if (trackCount === 6) return ['상1', '상2', '상3', '하1', '하2', '하3'];
  return ['상선', '하선'];
}

/** 고속선 선로 번호 — 중심에서 외측 순 */
export const HIGH_SPEED_DOWN_TRACKS: TrackName[] = ['T1', 'T3', 'T5', 'T7']; // 하1~하4
export const HIGH_SPEED_UP_TRACKS: TrackName[]   = ['T2', 'T4', 'T6', 'T8']; // 상1~상4
export const HIGH_SPEED_TRACKS: TrackName[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

/** 고속선 T번호 ↔ 일반선 명칭 대응 */
export const T_TRACK_LABEL: Record<string, string> = {
  T1: 'T1(하1)', T2: 'T2(상1)', T3: 'T3(하2)', T4: 'T4(상2)',
  T5: 'T5(하3)', T6: 'T6(상3)', T7: 'T7(하4)', T8: 'T8(상4)',
};

// 차단현황도 시설물 분류 필터
// 역: station_type별 세분화 / 구조물·전기설비: 세부 시설물 유형별
export interface FacilityFilter {
  // 역
  역관리역:       boolean;  // 관리역
  역보통역:       boolean;  // 보통역
  역무인역:       boolean;  // 무인역
  역신호장:       boolean;  // 신호장
  역신호소:       boolean;  // 신호소
  // 구조물
  구조물터널:     boolean;  // 터널 (LineString)
  구조물교량:     boolean;  // 교량 (LineString)
  구조물과선교:   boolean;  // 과선교 (LineString)
  구조물건널목:   boolean;  // 건널목 (Point)
  구조물분기:     boolean;  // 분기 (Point)
  // 전기설비 (변전소만 현재 map 데이터 존재)
  전기변전소:     boolean;  // 변전소 ss/sp/ssp/atp/pp
  전기전기실:     boolean;  // 전기실 AC/DC (데이터 준비중)
  전기통신실:     boolean;  // 통신실 (데이터 준비중)
  전기신호기계실: boolean;  // 신호기계실 IEC/INEC (데이터 준비중)
}

export type FacilityType =
  | 'STATION'
  | 'GENERAL_STATION'
  | 'CROSSING'
  | 'OVERPASS'
  | 'SUBSTATION'
  | 'TUNNEL'
  | 'BRIDGE';

export interface Route {
  id: number;
  code: string;
  name: string;
  start_km: number;
  end_km: number;
  start_station: string | null;
  end_station: string | null;
  up_direction: string | null;
  down_direction: string | null;
  default_track_count: number;   // 1=단선, 2=복선, 4=2복선, 6=3복선
}

export interface Facility {
  id: number;
  route_id: number;
  type: FacilityType;
  name: string;
  km: number;
  has_station_map: boolean;
}

export interface BlockOrder {
  id: number;
  organization_id: number | null;
  route_id: number;
  rail_route_id: number | null;
  route_name: string | null;
  tracks: TrackName[];
  start_km: number | null;
  end_km: number | null;
  start_kp: number | null;
  end_kp: number | null;
  section_note: string | null;
  start_facility_id: number | null;
  end_facility_id: number | null;
  start_rail_facility_id: number | null;
  end_rail_facility_id: number | null;
  danger_level: string | null;   // 'A'(위험) / 'B'(주의) / 'C'(일반) / null
  parent_id: number | null;      // 대표명령 ID (null = 대표명령 자신)
  equipment_name: string | null; // 투입장비
  speed_restriction: number | null;      // 열차서행 제한속도 km/h
  speed_restriction_note: string | null; // 열차서행 구간/비고
  catenary_protection: string | null;  // 양단접지 | 단접지
  zep:  string | null;   // 관제사 보호조치 ZEP (고속선)
  zcp:  string | null;   // 관제사 보호조치 ZCP (고속선)
  cpt:  string | null;   // 작업자 보호조치 CPT (고속선)
  tzep: string | null;   // 작업자 보호조치 TZEP (고속선)
  worker_count: number | null;   // 작업자 수
  work_date: string;      // YYYY-MM-DD
  start_time: string;     // HH:mm:ss
  end_time: string;
  field: string;
  block_type: string;
  work_type: string | null;   // 인력 | 장비 | 기계
  has_equipment: boolean;
  has_labor: boolean;
  implementer: string;        // 철도공사 | 철도공단 | 외부
  is_external: boolean;
  doc_no: string | null;
  dept_head: string | null;
  dept_head_phone: string | null;
  work_supervisor: string;
  work_supervisor_phone: string | null;
  safety_manager: string;
  safety_manager_phone: string | null;
  electric_safety_manager: string | null;
  electric_safety_manager_phone: string | null;
  contractor: string | null;
  train_watcher: string | null;
  train_watcher_phone: string | null;
  reason: string | null;
  safety_items: string | null;
  track_name: string | null;
  document_path: string | null;
  note: string | null;
  created_by: number;
}

export interface BlockOrderCreate {
  route_id: number | null;
  rail_route_id?: number | null;
  organization_id?: number;
  tracks: TrackName[];
  start_km: number | null;
  end_km: number | null;
  start_kp?: number | null;
  end_kp?: number | null;
  section_note?: string;
  start_facility_id?: number | null;
  end_facility_id?: number | null;
  start_rail_facility_id?: number | null;
  end_rail_facility_id?: number | null;
  danger_level?: string | null;
  parent_id?: number | null;
  equipment_name?: string | null;
  speed_restriction?: number | null;
  speed_restriction_note?: string | null;
  catenary_protection?: string | null;
  zep?:  string | null;
  zcp?:  string | null;
  cpt?:  string | null;
  tzep?: string | null;
  worker_count?: number | null;
  work_date: string;
  start_time: string;
  end_time: string;
  field: string;
  block_type: string;
  work_type?: string | null;
  has_equipment: boolean;
  has_labor: boolean;
  implementer?: string;
  is_external: boolean;
  doc_no?: string;
  dept_head?: string;
  dept_head_phone?: string;
  work_supervisor: string;
  work_supervisor_phone?: string;
  safety_manager: string;
  safety_manager_phone?: string;
  electric_safety_manager?: string;
  electric_safety_manager_phone?: string;
  contractor?: string;
  train_watcher?: string;
  train_watcher_phone?: string;
  reason?: string;
  safety_items?: string;
  track_name?: string | null;
  note?: string;
}

export interface Anchor {
  km: number;
  x: number;
  y: number;
}

export interface AnchorData {
  route: string;
  route_code: string;
  start_km: number;
  end_km: number;
  up_offset_px: number;
  down_offset_px: number;
  anchors: Anchor[];
}

export interface ParsedBlockOrder {
  route_name: string | null;
  tracks: TrackName[] | null;
  start_km: number | null;
  end_km: number | null;
  work_date: string | null;       // YYYY-MM-DD
  start_time: string | null;      // HH:mm
  end_time: string | null;        // HH:mm
  field: string | null;
  block_type: string | null;
  doc_no: string | null;
  dept_head: string | null;
  dept_head_phone: string | null;
  work_supervisor: string | null;
  work_supervisor_phone: string | null;
  safety_manager: string | null;
  safety_manager_phone: string | null;
  electric_safety_manager: string | null;
  electric_safety_manager_phone: string | null;
  contractor: string | null;
  train_watcher: string | null;
  train_watcher_phone: string | null;
  confidence: number;             // 0.0~1.0
  error: string | null;
}

// PDF 일괄 파싱 결과 — 세부내역 표 한 행
export interface ParsedRow {
  work_date: string | null;          // YYYY-MM-DD
  start_time: string | null;         // HH:MM
  end_time: string | null;           // HH:MM
  start_km: number | null;
  end_km: number | null;
  section_note: string | null;       // 전차선 단전 구간명 (예: "청도SP~밀양SS")
  tracks: TrackName[] | null;
  block_type: string | null;
  reason: string | null;
  field: string;
  field_confidence: 'high' | 'medium' | 'low';
  route_name: string | null;
  doc_no: string | null;
  dept_head: string | null;
  dept_head_phone: string | null;
  work_supervisor: string | null;
  work_supervisor_phone: string | null;
  safety_manager: string | null;
  safety_manager_phone: string | null;
  electric_safety_manager: string | null;
  electric_safety_manager_phone: string | null;
  contractor: string | null;
  train_watcher: string | null;
  train_watcher_phone: string | null;
  has_equipment: boolean;
  has_labor: boolean;
  needs_review: boolean;
}

// /documents/bulk-parse 응답
export interface BulkParseResult {
  route_name: string | null;
  cover_meta: {
    route_name?: string | null;
    doc_no?: string | null;
    dept_head?: string | null;
    dept_head_phone?: string | null;
    work_supervisor?: string | null;
    work_supervisor_phone?: string | null;
    safety_manager?: string | null;
    safety_manager_phone?: string | null;
    electric_safety_manager?: string | null;
    electric_safety_manager_phone?: string | null;
    contractor?: string | null;
    train_watcher?: string | null;
    train_watcher_phone?: string | null;
    field?: string | null;
  };
  rows: ParsedRow[];
  total: number;
  needs_review_count: number;
  error: string | null;
}

// /block-orders/bulk 요청 한 행
export interface BulkBlockOrderItem {
  route_id: number;
  rail_route_id?: number | null;
  organization_id?: number;
  tracks: TrackName[];
  start_km?: number | null;
  end_km?: number | null;
  start_kp?: number | null;
  end_kp?: number | null;
  section_note?: string | null;  // 전차선 단전 구간명
  work_date: string;
  start_time: string;   // HH:MM
  end_time: string;     // HH:MM
  field: string;
  block_type: string;
  work_type?: string | null;
  has_equipment: boolean;
  has_labor: boolean;
  implementer?: string;
  is_external: boolean;
  doc_no?: string | null;
  dept_head?: string | null;
  dept_head_phone?: string | null;
  work_supervisor: string;
  work_supervisor_phone?: string | null;
  safety_manager: string;
  safety_manager_phone?: string | null;
  electric_safety_manager?: string | null;
  electric_safety_manager_phone?: string | null;
  contractor?: string | null;
  train_watcher?: string | null;
  train_watcher_phone?: string | null;
  reason?: string | null;
  note?: string | null;
}

// /block-orders/bulk 응답
export interface BulkBlockOrderResult {
  saved: number;
  failed: number;
  errors: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export type UserRole = 'system_superuser' | 'org_admin' | 'user';
export type UserField = 'all' | '시설' | '전기' | '건축' | null;

export interface UserInfo {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  field: UserField;
  organization_id: number | null;
  organization_name: string | null;
}
