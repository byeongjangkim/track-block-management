import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';

interface Section {
  id: string;
  title: string;
  sub?: { id: string; title: string }[];
}

const SECTIONS: Section[] = [
  { id: 'overview', title: '시스템 개요' },
  {
    id: 'block-map', title: '차단현황도',
    sub: [
      { id: 'map-navigation', title: '지도 조작' },
      { id: 'map-legend',     title: '노선 표시 기호' },
      { id: 'map-block',      title: '차단작업 표시' },
      { id: 'map-select',     title: '작업 선택 및 상세' },
    ],
  },
  {
    id: 'block-orders', title: '차단명령',
    sub: [
      { id: 'bo-list',   title: '목록 조회' },
      { id: 'bo-create', title: '수동 등록' },
      { id: 'bo-pdf',    title: 'PDF 일괄등록' },
      { id: 'bo-edit',   title: '수정·삭제' },
    ],
  },
  { id: 'calendar', title: '캘린더' },
  {
    id: 'reference', title: '기준정보 관리',
    sub: [
      { id: 'ref-routes',    title: '노선원장' },
      { id: 'ref-stations',  title: '역/KP 관리' },
      { id: 'ref-facilities','title': '시설물 관리' },
      { id: 'ref-boundary',  title: '담당구역 관리' },
    ],
  },
  {
    id: 'system', title: '시스템 관리',
    sub: [
      { id: 'sys-users',    title: '사용자 관리' },
      { id: 'sys-settings', title: '시스템 설정' },
    ],
  },
  { id: 'roles', title: '권한 안내' },
];

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'orange' | 'gray' | 'purple' | 'red' }) {
  const cls: Record<string, string> = {
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    orange: 'bg-orange-100 text-orange-700',
    gray:   'bg-gray-100 text-gray-600',
    purple: 'bg-purple-100 text-purple-700',
    red:    'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls[color]}`}>
      {children}
    </span>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 border-b-2 border-blue-600 pb-2 mb-5 mt-10 first:mt-0 scroll-mt-16">
      {children}
    </h2>
  );
}

function SubTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-base font-semibold text-gray-800 mt-6 mb-3 scroll-mt-16">
      {children}
    </h3>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 my-3">
      {children}
    </div>
  );
}

function WarnBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-yellow-50 border border-yellow-300 rounded-lg px-4 py-3 text-sm text-yellow-800 my-3">
      {children}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 my-2">
      <span className="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-auto my-4">
      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-700 border-b border-gray-100 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HelpPage() {
  const { user } = useAuthStore();
  const isAdmin     = user?.role === 'org_admin' || user?.role === 'system_superuser';
  const isSuperuser = user?.role === 'system_superuser';

  const contentRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState('overview');

  // 스크롤 감지 → 목차 활성 항목 업데이트
  useEffect(() => {
    const allIds = SECTIONS.flatMap((s) => [s.id, ...(s.sub?.map((sub) => sub.id) ?? [])]);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    allIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className="flex h-full bg-white overflow-hidden">
      {/* 좌측 목차 */}
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto py-4">
        <div className="px-4 mb-4">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">목차</span>
        </div>
        <nav className="space-y-0.5 px-2">
          {SECTIONS.map((sec) => {
            const isHidden = (sec.id === 'reference' && !isAdmin) ||
                             (sec.id === 'system' && !isSuperuser);
            if (isHidden) return null;
            return (
              <div key={sec.id}>
                <button
                  onClick={() => scrollTo(sec.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors ${
                    activeId === sec.id
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {sec.title}
                </button>
                {sec.sub?.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => scrollTo(sub.id)}
                    className={`w-full text-left pl-7 pr-3 py-1 text-xs rounded transition-colors ${
                      activeId === sub.id
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {sub.title}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* 우측 본문 */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-10 py-8 max-w-4xl">

        {/* ── 1. 시스템 개요 ───────────────────────────────────────── */}
        <SectionTitle id="overview">시스템 개요</SectionTitle>

        <p className="text-sm text-gray-700 leading-relaxed mb-4">
          <strong>선로차단작업 관리 시스템</strong>은 KORAIL 전국 선로차단작업 승인 내역을
          통합 관리하는 웹 애플리케이션입니다. 지역본부 12개·사업단 2개 등 14개 조직이
          전국 153개 노선의 차단작업을 단일 시스템에서 등록·조회·관리합니다.
        </p>

        <Table
          headers={['기능', '설명']}
          rows={[
            ['차단현황도', '전국 노선도 위에 당일 차단작업을 시각화하는 지도 화면'],
            ['차단명령', '차단명령 목록 조회 및 등록·수정·삭제'],
            ['캘린더', '월별 차단작업 일정 현황 확인'],
            ['기준정보 관리', '노선·역·시설물·담당구역 등 기준 데이터 관리 (관리자)'],
            ['시스템 관리', '사용자 계정·시스템 설정 관리 (최고관리자)'],
          ]}
        />

        <InfoBox>
          사내망 PC 브라우저(Chrome 권장, 화면 너비 1,280px 이상)에서 사용하도록 설계되었습니다.
        </InfoBox>

        {/* ── 2. 차단현황도 ──────────────────────────────────────────── */}
        <SectionTitle id="block-map">차단현황도</SectionTitle>

        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          전국 철도 노선도 위에 선택한 날짜의 차단작업을 실시간으로 표시합니다.
          상단의 날짜 선택기로 조회일을 변경하고, 노선 필터로 특정 노선만 강조할 수 있습니다.
        </p>

        <SubTitle id="map-navigation">지도 조작</SubTitle>
        <Table
          headers={['조작', '방법']}
          rows={[
            ['확대/축소', '마우스 휠 스크롤 또는 화면 좌측 +/− 버튼'],
            ['이동', '마우스 왼쪽 버튼 드래그'],
            ['전국 보기', '화면 좌측 홈(⌂) 버튼 클릭'],
            ['노선 이동', '차단 배지(축소 보기) 클릭 → 해당 구간으로 자동 이동·확대'],
          ]}
        />

        <SubTitle id="map-legend">노선 표시 기호</SubTitle>
        <Table
          headers={['색상', '의미']}
          rows={[
            [<span key="1" className="flex items-center gap-2"><span className="inline-block w-8 h-1.5 rounded bg-red-600" /> 빨강</span>, '고속선 (KTX)'],
            [<span key="2" className="flex items-center gap-2"><span className="inline-block w-8 h-1.5 rounded bg-black" /> 검정</span>, '일반선 — 전철화 구간'],
            [<span key="3" className="flex items-center gap-2"><span className="inline-block w-8 h-1.5 rounded bg-gray-400" /> 회색</span>, '일반선 — 비전철 구간'],
            [<span key="4" className="flex items-center gap-2"><span className="inline-block w-4 h-1.5 rounded bg-gray-800 mr-1" /><span className="inline-block w-4 h-1.5 rounded bg-gray-800" /></span>, '터널 (사각 윤곽)'],
            [<span key="5" className="flex items-center gap-2"><span className="text-gray-700 text-xs font-mono">] [</span></span>, '교량·과선교 (양끝 브래킷)'],
          ]}
        />
        <InfoBox>
          노선 색상은 시스템 설정에서 변경할 수 있습니다. 변경 후 새로고침하면 지도에 반영됩니다.
        </InfoBox>

        <p className="text-sm text-gray-700 mt-3 mb-1">
          줌 배율 3 이상에서는 복선 노선의 <strong>상선과 하선이 분리</strong>되어 표시됩니다.
        </p>
        <Table
          headers={['분야', '마커', '의미']}
          rows={[
            ['시설', <span key="1"><span className="text-yellow-600 font-bold">◆</span> 노란 다이아몬드</span>, '시설 분야 차단작업 위치'],
            ['전기', <span key="2"><span className="text-green-600 font-bold">◆</span> 녹색 다이아몬드</span>, '전기 분야 차단작업 위치'],
            ['건축', <span key="3"><span className="text-purple-700 font-bold">◆</span> 보라 다이아몬드</span>, '건축 분야 차단작업 위치'],
          ]}
        />

        <SubTitle id="map-block">차단작업 표시</SubTitle>
        <Table
          headers={['작업 유형', '표시 위치', '표시 방법']}
          rows={[
            ['선로차단', '해당 선로 위', '노란 굵은 실선'],
            ['전차선단전', '해당 선로 위', '녹색 실선 (더 긴 구간)'],
            ['작업구간설정', '최외방 선로 바깥 (1단계)', '노란 가는 실선'],
            ['보호지구작업', '최외방 선로 바깥 (2단계)', '노란 사각형 + 사선 해칭'],
            ['임시완속·속도제한', '해당 선로 위', '노란 점선'],
          ]}
        />
        <WarnBox>
          줌 배율이 낮을 때(전국 보기)는 차단작업이 노선별 <strong>집계 배지</strong>로 표시됩니다.
          배지를 클릭하면 해당 노선으로 확대 이동합니다.
        </WarnBox>

        <SubTitle id="map-select">작업 선택 및 상세</SubTitle>
        <Step n={1}>지도에서 차단작업 선분(노란선/녹색선) 또는 분야 마커(◆)를 클릭합니다.</Step>
        <Step n={2}>화면 우측 사이드바에 선택한 작업의 상세 정보가 표시됩니다.</Step>
        <Step n={3}>
          같은 <strong>문서번호(doc_no)</strong>를 가진 차단작업은 사업 묶음으로 함께 강조됩니다.
          선택된 건 기준 ±45일의 연속작업이 있으면 자동으로 표시됩니다.
        </Step>
        <Step n={4}>선분이 없는 빈 영역을 클릭하면 선택이 해제됩니다.</Step>

        {/* ── 3. 차단명령 ──────────────────────────────────────────── */}
        <SectionTitle id="block-orders">차단명령</SectionTitle>

        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          차단명령 등록·수정·삭제 및 전체 목록을 조회하는 화면입니다.
        </p>

        <SubTitle id="bo-list">목록 조회</SubTitle>
        <Table
          headers={['필터', '설명']}
          rows={[
            ['날짜 범위', '작업 시작일 기준으로 조회 범위 지정'],
            ['노선', '특정 노선의 차단명령만 표시'],
            ['분야', '시설·전기·건축 분야별 필터'],
            ['작업 유형', '선로차단·전차선단전 등 block_type 필터'],
            ['키워드 검색', '노선명·구간·담당자 등 텍스트 검색'],
          ]}
        />

        <SubTitle id="bo-create">수동 등록</SubTitle>
        <InfoBox>
          org_admin 이상 권한이 있어야 차단명령을 등록할 수 있습니다.
          자기 조직의 관할 구간 내 노선만 등록할 수 있습니다.
        </InfoBox>

        <Step n={1}>"등록" 버튼을 클릭하여 등록 폼을 엽니다.</Step>
        <Step n={2}>
          <strong>기본정보</strong>: 노선, 선로(상선/하선 또는 T번호), 구간(시작·종료 KP),
          작업일·시간을 입력합니다.
        </Step>
        <Step n={3}>
          <strong>분류</strong>: 분야(시설/전기/건축), 작업 유형(선로차단·전차선단전 등),
          작업 방법(인력/장비/기계)을 선택합니다.
        </Step>
        <Step n={4}>
          <strong>보호조치</strong>(필요 시): 투입장비, 열차서행 속도·구간,
          전차선 보호장치(양단접지/단접지)를 입력합니다.
          고속선인 경우 ZEP·ZCP·CPT·TZEP 코드를 추가 입력합니다.
        </Step>
        <Step n={5}>
          <strong>담당자·안전관리</strong>: 부서장, 작업책임자, 안전관리자, 열차감시원,
          안전관리 항목, 작업자 수를 입력합니다.
        </Step>
        <Step n={6}>"저장" 버튼을 클릭하면 차단명령이 등록되고 지도에 반영됩니다.</Step>

        <p className="text-sm text-gray-700 mt-4 mb-1 font-medium">대표명령 계층 구조</p>
        <p className="text-sm text-gray-600 mb-2">
          여러 하위 작업(선로차단·전차선단전 등)을 하나의 대표명령 아래 묶을 수 있습니다.
          등록 시 상위 대표명령을 지정하면 계층 관계가 형성됩니다.
        </p>
        <Table
          headers={['구분', '설명']}
          rows={[
            ['대표명령', '작업 계획 전체를 대표하는 상위 명령 (block_type: 대표명령)'],
            ['하위작업', '실제 선로차단·전차선단전 등 개별 작업 (parent_id로 대표명령 연결)'],
          ]}
        />

        <SubTitle id="bo-pdf">PDF 일괄등록</SubTitle>
        <InfoBox>
          org_admin 이상 권한이 있을 때 차단명령 목록 상단의 <strong>"PDF 일괄등록"</strong> 버튼이 표시됩니다.
          KORAIL 차단명령 승인문서(시행문·세부내역) PDF 파일을 업로드하면 일정표를 자동으로 파싱하여 일괄 등록합니다.
        </InfoBox>

        <p className="text-sm font-medium text-gray-700 mt-3 mb-2">준비 파일</p>
        <Table
          headers={['파일', '내용', '필수 여부']}
          rows={[
            [
              '시행문 PDF',
              '작업책임자·안전관리자·시공사·문서번호 등 담당자 정보 포함',
              '권장 (없어도 진행 가능)',
            ],
            [
              '세부내역 PDF',
              '날짜·시각·구간(KP)·선로·사유 등 차단 일정 표 포함',
              '필수 (핵심 파일)',
            ],
          ]}
        />

        <p className="text-sm font-medium text-gray-700 mt-4 mb-2">등록 절차 — 3단계</p>

        <div className="border border-gray-200 rounded-lg overflow-hidden my-3 text-sm">
          <div className="bg-blue-50 px-4 py-2 font-medium text-blue-700 border-b border-gray-200">
            ① 파일 선택
          </div>
          <div className="px-4 py-3 space-y-2">
            <Step n={1}>차단명령 목록 화면에서 <strong>"PDF 일괄등록"</strong> 버튼을 클릭합니다.</Step>
            <Step n={2}><strong>시행문 PDF</strong>와 <strong>세부내역 PDF</strong>를 각각 업로드합니다.
              세부내역 PDF만 있어도 일정 등록이 가능하며, 시행문을 함께 올리면 담당자 정보가 자동 입력됩니다.</Step>
            <Step n={3}><strong>노선 확인</strong>: PDF에서 자동 감지된 노선을 확인하고 필요 시 직접 선택합니다.</Step>
            <Step n={4}><strong>"다음 →"</strong> 버튼을 클릭하면 PDF를 분석합니다. (수 초 소요)</Step>
          </div>

          <div className="bg-blue-50 px-4 py-2 font-medium text-blue-700 border-b border-t border-gray-200">
            ② 내용 확인 및 수정
          </div>
          <div className="px-4 py-3 space-y-2">
            <Step n={1}>파싱된 차단명령 목록이 표로 표시됩니다. 각 행이 차단명령 1건입니다.</Step>
            <Step n={2}>
              <strong className="text-orange-600">주황색 행</strong>은 자동 인식에 실패한 항목입니다 —
              선로·KP 등 누락 정보를 직접 수정한 뒤 체크박스를 켭니다.
              수정 없이 등록하지 않으려면 체크박스를 해제합니다.
            </Step>
            <Step n={3}>
              각 셀을 클릭하여 직접 수정할 수 있는 항목:
              <ul className="list-disc list-inside text-gray-600 mt-1 ml-2 space-y-0.5">
                <li>노선 — 드롭다운 선택</li>
                <li>선로(방향) — 상선/하선/상1/하1 등 선택</li>
                <li>작업일자, 시작·종료 시각</li>
                <li>시작·종료 KP(km)</li>
                <li>분야 — 시설/전기/건축 (주황색 표시는 자동 감지 신뢰도 낮음)</li>
              </ul>
            </Step>
            <Step n={4}>"전체 선택/해제"로 일괄 선택을 조정할 수 있습니다.</Step>
            <Step n={5}><strong>"선택 항목 저장 (N건)"</strong> 버튼을 클릭하여 등록을 완료합니다.</Step>
          </div>

          <div className="bg-blue-50 px-4 py-2 font-medium text-blue-700 border-b border-t border-gray-200">
            ③ 저장 결과 확인
          </div>
          <div className="px-4 py-3 space-y-2">
            <Step n={1}>저장된 건수와 실패한 건수가 표시됩니다.</Step>
            <Step n={2}>실패한 항목이 있으면 실패 사유가 목록으로 표시됩니다. 수동 등록으로 보완합니다.</Step>
            <Step n={3}>"닫기"를 클릭하면 차단명령 목록에 등록된 내역이 반영됩니다.</Step>
          </div>
        </div>

        <WarnBox>
          <strong>선로(방향) 자동 인식 한계:</strong> PDF 표에 "단선", "구내"로 기재된 경우
          자동으로 "상선"으로 임시 설정됩니다. 반드시 내용 확인 단계(②)에서 실제 선로를 확인·수정하세요.
        </WarnBox>
        <WarnBox>
          <strong>전차선 단전(단전구간):</strong> 역간 구간명(예: 청도SP~밀양SS)으로만 기재된 경우
          KP는 비워지고 구간명으로 저장됩니다. 이 경우 지도에 선분이 표시되지 않을 수 있습니다.
        </WarnBox>

        <SubTitle id="bo-edit">수정·삭제</SubTitle>
        <Step n={1}>목록에서 수정할 차단명령의 행을 클릭하거나 수정 버튼을 누릅니다.</Step>
        <Step n={2}>내용을 수정한 후 "저장"을 클릭합니다.</Step>
        <Step n={3}>삭제는 상세 화면에서 "삭제" 버튼을 클릭하면 확인 후 삭제됩니다.</Step>
        <WarnBox>
          삭제된 차단명령은 복구할 수 없습니다. 신중하게 처리하세요.
        </WarnBox>

        {/* ── 4. 캘린더 ────────────────────────────────────────────── */}
        <SectionTitle id="calendar">캘린더</SectionTitle>

        <p className="text-sm text-gray-700 leading-relaxed">
          월별 차단작업 일정을 캘린더 형태로 확인합니다.
          각 날짜 셀에 해당 날짜의 차단작업 건수가 표시되며,
          날짜를 클릭하면 해당일의 차단명령 목록으로 이동합니다.
        </p>

        {/* ── 5. 기준정보 관리 ─────────────────────────────────────── */}
        {isAdmin && (
          <>
            <SectionTitle id="reference">기준정보 관리</SectionTitle>

            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              노선·역·시설물·담당구역 등 시스템 운영의 기반이 되는 기준 데이터를 관리합니다.
              org_admin 이상 권한이 필요합니다.
            </p>

            <InfoBox>
              <strong>2단계 UX:</strong> 먼저 노선 목록에서 노선을 선택(1단계)한 후,
              해당 노선의 상세 데이터를 편집합니다(2단계).
              상단의 "← 목록" 버튼으로 노선 목록으로 돌아갑니다.
            </InfoBox>

            <SubTitle id="ref-routes">노선원장</SubTitle>
            <p className="text-sm text-gray-700 mb-2">
              153개 노선의 기본정보(노선코드·명칭·선로 수·전철화 여부·노선 유형)를 조회합니다.
              노선 목록에서 검색·필터로 원하는 노선을 찾아 클릭하면 상세 정보를 확인합니다.
            </p>
            <Table
              headers={['필터', '설명']}
              rows={[
                ['텍스트 검색', '노선명·코드·시종점으로 검색'],
                ['유형 필터', '고속선·일반선·기지 노선 구분'],
                ['오류 노선만', '기준 데이터 오류가 있는 노선만 표시'],
              ]}
            />

            <SubTitle id="ref-stations">역/KP 관리</SubTitle>
            <p className="text-sm text-gray-700 mb-2">
              노선별 역 목록과 KP(거리정) 데이터를 관리합니다.
              역 항목을 클릭하면 인라인 편집 모드로 전환되어 KP·GPS 좌표·역 구분을 수정할 수 있습니다.
            </p>
            <Step n={1}>노선원장 탭에서 노선을 선택한 후 "역/KP 관리" 탭으로 전환합니다.</Step>
            <Step n={2}>역 목록에서 수정할 역 행을 클릭합니다.</Step>
            <Step n={3}>KP·GPS 좌표(위도·경도)·역 구분·기준선 여부를 수정합니다.</Step>
            <Step n={4}>"저장"을 클릭하면 노선도 기준점이 자동으로 갱신됩니다.</Step>
            <WarnBox>
              기준선(is_baseline_anchor)을 설정하면 노선도 렌더링의 좌표 기준점으로 사용됩니다.
              잘못된 KP·GPS 입력 시 노선도 표시가 왜곡될 수 있습니다.
            </WarnBox>

            <SubTitle id="ref-facilities">시설물 관리</SubTitle>
            <p className="text-sm text-gray-700 mb-2">
              터널·교량·변전소·건널목·분기 등 선로 시설물을 등록·수정·삭제합니다.
              CSV 파일로 일괄 업로드도 지원합니다.
            </p>
            <Table
              headers={['시설물 유형', '지도 표시']}
              rows={[
                ['터널', '닫힌 사각 윤곽선 □'],
                ['교량·과선교', '양끝 브래킷 ] ['],
                ['변전소·신호기계실·통신실', '선로 외방에 레이블(예: 익산PP) 표시'],
              ]}
            />

            <SubTitle id="ref-boundary">담당구역 관리</SubTitle>
            <p className="text-sm text-gray-700 mb-2">
              지역본부·사업단별 관할 담당구역(노선+KP 범위+분야)을 등록합니다.
              153개 노선을 검색형 셀렉터로 선택할 수 있습니다.
            </p>
            <Table
              headers={['분야', '의미']}
              rows={[
                [<Badge key="1" color="gray">all</Badge>, '행정경계 — 해당 노선 전체 담당'],
                [<Badge key="2" color="orange">시설</Badge>, '시설 분야 담당 구간'],
                [<Badge key="3" color="blue">전기</Badge>, '전기 분야 담당 구간'],
                [<Badge key="4" color="purple">건축</Badge>, '건축 분야 담당 구간'],
              ]}
            />
          </>
        )}

        {/* ── 6. 시스템 관리 ──────────────────────────────────────── */}
        {isSuperuser && (
          <>
            <SectionTitle id="system">시스템 관리</SectionTitle>

            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              최고관리자(system_superuser) 전용 메뉴입니다.
            </p>

            <SubTitle id="sys-users">사용자 관리</SubTitle>
            <p className="text-sm text-gray-700 mb-2">
              사용자 계정 생성·수정·비활성화를 관리합니다.
              각 사용자의 소속 조직·권한(role)·이름을 설정합니다.
            </p>
            <Table
              headers={['권한', '설명']}
              rows={[
                [<Badge key="1" color="blue">user</Badge>, '차단현황도·차단명령·캘린더 조회만 가능'],
                [<Badge key="2" color="green">org_admin</Badge>, '자기 조직 관할 구간 내 차단명령 등록·수정, 기준정보 관리'],
                [<Badge key="3" color="red">system_superuser</Badge>, '전체 기능 + 크로스 조직 + 사용자·시스템 설정 관리'],
              ]}
            />

            <SubTitle id="sys-settings">시스템 설정</SubTitle>
            <p className="text-sm text-gray-700 mb-2">
              지도 노선 색상, 차단작업 색상, 시설물 색상, 지도 렌더링 옵션을 설정합니다.
            </p>
            <Table
              headers={['설정 항목', '설명']}
              rows={[
                ['노선 색상', '고속선·일반선 전철화·일반선 비전철·전차선단전 색상 (#RRGGBB)'],
                ['차단 색상', '선로차단·위험/보호지구 표시 색상'],
                ['위험등급 색상', '위험등급 A·B·C·미지정 마커 색상'],
                ['시설물 색상', '역 유형·시설물 종류별 지도 표시 색상 (12종)'],
                ['역 좌표 모드', 'center_only(기본): 역 중심·시설물 경계 기준 / all_points: 전체 좌표'],
                ['선 두께 포화 배율', '지도 줌 배율 N 이상에서 선 두께를 화면 픽셀로 고정 (기본 5)'],
              ]}
            />
            <InfoBox>
              색상 설정 저장 후 <strong>"새로고침(지도 반영)"</strong> 버튼을 클릭하거나
              페이지를 새로고침해야 지도에 반영됩니다.
            </InfoBox>
          </>
        )}

        {/* ── 7. 권한 안내 ─────────────────────────────────────────── */}
        <SectionTitle id="roles">권한 안내</SectionTitle>

        <Table
          headers={['구분', '메뉴 접근', '차단명령', '기준정보 관리', '시스템 관리']}
          rows={[
            [
              <Badge key="1" color="blue">user</Badge>,
              '차단현황도·차단명령·캘린더',
              '조회만',
              '불가',
              '불가',
            ],
            [
              <Badge key="2" color="green">org_admin</Badge>,
              '위 + 기준정보 관리',
              '자기 조직 관할 구간 내 등록·수정',
              '담당 조직 기준정보',
              '불가',
            ],
            [
              <Badge key="3" color="red">system_superuser</Badge>,
              '전체 메뉴',
              '전체 노선 CRUD',
              '전체 노선',
              '전체 권한',
            ],
          ]}
        />

        <p className="text-sm text-gray-500 mt-8 pb-4">
          문의사항은 시스템 관리자(최고관리자 계정)에게 연락하십시오.
        </p>
      </div>
    </div>
  );
}
