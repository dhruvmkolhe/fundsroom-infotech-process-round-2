import { useState, useEffect, createContext, useContext, useCallback, useRef } from "react";
import {
  Package, ClipboardList, ArrowLeftRight, ShoppingCart, LogOut,
  Plus, Edit2, Trash2, CheckCircle, Clock, AlertTriangle, XCircle,
  ChevronRight, RefreshCw, TrendingDown, Search, X, Eye, Truck,
  ArrowRight, BarChart2, Users, Warehouse, AlertCircle, Filter
} from "lucide-react";
import {
  getToken, setToken, clearToken,
  apiLogin, apiGetMe,
  apiGetInventory, apiCreateInventory, apiUpdateInventory, apiDeleteInventory,
  apiGetWorkOrders, apiCreateWorkOrder, apiUpdateWorkOrderStatus,
  apiGetTransfers, apiCreateTransfer, apiDispatchTransfer, apiReceiveTransfer,
  apiGetCustomerOrders, apiCreateCustomerOrder, apiCancelCustomerOrder,
  type ApiUser, type ApiInventoryItem, type ApiWorkOrder, type ApiTransfer, type ApiCustomerOrder,
} from "./api";

// ─── Types ─────────────────────────────────────────────────────────────────

type UserRole = "admin" | "operations" | "sales";

interface User {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
}

// Normalised frontend types (numbers, not strings)
interface InventoryItem {
  id: string;
  item: string;
  category: string;
  location: string;
  batch: string;
  physical_qty: number;
  reserved_qty: number;
  available_qty: number;
  updatedAt: string;
}

interface WorkOrder {
  id: string;
  work_order_id: string;
  location: string;
  item: string;
  required_qty: number;
  assigned_username: string;
  status: "Assigned" | "In Progress" | "Completed";
  shortage_qty: number;
  notes?: string;
  createdAt: string;
}

interface InternalTransfer {
  id: string;
  transfer_id: string;
  source_location: string;
  destination_location: string;
  item: string;
  qty: number;
  status: "Requested" | "Dispatched" | "Received";
  work_order_id?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  createdAt: string;
}

interface CustomerOrder {
  id: string;
  order_id: string;
  customer_name: string;
  item: string;
  location: string;
  qty: number;
  status: "Reserved" | "Fulfilled" | "Cancelled";
  created_by: string;
  createdAt: string;
}

// ─── Normalise helpers (API returns strings for numerics) ───────────────────

function normInv(r: ApiInventoryItem): InventoryItem {
  return {
    id: r.id, item: r.item, category: r.category, location: r.location,
    batch: r.batch,
    physical_qty: Number(r.physical_qty),
    reserved_qty: Number(r.reserved_qty),
    available_qty: Number(r.available_qty),
    updatedAt: r.updated_at,
  };
}

function normWO(r: ApiWorkOrder): WorkOrder {
  return {
    id: r.id, work_order_id: r.work_order_id, location: r.location,
    item: r.item, required_qty: Number(r.required_qty),
    assigned_username: r.assigned_username ?? "",
    status: r.status, shortage_qty: Number(r.shortage_qty),
    notes: r.notes ?? undefined, createdAt: r.created_at,
  };
}

function normTransfer(r: ApiTransfer): InternalTransfer {
  return {
    id: r.id, transfer_id: r.transfer_id,
    source_location: r.source_location,
    destination_location: r.destination_location,
    item: r.item, qty: Number(r.qty), status: r.status,
    work_order_id: r.work_order_id ?? undefined,
    dispatchedAt: r.dispatched_at ?? undefined,
    receivedAt: r.received_at ?? undefined,
    createdAt: r.created_at,
  };
}

function normOrder(r: ApiCustomerOrder): CustomerOrder {
  return {
    id: r.id, order_id: r.order_id,
    customer_name: r.customer_name, item: r.item,
    location: r.location, qty: Number(r.qty),
    status: r.status as CustomerOrder["status"],
    created_by: r.created_by_username ?? "",
    createdAt: r.created_at,
  };
}

// ─── Contexts ──────────────────────────────────────────────────────────────

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}
const AuthContext = createContext<AuthCtx>(null!);

interface AppData {
  inventory: InventoryItem[];
  workOrders: WorkOrder[];
  transfers: InternalTransfer[];
  customerOrders: CustomerOrder[];
}

interface DataCtx {
  data: AppData;
  loading: boolean;
  refresh: () => Promise<void>;
  addInventory: (item: { item: string; category: string; location: string; batch?: string; physical_qty: number }) => Promise<{ ok: boolean; error?: string }>;
  updateInventory: (id: string, patch: { physical_qty?: number; category?: string; location?: string }) => Promise<{ ok: boolean; error?: string }>;
  deleteInventory: (id: string) => Promise<{ ok: boolean; error?: string }>;
  createWorkOrder: (wo: { location: string; item: string; required_qty: number; assigned_username?: string; notes?: string }) => Promise<{ ok: boolean; data?: WorkOrder; error?: string }>;
  updateWorkOrderStatus: (id: string, status: WorkOrder["status"]) => Promise<void>;
  createTransfer: (t: { source_location: string; destination_location: string; item: string; qty: number; work_order_id?: string }) => Promise<{ ok: boolean; data?: InternalTransfer; error?: string }>;
  dispatchTransfer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  receiveTransfer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  createCustomerOrder: (co: { customer_name: string; item: string; location: string; qty: number }) => Promise<{ ok: boolean; data?: CustomerOrder; error?: string }>;
  cancelCustomerOrder: (id: string) => Promise<{ ok: boolean; error?: string }>;
}
const DataContext = createContext<DataCtx>(null!);

