'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Banknote,
  ShoppingBag,
  TrendingUp,
  Users,
  ClipboardList,
  ArrowRight,
  RefreshCw,
  CreditCard,
  Percent,
} from 'lucide-react';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import PeriodSelector, { PeriodFilterState, PeriodType } from '@/components/ui/PeriodSelector';
import SalesTrendChart, { TrendDataPoint } from '@/components/dashboard/SalesTrendChart';
import PaymentCompositionCard, { PaymentMethodItem } from '@/components/dashboard/PaymentCompositionCard';
import TopProductsCard, { TopProductItem } from '@/components/dashboard/TopProductsCard';
import SalaryDeductionsAuditCard, { SalaryDeductionsStatusAudit } from '@/components/dashboard/SalaryDeductionsAuditCard';

interface DashboardData {
  period: string;
  range: {
    startDate: string;
    endDate: string;
    label: string;
    timezone: string;
  };
  kpis: {
    netSales: number;
    grossSales: number;
    totalDiscounts: number;
    totalOrders: number;
    aov: number;
    uniqueMembers: number;
    cashSales: number;
    salaryDeductionSales: number;
  };
  paymentMethods: PaymentMethodItem[];
  salaryDeductionsBreakdown: SalaryDeductionsStatusAudit;
  trend: TrendDataPoint[];
  topProducts: TopProductItem[];
  recentOrders: any[];
}

