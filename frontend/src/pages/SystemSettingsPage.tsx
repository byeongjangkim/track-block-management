/**
 * SystemSettingsPage — 시스템 설정 (system_superuser 전용)
 *
 * 색상 변경 후 [저장] → DB에 저장
 * 페이지 새로고침 후 지도에 반영됨
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../store/settingsStore';
import {
  fetchAllSettings,
  updateSetting,
  resetSetting,
  resetAllSettings,
  type SettingItem,
  type AllSettings,
} from '../api/settings';

const CATEGORY_LABELS: Record<string, string> = {
  route_colors:    '노선 색상',
  block_colors:    '차단구간 색상',
  danger_colors:   '위험등급 색상',
  facility_colors: '시설물 색상',
};

const CATEGORY_ORDER = ['route_colors', 'block_colors', 'danger_colors', 'facility_colors'];

// ── 단일 색상 설정 행 ────────────────────────────────────────────────────────

function SettingRow({
  category,
  item,
  onSaved,
}: {
  category: string;
  item: SettingItem;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [localColor, setLocalColor] = useState(item.value);
  const isDirty = localColor !== item.value;

  const saveMut = useMutation({
    mutationFn: () => updateSetting(category, item.key, localColor),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['system-settings'] }); onSaved(); },
  });
  const resetMut = useMutation({
    mutationFn: () => resetSetting(category, item.key),
    onSuccess: () => {
      setLocalColor(item.default_value);
      qc.invalidateQueries({ queryKey: ['system-settings'] });
      onSaved();
    },
  });

  const isDefault = item.value === item.default_value;

  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="px-4 py-3 text-sm font-medium text-gray-800">{item.label}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{item.description ?? '—'}</td>

      {/* 현재 저장된 색상 */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded border border-gray-200 shadow-sm shrink-0"
            style={{ backgroundColor: item.value }} />
          <span className="text-xs font-mono text-gray-600">{item.value}</span>
        </div>
      </td>

      {/* 색상 편집 */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={localColor}
            onChange={(e) => setLocalColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-gray-200"
          />
          <input
            type="text"
            value={localColor}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setLocalColor(v);
            }}
            maxLength={7}
            className="w-20 border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </td>

      {/* 기본값 */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded border border-gray-200 shrink-0"
            style={{ backgroundColor: item.default_value }} />
          <span className="text-xs font-mono text-gray-400">{item.default_value}</span>
        </div>
      </td>

      {/* 액션 */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => saveMut.mutate()}
            disabled={!isDirty || saveMut.isPending || !/^#[0-9a-fA-F]{6}$/.test(localColor)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              isDirty && /^#[0-9a-fA-F]{6}$/.test(localColor)
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saveMut.isPending ? '저장 중…' : '저장'}
          </button>
          {!isDefault && (
            <button
              onClick={() => { if (confirm(`'${item.label}'을 기본값(${item.default_value})으로 복원하시겠습니까?`)) resetMut.mutate(); }}
              disabled={resetMut.isPending}
              className="px-2 py-1 text-xs border rounded text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              복원
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── 카테고리 섹션 ─────────────────────────────────────────────────────────────

function CategorySection({
  category,
  items,
  onSaved,
}: {
  category: string;
  items: SettingItem[];
  onSaved: () => void;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-gray-700 mb-3 border-b pb-2">
        {CATEGORY_LABELS[category] ?? category}
      </h2>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-4 py-2 text-xs text-gray-500 font-medium w-32">항목</th>
            <th className="px-4 py-2 text-xs text-gray-500 font-medium">설명</th>
            <th className="px-4 py-2 text-xs text-gray-500 font-medium w-36">현재 색상</th>
            <th className="px-4 py-2 text-xs text-gray-500 font-medium w-44">변경</th>
            <th className="px-4 py-2 text-xs text-gray-500 font-medium w-32">기본값</th>
            <th className="px-4 py-2 text-xs text-gray-500 font-medium w-28"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <SettingRow key={item.key} category={category} item={item} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 선 두께 포화 배율 서브섹션 ───────────────────────────────────────────────

function StrokeCapZoomSection({
  currentValue,
  onSaved,
}: {
  currentValue: number;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(currentValue);
  const isDirty = value !== currentValue;

  const saveMut = useMutation({
    mutationFn: () => updateSetting('map_settings', 'stroke_cap_zoom', String(value)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['system-settings'] }); onSaved(); },
  });
  const resetMut = useMutation({
    mutationFn: () => resetSetting('map_settings', 'stroke_cap_zoom'),
    onSuccess: () => {
      setValue(5);
      qc.invalidateQueries({ queryKey: ['system-settings'] });
      onSaved();
    },
  });

  // 슬라이더 값별 화면 픽셀 미리보기 계산
  const routePx  = (0.4 * value).toFixed(1);
  const blockPx  = (0.7 * value).toFixed(1);

  return (
    <div className="mt-6 pt-5 border-t border-gray-100">
      <p className="text-sm font-medium text-gray-800 mb-1">선 두께 포화 배율 (k)</p>
      <p className="text-xs text-gray-500 mb-4">
        이 줌 배율(k) 이상에서 노선·차단선의 화면 픽셀 두께가 고정됩니다.<br />
        낮을수록 더 일찍 두께가 고정되어 얇게 유지됩니다 (권장: 3~8).
      </p>

      <div className="flex items-center gap-5">
        {/* 슬라이더 */}
        <div className="flex-1">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>얇음 (k=2)</span>
            <span className="font-semibold text-blue-600">현재 k={value}</span>
            <span>두꺼움 (k=20)</span>
          </div>
          <input
            type="range"
            min={2} max={20} step={0.5}
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value))}
            className="w-full accent-blue-600"
          />
          {/* 눈금 표시 */}
          <div className="flex justify-between text-xs text-gray-300 mt-0.5 px-0.5">
            {[2,4,6,8,10,12,14,16,18,20].map(v => (
              <span key={v} className={v === Math.round(value) ? 'text-blue-400 font-bold' : ''}>{v}</span>
            ))}
          </div>
        </div>

        {/* 미리보기 */}
        <div className="shrink-0 bg-gray-50 border rounded-lg px-4 py-3 text-xs text-center w-36">
          <div className="text-gray-500 mb-2">k={value} 이상 고정</div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div style={{ height: `${Math.min(8, parseFloat(routePx))}px`, width: 40, backgroundColor: '#1e40af', borderRadius: 2 }} />
              <span className="text-gray-600">노선 {routePx}px</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ height: `${Math.min(8, parseFloat(blockPx))}px`, width: 40, backgroundColor: '#ca8a04', borderRadius: 2 }} />
              <span className="text-gray-600">차단 {blockPx}px</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => saveMut.mutate()}
          disabled={!isDirty || saveMut.isPending}
          className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
            isDirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saveMut.isPending ? '저장 중…' : '저장'}
        </button>
        {currentValue !== 5 && (
          <button
            onClick={() => { if (confirm('기본값(5)으로 복원하시겠습니까?')) resetMut.mutate(); }}
            disabled={resetMut.isPending}
            className="px-3 py-1.5 text-sm border rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            기본값(5) 복원
          </button>
        )}
      </div>
    </div>
  );
}

