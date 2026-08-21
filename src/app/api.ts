// ─── API Client ─────────────────────────────────────────────────────────────
// All calls go through apiFetch which automatically attaches the JWT token.
//
// LOCAL DEV:  BASE = '/api'  →  Vite proxy forwards to http://localhost:4000
// PRODUCTION: Set VITE_API_URL=https://your-backend.railway.app/api in Vercel
//             env vars so the frontend knows where the real backend lives.

const BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

// ── Auth storage helpers ─────────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem('erp_token');
}

export function setToken(token: string): void {
  localStorage.setItem('erp_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('erp_token');
}

// ── Core fetch wrapper ───────────────────────────────────────────────────────

interface ApiError {
  error: string;
  details?: Array<{ msg: string; path: string }>;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const message = body.details
      ? body.details.map((d) => d.msg).join(', ')
      : body.error;
    throw new Error(message ?? `HTTP ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types (mirrored from server/src/types.ts) ────────────────────────────────

export type UserRole = 'admin' | 'operations' | 'sales';

export interface ApiUser {
  id: string;
  username: string;
  role: UserRole;
  full_name: string | null;
}

export interface ApiInventoryItem {
  id: string;
  item: string;
  category: string;
  location: string;
  batch: string;
  physical_qty: string;
  reserved_qty: string;
  available_qty: string;
  created_at: string;
  updated_at: string;
}

export interface ApiWorkOrder {
  id: string;
  work_order_id: string;
  location: string;
  item: string;
  required_qty: string;
  assigned_user_id: string | null;
  assigned_username: string | null;
  status: 'Assigned' | 'In Progress' | 'Completed';
  shortage_qty: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiTransfer {
  id: string;
  transfer_id: string;
  source_location: string;
  destination_location: string;
  item: string;
  qty: string;
  status: 'Requested' | 'Dispatched' | 'Received';
  work_order_id: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiCustomerOrder {
  id: string;
  order_id: string;
  customer_name: string;
  item: string;
  location: string;
  qty: string;
  status: 'Pending' | 'Reserved' | 'Fulfilled' | 'Cancelled';
  created_by_id: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function apiLogin(
  username: string,
  password: string
): Promise<{ token: string; user: ApiUser }> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function apiGetMe(): Promise<ApiUser> {
  return apiFetch('/auth/me');
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export async function apiGetInventory(): Promise<ApiInventoryItem[]> {
  return apiFetch('/inventory');
}

export async function apiCreateInventory(payload: {
  item: string;
  category: string;
  location: string;
  batch?: string;
  physical_qty: number;
}): Promise<ApiInventoryItem> {
  return apiFetch('/inventory', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiUpdateInventory(
  id: string,
  payload: { physical_qty?: number; category?: string; location?: string }
): Promise<ApiInventoryItem> {
  return apiFetch(`/inventory/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteInventory(id: string): Promise<void> {
  return apiFetch(`/inventory/${id}`, { method: 'DELETE' });
}

// ── Work Orders ──────────────────────────────────────────────────────────────

export async function apiGetWorkOrders(): Promise<ApiWorkOrder[]> {
  return apiFetch('/work-orders');
}

export async function apiCreateWorkOrder(payload: {
  location: string;
  item: string;
  required_qty: number;
  assigned_user_id?: string;
  notes?: string;
}): Promise<ApiWorkOrder> {
  return apiFetch('/work-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiUpdateWorkOrderStatus(
  id: string,
  status: 'Assigned' | 'In Progress' | 'Completed'
): Promise<ApiWorkOrder> {
  return apiFetch(`/work-orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ── Transfers ────────────────────────────────────────────────────────────────

export async function apiGetTransfers(): Promise<ApiTransfer[]> {
  return apiFetch('/transfers');
}

export async function apiCreateTransfer(payload: {
  source_location: string;
  destination_location: string;
  item: string;
  qty: number;
  work_order_id?: string;
}): Promise<ApiTransfer> {
  return apiFetch('/transfers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiDispatchTransfer(id: string): Promise<ApiTransfer> {
  return apiFetch(`/transfers/${id}/dispatch`, { method: 'PATCH' });
}

export async function apiReceiveTransfer(id: string): Promise<ApiTransfer> {
  return apiFetch(`/transfers/${id}/receive`, { method: 'PATCH' });
}

// ── Customer Orders ──────────────────────────────────────────────────────────

export async function apiGetCustomerOrders(): Promise<ApiCustomerOrder[]> {
  return apiFetch('/customer-orders');
}

export async function apiCreateCustomerOrder(payload: {
  customer_name: string;
  item: string;
  location: string;
  qty: number;
}): Promise<ApiCustomerOrder> {
  return apiFetch('/customer-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiCancelCustomerOrder(id: string): Promise<ApiCustomerOrder> {
  return apiFetch(`/customer-orders/${id}/cancel`, { method: 'PATCH' });
}
