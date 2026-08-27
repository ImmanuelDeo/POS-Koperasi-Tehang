'use client';

import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  User,
  UserCheck,
  CreditCard,
  Building2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/store/cart';
import type { Table, Order, OrderItem, CartItem } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

interface Props {
  tables?: Table[];
  currency?: string;
  submitting: boolean;
  onPlaceOrder: () => void;
  onShowTablePicker?: () => void;
  onOpenMemberSelector?: () => void;
  onEditItem?: (item: CartItem) => void;
  variant?: 'sidebar' | 'drawer';
  existingOrder?: Order | null;
}

export default function CartPanel({
  submitting,
  onPlaceOrder,
  onOpenMemberSelector,
  variant = 'sidebar',
  existingOrder,
}: Props) {
  const cart = useCartStore();
  const fmt = useFormatCurrency();
  const member = cart.member;
  const savings = cart.memberSavings();
  const totalAmount = cart.subtotal();

  const isDrawer = variant === 'drawer';

  return (
    <div
      className={
        isDrawer
          ? 'flex flex-col w-full h-full'
          : 'w-full h-full bg-white rounded-2xl border border-gray-200/80 flex flex-col shadow-sm overflow-hidden'
      }
    >
      {/* ── Member / Customer Card Header ───────────────────────────────────── */}
      <div className="p-3.5 border-b border-gray-100 bg-gradient-to-br from-gray-50 to-white">
        {member ? (
          (() => {
            const monthlyLimit = Number(member.monthly_deduction_limit || 0);
            const monthlyUsage = Number(member.current_monthly_usage || 0);
            const totalHistory = Number(member.total_accumulated_deductions || 0);
            const remainingLimit = monthlyLimit > 0 ? Math.max(0, monthlyLimit - monthlyUsage) : Infinity;
            const isCartOverLimit = monthlyLimit > 0 && cart.subtotal() > remainingLimit;

            return (
              <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <UserCheck size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{member.name}</p>
                      <p className="text-[11px] font-mono text-emerald-800">
                        {member.member_no} {member.employee_id ? `• NIK: ${member.employee_id}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => cart.setMember(null)}
                      title="Ganti transaksi ke Pembeli Umum / Non-Member"
                      className="text-[11px] font-semibold text-gray-600 hover:text-red-700 bg-white px-2 py-1 rounded-md border border-gray-200 hover:bg-red-50 hover:border-red-200 transition-colors"
                    >
                      Non-Member
                    </button>
                    <button
                      type="button"
                      onClick={onOpenMemberSelector}
                      className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 bg-white px-2 py-1 rounded-md border border-emerald-300 hover:bg-emerald-100 transition-colors"
                    >
                      Ganti (F2)
                    </button>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-emerald-200/60 grid grid-cols-2 gap-1.5 text-[11px] text-gray-600">
                  <span className="flex items-center gap-1">
                    <Building2 size={12} className="text-gray-400 shrink-0" />
                    <span className="truncate">{member.department || 'Umum'}</span>
                  </span>
                  <span className="flex items-center gap-1 justify-end font-medium">
                    <CreditCard size={12} className="text-emerald-700 shrink-0" />
                    Sisa: <strong className={`font-bold ${isCartOverLimit ? 'text-red-600' : 'text-emerald-900'}`}>
                      {monthlyLimit > 0 ? fmt(remainingLimit) : 'Bebas Limit'}
                    </strong>
                  </span>
                </div>

                <div className="pt-1 border-t border-emerald-200/40 flex items-center justify-between text-[10px] text-gray-500">
                  <span>Terpakai Bulan Ini: <strong className="text-amber-800 font-semibold">{fmt(monthlyUsage)}</strong></span>
                  <span>Total Riwayat Bon: <strong className="text-slate-800 font-semibold">{fmt(totalHistory)}</strong></span>
                </div>

                {isCartOverLimit && (
                  <div className="p-1.5 bg-red-100 text-red-800 text-[10px] rounded-lg font-semibold flex items-center gap-1">
                    <AlertTriangle size={12} className="text-red-600 shrink-0" />
                    <span>Total keranjang melebihi sisa limit potong gaji!</span>
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 border border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                <User size={15} />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-800">Pembeli Umum</p>
                <p className="text-[10px] text-gray-400">Harga standar / non-member</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenMemberSelector}
              className="text-xs font-semibold h-7 px-2.5 bg-white hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
            >
              + Pilih Member (F2)
            </Button>
          </div>
        )}
      </div>

      {/* ── Cart Items List ─────────────────────────────────────────────────── */}
      <div className={isDrawer ? 'overflow-y-auto p-4 max-h-[45vh]' : 'flex-1 overflow-y-auto p-3.5'}>
        {/* Previously ordered items (if existing) */}
        {existingOrder && existingOrder.items && existingOrder.items.filter((i: OrderItem) => i.status !== 'cancelled').length > 0 && (
          <div className="mb-3 pb-3 border-b border-dashed border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Item Sebelumnya</p>
            <div className="space-y-1.5">
              {existingOrder.items.filter((i: OrderItem) => i.status !== 'cancelled').map((item: OrderItem) => (
                <div key={item.id} className="flex justify-between items-center text-xs text-gray-500">
                  <span>{item.quantity}× {item.product_name}</span>
                  <span className="text-gray-400">{fmt(Number(item.total))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cart.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center text-gray-400 ${isDrawer ? 'py-8' : 'h-full'}`}>
            <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-2">
              <ShoppingCart size={28} className="text-gray-300" />
            </div>
            <p className="text-sm font-semibold text-gray-600">Keranjang Masih Kosong</p>
            <p className="text-xs text-gray-400 text-center max-w-[200px] mt-0.5">
              Scan barcode produk atau pilih barang dari katalog
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {cart.items.map((item) => {
              const regPrice = Number(item.product.price) || 0;
              const effectivePrice = typeof item.unit_price === 'number' ? item.unit_price : regPrice;
              const isDiscounted = regPrice > effectivePrice;
              const itemTotal = effectivePrice * item.quantity;

              return (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl border border-gray-100 bg-white hover:border-gray-200 transition-all flex items-start gap-2.5"
                >
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => cart.removeItem(item.id)}
                    className="w-6 h-6 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors mt-0.5 shrink-0"
                    title="Hapus barang"
                  >
                    <Trash2 size={13} />
                  </button>

                  {/* Item Description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-xs font-bold text-gray-900 truncate">
                        {item.product.name}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs font-semibold text-gray-700">
                        {fmt(effectivePrice)}
                      </span>
                      {item.product.unit && (
                        <span className="text-[10px] text-gray-400">
                          /{item.product.unit}
                        </span>
                      )}
                      {isDiscounted && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                          Hemat {fmt(regPrice - effectivePrice)}
                        </span>
                      )}
                    </div>

                    {item.special_instructions && (
                      <p className="text-[11px] text-gray-400 italic mt-0.5 truncate">{item.special_instructions}</p>
                    )}
                  </div>

                  {/* Quantity Controls (Editable Input with Stock Clamping & Decimal Support) */}
                  <div className="flex items-center gap-1 shrink-0 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        const step = 1;
                        cart.updateQuantity(item.id, item.quantity - step);
                      }}
                      className="w-6 h-6 rounded-md bg-white text-gray-700 hover:bg-gray-200 flex items-center justify-center transition-colors shadow-xs"
                      title="Kurangi"
                    >
                      <Minus size={12} />
                    </button>
                    <input
                      type="number"
                      min={item.product.allow_decimal ? "0.01" : "1"}
                      max={item.product.track_inventory ? item.product.stock_quantity : undefined}
                      step={item.product.allow_decimal ? "0.01" : "1"}
                      value={item.quantity}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          cart.updateQuantity(item.id, val);
                        }
                      }}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (isNaN(val) || val <= 0) {
                          cart.removeItem(item.id);
                        } else {
                          cart.updateQuantity(item.id, val);
                        }
                      }}
                      className="w-12 h-6 text-xs font-bold text-center text-gray-900 bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      title={`Jumlah (Maks: ${item.product.track_inventory ? item.product.stock_quantity : 'Tak terbatas'})`}
                    />
                    <button
                      type="button"
                      disabled={!cart.canIncreaseQuantity(item.id)}
                      onClick={() => {
                        const step = 1;
                        cart.updateQuantity(item.id, item.quantity + step);
                      }}
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors shadow-xs ${
                        !cart.canIncreaseQuantity(item.id)
                          ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                          : 'bg-white text-gray-700 hover:bg-gray-200'
                      }`}
                      title={!cart.canIncreaseQuantity(item.id) ? 'Stok mencapai batas maksimum' : 'Tambah'}
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  {/* Line Total */}
                  <div className="text-right shrink-0 min-w-[65px] self-center">
                    <p className="text-xs font-bold text-gray-900">{fmt(itemTotal)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Cart Footer & Checkout ─────────────────────────────────────────── */}
      <div className="p-3.5 sm:p-4 border-t border-gray-100 bg-gray-50/70">
        {/* Order Notes (Optional) */}
        {cart.items.length > 0 && (
          <div className="mb-3">
            <input
              type="text"
              value={cart.orderNotes}
              onChange={(e) => cart.setOrderNotes(e.target.value.slice(0, 150))}
              placeholder="Catatan transaksi (opsional)..."
              maxLength={150}
              className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
        )}

        <div className="space-y-1.5 mb-3">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Total Item ({cart.itemCount()})</span>
            <span>{cart.items.length} jenis</span>
          </div>

          {savings > 0 && (
            <div className="flex justify-between text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200/60">
              <span className="flex items-center gap-1">
                <Sparkles size={12} /> Hemat Member
              </span>
              <span>- {fmt(savings)}</span>
            </div>
          )}

          <div className="flex justify-between items-baseline pt-1 border-t border-gray-200">
            <span className="font-bold text-gray-900 text-sm">TOTAL TAGIHAN</span>
            <span className="font-black text-xl text-emerald-700">
              {fmt(totalAmount)}
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          {cart.items.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => cart.clearCart()}
              disabled={submitting}
              className="px-3 h-11 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
              title="Kosongkan Keranjang"
            >
              <Trash2 size={16} />
            </Button>
          )}

          <Button
            type="button"
            onClick={onPlaceOrder}
            disabled={submitting || cart.items.length === 0}
            className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md active:scale-98 transition-all"
            size="lg"
          >
            {submitting ? 'Memproses...' : `BAYAR (F4) • ${fmt(totalAmount)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

