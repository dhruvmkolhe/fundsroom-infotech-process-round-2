export type UserRole = 'admin' | 'operations' | 'sales' | 'customer';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  full_name?: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  role: UserRole;
}

export interface InventoryItem {
  id: string;
  item: string;
  category: string;
  location: string;
  batch: string;
  physical_qty: number;
  reserved_qty: number;
  available_qty: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: string;
  work_order_id: string;
  location: string;
  item: string;
  required_qty: number;
  assigned_user_id?: string;
  assigned_username?: string;
  status: 'Assigned' | 'In Progress' | 'Completed';
  shortage_qty: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface InternalTransfer {
  id: string;
  transfer_id: string;
  source_location: string;
  destination_location: string;
  item: string;
  qty: number;
  status: 'Requested' | 'Dispatched' | 'Received';
  work_order_id?: string;
  dispatched_at?: string;
  received_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerOrder {
  id: string;
  order_id: string;
  customer_name: string;
  item: string;
  location: string;
  qty: number;
  status: 'Pending' | 'Reserved' | 'Fulfilled' | 'Cancelled';
  created_by_id?: string;
  created_by_username?: string;
  created_at: string;
  updated_at: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
