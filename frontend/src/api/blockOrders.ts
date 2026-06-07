import { api } from './client';
import type {
  BlockOrder,
  BlockOrderCreate,
  BlockOrderDocument,
  BlockOrderMonitor,
  ParsedBlockOrder,
  BulkParseResult,
  BulkBlockOrderItem,
  BulkBlockOrderResult,
} from '../types';

export async function parsePdfForBlockOrder(file: File): Promise<ParsedBlockOrder> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<ParsedBlockOrder>('/documents/parse-pdf', form);
  return res.data;
}

export async function fetchBlockOrders(params?: {
  route_id?: number;
  date_from?: string;
  date_to?: string;
  organization_id?: number;
  field?: string;
  work_type?: string;
  implementer?: string;
  is_external?: boolean;
  start_km_from?: number;
  end_km_to?: number;
}): Promise<BlockOrder[]> {
  const res = await api.get<BlockOrder[]>('/block-orders', { params });
  return res.data;
}

export async function createBlockOrder(body: BlockOrderCreate): Promise<BlockOrder> {
  const res = await api.post<BlockOrder>('/block-orders', body);
  return res.data;
}

export async function updateBlockOrder(
  id: number,
  body: Partial<BlockOrderCreate>
): Promise<BlockOrder> {
  const res = await api.put<BlockOrder>(`/block-orders/${id}`, body);
  return res.data;
}

export async function deleteBlockOrder(id: number): Promise<void> {
  await api.delete(`/block-orders/${id}`);
}

export async function bulkParsePdfs(params: {
  coverFile?: File;
  detailFile?: File;
  routeName?: string;
}): Promise<BulkParseResult> {
  const form = new FormData();
  if (params.coverFile) form.append('cover_file', params.coverFile);
  if (params.detailFile) form.append('detail_file', params.detailFile);
  if (params.routeName) form.append('route_name', params.routeName);
  const res = await api.post<BulkParseResult>('/documents/bulk-parse', form);
  return res.data;
}

export async function bulkCreateBlockOrders(
  items: BulkBlockOrderItem[]
): Promise<BulkBlockOrderResult> {
  const res = await api.post<BulkBlockOrderResult>('/block-orders/bulk', items);
  return res.data;
}

export async function uploadDocument(orderId: number, file: File): Promise<{ filename: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<{ filename: string }>(`/documents/upload/${orderId}`, form);
  return res.data;
}

// ── DB 저장 방식 (PostgreSQL BYTEA) ──────────────────────────────────────────

/** PDF 원문을 PostgreSQL BYTEA에 저장. order_id가 있으면 해당 차단명령에 자동 연결. */
export async function uploadDocumentToDb(
  file: File,
  opts?: { orderId?: number; docNo?: string; note?: string },
): Promise<BlockOrderDocument> {
  const form = new FormData();
  form.append('file', file);
  if (opts?.orderId != null) form.append('order_id', String(opts.orderId));
  if (opts?.docNo)           form.append('doc_no',   opts.docNo);
  if (opts?.note)            form.append('note',     opts.note);
  const res = await api.post<BlockOrderDocument>('/documents/db/upload', form);
  return res.data;
}

/** 브라우저 새 탭으로 PDF 원문 열기 */
export function openDocumentInBrowser(docId: number): void {
  const baseUrl = (api.defaults.baseURL ?? '').replace(/\/$/, '');
  window.open(`${baseUrl}/documents/db/${docId}/view`, '_blank');
}

/** 문서 메타데이터 조회 (바이너리 제외) */
export async function fetchDocumentInfo(docId: number): Promise<BlockOrderDocument> {
  const res = await api.get<BlockOrderDocument>(`/documents/db/${docId}/info`);
  return res.data;
}

/** 문서 삭제 (org_admin 이상) */
export async function deleteDocumentFromDb(docId: number): Promise<void> {
  await api.delete(`/documents/db/${docId}`);
}

// ── 열차감시원 CRUD ────────────────────────────────────────────────────────────

export async function fetchMonitors(orderId: number): Promise<BlockOrderMonitor[]> {
  const res = await api.get<BlockOrderMonitor[]>(`/block-orders/${orderId}/monitors`);
  return res.data;
}

export async function addMonitor(
  orderId: number,
  data: { name: string; phone?: string; company?: string },
): Promise<BlockOrderMonitor> {
  const res = await api.post<BlockOrderMonitor>(`/block-orders/${orderId}/monitors`, data);
  return res.data;
}

export async function deleteMonitor(orderId: number, monitorId: number): Promise<void> {
  await api.delete(`/block-orders/${orderId}/monitors/${monitorId}`);
}
