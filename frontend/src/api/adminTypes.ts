export interface FacilityResponse {
  id: number;
  route_id: number;
  type: string;           // 대분류: 역 | 변전소 | 구조물 | 소속경계
  station_type: string | null;  // 소분류: 관리역/보통역/무인역/신호장/신호소 | ss/sp/ssp/atp/pp | 터널/교량/과선교/건널목/분기 | 지역본부/사업소
  name: string;
  km: number;
  km_end: number | null;
  lat: number | null;
  lon: number | null;
  lat_end: number | null;
  lon_end: number | null;
  direction: string | null;   // UP | DOWN | BOTH | null
  has_station_map: boolean;
  use_as_anchor: boolean;
  note: string | null;
  boundary: string | null;   // 본부 | 시설 | 전기 | 건축 | null
}