/** Get today's local date YYYY-MM-DD in Asia/Jakarta */
function getTodayLocal(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default function DashboardPage() {
  const { currentTenant, user } = useAuthStore();
  const router = useRouter();
  const fmt = useFormatCurrency();

  const userRole = currentTenant?.role || user?.role || 'cashier';
  const userPermissions = currentTenant?.permissions || user?.permissions || [];

  const isAuthorized =
    userRole === 'owner' ||
    userRole === 'admin' ||
    userRole === 'office_hr' ||
    userRole === 'manager' ||
    userPermissions.includes('dashboard');

  const [filterState, setFilterState] = useState<PeriodFilterState>({
    period: 'daily',
    date: getTodayLocal(),
  });

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (currentTenant && !isAuthorized) {
      router.replace('/pos');
    }
  }, [currentTenant, isAuthorized, router]);

  const fetchDashboardData = useCallback(
    async (showFullLoading = false) => {
      if (!isAuthorized) return;
      if (showFullLoading) setLoading(true);
      else setIsRefreshing(true);

      try {
        const { data: resp } = await api.get('/dashboard/analytics', {
          params: {
            period: filterState.period,
            date: filterState.date,
            startDate: filterState.startDate,
            endDate: filterState.endDate,
          },
        });
        setData(resp);
      } catch (err) {
        console.error('[Dashboard fetch error]', err);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [isAuthorized, filterState]
  );

  useEffect(() => {
    fetchDashboardData(true);
  }, [fetchDashboardData]);

  // Auto-refresh interval every 20s for real-time live data when viewing today
  useEffect(() => {
    if (!isAuthorized || filterState.period !== 'daily') return;
    const interval = setInterval(() => {
      fetchDashboardData(false);
    }, 20000);
    return () => clearInterval(interval);
  }, [isAuthorized, filterState.period, fetchDashboardData]);

  if (!isAuthorized) return null;

  const kpis = data?.kpis || {
    netSales: 0,
    grossSales: 0,
    totalDiscounts: 0,
    totalOrders: 0,
    aov: 0,
    uniqueMembers: 0,
    cashSales: 0,
    salaryDeductionSales: 0,
  };

  const periodLabel = data?.range?.label || 'Hari Ini';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Top Header & Global Period Filter ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard Analitik</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Ikhtisar operasional & penjualan POS Koperasi
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <PeriodSelector
            period={filterState.period}
            date={filterState.date}
            startDate={filterState.startDate}
            endDate={filterState.endDate}
            activeLabel={periodLabel}
            onChange={(newFilter) => setFilterState(newFilter)}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDashboardData(false)}
            disabled={isRefreshing || loading}
            className="flex items-center gap-1.5 text-gray-700 hover:text-gray-900 border-gray-200 h-9 rounded-xl shadow-xs"
            title="Segarkan Data"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-emerald-600' : ''} />
            <span className="hidden sm:inline text-xs font-semibold">Segarkan</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-9 h-9 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── 4 Primary KPI Summary Cards ─────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Penjualan Bersih */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs transition-all hover:shadow-md hover:-translate-y-0.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Penjualan Bersih
                </span>
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <Banknote size={18} />
                </div>
              </div>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {fmt(kpis.netSales)}
              </p>
              <div className="mt-2.5 flex items-center gap-2 text-[11px] text-gray-500 font-medium">
                <span>Bruto: {fmt(kpis.grossSales)}</span>
                {kpis.totalDiscounts > 0 && (
                  <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-semibold">
                    Diskon: -{fmt(kpis.totalDiscounts)}
                  </span>
                )}
              </div>
            </div>

            {/* Card 2: Total Transaksi */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs transition-all hover:shadow-md hover:-translate-y-0.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Total Transaksi
                </span>
                <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
                  <ShoppingBag size={18} />
                </div>
              </div>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {kpis.totalOrders}{' '}
                <span className="text-sm font-semibold text-gray-400">Order</span>
              </p>
              <div className="mt-2.5 text-[11px] text-gray-500 font-medium flex items-center gap-2">
                <span>Tunai: {fmt(kpis.cashSales)}</span>
                <span>•</span>
                <span>Bon: {fmt(kpis.salaryDeductionSales)}</span>
              </div>
            </div>

            {/* Card 3: Rata-Rata Nilai Belanja (AOV) */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs transition-all hover:shadow-md hover:-translate-y-0.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Rata-Rata Belanja (AOV)
                </span>
                <div className="p-2 rounded-xl bg-teal-50 text-teal-700">
                  <TrendingUp size={18} />
                </div>
              </div>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {fmt(kpis.aov)}
              </p>
              <p className="mt-2.5 text-[11px] text-gray-500 font-medium">
                Rata-rata pengeluaran per struk belanja
              </p>
            </div>

            {/* Card 4: Anggota Bertransaksi */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs transition-all hover:shadow-md hover:-translate-y-0.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Anggota Belanja
                </span>
                <div className="p-2 rounded-xl bg-purple-50 text-purple-700">
                  <Users size={18} />
                </div>
              </div>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {kpis.uniqueMembers}{' '}
                <span className="text-sm font-semibold text-gray-400">Anggota</span>
              </p>
              <p className="mt-2.5 text-[11px] text-gray-500 font-medium">
                Member terdaftar yang aktif berbelanja
              </p>
            </div>
          </div>

          {/* ── Native SVG Sales Trend Chart ───────────────────────────────── */}
          <SalesTrendChart data={data?.trend || []} periodLabel={periodLabel} />

          {/* ── 2-Column Section: Top Products & Payment Breakdown ─────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopProductsCard data={data?.topProducts || []} />
            <PaymentCompositionCard data={data?.paymentMethods || []} />
          </div>

          {/* ── 2-Column Section: Salary Deductions & Recent Transactions ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SalaryDeductionsAuditCard
              data={
                data?.salaryDeductionsBreakdown || {
                  pending: { count: 0, total: 0 },
                  confirmed: { count: 0, total: 0 },
                  rejected: { count: 0, total: 0 },
                  cancelled: { count: 0, total: 0 },
                }
              }
            />

            {/* Recent Transactions in Period */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
                    <ClipboardList size={16} />
                  </div>
                  <h3 className="font-bold text-gray-900 text-sm">Transaksi Terakhir</h3>
                </div>
                <Link
                  href="/orders"
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
                >
                  Lihat Semua Order <ArrowRight size={13} />
                </Link>
              </div>

              {(!data?.recentOrders || data.recentOrders.length === 0) ? (
                <div className="py-10 text-center text-gray-400 text-xs my-auto">
                  Belum ada transaksi pada periode ini.
                </div>
              ) : (
                <div className="divide-y divide-gray-100/80 my-auto">
                  {data.recentOrders.map((bill) => {
                    const isSalaryDeduction =
                      bill.payment_details && bill.payment_details.includes('salary_deduction');

                    return (
                      <div
                        key={bill.id}
                        className="flex items-center justify-between py-2.5 hover:bg-gray-50/60 px-2 rounded-xl transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-gray-900">
                              {bill.bill_number}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                isSalaryDeduction
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-blue-50 text-blue-800 border-blue-200'
                              }`}
                            >
                              {isSalaryDeduction ? 'Potong Gaji' : 'Tunai'}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">
                            {bill.customer_name ? (
                              <span>
                                {bill.customer_name}
                                {bill.customer_nik ? ` (${bill.customer_nik.slice(0, 4)}****${bill.customer_nik.slice(-4)})` : ''}
                              </span>
                            ) : (
                              'Pelanggan Umum'
                            )}
                          </p>
                        </div>

                        <div className="text-right shrink-0 pl-3">
                          <p className="text-xs font-bold text-gray-900">{fmt(bill.total)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
