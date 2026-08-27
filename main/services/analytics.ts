import Database from 'better-sqlite3';

export interface PeriodRange {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'all';
  startDate: string; // YYYY-MM-DD in Asia/Jakarta
  endDate: string;   // YYYY-MM-DD in Asia/Jakarta
  startUtcIso: string; // UTC ISO string
  endUtcIso: string;   // UTC ISO string
  label: string;
  timezone: string;
}

export interface AnalyticsKpis {
  netSales: number;
  grossSales: number;
  totalDiscounts: number;
  totalOrders: number;
  aov: number;
  uniqueMembers: number;
  cashSales: number;
  salaryDeductionSales: number;
}

export interface PaymentBreakdownItem {
  method: string;
  label: string;
  count: number;
  total: number;
  percentage: number;
}

export interface TrendBucket {
  key: string;
  label: string;
  netSales: number;
  orderCount: number;
}

export interface TopProductItem {
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  revenue: number;
  order_count: number;
}

export interface SalaryDeductionsStatusAudit {
  pending: { count: number; total: number };
  confirmed: { count: number; total: number };
  rejected: { count: number; total: number };
  cancelled: { count: number; total: number };
}

export interface DashboardAnalyticsResponse {
  period: string;
  range: PeriodRange;
  kpis: AnalyticsKpis;
  paymentMethods: PaymentBreakdownItem[];
  salaryDeductionsBreakdown: SalaryDeductionsStatusAudit;
  trend: TrendBucket[];
  topProducts: TopProductItem[];
  recentOrders: any[];
}

/**
 * Get current date string (YYYY-MM-DD) in Asia/Jakarta (WIB).
 */
export function getWibDateString(d: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    const offsetDate = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return offsetDate.toISOString().slice(0, 10);
  }
}

/**
 * Convert a WIB date and time to a UTC ISO string.
 * Example: '2026-08-25', '00:00:00.000' -> '2026-08-24T17:00:00.000Z'
 */
export function wibToUtcIso(dateStr: string, timeStr: string = '00:00:00.000'): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes, secondsAndMs] = timeStr.split(':');
  const [seconds, ms] = (secondsAndMs || '00.000').split('.');

  const utcTimestamp = Date.UTC(
    year,
    month - 1,
    day,
    Number(hours) - 7, // subtract 7 hours for WIB
    Number(minutes),
    Number(seconds),
    Number(ms || 0)
  );

  return new Date(utcTimestamp).toISOString();
}

/**
 * Format a Date object to Indonesian date format (e.g. "25 Agu 2026").
 */
