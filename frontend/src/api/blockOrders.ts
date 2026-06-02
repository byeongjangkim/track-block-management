import { api } from './client';
import type {
  BlockOrder,
  BlockOrderCreate,
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
