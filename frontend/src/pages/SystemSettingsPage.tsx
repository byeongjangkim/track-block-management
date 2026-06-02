/**
 * SystemSettingsPage — 시스템 설정 (system_superuser 전용)
 *
 * 색상 변경 후 [저장] → DB에 저장
 * 페이지 새로고침 후 지도에 반영됨
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAllSettings,
  updateSetting,
  resetSetting,
  resetAllSettings,
  type SettingItem,
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

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function SystemSettingsPage() {
  const qc = useQueryClient();
  const [savedMsg, setSavedMsg] = useState('');

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
