'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useCartStore } from '@/store/cart';
import { usePosSettingsStore } from '@/store/pos-settings';
import { useSidebar } from '@/components/ui/sidebar';
import toast from 'react-hot-toast';
import { ShoppingCart } from 'lucide-react';
import type { Product, Bill, Order } from '@/lib/types';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';

import ProductGrid from '@/components/pos/ProductGrid';
import CartPanel from '@/components/pos/CartPanel';
import MemberSelector from '@/components/pos/MemberSelector';
import AdminExitModal from '@/components/pos/AdminExitModal';
import PrepaidCheckoutModal, {
  type PrepaidPayment,
  type PrepaidDiscount,
} from '@/components/pos/PrepaidCheckoutModal';
import PosTopbar from '@/components/pos/PosTopbar';
import { ProductBarcodeSelectModal } from '@/components/pos/ProductBarcodeSelectModal';
import { usePrinterStore } from '@/hooks/usePrinter';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useI18n } from '@/hooks/useI18n';
import { getCurrencySymbol, getCountryByCode } from '@/lib/countries';

import { useCatalogStore } from '@/store/catalog';

export default function POSPage() {
  const { currentTenant } = useAuthStore();
  const cart = useCartStore();
  const { autoPrintBill } = usePosSettingsStore();
  const { open: leftSidebarOpen } = useSidebar();
  const { t } = useI18n();

  const [submitting, setSubmitting] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Modal states for POS Koperasi
  const [showMemberSelector, setShowMemberSelector] = useState(false);
  const [showPrepaidCheckout, setShowPrepaidCheckout] = useState(false);
  const [showAdminExitModal, setShowAdminExitModal] = useState(false);
  const [barcodeDisambiguation, setBarcodeDisambiguation] = useState<{
    isOpen: boolean;
    barcode: string;
    products: Product[];
  }>({
    isOpen: false,
    barcode: '',
    products: [],
  });

  const currency = getCurrencySymbol(
    currentTenant?.currency || 'IDR',
    getCountryByCode(currentTenant?.country ?? 'ID')?.locale
  );
  const { printBill } = usePrinterStore();

  const printBillForTenant = async (bill: Bill, force = false) => {
    if (!currentTenant) return;
    if (!force && !autoPrintBill) return;

    try {
      await printBill(bill, {
        business_name: currentTenant.business_name || 'Koperasi Sembako',
        currency,
        country: currentTenant.country || 'ID',
      });
    } catch (err: any) {
      // Non-fatal: print failure should not block or rollback checkout
      const errMsg = err?.message || 'Printer tidak terhubung atau offline';
      toast.error(`⚠️ Struk tidak tercetak: ${errMsg}`, {
        id: 'printer-error-toast',
        duration: 6000,
      });
    }
  };

  useEffect(() => {
    useCatalogStore.getState().initCatalog();
  }, []);

  // Direct scan or click adds product to cart (+1 qty) with stock limits
  const handleProductClick = useCallback(
    (product: Product) => {
      const res = cart.addItem(product, 1);
      if (!res.success) {
        toast.error(res.message || `Stok '${product.name}' sudah mencapai batas maksimal.`);
      }
    },
    [cart]
  );

  // Barcode scanner listener - 100% On-Demand Exact Lookup + LRU Cache
  const anyModalOpen = showMemberSelector || showPrepaidCheckout || showAdminExitModal;

  useBarcodeScanner(async (code) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    try {
      const res = await api.get(`/products/lookup-barcode?code=${encodeURIComponent(trimmed)}`);

      // If multiple products share the same barcode
      if (res.data?.multiple && Array.isArray(res.data?.products) && res.data.products.length > 1) {
        setBarcodeDisambiguation({
          isOpen: true,
          barcode: trimmed,
          products: res.data.products,
        });
        return;
      }

      const product = res.data?.product;

      if (product) {
        if (!product.is_active) {
          toast.error('Produk tidak aktif.');
          return;
        }
        // If disambiguation modal was open, close it since new barcode was scanned
        setBarcodeDisambiguation({ isOpen: false, barcode: '', products: [] });
        const addRes = cart.addItem(product, 1);
        if (!addRes.success) {
          toast.error(addRes.message || `Stok '${product.name}' sudah mencapai batas maksimal.`);
        } else {
          toast.success(`+1 ${product.name}`, { duration: 1000 });
        }
      } else {
        toast.error('Produk belum terdaftar.');
      }
    } catch (err: any) {
      if (err.response?.status === 404) {
        toast.error('Produk belum terdaftar.');
      } else if (err.response?.status === 422) {
        toast.error('Produk tidak aktif.');
      } else {
        toast.error('Gagal memproses scan barcode.');
      }
    }
  }, !anyModalOpen);

  // Keyboard shortcuts: F2 (Member), F4 (Checkout), Ctrl+Shift+X (Admin Exit)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setShowMemberSelector(true);
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (cart.items.length > 0 && !submitting) {
          setShowPrepaidCheckout(true);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toUpperCase() === 'X') {
        e.preventDefault();
        setShowAdminExitModal(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [cart.items.length, submitting]);

  // IPC listener for Admin Exit Modal triggered from Electron Main Process
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onOpenAdminExitModal) return;
    const cleanup = window.electronAPI.onOpenAdminExitModal(() => {
      setShowAdminExitModal(true);
    });
    return cleanup;
  }, []);


  // Trigger checkout modal
  const handlePlaceOrder = () => {
    if (cart.items.length === 0) {
      toast.error('Keranjang belanja masih kosong');
      return;
    }
    setShowPrepaidCheckout(true);
  };

  // Execute checkout: Order -> Bill -> Payment (Cash / Salary Deduction) -> Print -> Reset
  const handlePrepaidCheckout = async (
    payments: PrepaidPayment[],
    _walletAmount: number,
    _discount: PrepaidDiscount | null,
    notes?: string
  ) => {
    setShowPrepaidCheckout(false);
    setSubmitting(true);

    try {
      // Step 1: Create the Order (explicitly takeaway, no tables, single guest)
      const { data: orderData } = await api.post('/orders', {
        table_id: null,
        customer_id: cart.member?.id || cart.customerId || null,
        type: 'takeaway',
        guest_count: 1,
        special_instructions: notes || cart.orderNotes || undefined,
        items: cart.items.map((item) => ({
          product_id: item.product.id,
          addon_group_id: (item.product as any).addon_group_id || undefined,
          is_bundle: Boolean((item.product as any).is_bundle),
          quantity: item.quantity,
          addons: item.addons || null,
          special_instructions: item.special_instructions || null,
        })),
      });

      const orderId = orderData.order.id;

      // Step 2: Generate Bill
      const { data: billData } = await api.post('/bills/generate', {
        order_id: orderId,
      });
      const billId = billData.bill.id;

      // Step 3: Record Payment
      let paidBill: Bill = billData.bill;
      let salaryDeductionNumber: string | null = null;

      for (const p of payments) {
        if (!p.amount || p.amount <= 0) continue;

        const res = await api.post(`/bills/${billId}/payment`, {
          amount: p.amount,
          method: p.method,
          notes: notes || p.notes || undefined,
          customer_id: cart.member?.id || cart.customerId || undefined,
        });

        paidBill = res.data?.bill || paidBill;
        if (res.data?.salary_deduction?.deduction_number) {
          salaryDeductionNumber = res.data.salary_deduction.deduction_number;
        }
      }

      // Step 4: Success notification
      if (salaryDeductionNumber) {
        toast.success(`Potong Gaji Berhasil! (${salaryDeductionNumber})`, { duration: 4000 });
      } else {
        toast.success(`Pembayaran Tunai Berhasil (${orderData.order.order_number})`, { duration: 3000 });
      }

      // Step 5: Thermal Receipt Print (non-blocking)
      await printBillForTenant(paidBill, true);

      // Step 6: Reset Cart & Member state only after successful payment
      cart.clearCart();
      setMobileCartOpen(false);
    } catch (err: any) {
      console.error('[POS] Checkout failed:', err);
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Gagal memproses transaksi. Silakan periksa kembali.';
      toast.error(errorMsg, { duration: 5000 });
    } finally {
      setSubmitting(false);
      useCatalogStore.getState().refreshCatalog(true);
    }
  };

  const cartPanelProps = {
    submitting,
    onPlaceOrder: handlePlaceOrder,
    onOpenMemberSelector: () => setShowMemberSelector(true),
  };

  const itemCount = cart.itemCount();

  return (
    <>
      <PosTopbar tables={[]} onShowTablePicker={() => {}} />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden p-3 sm:p-4 gap-3 sm:gap-4">
        {/* Product Grid — full width on mobile, flex-1 on desktop */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          <ProductGrid
            onProductClick={handleProductClick}
            sidebarOpen={leftSidebarOpen}
          />
        </div>

        {/* Desktop Cart — always open, hidden on mobile */}
        <div className="hidden md:flex md:w-84 lg:w-96 md:shrink-0 h-full">
          <CartPanel {...cartPanelProps} />
        </div>
      </div>

      {/* Mobile: Floating Cart Button + Bottom Sheet Drawer */}
      <Drawer open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <DrawerTrigger asChild>
          <button
            type="button"
            className="fixed bottom-5 right-5 z-40 w-14 h-14 bg-emerald-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-emerald-700 transition-colors md:hidden active:scale-95"
          >
            <ShoppingCart size={22} />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[11px] w-5 h-5 rounded-full flex items-center justify-center font-bold shadow-sm">
                {itemCount}
              </span>
            )}
          </button>
        </DrawerTrigger>
        <DrawerContent className="max-h-[88vh]">
          <div className="overflow-y-auto max-h-[82vh] px-3 pb-4">
            <CartPanel {...cartPanelProps} variant="drawer" />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Member Selector Modal */}
      <MemberSelector
        isOpen={showMemberSelector}
        onClose={() => setShowMemberSelector(false)}
        onSelectMember={(member) => cart.setMember(member)}
        onClearMember={() => cart.clearMember()}
        selectedMember={cart.member}
      />

      {/* Prepaid Checkout Modal (Cash / Salary Deduction) */}
      {showPrepaidCheckout && (
        <PrepaidCheckoutModal
          currency={currency}
          onClose={() => setShowPrepaidCheckout(false)}
          onConfirm={handlePrepaidCheckout}
          onOpenMemberSelector={() => {
            setShowPrepaidCheckout(false);
            setShowMemberSelector(true);
          }}
        />
      )}

      {/* Admin Exit & Kiosk Recovery Modal */}
      <AdminExitModal
        isOpen={showAdminExitModal}
        onClose={() => setShowAdminExitModal(false)}
      />

      {/* Barcode Multi-Product Disambiguation Modal */}
      <ProductBarcodeSelectModal
        isOpen={barcodeDisambiguation.isOpen}
        barcode={barcodeDisambiguation.barcode}
        products={barcodeDisambiguation.products}
        onSelect={(selectedProduct) => {
          handleProductClick(selectedProduct);
          setBarcodeDisambiguation({ isOpen: false, barcode: '', products: [] });
        }}
        onCancel={() => {
          setBarcodeDisambiguation({ isOpen: false, barcode: '', products: [] });
        }}
      />
    </>
  );
}


