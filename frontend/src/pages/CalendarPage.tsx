import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchBlockOrders } from '../api/blockOrders';
import { fetchRoutes } from '../api/routes';

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay(); // 0=일
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const dateFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const dateTo = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: fetchRoutes });
  const { data: orders = [] } = useQuery({
    queryKey: ['block-orders-month', dateFrom, dateTo],
    queryFn: () => fetchBlockOrders({ date_from: dateFrom, date_to: dateTo }),
  });

  const { data: dayOrders = [] } = useQuery({
    queryKey: ['block-orders-day', selectedDate],
    queryFn: () =>
      fetchBlockOrders({ date_from: selectedDate!, date_to: selectedDate! }),
    enabled: !!selectedDate,
  });

  // 날짜별 건수 집계
  const countByDate: Record<string, number> = {};
  for (const o of orders) {
    countByDate[o.work_date] = (countByDate[o.work_date] ?? 0) + 1;
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  }

  const days = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);
  const cells = Array.from({ length: startDay + days }, (_, i) =>
    i < startDay ? null : i - startDay + 1
  );
  // 7의 배수로 패딩
  while (cells.length % 7 !== 0) cells.push(null);

  const routeMap = Object.fromEntries(routes.map((r) => [r.id, r.name]));

  return (
    <div className="flex h-full">
      {/* 캘린더 */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={prevMonth} className="px-3 py-1 border rounded hover:bg-gray-100">‹</button>
          <h2 className="text-lg font-semibold">
            {year}년 {month + 1}월
          </h2>
          <button onClick={nextMonth} className="px-3 py-1 border rounded hover:bg-gray-100">›</button>
        </div>

        <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded overflow-hidden">
          {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
            <div key={d} className="bg-gray-50 text-center text-xs font-medium py-2 text-gray-500">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={i} className="bg-white h-20" />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const count = countByDate[dateStr] ?? 0;
            const isToday = dateStr === today.toISOString().slice(0, 10);
            const isSelected = dateStr === selectedDate;
            return (
              <div
                key={i}
                onClick={() => setSelectedDate(dateStr)}
                className={`bg-white h-20 p-1 cursor-pointer transition-colors hover:bg-blue-50 ${
                  isSelected ? 'ring-2 ring-inset ring-blue-400' : ''
                }`}
              >
                <span
                  className={`text-sm inline-block w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-blue-600 text-white' : 'text-gray-700'
                  }`}
                >
                  {day}
                </span>
                {count > 0 && (
                  <span className="mt-1 inline-block bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {count}건
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 상세 패널 */}
      {selectedDate && (
        <aside className="w-80 border-l bg-white overflow-y-auto p-4">
          <h3 className="font-semibold mb-3">{selectedDate} 차단명령</h3>
          {dayOrders.length === 0 ? (
            <p className="text-gray-400 text-sm">차단명령이 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {dayOrders.map((o) => (
                <li
                  key={o.id}
                  onClick={() => navigate(`/block-map?date=${selectedDate}`)}
                  className="border rounded p-3 text-sm space-y-1 cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <div className="font-medium">
                    {routeMap[o.route_id] ?? `노선 ${o.route_id}`}
                  </div>
                  <div className="text-gray-600">
                    {o.field} / {o.block_type}
                  </div>
                  <div className="text-gray-500">
                    {o.start_km}~{o.end_km}km ({o.direction === 'UP' ? '상선' : '하선'})
                  </div>
                  <div className="text-gray-500">
                    {o.start_time.slice(0, 5)} ~ {o.end_time.slice(0, 5)}
                  </div>
                  <div className="text-gray-400 text-xs">
                    작업책임자: {o.work_supervisor}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