// ─── Auth Provider ──────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: restore session from stored token
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    apiGetMe()
      .then((u) => setUser({ id: u.id, username: u.username, role: u.role as UserRole, fullName: u.full_name ?? u.username }))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await apiLogin(username, password);
      setToken(res.token);
      setUser({
        id: res.user.id,
        username: res.user.username,
        role: res.user.role as UserRole,
        fullName: res.user.full_name ?? res.user.username,
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message ?? "Login failed" };
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

// ─── Data Provider ──────────────────────────────────────────────────────────

function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>({ inventory: [], workOrders: [], transfers: [], customerOrders: [] });
  const [loading, setLoading] = useState(true);
  const { user } = useContext(AuthContext);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [inv, wos, trf, cos] = await Promise.all([
        apiGetInventory(),
        apiGetWorkOrders(),
        apiGetTransfers(),
        apiGetCustomerOrders(),
      ]);
      setData({
        inventory: inv.map(normInv),
        workOrders: wos.map(normWO),
        transfers: trf.map(normTransfer),
        customerOrders: cos.map(normOrder),
      });
    } catch {
      // silently ignore — user will see stale data
    }
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [user, refresh]);

  // ── Inventory ops ────────────────────────────────────────────────────────

  const addInventory = useCallback(async (payload: { item: string; category: string; location: string; batch?: string; physical_qty: number }) => {
    try {
      await apiCreateInventory(payload);
      await refresh();
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  const updateInventory = useCallback(async (id: string, patch: { physical_qty?: number; category?: string; location?: string }) => {
    try {
      await apiUpdateInventory(id, patch);
      await refresh();
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  const deleteInventory = useCallback(async (id: string) => {
    try {
      await apiDeleteInventory(id);
      await refresh();
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  // ── Work Order ops ───────────────────────────────────────────────────────

  const createWorkOrder = useCallback(async (payload: { location: string; item: string; required_qty: number; assigned_username?: string; notes?: string }) => {
    try {
      const wo = await apiCreateWorkOrder({ location: payload.location, item: payload.item, required_qty: payload.required_qty, notes: payload.notes });
      await refresh();
      return { ok: true, data: normWO(wo) };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  const updateWorkOrderStatus = useCallback(async (id: string, status: WorkOrder["status"]) => {
    try {
      await apiUpdateWorkOrderStatus(id, status);
      await refresh();
    } catch { /* ignore */ }
  }, [refresh]);

  // ── Transfer ops ─────────────────────────────────────────────────────────

  const createTransfer = useCallback(async (payload: { source_location: string; destination_location: string; item: string; qty: number; work_order_id?: string }) => {
    try {
      const t = await apiCreateTransfer(payload);
      await refresh();
      return { ok: true, data: normTransfer(t) };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  const dispatchTransfer = useCallback(async (id: string) => {
    try {
      await apiDispatchTransfer(id);
      await refresh();
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  const receiveTransfer = useCallback(async (id: string) => {
    try {
      await apiReceiveTransfer(id);
      await refresh();
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  // ── Customer Order ops ───────────────────────────────────────────────────

  const createCustomerOrder = useCallback(async (payload: { customer_name: string; item: string; location: string; qty: number }) => {
    try {
      const co = await apiCreateCustomerOrder(payload);
      await refresh();
      return { ok: true, data: normOrder(co) };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  const cancelCustomerOrder = useCallback(async (id: string) => {
    try {
      await apiCancelCustomerOrder(id);
      await refresh();
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err.message }; }
  }, [refresh]);

  return (
    <DataContext.Provider value={{
      data, loading, refresh,
      addInventory, updateInventory, deleteInventory,
      createWorkOrder, updateWorkOrderStatus,
      createTransfer, dispatchTransfer, receiveTransfer,
      createCustomerOrder, cancelCustomerOrder,
    }}>
      {children}
    </DataContext.Provider>
  );
}

// ─── UI Primitives ─────────────────────────────────────────────────────────

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Assigned": "bg-blue-100 text-blue-800 border border-blue-200",
    "In Progress": "bg-amber-100 text-amber-800 border border-amber-200",
    "Completed": "bg-emerald-100 text-emerald-800 border border-emerald-200",
    "Requested": "bg-slate-100 text-slate-700 border border-slate-200",
    "Dispatched": "bg-orange-100 text-orange-800 border border-orange-200",
    "Received": "bg-emerald-100 text-emerald-800 border border-emerald-200",
    "Reserved": "bg-blue-100 text-blue-800 border border-blue-200",
    "Fulfilled": "bg-emerald-100 text-emerald-800 border border-emerald-200",
    "Cancelled": "bg-rose-100 text-rose-800 border border-rose-200",
  };
  const icon: Record<string, React.ReactNode> = {
    "Assigned": <Clock className="w-3 h-3" />, "In Progress": <RefreshCw className="w-3 h-3" />,
    "Completed": <CheckCircle className="w-3 h-3" />, "Requested": <Clock className="w-3 h-3" />,
    "Dispatched": <Truck className="w-3 h-3" />, "Received": <CheckCircle className="w-3 h-3" />,
    "Reserved": <Package className="w-3 h-3" />, "Fulfilled": <CheckCircle className="w-3 h-3" />,
    "Cancelled": <XCircle className="w-3 h-3" />,
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium font-mono", map[status] || "bg-slate-100 text-slate-600")}>
      {icon[status]}{status}
    </span>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const map: Record<UserRole, string> = { admin: "bg-purple-100 text-purple-700 border border-purple-200", operations: "bg-teal-100 text-teal-700 border border-teal-200", sales: "bg-indigo-100 text-indigo-700 border border-indigo-200" };
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize font-mono", map[role])}>{role}</span>;
}

function Btn({ children, onClick, variant = "primary", disabled = false, size = "md", className = "", type = "button" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  disabled?: boolean; size?: "sm" | "md"; className?: string; type?: "button" | "submit";
}) {
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-sm",
    secondary: "bg-slate-100 hover:bg-slate-200 text-slate-700",
    danger: "bg-rose-600 hover:bg-rose-700 text-white shadow-sm",
    ghost: "hover:bg-slate-100 text-slate-600",
    outline: "border border-slate-200 hover:bg-slate-50 text-slate-700",
  };
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-1.5 text-sm" };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cn("inline-flex items-center gap-1.5 rounded font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed", variants[variant], sizes[size], className)}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, required, min, error }: {
  label?: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; min?: number; error?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</label>}
      <input
        type={type} value={value} placeholder={placeholder} required={required}
        min={min !== undefined ? String(min) : undefined}
        onChange={e => onChange(e.target.value)}
        className={cn("w-full px-3 py-2 bg-slate-50 border rounded text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow",
          error ? "border-rose-400" : "border-slate-200")}
      />
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options, required, placeholder }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; required?: boolean; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</label>}
      <select value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Alert({ msg, type = "error", onClose }: { msg: string; type?: "error" | "success" | "warn"; onClose: () => void }) {
  const styles = { error: "bg-rose-50 border-rose-200 text-rose-700", success: "bg-emerald-50 border-emerald-200 text-emerald-700", warn: "bg-amber-50 border-amber-200 text-amber-700" };
  return (
    <div className={cn("flex items-start gap-2 px-4 py-3 border rounded text-sm mb-4", styles[type])}>
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="flex-1">{msg}</span>
      <button onClick={onClose}><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn("px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200", right && "text-right")}>{children}</th>;
}

function Td({ children, mono, right }: { children: React.ReactNode; mono?: boolean; right?: boolean }) {
  return <td className={cn("px-4 py-3 text-slate-700 border-b border-slate-100", mono && "font-mono text-xs", right && "text-right")}>{children}</td>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{message}</div>;
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "inventory", label: "Inventory", icon: Package, roles: ["admin", "operations", "sales"] as UserRole[] },
  { id: "workorders", label: "Work Orders", icon: ClipboardList, roles: ["admin", "operations"] as UserRole[] },
  { id: "transfers", label: "Stock Transfers", icon: ArrowLeftRight, roles: ["admin", "operations"] as UserRole[] },
  { id: "customerorders", label: "Customer Orders", icon: ShoppingCart, roles: ["admin", "sales", "customer"] as UserRole[] },
];

function Sidebar({ active, onNav }: { active: string; onNav: (id: string) => void }) {
  const { user, logout } = useContext(AuthContext);
  const { data } = useContext(DataContext);

  const shortages = data.workOrders.filter(w => w.shortage_qty > 0 && w.status !== "Completed").length;
  const pendingTransfers = data.transfers.filter(t => t.status === "Requested").length;

  const badges: Record<string, number> = { workorders: shortages, transfers: pendingTransfers };

  return (
    <aside aria-label="Sidebar navigation" className="w-56 h-screen bg-[#0f172a] flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center">
            <Warehouse className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-tight">MiniOps ERP</p>
            <p className="text-slate-400 text-xs">Operations Suite</p>
          </div>
        </div>
      </div>

      <nav aria-label="Modules navigation" className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest px-2 mb-2">Modules</p>
        {NAV_ITEMS.filter(item => user && item.roles.includes(user.role)).map(item => (
          <button key={item.id} onClick={() => onNav(item.id)}
            className={cn("w-full flex items-center justify-between px-3 py-2 rounded-md mb-0.5 group transition-colors",
              active === item.id ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")}>
            <span className="flex items-center gap-2.5 text-sm font-medium">
              <item.icon className="w-4 h-4" />
              {item.label}
            </span>
            {badges[item.id] > 0 && (
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono",
                active === item.id ? "bg-white/20 text-white" : "bg-amber-500 text-white")}>
                {badges[item.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="px-3 pb-4 border-t border-white/10 pt-4">
        <div className="flex items-center gap-2.5 px-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
            {user?.fullName.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{user?.fullName}</p>
            <RoleBadge role={user!.role} />
          </div>
        </div>
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-400 hover:bg-white/5 hover:text-white text-sm transition-colors">
          <LogOut className="w-3.5 h-3.5" /><span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}

// ─── Login ──────────────────────────────────────────────────────────────────

function LoginPage() {
  const { login } = useContext(AuthContext);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(username, password);
    if (!result.ok) setError(result.error || "Login failed");
    setLoading(false);
  };

  const fill = (u: string, p: string) => { setUsername(u); setPassword(p); };

  return (
    <main aria-label="Sign In" className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg">
            <Warehouse className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">MiniOps ERP</h1>
            <p className="text-slate-400 text-xs">Operations Management System</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-2xl border border-slate-700/50 p-6">
          <h2 className="text-slate-800 text-lg font-semibold mb-5">Sign In</h2>
          {error && <Alert msg={error} type="error" onClose={() => setError("")} />}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Username" value={username} onChange={setUsername} placeholder="Enter username" required />
            <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="Enter password" required />
            <Btn type="submit" variant="primary" className="w-full justify-center" disabled={loading}>
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Signing in..." : "Sign In"}
            </Btn>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs text-slate-500 font-medium mb-2">Demo credentials (click to autofill):</p>
            <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto pr-1">
              {[
                ["admin", "admin123", "ADMIN", "System Administrator"],
                ["ops_user", "ops123", "OPERATIONS", "Operations Manager"],
                ["ops_lead", "ops123", "OPERATIONS", "Warehouse Lead"],
                ["sales_user", "sales123", "SALES", "Sales Representative"],
                ["sales_lead", "sales123", "SALES", "Senior Account Exec"],
                ["customer_user", "customer123", "CUSTOMER", "Apex Manufacturing Client"],
                ["client_titan", "customer123", "CUSTOMER", "Titan Industries Client"],
              ].map(([u, p, badge, title]) => (
                <button key={u} onClick={() => fill(u, p)}
                  className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-50 hover:bg-blue-50/50 hover:border-blue-200 rounded border border-slate-200 transition-all text-left group">
                  <div className="flex flex-col">
                    <span className="text-xs font-mono font-medium text-slate-700 group-hover:text-blue-600">{u}</span>
                    <span className="text-[10px] text-slate-400">{title}</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                    badge === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                    badge === 'OPERATIONS' ? 'bg-amber-100 text-amber-700' :
                    badge === 'SALES' ? 'bg-blue-100 text-blue-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>{badge}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Inventory ──────────────────────────────────────────────────────────────

type InvModal = { mode: "add" } | { mode: "edit"; item: InventoryItem } | null;

function InventoryPage() {
  const { user } = useContext(AuthContext);
  const { data, loading, addInventory, updateInventory, deleteInventory } = useContext(DataContext);
  const [modal, setModal] = useState<InvModal>(null);
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [alert, setAlert] = useState<{ msg: string; type: "error" | "success" } | null>(null);

  const locations = [...new Set(data.inventory.map(i => i.location))].sort();
  const categories = [...new Set(data.inventory.map(i => i.category))].sort();

  const filtered = data.inventory.filter(i => {
    const q = search.toLowerCase();
    return (!locFilter || i.location === locFilter) &&
      (!catFilter || i.category === catFilter) &&
      (!q || i.item.toLowerCase().includes(q) || i.batch.toLowerCase().includes(q));
  });

  const canEdit = user?.role === "admin" || user?.role === "operations";

  const handleDelete = async (id: string) => {
    const result = await deleteInventory(id);
    if (!result.ok) setAlert({ msg: result.error!, type: "error" });
    else setAlert({ msg: "Item deleted.", type: "success" });
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} records</p>
        </div>
        {canEdit && <Btn variant="primary" onClick={() => setModal({ mode: "add" })}><Plus className="w-4 h-4" />Add Item</Btn>}
      </div>

      {alert && <Alert msg={alert.msg} type={alert.type} onClose={() => setAlert(null)} />}

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-52" />
        </div>
        <select value={locFilter} onChange={e => setLocFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Locations</option>
          {locations.map(l => <option key={l}>{l}</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        {(search || locFilter || catFilter) && <Btn variant="ghost" size="sm" onClick={() => { setSearch(""); setLocFilter(""); setCatFilter(""); }}><X className="w-3 h-3" />Clear</Btn>}
      </div>

      {loading ? <LoadingSpinner /> : (
        <TableWrapper>
          <thead>
            <tr>
              <Th>Item</Th><Th>Category</Th><Th>Location</Th><Th>Batch</Th>
              <Th>Physical</Th><Th>Reserved</Th><Th>Available</Th>
              {canEdit && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={canEdit ? 8 : 7}><EmptyState message="No inventory records found" /></td></tr>
            ) : filtered.map(item => (
              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                <Td><span className="font-medium text-slate-800">{item.item}</span></Td>
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">{item.category}</span></Td>
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-blue-50 text-blue-700 border border-blue-100">{item.location}</span></Td>
                <Td>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                    {item.batch}
                  </span>
                </Td>
                <Td right><span className="font-mono">{item.physical_qty.toLocaleString()}</span></Td>
                <Td right><span className={cn("font-mono", item.reserved_qty > 0 ? "text-amber-600" : "text-slate-400")}>{item.reserved_qty.toLocaleString()}</span></Td>
                <Td right>
                  <span className={cn("font-mono font-semibold", item.available_qty <= 0 ? "text-rose-600" : item.available_qty < 20 ? "text-amber-600" : "text-emerald-600")}>
                    {item.available_qty.toLocaleString()}
                  </span>
                </Td>
                {canEdit && (
                  <Td>
                    <div className="flex gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => setModal({ mode: "edit", item })}><Edit2 className="w-3 h-3" /></Btn>
                      {user?.role === "admin" && <Btn size="sm" variant="ghost" onClick={() => handleDelete(item.id)} className="hover:text-rose-600"><Trash2 className="w-3 h-3" /></Btn>}
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      {modal && <InvModal modal={modal} onClose={() => setModal(null)} setAlert={setAlert} />}
    </div>
  );
}

function InvModal({ modal, onClose, setAlert }: { modal: InvModal & { mode: string }; onClose: () => void; setAlert: (a: { msg: string; type: "error" | "success" }) => void }) {
  const { addInventory, updateInventory, data } = useContext(DataContext);
  const existingItem = modal.mode === "edit" ? (modal as { mode: "edit"; item: InventoryItem }).item : null;
  const [form, setForm] = useState({
    item: existingItem?.item ?? "",
    category: existingItem?.category ?? "",
    location: existingItem?.location ?? "",
    batch: existingItem?.batch ?? "DEFAULT",
    physical_qty: existingItem ? String(existingItem.physical_qty) : "",
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const locations = [...new Set(data.inventory.map(i => i.location))].sort();
  const categories = [...new Set(data.inventory.map(i => i.category))].sort();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const qty = parseFloat(form.physical_qty);
    if (isNaN(qty) || qty < 0) { setErr("Invalid quantity"); return; }
    setSaving(true);
    let result;
    if (modal.mode === "add") {
      result = await addInventory({ item: form.item, category: form.category, location: form.location, batch: form.batch, physical_qty: qty });
    } else {
      result = await updateInventory(existingItem!.id, { physical_qty: qty, category: form.category, location: form.location });
    }
    setSaving(false);
    if (!result.ok) { setErr(result.error!); return; }
    setAlert({ msg: modal.mode === "add" ? "Item added to inventory." : "Inventory updated.", type: "success" });
    onClose();
  };

  return (
    <Modal title={modal.mode === "add" ? "Add Inventory Item" : "Edit Inventory Item"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && <Alert msg={err} type="error" onClose={() => setErr("")} />}
        <Input label="Item Name" value={form.item} onChange={v => setForm({ ...form, item: v })} required placeholder="e.g., Steel Rods" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider block mb-1">Category<span className="text-rose-500 ml-0.5">*</span></label>
            <input list="cat-list" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required placeholder="e.g., Raw Material"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider block mb-1">Location<span className="text-rose-500 ml-0.5">*</span></label>
            <input list="loc-list" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} required placeholder="e.g., Warehouse A"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <datalist id="loc-list">{locations.map(l => <option key={l} value={l} />)}</datalist>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Batch" value={form.batch} onChange={v => setForm({ ...form, batch: v })} placeholder="e.g., BATCH-001" />
          <Input label="Physical Qty" type="number" value={form.physical_qty} onChange={v => setForm({ ...form, physical_qty: v })} required min={0} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={saving}>{saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}{modal.mode === "add" ? "Add Item" : "Save Changes"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ─── Work Orders ─────────────────────────────────────────────────────────────

function WorkOrdersPage() {
  const { user } = useContext(AuthContext);
  const { data, loading, updateWorkOrderStatus, createTransfer } = useContext(DataContext);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [alert, setAlert] = useState<{ msg: string; type: "error" | "success" } | null>(null);

  const filtered = data.workOrders.filter(w => !statusFilter || w.status === statusFilter);
  const shortageOrders = data.workOrders.filter(w => w.shortage_qty > 0 && w.status !== "Completed");

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Work Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} orders · {shortageOrders.length} with shortages</p>
        </div>
        {user?.role === "admin" && <Btn variant="primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" />Create Work Order</Btn>}
      </div>

      {alert && <Alert msg={alert.msg} type={alert.type} onClose={() => setAlert(null)} />}

      {shortageOrders.length > 0 && (
        <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">Shortage Alert — {shortageOrders.length} work order(s) need stock transfers</span>
          </div>
          <div className="space-y-1">
            {shortageOrders.map(wo => (
              <div key={wo.id} className="flex items-center justify-between text-xs bg-white/70 rounded px-3 py-2 border border-amber-100">
                <span className="font-mono font-medium text-amber-800">{wo.work_order_id}</span>
                <span className="text-slate-600">{wo.item} @ {wo.location}</span>
                <span className="text-rose-600 font-semibold font-mono">Short: {wo.shortage_qty}</span>
                <Btn size="sm" variant="outline" onClick={() => setSelected(wo)}>
                  <ArrowLeftRight className="w-3 h-3" />Request Transfer
                </Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {["", "Assigned", "In Progress", "Completed"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn("px-3 py-1.5 text-xs rounded font-medium border transition-colors", statusFilter === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}>
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <TableWrapper>
          <thead>
            <tr><Th>Work Order</Th><Th>Item</Th><Th>Location</Th><Th>Required</Th><Th>Assigned To</Th><Th>Shortage</Th><Th>Status</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8}><EmptyState message="No work orders found" /></td></tr>
            ) : filtered.map(wo => (
              <tr key={wo.id} className="hover:bg-slate-50/80 transition-colors">
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">{wo.work_order_id}</span></Td>
                <Td><span className="font-medium">{wo.item}</span></Td>
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">{wo.location}</span></Td>
                <Td right><span className="font-mono">{wo.required_qty}</span></Td>
                <Td mono>{wo.assigned_username || "—"}</Td>
                <Td right>
                  {wo.shortage_qty > 0 ? (
                    <span className="font-mono font-semibold text-rose-600 flex items-center justify-end gap-1">
                      <TrendingDown className="w-3 h-3" />{wo.shortage_qty}
                    </span>
                  ) : <span className="text-emerald-500 font-mono">—</span>}
                </Td>
                <Td><Badge status={wo.status} /></Td>
                <Td>
                  <div className="flex gap-1">
                    {(user?.role === "admin" || user?.role === "operations") && wo.status !== "Completed" && (
                      <select value={wo.status} onChange={e => updateWorkOrderStatus(wo.id, e.target.value as WorkOrder["status"])}
                        className="text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option>Assigned</option><option>In Progress</option><option>Completed</option>
                      </select>
                    )}
                    {wo.shortage_qty > 0 && wo.status !== "Completed" && (
                      <Btn size="sm" variant="outline" onClick={() => setSelected(wo)}><ArrowLeftRight className="w-3 h-3" /></Btn>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      {showCreate && <CreateWorkOrderModal onClose={() => setShowCreate(false)} setAlert={setAlert} />}
      {selected && <RequestTransferModal wo={selected} onClose={() => setSelected(null)} setAlert={setAlert} />}
    </div>
  );
}

function CreateWorkOrderModal({ onClose, setAlert }: { onClose: () => void; setAlert: (a: { msg: string; type: "error" | "success" }) => void }) {
  const { data, createWorkOrder } = useContext(DataContext);
  const [form, setForm] = useState({ location: "", item: "", required_qty: "", notes: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ available: number; shortage: number } | null>(null);

  const items = [...new Set(data.inventory.map(i => i.item))].sort();
  const locations = [...new Set(data.inventory.map(i => i.location))].sort();

  useEffect(() => {
    if (!form.item || !form.location) { setPreview(null); return; }
    const available = data.inventory.filter(i => i.item === form.item && i.location === form.location).reduce((s, i) => s + i.available_qty, 0);
    const reqQty = parseFloat(form.required_qty) || 0;
    setPreview({ available, shortage: Math.max(0, reqQty - available) });
  }, [form.item, form.location, form.required_qty, data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const qty = parseFloat(form.required_qty);
    if (isNaN(qty) || qty <= 0) { setErr("Required quantity must be > 0"); return; }
    setSaving(true);
    const result = await createWorkOrder({ location: form.location, item: form.item, required_qty: qty, notes: form.notes || undefined });
    setSaving(false);
    if (!result.ok) { setErr(result.error!); return; }
    const shortage = result.data!.shortage_qty;
    setAlert({ msg: `Work order created.${shortage > 0 ? ` Shortage of ${shortage} units detected.` : " Sufficient stock available."}`, type: shortage > 0 ? "error" : "success" });
    onClose();
  };

  return (
    <Modal title="Create Work Order" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && <Alert msg={err} type="error" onClose={() => setErr("")} />}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Item" value={form.item} onChange={v => setForm({ ...form, item: v })} options={items.map(i => ({ value: i, label: i }))} required placeholder="Select item…" />
          <Select label="Location" value={form.location} onChange={v => setForm({ ...form, location: v })} options={locations.map(l => ({ value: l, label: l }))} required placeholder="Select location…" />
        </div>
        <Input label="Required Qty" type="number" value={form.required_qty} onChange={v => setForm({ ...form, required_qty: v })} required min={1} />

        {preview !== null && (
          <div className={cn("rounded px-4 py-3 border text-sm", preview.shortage > 0 ? "bg-rose-50 border-rose-200" : "bg-emerald-50 border-emerald-200")}>
            <div className="flex items-center justify-between">
              <span className={preview.shortage > 0 ? "text-rose-700 font-medium" : "text-emerald-700 font-medium"}>
                {preview.shortage > 0 ? <><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />Shortage Detected</> : <><CheckCircle className="w-3.5 h-3.5 inline mr-1" />Stock Sufficient</>}
              </span>
              <span className="font-mono text-xs">Available: {preview.available}</span>
            </div>
            {preview.shortage > 0 && <p className="text-rose-600 text-xs mt-1 font-mono">Shortage: {preview.shortage} units — a transfer will be needed</p>}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Optional notes…"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={saving}>{saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}Create Work Order</Btn>
        </div>
      </form>
    </Modal>
  );
}

function RequestTransferModal({ wo, onClose, setAlert }: { wo: WorkOrder; onClose: () => void; setAlert: (a: { msg: string; type: "error" | "success" }) => void }) {
  const { data, createTransfer } = useContext(DataContext);
  const otherLocations = [...new Set(data.inventory.filter(i => i.item === wo.item && i.location !== wo.location && i.available_qty > 0).map(i => i.location))];
  const [source, setSource] = useState(otherLocations[0] || "");
  const [qty, setQty] = useState(String(wo.shortage_qty));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const sourceAvailable = data.inventory.filter(i => i.item === wo.item && i.location === source).reduce((s, i) => s + i.available_qty, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    setSaving(true);
    const result = await createTransfer({ source_location: source, destination_location: wo.location, item: wo.item, qty: parseFloat(qty), work_order_id: wo.work_order_id });
    setSaving(false);
    if (!result.ok) { setErr(result.error!); return; }
    setAlert({ msg: `Transfer ${result.data!.transfer_id} requested for ${qty} units of ${wo.item}.`, type: "success" });
    onClose();
  };

  return (
    <Modal title={`Request Transfer — ${wo.work_order_id}`} onClose={onClose}>
      <div className="mb-4 p-3 bg-slate-50 rounded border border-slate-200 text-sm">
        <div className="grid grid-cols-2 gap-y-1 text-xs">
          <span className="text-slate-500">Item:</span><span className="font-medium">{wo.item}</span>
          <span className="text-slate-500">Destination:</span><span className="font-mono">{wo.location}</span>
          <span className="text-slate-500">Shortage:</span><span className="font-mono text-rose-600 font-semibold">{wo.shortage_qty}</span>
        </div>
      </div>
      {otherLocations.length === 0 ? (
        <Alert msg={`No other locations have available ${wo.item} stock.`} type="warn" onClose={() => {}} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {err && <Alert msg={err} type="error" onClose={() => setErr("")} />}
          <Select label="Source Location" value={source} onChange={setSource}
            options={otherLocations.map(l => {
              const avail = data.inventory.filter(i => i.item === wo.item && i.location === l).reduce((s, i) => s + i.available_qty, 0);
              return { value: l, label: `${l} (${avail} available)` };
            })} />
          <Input label="Transfer Qty" type="number" value={qty} onChange={setQty} required min={1} />
          {source && <p className="text-xs text-slate-500">Available at {source}: <span className="font-mono font-semibold text-slate-700">{sourceAvailable}</span></p>}
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={saving}>{saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}<ArrowLeftRight className="w-3.5 h-3.5" />Request Transfer</Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Transfers ───────────────────────────────────────────────────────────────

function TransfersPage() {
  const { data, loading, dispatchTransfer, receiveTransfer } = useContext(DataContext);
  const { user } = useContext(AuthContext);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [alert, setAlert] = useState<{ msg: string; type: "error" | "success" } | null>(null);

  const filtered = data.transfers.filter(t => !statusFilter || t.status === statusFilter);

  const handleDispatch = async (id: string) => {
    const result = await dispatchTransfer(id);
    setAlert({ msg: result.ok ? "Transfer dispatched. Source inventory reduced." : result.error!, type: result.ok ? "success" : "error" });
  };

  const handleReceive = async (id: string) => {
    const result = await receiveTransfer(id);
    setAlert({ msg: result.ok ? "Transfer received. Destination inventory updated." : result.error!, type: result.ok ? "success" : "error" });
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Internal Stock Transfers</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} transfers</p>
        </div>
        {(user?.role === "admin" || user?.role === "operations") && (
          <Btn variant="primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" />New Transfer</Btn>
        )}
      </div>

      {alert && <Alert msg={alert.msg} type={alert.type} onClose={() => setAlert(null)} />}

      <div className="flex gap-2 mb-4">
        {["", "Requested", "Dispatched", "Received"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn("px-3 py-1.5 text-xs rounded font-medium border transition-colors", statusFilter === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}>
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <TableWrapper>
          <thead>
            <tr><Th>Transfer ID</Th><Th>Item</Th><Th>From</Th><Th>To</Th><Th>Qty</Th><Th>Work Order</Th><Th>Status</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8}><EmptyState message="No transfers found" /></td></tr>
            ) : filtered.map(t => (
              <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">{t.transfer_id}</span></Td>
                <Td><span className="font-medium">{t.item}</span></Td>
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">{t.source_location}</span></Td>
                <Td>
                  <span className="flex items-center gap-1 text-xs">
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">{t.destination_location}</span>
                  </span>
                </Td>
                <Td right><span className="font-mono font-semibold">{t.qty}</span></Td>
                <Td mono>{t.work_order_id || "—"}</Td>
                <Td><Badge status={t.status} /></Td>
                <Td>
                  <div className="flex gap-1">
                    {t.status === "Requested" && (user?.role === "admin" || user?.role === "operations") && (
                      <Btn size="sm" variant="primary" onClick={() => handleDispatch(t.id)}><Truck className="w-3 h-3" />Dispatch</Btn>
                    )}
                    {t.status === "Dispatched" && (user?.role === "admin" || user?.role === "operations") && (
                      <Btn size="sm" variant="secondary" onClick={() => handleReceive(t.id)}><CheckCircle className="w-3 h-3" />Receive</Btn>
                    )}
                    {t.status === "Received" && <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="w-3 h-3" />Received</span>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      {showCreate && <CreateTransferModal onClose={() => setShowCreate(false)} setAlert={setAlert} />}
    </div>
  );
}

function CreateTransferModal({ onClose, setAlert }: { onClose: () => void; setAlert: (a: { msg: string; type: "error" | "success" }) => void }) {
  const { data, createTransfer } = useContext(DataContext);
  const [form, setForm] = useState({ source_location: "", destination_location: "", item: "", qty: "", work_order_id: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const items = [...new Set(data.inventory.map(i => i.item))].sort();
  const locations = [...new Set(data.inventory.map(i => i.location))].sort();
  const sourceAvail = form.item && form.source_location
    ? data.inventory.filter(i => i.item === form.item && i.location === form.source_location).reduce((s, i) => s + i.available_qty, 0) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (form.source_location === form.destination_location) { setErr("Source and destination cannot be the same"); return; }
    const qty = parseFloat(form.qty);
    if (isNaN(qty) || qty <= 0) { setErr("Quantity must be > 0"); return; }
    setSaving(true);
    const result = await createTransfer({ source_location: form.source_location, destination_location: form.destination_location, item: form.item, qty, work_order_id: form.work_order_id || undefined });
    setSaving(false);
    if (!result.ok) { setErr(result.error!); return; }
    setAlert({ msg: `Transfer ${result.data!.transfer_id} created.`, type: "success" });
    onClose();
  };

  return (
    <Modal title="Create Internal Transfer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && <Alert msg={err} type="error" onClose={() => setErr("")} />}
        <Select label="Item" value={form.item} onChange={v => setForm({ ...form, item: v })} options={items.map(i => ({ value: i, label: i }))} required placeholder="Select item…" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Source Location" value={form.source_location} onChange={v => setForm({ ...form, source_location: v })} options={locations.map(l => ({ value: l, label: l }))} required placeholder="From…" />
          <Select label="Destination" value={form.destination_location} onChange={v => setForm({ ...form, destination_location: v })} options={locations.map(l => ({ value: l, label: l }))} required placeholder="To…" />
        </div>
        {sourceAvail !== null && (
          <p className="text-xs text-slate-500">Available at source: <span className={cn("font-mono font-semibold", sourceAvail === 0 ? "text-rose-600" : "text-slate-700")}>{sourceAvail}</span></p>
        )}
        <Input label="Quantity" type="number" value={form.qty} onChange={v => setForm({ ...form, qty: v })} required min={1} />
        <Select label="Linked Work Order (optional)" value={form.work_order_id} onChange={v => setForm({ ...form, work_order_id: v })}
          options={data.workOrders.filter(w => w.status !== "Completed").map(w => ({ value: w.work_order_id, label: `${w.work_order_id} — ${w.item}` }))} placeholder="None" />
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={saving}>{saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}<ArrowLeftRight className="w-3.5 h-3.5" />Create Transfer</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ─── Customer Orders ──────────────────────────────────────────────────────────

function CustomerOrdersPage() {
  const { user } = useContext(AuthContext);
  const { data, loading, createCustomerOrder, cancelCustomerOrder } = useContext(DataContext);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [alert, setAlert] = useState<{ msg: string; type: "error" | "success" } | null>(null);

  const filtered = data.customerOrders.filter(o => !statusFilter || o.status === statusFilter);
  const canCreate = user?.role === "sales" || user?.role === "admin";

  const handleCancel = async (id: string) => {
    const result = await cancelCustomerOrder(id);
    setAlert({ msg: result.ok ? "Order cancelled and reservation released." : result.error!, type: result.ok ? "success" : "error" });
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Customer Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} orders</p>
        </div>
        {canCreate && <Btn variant="primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" />Create Order</Btn>}
      </div>

      {alert && <Alert msg={alert.msg} type={alert.type} onClose={() => setAlert(null)} />}

      <div className="flex gap-2 mb-4">
        {["", "Reserved", "Fulfilled", "Cancelled"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn("px-3 py-1.5 text-xs rounded font-medium border transition-colors", statusFilter === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}>
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <TableWrapper>
          <thead>
            <tr><Th>Order ID</Th><Th>Customer</Th><Th>Item</Th><Th>Location</Th><Th>Qty</Th><Th>Status</Th><Th>Created By</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8}><EmptyState message="No customer orders found" /></td></tr>
            ) : filtered.map(co => (
              <tr key={co.id} className="hover:bg-slate-50/80 transition-colors">
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">{co.order_id}</span></Td>
                <Td><span className="font-medium">{co.customer_name}</span></Td>
                <Td>{co.item}</Td>
                <Td><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">{co.location}</span></Td>
                <Td right><span className="font-mono font-semibold">{co.qty}</span></Td>
                <Td><Badge status={co.status} /></Td>
                <Td mono>{co.created_by}</Td>
                <Td>
                  {co.status === "Reserved" && canCreate && (
                    <Btn size="sm" variant="ghost" onClick={() => handleCancel(co.id)} className="hover:text-rose-600"><XCircle className="w-3 h-3" />Cancel</Btn>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      {showCreate && <CreateOrderModal onClose={() => setShowCreate(false)} setAlert={setAlert} />}
    </div>
  );
}

function CreateOrderModal({ onClose, setAlert }: { onClose: () => void; setAlert: (a: { msg: string; type: "error" | "success" }) => void }) {
  const { data, createCustomerOrder } = useContext(DataContext);
  const { user } = useContext(AuthContext);
  const [form, setForm] = useState({ customer_name: "", item: "", location: "", qty: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const items = [...new Set(data.inventory.map(i => i.item))].sort();
  const locations = form.item
    ? [...new Set(data.inventory.filter(i => i.item === form.item && i.available_qty > 0).map(i => i.location))].sort()
    : [...new Set(data.inventory.map(i => i.location))].sort();

  const availableQty = form.item && form.location
    ? data.inventory.filter(i => i.item === form.item && i.location === form.location).reduce((s, i) => s + i.available_qty, 0) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const qty = parseFloat(form.qty);
    if (isNaN(qty) || qty <= 0) { setErr("Quantity must be > 0"); return; }
    setSaving(true);
    const result = await createCustomerOrder({ customer_name: form.customer_name, item: form.item, location: form.location, qty });
    setSaving(false);
    if (!result.ok) { setErr(result.error!); return; }
    setAlert({ msg: `Order ${result.data!.order_id} created. ${qty} units of ${form.item} reserved.`, type: "success" });
    onClose();
  };

  return (
    <Modal title="Create Customer Order & Reserve Stock" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && <Alert msg={err} type="error" onClose={() => setErr("")} />}
        <Input label="Customer Name" value={form.customer_name} onChange={v => setForm({ ...form, customer_name: v })} required placeholder="e.g., Apex Manufacturing" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Item" value={form.item} onChange={v => setForm({ ...form, item: v, location: "" })} options={items.map(i => ({ value: i, label: i }))} required placeholder="Select item…" />
          <Select label="Location" value={form.location} onChange={v => setForm({ ...form, location: v })} options={locations.map(l => ({ value: l, label: l }))} required placeholder="Select location…" />
        </div>
        {availableQty !== null && (
          <div className={cn("px-3 py-2 rounded border text-xs", availableQty === 0 ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-700")}>
            Available stock at {form.location}: <span className="font-mono font-bold">{availableQty}</span> units
            {availableQty === 0 && " — No stock available at this location"}
          </div>
        )}
        <Input label="Order Qty" type="number" value={form.qty} onChange={v => setForm({ ...form, qty: v })} required min={1} />
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={saving}>{saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}<Package className="w-3.5 h-3.5" />Reserve & Create Order</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar() {
  const { data } = useContext(DataContext);
  const totalItems = data.inventory.length;
  const lowStock = data.inventory.filter(i => i.available_qty < 20).length;
  const activeWOs = data.workOrders.filter(w => w.status !== "Completed").length;
  const pendingTransfers = data.transfers.filter(t => t.status !== "Received").length;
  const activeOrders = data.customerOrders.filter(o => o.status === "Reserved").length;

  return (
    <header aria-label="System Metrics" className="grid grid-cols-5 gap-0 border-b border-slate-200 bg-white">
      {[
        { label: "Inventory Records", value: totalItems, icon: Package, color: "text-blue-600" },
        { label: "Low Stock Alerts", value: lowStock, icon: AlertTriangle, color: lowStock > 0 ? "text-amber-600" : "text-slate-400" },
        { label: "Active Work Orders", value: activeWOs, icon: ClipboardList, color: "text-indigo-600" },
        { label: "Pending Transfers", value: pendingTransfers, icon: ArrowLeftRight, color: "text-orange-600" },
        { label: "Reserved Orders", value: activeOrders, icon: ShoppingCart, color: "text-emerald-600" },
      ].map((stat, i) => (
        <div key={i} className={cn("flex items-center gap-3 px-5 py-3", i < 4 && "border-r border-slate-200")}>
          <stat.icon className={cn("w-5 h-5 shrink-0", stat.color)} />
          <div>
            <p className="text-lg font-bold text-slate-800 font-mono leading-none">{stat.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
          </div>
        </div>
      ))}
    </header>
  );
}

// ─── 404 Not Found Page ────────────────────────────────────────────────────────

function NotFoundPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 text-center" role="region" aria-label="404 Page Not Found">
      <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mb-4 text-rose-600 shadow-sm">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-rose-100 text-rose-700 border border-rose-200 mb-3">
        ERROR 404
      </span>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Page Not Found</h1>
      <p className="text-sm text-slate-500 max-w-md mb-6 leading-relaxed">
        The requested ERP view or operations resource does not exist or has been relocated.
      </p>
      <div className="flex items-center gap-3">
        <Btn variant="primary" onClick={() => onNavigate("inventory")}>
          <Package className="w-4 h-4" />
          Return to Inventory
        </Btn>
        <Btn variant="outline" onClick={() => onNavigate("customerorders")}>
          <ShoppingCart className="w-4 h-4" />
          Customer Orders
        </Btn>
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────

function parsePathToPage(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.toLowerCase().replace(/^\/|\/$/g, "");
  if (!path || path === "index.html") return null;
  if (path === "inventory") return "inventory";
  if (path === "workorders" || path === "work-orders") return "workorders";
  if (path === "transfers" || path === "stock-transfers") return "transfers";
  if (path === "customerorders" || path === "customer-orders") return "customerorders";
  return "notfound";
}

function AppShell() {
  const { user } = useContext(AuthContext);
  const [page, setPage] = useState<string>(() => {
    const fromPath = parsePathToPage();
    if (fromPath === "notfound") return "notfound";
    if (fromPath) return fromPath;
    return (user?.role === "sales" || user?.role === "customer") ? "customerorders" : "inventory";
  });

  if (!user) return <LoginPage />;

  const pages: Record<string, React.ReactNode> = {
    inventory: <InventoryPage />,
    workorders: <WorkOrdersPage />,
    transfers: <TransfersPage />,
    customerorders: <CustomerOrdersPage />,
    notfound: <NotFoundPage onNavigate={setPage} />,
  };

  const canAccess: Record<string, UserRole[]> = {
    inventory: ["admin", "operations", "sales"],
    workorders: ["admin", "operations"],
    transfers: ["admin", "operations"],
    customerorders: ["admin", "sales", "customer"],
    notfound: ["admin", "operations", "sales", "customer"],
  };

  const activePage = page === "notfound" ? "notfound" : (canAccess[page]?.includes(user.role) ? page : ((user.role === "sales" || user.role === "customer") ? "customerorders" : "inventory"));

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-[Inter,system-ui,sans-serif]">
      <Sidebar active={activePage} onNav={setPage} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <StatsBar />
        <main id="main-content" tabIndex={-1} aria-label="Operations Dashboard" className="flex-1 overflow-auto">
          {pages[activePage] || <NotFoundPage onNavigate={setPage} />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <AppShell />
      </DataProvider>
    </AuthProvider>
  );
}
