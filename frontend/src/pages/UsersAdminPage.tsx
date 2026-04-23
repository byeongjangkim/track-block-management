import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchUsers, createUser, updateUser, deactivateUser } from '../api/users';
import { fetchOrganizations } from '../api/organizations';
import type { UserRecord, UserCreate, UserUpdate } from '../api/users';
import type { AxiosError } from 'axios';

const ROLES = [
  { value: 'system_superuser', label: '최상위 관리자' },
  { value: 'org_admin',        label: '조직 관리자' },
  { value: 'user',             label: '일반 사용자' },
];

const FIELDS = [
  { value: '',     label: '전체 (제한 없음)' },
  { value: '시설',  label: '시설' },
  { value: '전기',  label: '전기' },
  { value: '건축',  label: '건축' },
];

const ROLE_BADGE: Record<string, string> = {
  system_superuser: 'bg-red-100 text-red-700',
  org_admin:        'bg-blue-100 text-blue-700',
  user:             'bg-gray-100 text-gray-600',
};

const ROLE_LABEL: Record<string, string> = {
  system_superuser: '최상위 관리자',
  org_admin:        '조직 관리자',
  user:             '일반 사용자',
};

type FormMode = 'create' | 'edit';

interface FormState {
  mode: FormMode;
  userId?: number;
  username: string;
  password: string;
  full_name: string;
  role: string;
  field: string;
  organization_id: string;  // select value는 string
}

const EMPTY_FORM: FormState = {
  mode: 'create',
  username: '',
  password: '',
  full_name: '',
  role: 'user',
  field: '',
  organization_id: '',
};

export default function UsersAdminPage() {
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  const { data: organizations = [] } = useQuery({ queryKey: ['organizations'], queryFn: fetchOrganizations });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  function showMsg(type: 'ok' | 'err', msg: string) {
    setNotice({ type, msg });
    setTimeout(() => setNotice(null), 4000);
  }

  function extractError(err: unknown): string {
    const ae = err as AxiosError<{ detail: string }>;
    return ae?.response?.data?.detail ?? '오류가 발생했습니다.';
  }

  const createMut = useMutation({
    mutationFn: (body: UserCreate) => createUser(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      showMsg('ok', '사용자가 생성되었습니다.');
    },
    onError: (err) => showMsg('err', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserUpdate }) => updateUser(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      showMsg('ok', '사용자 정보가 수정되었습니다.');
    },
    onError: (err) => showMsg('err', extractError(err)),
  });

  const deactivateMut = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      showMsg('ok', '사용자가 비활성화되었습니다.');
    },
    onError: (err) => showMsg('err', extractError(err)),
  });

  function openCreate() {
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(u: UserRecord) {
    setForm({
      mode: 'edit',
      userId: u.id,
      username: u.username,
      password: '',
      full_name: u.full_name,
      role: u.role,
      field: u.field ?? '',
      organization_id: u.organization_id?.toString() ?? '',
    });
    setShowForm(true);
  }

  function handleDeactivate(u: UserRecord) {
    if (!confirm(`'${u.full_name}(${u.username})' 을 비활성화하시겠습니까?`)) return;
    deactivateMut.mutate(u.id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const orgId = form.organization_id !== '' ? Number(form.organization_id) : null;
    const fieldVal = form.field !== '' ? form.field : null;

    if (form.mode === 'create') {
      if (!form.password.trim()) { showMsg('err', '비밀번호를 입력하세요.'); return; }
      createMut.mutate({
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        role: form.role,
        field: fieldVal,
        organization_id: orgId,
      });
    } else {
      const body: UserUpdate = {
        full_name: form.full_name.trim(),
        role: form.role,
        field: fieldVal,
        organization_id: orgId,
      };
      if (form.password.trim()) body.password = form.password;
      updateMut.mutate({ id: form.userId!, body });
    }
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const needsOrg = form.role === 'org_admin' || form.role === 'user';
  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">

      {/* 헤더 */}
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-lg font-semibold">사용자 관리</h1>
        <span className="text-sm text-gray-400">{users.length}명</span>
        <div className="flex-1" />
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium"
        >
          + 사용자 추가
        </button>
      </div>

      {/* 알림 */}
      {notice && (
        <div className={`px-4 py-2 rounded-lg text-sm shrink-0 ${
          notice.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          {notice.msg}
        </div>
      )}

      {/* 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['아이디', '이름', '역할', '담당 분야', '소속 조직', '상태', ''].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">불러오는 중...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">사용자가 없습니다.</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className={`border-b hover:bg-gray-50 ${!u.is_active ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-sm">{u.username}</td>
                  <td className="px-3 py-2 font-medium">{u.full_name}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">
                    {u.field ?? '전체'}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {u.organization_name ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                      {u.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        수정
                      </button>
                      {u.is_active && (
                        <button
                          onClick={() => handleDeactivate(u)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          비활성화
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 사용자 추가/수정 모달 */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            {/* 모달 헤더 */}
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-lg">
                {form.mode === 'create' ? '사용자 추가' : '사용자 수정'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* 모달 폼 */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

              {/* 아이디 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  아이디 {form.mode === 'create' && '*'}
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                  disabled={form.mode === 'edit'}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
                  required={form.mode === 'create'}
                />
              </div>

              {/* 이름 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">이름 *</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => set('full_name', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  required
                />
              </div>

              {/* 비밀번호 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  비밀번호 {form.mode === 'edit' ? '(변경 시에만 입력)' : '*'}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  required={form.mode === 'create'}
                  placeholder={form.mode === 'edit' ? '변경하지 않으면 비워두세요' : ''}
                />
              </div>

              {/* 역할 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">역할 *</label>
                <select
                  value={form.role}
                  onChange={(e) => set('role', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* 소속 조직 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  소속 조직 {needsOrg && '*'}
                </label>
                <select
                  value={form.organization_id}
                  onChange={(e) => set('organization_id', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  required={needsOrg}
                >
                  <option value="">— 없음 (최상위 관리자용) —</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      [{o.org_type === 'special' ? '사업단' : '지역본부'}] {o.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 담당 분야 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">담당 분야</label>
                <select
                  value={form.field}
                  onChange={(e) => set('field', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  '전체'는 조직 관할 구간 내 모든 분야 등록 가능.
                  특정 분야 선택 시 해당 분야만 등록 가능.
                </p>
              </div>
            </form>

            {/* 모달 푸터 */}
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSubmit as unknown as React.MouseEventHandler}
                disabled={isPending}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {isPending ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