export function formatIndonesianDateLabel(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

/**
 * Calculate the exact start and end boundaries for the requested period.
 */
export function calculatePeriodRange(
  period: string = 'daily',
  dateParam?: string,
  startDateParam?: string,
  endDateParam?: string
): PeriodRange {
  const todayWib = getWibDateString(new Date());

  if (period === 'weekly') {
    const refDate = dateParam || todayWib;
    const [y, m, d] = refDate.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    
    // In JS UTC: 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    const dayOfWeek = dateObj.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    
    const mondayObj = new Date(dateObj.getTime() + diffToMonday * 86400000);
    const sundayObj = new Date(mondayObj.getTime() + 6 * 86400000);
    
    const startWib = mondayObj.toISOString().slice(0, 10);
    const endWib = sundayObj.toISOString().slice(0, 10);
    
    return {
      period: 'weekly',
      startDate: startWib,
      endDate: endWib,
      startUtcIso: wibToUtcIso(startWib, '00:00:00.000'),
      endUtcIso: wibToUtcIso(endWib, '23:59:59.999'),
      label: `${formatIndonesianDateLabel(startWib)} – ${formatIndonesianDateLabel(endWib)}`,
      timezone: 'Asia/Jakarta',
    };
  }

  if (period === 'monthly') {
    const refDate = dateParam || todayWib;
    const [year, month] = refDate.split('-').map(Number);
    const startWib = `${year}-${String(month).padStart(2, '0')}-01`;
    
    // Find last day of month
    const nextMonthObj = new Date(Date.UTC(year, month, 1, 12, 0, 0));
    const lastDayObj = new Date(nextMonthObj.getTime() - 86400000);
    const endWib = lastDayObj.toISOString().slice(0, 10);

    const monthName = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, 15)));

    return {
      period: 'monthly',
      startDate: startWib,
      endDate: endWib,
      startUtcIso: wibToUtcIso(startWib, '00:00:00.000'),
      endUtcIso: wibToUtcIso(endWib, '23:59:59.999'),
      label: monthName,
      timezone: 'Asia/Jakarta',
    };
  }

  if (period === 'yearly') {
    const refDate = dateParam || todayWib;
    const [year] = refDate.split('-').map(Number);
    const startWib = `${year}-01-01`;
    const endWib = `${year}-12-31`;

    return {
      period: 'yearly',
      startDate: startWib,
      endDate: endWib,
      startUtcIso: wibToUtcIso(startWib, '00:00:00.000'),
      endUtcIso: wibToUtcIso(endWib, '23:59:59.999'),
      label: `Tahun ${year}`,
      timezone: 'Asia/Jakarta',
    };
  }

  if (period === 'custom') {
    const startWib = startDateParam || todayWib;
    const endWib = endDateParam || startWib;
    
    return {
      period: 'custom',
      startDate: startWib,
      endDate: endWib,
      startUtcIso: wibToUtcIso(startWib, '00:00:00.000'),
      endUtcIso: wibToUtcIso(endWib, '23:59:59.999'),
      label: startWib === endWib ? formatIndonesianDateLabel(startWib) : `${formatIndonesianDateLabel(startWib)} – ${formatIndonesianDateLabel(endWib)}`,
      timezone: 'Asia/Jakarta',
    };
  }

  if (period === 'all') {
    return {
      period: 'all',
      startDate: '2020-01-01',
      endDate: todayWib,
      startUtcIso: '2020-01-01T00:00:00.000Z',
      endUtcIso: wibToUtcIso(todayWib, '23:59:59.999'),
      label: 'Semua Riwayat',
      timezone: 'Asia/Jakarta',
    };
  }

  // Default: daily
  const targetDate = dateParam || todayWib;
  return {
    period: 'daily',
    startDate: targetDate,
    endDate: targetDate,
    startUtcIso: wibToUtcIso(targetDate, '00:00:00.000'),
    endUtcIso: wibToUtcIso(targetDate, '23:59:59.999'),
    label: formatIndonesianDateLabel(targetDate),
    timezone: 'Asia/Jakarta',
  };
}

/**
 * Main analytics computation service.
 */
