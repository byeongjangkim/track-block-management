export type Direction = 'UP' | 'DOWN';

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
  start_station: string | null;   // 시점역명 (km=0.0 기준역)
  end_station: string | null;     // 종점역명
  up_direction: string | null;    // 상선 방향 표시 (예: "서울 방향")
  down_direction: string | null;  // 하선 방향 표시 (예: "부산 방향")
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
  direction: Direction;
  start_km: number | null;
  end_km: number | null;
  start_kp: number | null;
  end_kp: number | null;
  section_note: string | null;
  start_facility_id: number | null;
  end_facility_id: number | null;
  work_date: string;      // YYYY-MM-DD
  start_time: string;     // HH:mm:ss
  end_time: string;
  field: string;
  block_type: string;
  has_equipment: boolean;
  has_labor: boolean;
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
  document_path: string | null;
  note: string | null;
  created_by: number;
}

export interface BlockOrderCreate {
  route_id: number;
  rail_route_id?: number | null;
  organization_id?: number;
  direction: Direction;
  start_km: number | null;
  end_km: number | null;
  start_kp?: number | null;
  end_kp?: number | null;
  section_note?: string;
  start_facility_id?: number | null;
  end_facility_id?: number | null;
  work_date: string;
  start_time: string;
  end_time: string;
  field: string;
  block_type: string;
  has_equipment: boolean;
  has_labor: boolean;
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
  direction: 'UP' | 'DOWN' | null;
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
  direction: 'UP' | 'DOWN' | null;
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
  direction: 'UP' | 'DOWN';
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
  has_equipment: boolean;
  has_labor: boolean;
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
