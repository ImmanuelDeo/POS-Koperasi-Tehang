import { create } from 'zustand';
import type { Customer, Product, Addon, CartItem, CooperativeMember } from '@/lib/types';

/**
 * Calculates the effective unit price for a product.
 * Price rule: Koperasi policy unifies member and general pricing (identical price).
 */
export function getEffectiveUnitPrice(product: Product, _hasActiveMember: boolean): number {
  return product.price;
}

export function sanitizeProductQuantity(quantity: number, allowDecimal?: boolean | number): number {
  if (isNaN(quantity) || !Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  if (allowDecimal === true || allowDecimal === 1) {
    // Round to max 2 decimal places
    return Math.round(quantity * 100) / 100;
  }
  return Math.floor(quantity);
}

export interface AddItemResult {
  success: boolean;
  addedQty: number;
  maxStockReached: boolean;
  currentQty: number;
  message?: string;
}

interface CartState {
  items: CartItem[];
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  tableId: string | null;
  customerId: number | string | null;
  customer: Customer | null;
  member: CooperativeMember | null;
  guestCount: number;
  deliveryAddress: string;
  orderNotes: string;

  addItem: (product: Product, quantity?: number, addons?: Addon[], specialInstructions?: string) => AddItemResult;
  updateItemDetails: (cartItemId: string, quantity: number, addons: Addon[], specialInstructions: string) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  canIncreaseQuantity: (cartItemId: string) => boolean;
  clearCart: () => void;
  loadItems: (items: CartItem[], tableId: string | null, customerId: number | string | null, guestCount: number, orderNotes?: string) => void;
  setOrderType: (type: CartState['orderType']) => void;
  setTableId: (id: string | null) => void;
  setCustomerId: (id: number | string | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setMember: (member: CooperativeMember | null) => void;
  clearMember: () => void;
  repriceCartForMember: (member: CooperativeMember | null) => void;
  setGuestCount: (count: number) => void;
  setDeliveryAddress: (address: string) => void;
  setOrderNotes: (notes: string) => void;

  subtotal: () => number;
  memberSavings: () => number;
  itemCount: () => number;
}

function generateCartItemId(productId: number | string, addons: Addon[], specialInstructions: string): string {
  const parts = [String(productId)];
  if (addons.length > 0) {
    const addonStr = [...addons]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((a) => `${a.id}:${a.quantity || 1}`)
      .join(',');
    parts.push(addonStr);
  }
  if (specialInstructions) {
    parts.push(specialInstructions);
  }
  return parts.join('-');
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  orderType: 'takeaway',
  tableId: null,
  customerId: null,
  customer: null,
  member: null,
  guestCount: 1,
  deliveryAddress: '',
  orderNotes: '',

  addItem: (product, quantity = 1, addons = [], specialInstructions = '') => {
    let finalAddons = addons;
    if (product.is_bundle && Array.isArray((product as any).components) && finalAddons.length === 0) {
      finalAddons = (product as any).components.map((c: any) => ({
        id: c.id || c.product_id,
        name: c.product_name || c.name,
        quantity: Number(c.quantity || 1),
        price: 0,
      }));
    }

    const items = get().items;
    const hasMember = !!get().member;
    const unitPrice = getEffectiveUnitPrice(product, hasMember);
    const itemId = generateCartItemId(product.id, finalAddons, specialInstructions);
    const existing = items.find((i) => i.id === itemId);

    const isDecimal = Boolean(product.allow_decimal);
    const requestedQty = sanitizeProductQuantity(quantity, isDecimal) || 1;
    const currentItemQty = existing ? existing.quantity : 0;
    const isTracked = product.track_inventory === 1 || (product.track_inventory as any) === true;
    const maxStock = isTracked ? Math.max(0, Number(product.stock_quantity || 0)) : Infinity;

    if (isTracked && maxStock <= 0) {
      return {
        success: false,
        addedQty: 0,
        maxStockReached: true,
        currentQty: currentItemQty,
        message: `Stok '${product.name}' habis.`,
      };
    }

    // Calculate target quantity clamped to maxStock
    const newTotalQty = isTracked
      ? Math.min(maxStock, currentItemQty + requestedQty)
      : currentItemQty + requestedQty;

    const actualAdded = newTotalQty - currentItemQty;

    if (actualAdded <= 0) {
      return {
        success: false,
        addedQty: 0,
        maxStockReached: true,
        currentQty: currentItemQty,
        message: `Stok '${product.name}' sudah mencapai batas maksimal di keranjang (${maxStock} ${product.unit || 'pcs'}).`,
      };
    }

    const safeNewTotal = sanitizeProductQuantity(newTotalQty, isDecimal);

    if (existing) {
      set({
        items: items.map((i) =>
          i.id === itemId
            ? { ...i, quantity: safeNewTotal, unit_price: unitPrice }
            : i
        ),
      });
    } else {
      set({
        items: [
          ...items,
          {
            id: itemId,
            product,
            quantity: safeNewTotal,
            unit_price: unitPrice,
            addons: finalAddons,
            special_instructions: specialInstructions,
          },
        ],
      });
    }

    return {
      success: true,
      addedQty: actualAdded,
      maxStockReached: isTracked && safeNewTotal >= maxStock,
      currentQty: safeNewTotal,
    };
  },

  updateItemDetails: (cartItemId, quantity, addons, specialInstructions) => {
    const items = get().items;
    const target = items.find((i) => i.id === cartItemId);
    if (!target) return;

    const hasMember = !!get().member;
    const unitPrice = getEffectiveUnitPrice(target.product, hasMember);
    const isDecimal = Boolean(target.product.allow_decimal);
    const safeQty = sanitizeProductQuantity(quantity, isDecimal) || 1;
    const isTracked = target.product.track_inventory === 1 || (target.product.track_inventory as any) === true;
    const maxStock = isTracked ? Math.max(0, Number(target.product.stock_quantity || 0)) : Infinity;
    const clampedQty = isTracked ? Math.min(maxStock, safeQty) : safeQty;
    const finalQty = sanitizeProductQuantity(clampedQty, isDecimal) || 1;

    const newId = generateCartItemId(target.product.id, addons, specialInstructions);

    if (newId === cartItemId) {
      set({
        items: items.map((i) =>
          i.id === cartItemId
            ? { ...i, quantity: finalQty, unit_price: unitPrice, addons, special_instructions: specialInstructions }
            : i
        ),
      });
      return;
    }

    // The edit produced a config that matches another existing line — merge into it.
    const collision = items.find((i) => i.id === newId && i.id !== cartItemId);
    if (collision) {
      const mergedQty = isTracked ? Math.min(maxStock, collision.quantity + finalQty) : collision.quantity + finalQty;
      set({
        items: items
          .filter((i) => i.id !== cartItemId)
          .map((i) => (i.id === newId ? { ...i, quantity: sanitizeProductQuantity(mergedQty, isDecimal), unit_price: unitPrice } : i)),
      });
    } else {
      set({
        items: items.map((i) =>
          i.id === cartItemId
            ? { ...i, id: newId, quantity: finalQty, unit_price: unitPrice, addons, special_instructions: specialInstructions }
            : i
        ),
      });
    }
  },

  removeItem: (cartItemId) => {
    set({ items: get().items.filter((i) => i.id !== cartItemId) });
  },

  updateQuantity: (cartItemId, quantity) => {
    const items = get().items;
    const item = items.find((i) => i.id === cartItemId);
    if (!item) return;

    const isDecimal = Boolean(item.product.allow_decimal);
    const parsedQty = sanitizeProductQuantity(quantity, isDecimal);

    if (parsedQty <= 0) {
      get().removeItem(cartItemId);
      return;
    }

    const isTracked = item.product.track_inventory === 1 || (item.product.track_inventory as any) === true;
    const maxStock = isTracked ? Math.max(0, Number(item.product.stock_quantity || 0)) : Infinity;
    const clampedQty = isTracked ? Math.min(maxStock, parsedQty) : parsedQty;
    const finalQty = sanitizeProductQuantity(clampedQty, isDecimal);

    if (finalQty <= 0) {
      get().removeItem(cartItemId);
      return;
    }

    set({
      items: items.map((i) =>
        i.id === cartItemId ? { ...i, quantity: finalQty } : i
      ),
    });
  },

  canIncreaseQuantity: (cartItemId) => {
    const item = get().items.find((i) => i.id === cartItemId);
    if (!item) return false;
    const isTracked = item.product.track_inventory === 1 || (item.product.track_inventory as any) === true;
    if (!isTracked) return true;
    return item.quantity < Number(item.product.stock_quantity || 0);
  },

  repriceCartForMember: (member) => {
    const hasMember = !!member;
    set({
      items: get().items.map((item) => ({
        ...item,
        unit_price: getEffectiveUnitPrice(item.product, hasMember),
      })),
    });
  },

  setMember: (member) => {
    set({
      member,
      customerId: member ? member.id : null,
      customer: member
        ? {
            id: member.id,
            name: member.name,
            phone: member.phone || '',
            country_code: '',
            email: null,
          }
        : null,
    });
    get().repriceCartForMember(member);
  },

  clearMember: () => {
    set({ member: null, customerId: null, customer: null });
    get().repriceCartForMember(null);
  },

  clearCart: () => {
    set({
      items: [],
      tableId: null,
      customerId: null,
      customer: null,
      member: null,
      guestCount: 1,
      deliveryAddress: '',
      orderNotes: '',
    });
  },

  loadItems: (items, tableId, customerId, guestCount, orderNotes) => {
    const hasMember = !!get().member;
    const itemsWithPrices = items.map((item) => {
      const isDecimal = Boolean(item.product?.allow_decimal);
      return {
        ...item,
        quantity: sanitizeProductQuantity(item.quantity, isDecimal) || 1,
        unit_price: item.unit_price ?? getEffectiveUnitPrice(item.product, hasMember),
      };
    });
    set({ items: itemsWithPrices, tableId, customerId, guestCount, orderNotes: orderNotes || '' });
  },

  setOrderType: (type) => set({ orderType: type, deliveryAddress: type !== 'delivery' ? '' : undefined }),
  setTableId: (id) => set({ tableId: id }),
  setCustomerId: (id) => set({ customerId: id }),
  setCustomer: (customer) => set({ customer, customerId: customer?.id ?? null }),
  setGuestCount: (count) => set({ guestCount: count }),
  setDeliveryAddress: (address) => set({ deliveryAddress: address }),
  setOrderNotes: (notes) => set({ orderNotes: notes }),

  subtotal: () => {
    return get().items.reduce((sum, item) => {
      const addonTotal = item.addons.reduce((a, addon) => a + Number(addon.price) * (Number(addon.quantity) || 1), 0);
      const effectivePrice = typeof item.unit_price === 'number' ? item.unit_price : item.product.price;
      return sum + (Number(effectivePrice) + addonTotal) * item.quantity;
    }, 0);
  },

  memberSavings: () => {
    if (!get().member) return 0;
    return get().items.reduce((sum, item) => {
      const regPrice = Number(item.product.price) || 0;
      const effectivePrice = typeof item.unit_price === 'number' ? item.unit_price : regPrice;
      const savingsPerUnit = Math.max(0, regPrice - effectivePrice);
      return sum + savingsPerUnit * item.quantity;
    }, 0);
  },

  itemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));

