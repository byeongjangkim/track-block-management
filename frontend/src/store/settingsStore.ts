/**
 * settingsStore — 시스템 설정 전역 상태
 *
 * 앱 시작(App.tsx)에서 loadSettings()로 DB 값을 로드한다.
 * D3 렌더링 코드는 이 store에서 색상 값을 읽어 사용한다.
 * 설정 변경은 새로고침 후 적용된다.
 */
import { create } from 'zustand';
import { fetchAllSettings, type AllSettings, type SettingItem } from '../api/settings';

/** DB 키 → 색상 코드 lookup */
export interface RouteColors {
  highway:        string;   // 고속선
  electrified:    string;   // 일반선 전철화
  nonElectrified: string;   // 일반선 비전철
  catenaryCut:    string;   // 전차선단전 구간
}

export interface BlockColors {
  trackBlock: string;       // 선로차단
  dangerZone: string;       // 위험/보호지구
}

export interface DangerColors {
  levelA: string;
  levelB: string;
  levelC: string;
  none:   string;
}

export interface FacilityColors {
  stationMaster:  string;
  stationGeneral: string;
  stationUnmanned:string;
  signalYard:     string;
  signalPost:     string;
  tunnelBridge:   string;
  substation:     string;
  elecRoom:       string;
  commRoom:       string;
  signalRoom:     string;
  crossing:       string;
  junction:       string;
}

// 기본값 (DB 로드 실패 시 fallback)
export const DEFAULT_ROUTE_COLORS: RouteColors = {
  highway:        '#dc2626',
  electrified:    '#000000',
  nonElectrified: '#9ca3af',
  catenaryCut:    '#16a34a',
};
export const DEFAULT_BLOCK_COLORS: BlockColors = {
  trackBlock: '#ca8a04',
  dangerZone: '#ca8a04',
};
export const DEFAULT_DANGER_COLORS: DangerColors = {
  levelA: '#ef4444',
  levelB: '#f59e0b',
  levelC: '#10b981',
  none:   '#6b7280',
};
export const DEFAULT_FACILITY_COLORS: FacilityColors = {
  stationMaster:  '#1d4ed8',
  stationGeneral: '#3b82f6',
  stationUnmanned:'#60a5fa',
  signalYard:     '#818cf8',
  signalPost:     '#a78bfa',
  tunnelBridge:   '#111111',
  substation:     '#7c3aed',
  elecRoom:       '#0284c7',
  commRoom:       '#16a34a',
  signalRoom:     '#b45309',
  crossing:       '#f59e0b',
  junction:       '#059669',
};

export type StationPointsMode = 'center_only' | 'all_points';

interface SettingsState {
  loaded:             boolean;
  raw:                AllSettings;       // DB 원본 (설정 페이지 편집용)
  routeColors:        RouteColors;
  blockColors:        BlockColors;
  dangerColors:       DangerColors;
  facilityColors:     FacilityColors;
  stationPointsMode:  StationPointsMode; // 역 좌표 모드
  strokeCapZoom:      number;            // 선 두께 포화 배율 (기본 5)
  loadSettings:       () => Promise<void>;
}

function pick(items: SettingItem[] | undefined, key: string, fallback: string): string {
  return items?.find(i => i.key === key)?.value ?? fallback;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded:            false,
  raw:               {},
  routeColors:       DEFAULT_ROUTE_COLORS,
  blockColors:       DEFAULT_BLOCK_COLORS,
  dangerColors:      DEFAULT_DANGER_COLORS,
  facilityColors:    DEFAULT_FACILITY_COLORS,
  stationPointsMode: 'center_only',
  strokeCapZoom:     5,

  loadSettings: async () => {
    try {
      const data = await fetchAllSettings();
      const rc = data.route_colors;
      const bc = data.block_colors;
      const dc = data.danger_colors;
      const fc = data.facility_colors;
      const ms = data.map_settings;
      const rawMode = ms?.find(i => i.key === 'station_points_mode')?.value;
      const stationMode: StationPointsMode =
        rawMode === 'all_points' ? 'all_points' : 'center_only';

      const rawCap = ms?.find(i => i.key === 'stroke_cap_zoom')?.value;
      const strokeCapZoom = rawCap ? Math.min(20, Math.max(2, parseFloat(rawCap) || 5)) : 5;

      set({
        loaded: true,
        raw:    data,
        stationPointsMode: stationMode,
        strokeCapZoom,
        routeColors: {
          highway:        pick(rc, 'highway',         DEFAULT_ROUTE_COLORS.highway),
          electrified:    pick(rc, 'electrified',     DEFAULT_ROUTE_COLORS.electrified),
          nonElectrified: pick(rc, 'non_electrified', DEFAULT_ROUTE_COLORS.nonElectrified),
          catenaryCut:    pick(rc, 'catenary_cut',    DEFAULT_ROUTE_COLORS.catenaryCut),
        },
        blockColors: {
          trackBlock: pick(bc, 'track_block', DEFAULT_BLOCK_COLORS.trackBlock),
          dangerZone: pick(bc, 'danger_zone', DEFAULT_BLOCK_COLORS.dangerZone),
        },
        dangerColors: {
          levelA: pick(dc, 'level_a', DEFAULT_DANGER_COLORS.levelA),
          levelB: pick(dc, 'level_b', DEFAULT_DANGER_COLORS.levelB),
          levelC: pick(dc, 'level_c', DEFAULT_DANGER_COLORS.levelC),
          none:   pick(dc, 'none',    DEFAULT_DANGER_COLORS.none),
        },
        facilityColors: {
          stationMaster:   pick(fc, 'station_master',   DEFAULT_FACILITY_COLORS.stationMaster),
          stationGeneral:  pick(fc, 'station_general',  DEFAULT_FACILITY_COLORS.stationGeneral),
          stationUnmanned: pick(fc, 'station_unmanned', DEFAULT_FACILITY_COLORS.stationUnmanned),
          signalYard:      pick(fc, 'signal_yard',      DEFAULT_FACILITY_COLORS.signalYard),
          signalPost:      pick(fc, 'signal_post',      DEFAULT_FACILITY_COLORS.signalPost),
          tunnelBridge:    pick(fc, 'tunnel_bridge',    DEFAULT_FACILITY_COLORS.tunnelBridge),
          substation:      pick(fc, 'substation',       DEFAULT_FACILITY_COLORS.substation),
          elecRoom:        pick(fc, 'elec_room',        DEFAULT_FACILITY_COLORS.elecRoom),
          commRoom:        pick(fc, 'comm_room',        DEFAULT_FACILITY_COLORS.commRoom),
          signalRoom:      pick(fc, 'signal_room',      DEFAULT_FACILITY_COLORS.signalRoom),
          crossing:        pick(fc, 'crossing',         DEFAULT_FACILITY_COLORS.crossing),
          junction:        pick(fc, 'junction',         DEFAULT_FACILITY_COLORS.junction),
        },
      });
    } catch {
      // 로드 실패 시 기본값 유지
      set({ loaded: true });
    }
  },
}));
