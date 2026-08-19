import { create } from 'zustand';
import type { Customer, Product, Addon, CartItem, CooperativeMember } from '@/lib/types';

/**
 * Calculates the effective unit price for a product based on active member presence.
 * Price rule:
 * - If member is active and product.member_price is a safe integer > 0 -> use member_price.
 * - Otherwise (non-member, or member_price is null/undefined/0/<=0/non-integer) -> fallback to product.price.
 */
export function getEffectiveUnitPrice(product: Product, hasActiveMember: boolean): number {
  if (
    hasActiveMember &&
    typeof product.member_price === 'number' &&
    Number.isSafeInteger(product.member_price) &&
    product.member_price > 0
  ) {
    return product.member_price;
  }
  return product.price;
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

  addItem: (product: Product, quantity?: number, addons?: Addon[], specialInstructions?: string) => void;
  updateItemDetails: (cartItemId: string, quantity: number, addons: Addon[], specialInstructions: string) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
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
    const items = get().items;
    const hasMember = !!get().member;
    const unitPrice = getEffectiveUnitPrice(product, hasMember);
    const itemId = generateCartItemId(product.id, addons, specialInstructions);
    const existing = items.find((i) => i.id === itemId);

    // Enforce positive integer quantity
    const safeQty = Math.max(1, Math.floor(quantity) || 1);

    if (existing) {
      set({
        items: items.map((i) =>
          i.id === itemId
            ? { ...i, quantity: i.quantity + safeQty, unit_price: unitPrice }
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
            quantity: safeQty,
            unit_price: unitPrice,
            addons,
            special_instructions: specialInstructions,
          },
        ],
      });
    }
  },

  updateItemDetails: (cartItemId, quantity, addons, specialInstructions) => {
    const items = get().items;
    const target = items.find((i) => i.id === cartItemId);
    if (!target) return;

    const hasMember = !!get().member;
    const unitPrice = getEffectiveUnitPrice(target.product, hasMember);
    const safeQty = Math.max(1, Math.floor(quantity) || 1);
    const newId = generateCartItemId(target.product.id, addons, specialInstructions);

    if (newId === cartItemId) {
      set({
        items: items.map((i) =>
          i.id === cartItemId
            ? { ...i, quantity: safeQty, unit_price: unitPrice, addons, special_instructions: specialInstructions }
            : i
        ),
      });
      return;
    }

    // The edit produced a config that matches another existing line — merge into it.
    const collision = items.find((i) => i.id === newId && i.id !== cartItemId);
    if (collision) {
      set({
        items: items
          .filter((i) => i.id !== cartItemId)
          .map((i) => (i.id === newId ? { ...i, quantity: i.quantity + safeQty, unit_price: unitPrice } : i)),
      });
    } else {
      set({
        items: items.map((i) =>
          i.id === cartItemId
            ? { ...i, id: newId, quantity: safeQty, unit_price: unitPrice, addons, special_instructions: specialInstructions }
            : i
        ),
      });
    }
  },

  removeItem: (cartItemId) => {
    set({ items: get().items.filter((i) => i.id !== cartItemId) });
  },

  updateQuantity: (cartItemId, quantity) => {
    const safeQty = Math.floor(quantity);
    if (safeQty <= 0) {
      get().removeItem(cartItemId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.id === cartItemId ? { ...i, quantity: safeQty } : i
      ),
    });
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
    const itemsWithPrices = items.map((item) => ({
      ...item,
      quantity: Math.max(1, Math.floor(item.quantity) || 1),
      unit_price: item.unit_price ?? getEffectiveUnitPrice(item.product, hasMember),
    }));
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