export function getDashboardAnalytics(
  db: Database.Database,
  params: {
    period?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
  }
): DashboardAnalyticsResponse {
  const range = calculatePeriodRange(params.period, params.date, params.startDate, params.endDate);
  const { startUtcIso, endUtcIso } = range;

  // 1. KPI Aggregations (Paid Bills)
  const kpiRow = db.prepare(`
    SELECT
      COUNT(b.id) as totalOrders,
      COALESCE(SUM(b.subtotal), 0) as grossSales,
      COALESCE(SUM(b.discount_amount), 0) as totalDiscounts,
      COALESCE(SUM(b.total), 0) as netSales,
      COUNT(DISTINCT CASE WHEN c.is_member = 1 THEN b.customer_id ELSE NULL END) as uniqueMembers
    FROM bills b
    LEFT JOIN customers c ON b.customer_id = c.id
    WHERE b.payment_status = 'paid'
      AND (
        (b.paid_at IS NOT NULL AND b.paid_at >= ? AND b.paid_at <= ?)
        OR
        (b.paid_at IS NULL AND b.created_at >= ? AND b.created_at <= ?)
      )
  `).get(startUtcIso, endUtcIso, startUtcIso, endUtcIso) as any;

  const totalOrders = Number(kpiRow?.totalOrders || 0);
  const grossSales = Number(kpiRow?.grossSales || 0);
  const totalDiscounts = Number(kpiRow?.totalDiscounts || 0);
  const netSales = Number(kpiRow?.netSales || 0);
  const uniqueMembers = Number(kpiRow?.uniqueMembers || 0);
  const aov = totalOrders > 0 ? Math.round(netSales / totalOrders) : 0;

  // 2. Payment Method Breakdown (Paid Bills)
  const billPaymentRows = db.prepare(`
    SELECT b.paid_amount, b.payment_details
    FROM bills b
    WHERE b.payment_status = 'paid'
      AND (
        (b.paid_at IS NOT NULL AND b.paid_at >= ? AND b.paid_at <= ?)
        OR
        (b.paid_at IS NULL AND b.created_at >= ? AND b.created_at <= ?)
      )
  `).all(startUtcIso, endUtcIso, startUtcIso, endUtcIso) as any[];

  let cashSales = 0;
  let salaryDeductionSales = 0;
  let cashCount = 0;
  let salaryDeductionCount = 0;
  let otherSales = 0;
  let otherCount = 0;

  for (const row of billPaymentRows) {
    const amount = Number(row.paid_amount || 0);
    const details = row.payment_details || '';
    if (details.includes('salary_deduction')) {
      salaryDeductionSales += amount;
      salaryDeductionCount += 1;
    } else if (details.includes('cash') || details === '' || !details.includes('method')) {
      cashSales += amount;
      cashCount += 1;
    } else {
      otherSales += amount;
      otherCount += 1;
    }
  }

  const totalPaidSum = cashSales + salaryDeductionSales + otherSales;
  const paymentMethods: PaymentBreakdownItem[] = [
    {
      method: 'salary_deduction',
      label: 'Potong Gaji (Bon)',
      count: salaryDeductionCount,
      total: salaryDeductionSales,
      percentage: totalPaidSum > 0 ? Math.round((salaryDeductionSales / totalPaidSum) * 1000) / 10 : 0,
    },
    {
      method: 'cash',
      label: 'Tunai (Cash)',
      count: cashCount,
      total: cashSales,
      percentage: totalPaidSum > 0 ? Math.round((cashSales / totalPaidSum) * 1000) / 10 : 0,
    },
  ];

  if (otherCount > 0) {
    paymentMethods.push({
      method: 'other',
      label: 'Lainnya',
      count: otherCount,
      total: otherSales,
      percentage: totalPaidSum > 0 ? Math.round((otherSales / totalPaidSum) * 1000) / 10 : 0,
    });
  }

  // 3. Salary Deductions Internal Status Breakdown
  const deductionRows = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM salary_deductions
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY status
  `).all(startUtcIso, endUtcIso) as any[];

  const salaryDeductionsBreakdown: SalaryDeductionsStatusAudit = {
    pending: { count: 0, total: 0 },
    confirmed: { count: 0, total: 0 },
    rejected: { count: 0, total: 0 },
    cancelled: { count: 0, total: 0 },
  };

  for (const r of deductionRows) {
    const st = r.status as keyof SalaryDeductionsStatusAudit;
    if (salaryDeductionsBreakdown[st]) {
      salaryDeductionsBreakdown[st] = {
        count: Number(r.count || 0),
        total: Number(r.total || 0),
      };
    }
  }

  // 4. Time-Series Sales Trend
  const trend: TrendBucket[] = [];

  if (range.period === 'daily') {
    // 24 Hour Buckets in WIB (00:00 to 23:00)
    const hourMap = new Map<number, { netSales: number; orderCount: number }>();
    for (let h = 0; h < 24; h++) {
      hourMap.set(h, { netSales: 0, orderCount: 0 });
    }

    const paidBillsInDay = db.prepare(`
      SELECT b.total, COALESCE(b.paid_at, b.created_at) as event_time
      FROM bills b
      WHERE b.payment_status = 'paid'
        AND (
          (b.paid_at IS NOT NULL AND b.paid_at >= ? AND b.paid_at <= ?)
          OR
          (b.paid_at IS NULL AND b.created_at >= ? AND b.created_at <= ?)
        )
    `).all(startUtcIso, endUtcIso, startUtcIso, endUtcIso) as any[];

    for (const b of paidBillsInDay) {
      if (!b.event_time) continue;
      const d = new Date(b.event_time);
      // Convert to WIB hour (+7)
      const wibHour = (d.getUTCHours() + 7) % 24;
      const existing = hourMap.get(wibHour) || { netSales: 0, orderCount: 0 };
      existing.netSales += Number(b.total || 0);
      existing.orderCount += 1;
      hourMap.set(wibHour, existing);
    }

    for (let h = 0; h < 24; h++) {
      const data = hourMap.get(h)!;
      const hourStr = String(h).padStart(2, '0') + ':00';
      trend.push({
        key: hourStr,
        label: hourStr,
        netSales: data.netSales,
        orderCount: data.orderCount,
      });
    }
  } else {
    // Day Buckets in WIB
    const dayMap = new Map<string, { netSales: number; orderCount: number }>();

    // Pre-populate days in range
    const startObj = new Date(range.startDate + 'T12:00:00Z');
    const endObj = new Date(range.endDate + 'T12:00:00Z');
    const curObj = new Date(startObj);

    while (curObj <= endObj) {
      const dateKey = curObj.toISOString().slice(0, 10);
      dayMap.set(dateKey, { netSales: 0, orderCount: 0 });
      curObj.setTime(curObj.getTime() + 86400000);
    }

    const paidBillsInRange = db.prepare(`
      SELECT b.total, COALESCE(b.paid_at, b.created_at) as event_time
      FROM bills b
      WHERE b.payment_status = 'paid'
        AND (
          (b.paid_at IS NOT NULL AND b.paid_at >= ? AND b.paid_at <= ?)
          OR
          (b.paid_at IS NULL AND b.created_at >= ? AND b.created_at <= ?)
        )
    `).all(startUtcIso, endUtcIso, startUtcIso, endUtcIso) as any[];

    for (const b of paidBillsInRange) {
      if (!b.event_time) continue;
      const d = new Date(b.event_time);
      const wibDateStr = getWibDateString(d);
      const existing = dayMap.get(wibDateStr);
      if (existing) {
        existing.netSales += Number(b.total || 0);
        existing.orderCount += 1;
      }
    }

    for (const [dateKey, val] of dayMap.entries()) {
      const parts = dateKey.split('-');
      const shortLabel = `${parts[2]}/${parts[1]}`;
      trend.push({
        key: dateKey,
        label: shortLabel,
        netSales: val.netSales,
        orderCount: val.orderCount,
      });
    }
  }

  // 5. Top 5 Products Sold in Period
  const topProducts = db.prepare(`
    SELECT
      oi.product_id,
      oi.product_name,
      COALESCE(p.unit, 'pcs') as unit,
      COALESCE(SUM(oi.quantity), 0) as quantity,
      COALESCE(SUM(oi.subtotal), 0) as revenue,
      COUNT(DISTINCT oi.order_id) as order_count
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN bills b ON b.order_id = o.id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE b.payment_status = 'paid'
      AND oi.status != 'cancelled'
      AND (
        (b.paid_at IS NOT NULL AND b.paid_at >= ? AND b.paid_at <= ?)
        OR
        (b.paid_at IS NULL AND b.created_at >= ? AND b.created_at <= ?)
      )
    GROUP BY oi.product_id
    ORDER BY quantity DESC, revenue DESC
    LIMIT 5
  `).all(startUtcIso, endUtcIso, startUtcIso, endUtcIso) as any[];

  // 6. Recent 6 Transactions in Period
  const recentBills = db.prepare(`
    SELECT
      b.id,
      b.bill_number,
      b.total,
      b.paid_amount,
      b.payment_details,
      b.created_at,
      b.paid_at,
      o.id as order_id,
      o.order_number,
      o.status as order_status,
      c.name as customer_name,
      c.nik as customer_nik,
      c.is_member as is_member
    FROM bills b
    JOIN orders o ON b.order_id = o.id
    LEFT JOIN customers c ON b.customer_id = c.id
    WHERE b.payment_status = 'paid'
      AND (
        (b.paid_at IS NOT NULL AND b.paid_at >= ? AND b.paid_at <= ?)
        OR
        (b.paid_at IS NULL AND b.created_at >= ? AND b.created_at <= ?)
      )
    ORDER BY COALESCE(b.paid_at, b.created_at) DESC
    LIMIT 6
  `).all(startUtcIso, endUtcIso, startUtcIso, endUtcIso) as any[];

  return {
    period: range.period,
    range,
    kpis: {
      netSales,
      grossSales,
      totalDiscounts,
      totalOrders,
      aov,
      uniqueMembers,
      cashSales,
      salaryDeductionSales,
    },
    paymentMethods,
    salaryDeductionsBreakdown,
    trend,
    topProducts: topProducts.map((p) => ({
      product_id: String(p.product_id),
      product_name: String(p.product_name),
      unit: String(p.unit || 'pcs'),
      quantity: Number(p.quantity || 0),
      revenue: Number(p.revenue || 0),
      order_count: Number(p.order_count || 0),
    })),
    recentOrders: recentBills,
  };
}
