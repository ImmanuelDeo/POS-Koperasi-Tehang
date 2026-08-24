export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  country_code: string;
  is_active: boolean;
}

export interface Tenant {
  id: number;
  business_name: string;
  slug: string;
  database_name: string;
  business_type: 'restaurant';
  service_model?: 'qsr' | 'finedine';
  country: string;
  currency: string;
  timezone: string;
  plan: string;
  status: string;
  role?: string;
  language?: 'id' | 'en' | 'es';
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
  color: string | null;
  icon: string | null;
  children?: Category[];
  products?: Product[];
}

export interface LoyaltyLedger {
  id: number;
  customer_id: number;
  bill_id: number | null;
  type: 'credit' | 'debit';
  amount: number;
  description: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Product {
  id: number;
  category_id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  price: number;
  cost_price: number | null;
  cb_percent?: number;
  tax_type: 'none' | 'inclusive' | 'exclusive';
  tax_rate: number;
  track_inventory: boolean | number;
  stock_quantity: number;
  low_stock_threshold: number | null;
  unit?: string | null;
  allow_decimal?: number | boolean;
  member_price?: number | null;
  min_reorder_qty?: number | null;
  is_active: boolean;
  available_online: boolean;
  has_image: boolean;
  updated_at: string;
  tags: string[] | null;
  variants: Record<string, unknown>[] | null;
  modifiers: Record<string, unknown>[] | null;
  sort_order: number;
  category?: Category;
  addon_groups?: AddonGroup[];
}

export interface AddonGroup {
  id: number | string;
  name: string;
  description: string | null;
  is_required: boolean | number;
  min_selection: number;
  max_selection: number;
  allow_multiple_quantities?: boolean | number;
  sort_order: number;
  is_active: boolean | number;
  addons?: Addon[];
}

export interface Addon {
  id: number | string;
  addon_group_id: number | string;
  name: string;
  price: number;
  quantity?: number;
  is_active: boolean | number;
  sort_order: number;
}

export interface Table {
  id: string;
  name: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'cleaning' | 'held';
  kitchen_station_id: number | null;
  floor: string | null;
  section: string | null;
  is_active: boolean;
  activeOrder?: Order | null;
  current_order?: Order | null;
  reservation_customer_id?: number | null;
  reservation_customer_name?: string | null;
  reservation_customer_phone?: string | null;
}

export interface Customer {
  id: string | number;
  member_no?: string | null;
  employee_id?: string | null;
  nik?: string | null;
  nik_masked?: string | null;
  has_nik?: boolean;
  department?: string | null;
  is_member?: boolean | number;
  salary_deduction_enabled?: boolean | number;
  monthly_deduction_limit?: number;
  outstanding_deduction_limit?: number;
  phone: string;
  phone_digits?: string | null;
  country_code: string;
  name: string;
  email: string | null;
  visits_count?: number;
  total_spent?: number;
  last_visit_at?: string | null;
  wallet_balance?: number;
  global_customer_id?: number | null;
  dietary_preferences?: string[] | null;
  favourite_dishes?: string[] | null;
  tag_counts?: Record<string, number> | null;
  address?: string | null;
}

export interface Order {
  id: number;
  order_number: string;
  table_id: string | null;
  table_name?: string | null;
  customer_id?: number | string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  user_id?: string | null;
  waiter_name?: string | null;
  type: 'dine_in' | 'takeaway' | 'delivery' | 'counter' | 'online';
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  subtotal: number;
  tax_amount: number;
  tax_breakdown?: { title: string; rate: number; amount: number }[] | any;
  discount_amount: number;
  delivery_charge: number;
  packaging_charge?: number;
  round_off?: number;
  total: number;
  guest_count: number | null;
  special_instructions: string | null;
  created_by?: number | string | null;
  created_at: string;
  items?: OrderItem[];
  bills?: Bill[];
  bill?: Bill;
  table?: Table;
  customer?: Customer;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: string | number;
  product_name: string;
  product_sku: string | null;
  unit_price: number;
  quantity: number;
  subtotal: number;
  tax_amount: number;
  discount_amount?: number;
  total: number;
  variant_selection?: VariantSelection | null;
  modifier_selection?: ModifierSelection | null;
  addons?: AddonSelection[] | any[] | null;
  special_instructions: string | null;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
}

export interface VariantSelection {
  [key: string]: string;
}

export interface ModifierSelection {
  [key: string]: string[];
}

export interface AddonSelection {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Bill {
  id: number;
  bill_number: string;
  order_id: number;
  customer_id?: number | string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  discount_type?: string | null;
  discount_value?: number | null;
  discount_reason?: string | null;
  service_charge?: number;
  delivery_charge: number;
  packaging_charge?: number;
  round_off?: number;
  total: number;
  paid_amount: number;
  balance: number;
  payment_status: 'unpaid' | 'partial' | 'paid' | 'refunded';
  payment_details: PaymentDetail[] | null;
  tax_breakdown?: { title: string; rate: number; amount: number }[] | null;
  order?: Order;
  created_at?: string;
}

export interface PaymentDetail {
  method: 'cash' | 'card' | 'upi' | 'wallet' | 'salary_deduction' | 'other';
  amount: number;
  reference?: string;
  salary_deduction_id?: number | string;
  period_month?: string;
  timestamp?: string;
}

export interface Staff {
  id: string;
  name: string;
  email: string | null;
  role: string;
  pin_hash: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface KitchenStation {
  id: number;
  name: string;
  is_active: boolean;
  printer_ip: string | null;
  sort_order: number;
}

// Cooperative Member for POS Koperasi
export interface CooperativeMember {
  id: string;
  nik?: string | null;
  nik_masked?: string | null;
  has_nik?: boolean;
  member_no: string;
  employee_id: string;
  name: string;
  department: string | null;
  phone: string | null;
  is_active: number;
  is_member?: number;
  salary_deduction_enabled: number;
  monthly_deduction_limit: number;
  outstanding_deduction_limit: number;
  current_monthly_usage?: number;
  total_accumulated_deductions?: number;
  current_outstanding?: number;
  remaining_monthly_limit: number;
  remaining_outstanding_limit: number;
}

export interface SalaryDeductionInfo {
  id: number | string;
  deduction_number: string;
  member_id: string;
  order_id: string;
  bill_id: string;
  amount: number;
  period_month: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  member_name?: string;
  member_no?: string;
  employee_id?: string;
}

// Cart types for POS
export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  unit_price: number;
  addons: Addon[];
  special_instructions: string;
}

export type AdminRecoveryAction = 'exit_kiosk' | 'quit_app';

export interface AdminKioskRecoveryResult {
  success: boolean;
  message?: string;
  error?: string;
}