// ── 지도 설정 섹션 ────────────────────────────────────────────────────────────

function MapSettingsSection({
  currentMode,
  settings,
  onSaved,
}: {
  currentMode: 'center_only' | 'all_points';
  settings: AllSettings | undefined;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'center_only' | 'all_points'>(currentMode);
  const isDirty = mode !== currentMode;

  const saveMut = useMutation({
    mutationFn: () => updateSetting('map_settings', 'station_points_mode', mode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['system-settings'] }); onSaved(); },
  });
  const resetMut = useMutation({
    mutationFn: () => resetSetting('map_settings', 'station_points_mode'),
    onSuccess: () => {
      setMode('center_only');
      qc.invalidateQueries({ queryKey: ['system-settings'] });
      onSaved();
    },
  });

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-gray-700 mb-3 border-b pb-2">지도 설정</h2>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800 mb-1">역 좌표 모드</p>
            <p className="text-xs text-gray-500 mb-4">
              노선도를 그릴 때 사용할 역 GPS 좌표 범위를 선택합니다.<br />
              시점·종점 좌표를 포함하면 실제 선형에 더 가깝지만,
              곡선 반경 데이터 없이 직선 보간되어 예상치 못한 굴곡이 발생할 수 있습니다.
            </p>

            <div className="flex gap-4">
              {/* center_only */}
              <label className={`flex-1 flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                mode === 'center_only'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}>
                <input
                  type="radio"
                  name="station_mode"
                  value="center_only"
                  checked={mode === 'center_only'}
                  onChange={() => setMode('center_only')}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <div className="text-sm font-semibold text-gray-800">
                    역 중심 좌표만
                    <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">기본값</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    역 중앙(center) GPS 좌표만 사용하여 보간합니다.<br />
                    불필요한 굴곡 없이 자연스러운 노선도가 표시됩니다.
                  </div>
                </div>
              </label>

              {/* all_points */}
              <label className={`flex-1 flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                mode === 'all_points'
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}>
                <input
                  type="radio"
                  name="station_mode"
                  value="all_points"
                  checked={mode === 'all_points'}
                  onChange={() => setMode('all_points')}
                  className="mt-0.5 accent-orange-600"
                />
                <div>
                  <div className="text-sm font-semibold text-gray-800">
                    시점·중앙·종점 모두
                    <span className="ml-2 text-xs font-normal text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded">고급</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    역의 시점·종점 좌표도 포함해 보간합니다.<br />
                    곡선 반경 미적용 구간에서 굴곡이 발생할 수 있습니다.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-8 shrink-0">
            <button
              onClick={() => saveMut.mutate()}
              disabled={!isDirty || saveMut.isPending}
              className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                isDirty
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {saveMut.isPending ? '저장 중…' : '저장'}
            </button>
            {currentMode !== 'center_only' && (
              <button
                onClick={() => { if (confirm('기본값(역 중심 좌표만)으로 복원하시겠습니까?')) resetMut.mutate(); }}
                disabled={resetMut.isPending}
                className="px-4 py-2 text-sm border rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                기본값 복원
              </button>
            )}
          </div>
        </div>

        {/* 선 두께 포화 배율 슬라이더 */}
        <StrokeCapZoomSection
          currentValue={parseFloat(settings?.map_settings?.find(i => i.key === 'stroke_cap_zoom')?.value ?? '5') || 5}
          onSaved={onSaved}
        />
      </div>
    </section>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function SystemSettingsPage() {
  const qc = useQueryClient();
  const [savedMsg, setSavedMsg] = useState('');
  const { loadSettings } = useSettingsStore();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: fetchAllSettings,
    staleTime: Infinity,
  });

  const resetAllMut = useMutation({
    mutationFn: resetAllSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-settings'] });
      flash('모든 설정이 기본값으로 복원되었습니다.');
    },
  });

  function flash(msg: string) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 3000);
  }

  return (
    <div className="h-full overflow-auto p-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">시스템 설정</h1>
          <p className="text-sm text-gray-500 mt-1">
            지도에 표시되는 색상을 설정합니다.
            <strong className="text-amber-600 ml-1">⚠ 설정 저장 후 페이지를 새로고침해야 지도에 반영됩니다.</strong>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedMsg && (
            <span className="text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded border border-green-200">
              ✓ {savedMsg}
            </span>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            새로고침 (지도 반영)
          </button>
          <button
            onClick={() => {
              if (confirm('모든 설정을 기본값으로 복원하시겠습니까?')) resetAllMut.mutate();
            }}
            disabled={resetAllMut.isPending}
            className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            전체 기본값 복원
          </button>
        </div>
      </div>

      {/* 설명 박스 */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6 text-sm text-blue-800">
        <ul className="list-disc list-inside space-y-1">
          <li>각 항목의 색상 피커 또는 HEX 코드(#RRGGBB)로 색상을 지정하세요.</li>
          <li><strong>저장</strong> 버튼을 누르면 DB에 저장되며, <strong>새로고침</strong> 후 지도에 적용됩니다.</li>
          <li><strong>복원</strong> 버튼은 해당 항목만 기본값으로 되돌립니다.</li>
          <li><strong>전체 기본값 복원</strong>은 모든 설정을 초기값으로 되돌립니다.</li>
        </ul>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400">설정을 불러오는 중...</div>
      ) : (
        <>
          {CATEGORY_ORDER.map((cat) => {
            const items = (settings as Record<string, SettingItem[]>)?.[cat];
            if (!items || items.length === 0) return null;
            return (
              <CategorySection
                key={cat}
                category={cat}
                items={items}
                onSaved={() => flash('저장되었습니다.')}
              />
            );
          })}

          {/* 지도 설정 — 역 좌표 모드 */}
          <MapSettingsSection
            currentMode={(settings?.map_settings?.find(i => i.key === 'station_points_mode')?.value ?? 'center_only') as 'center_only' | 'all_points'}
            settings={settings}
            onSaved={async () => {
              qc.invalidateQueries({ queryKey: ['system-settings'] });
              await loadSettings();
              flash('저장되었습니다. 새로고침 후 지도에 반영됩니다.');
            }}
          />

          {/* 시설물 아이콘 이미지 (Phase 2 예정) */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-gray-700 mb-3 border-b pb-2 flex items-center gap-2">
              시설물 아이콘 이미지
              <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-700 font-normal">
                Phase 2 예정
              </span>
            </h2>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
              시설물 아이콘을 커스텀 이미지(SVG/PNG)로 교체하는 기능은 향후 Phase 2에서 제공됩니다.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
