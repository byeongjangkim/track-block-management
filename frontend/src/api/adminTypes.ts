export interface FacilityResponse {
  id: number;
  route_id: number;
  type: string;
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
