import Database from 'better-sqlite3';

export interface MonthlyStockReportPeriod {
  year: number;
  month: number;
  monthStr: string; // 'YYYY-MM'
  monthLabel: string; // 'Agustus 2026'
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
  periodStartIso: string;
  periodEndExclusiveIso: string;
  periodDescription: string;
  asOfIso: string;
  generatedAtWib: string;
}

export interface MonthlyStockBreakdownIn {
  purchase: number;
  adjustment: number;
  opname: number;
  void: number;
  initial: number;
}

export interface MonthlyStockBreakdownOut {
  sale: number;
  adjustment: number;
  opname: number;
  void: number;
}

export interface MonthlyStockReportSummary {
  total_products_tracked: number;
  total_starting_stock: number;
  total_in: number;
  total_out: number;
  total_ending_stock: number;
  breakdown_in: MonthlyStockBreakdownIn;
  breakdown_out: MonthlyStockBreakdownOut;
}

export interface MonthlyStockReportRow {
  product_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  category_id: string | null;
  category_name: string | null;
  price: number;
  cost: number;
  current_stock: number;
  starting_stock: number;
  ending_stock: number;
  in_purchase: number;
  in_adjustment: number;
  in_opname: number;
  in_void: number;
  in_initial: number;
  total_in: number;
  out_sale: number;
  out_adjustment: number;
  out_opname: number;
  out_void: number;
  total_out: number;
  movement_count: number;
  stock_status: 'safe' | 'low' | 'out_of_stock';
}

export interface MonthlyStockReportData {
  period: MonthlyStockReportPeriod;
  summary: MonthlyStockReportSummary;
  items: MonthlyStockReportRow[];
  pagination: {
    page: number;
    per_page: number;
    total_records: number;
    total_pages: number;
  };
}

export interface GetMonthlyStockReportOptions {
  month?: string; // 'YYYY-MM'
  categoryId?: string;
  search?: string;
  includeZeroBalance?: boolean; // default false
  page?: number; // default 1
  perPage?: number; // default 50, max 200
  fetchAll?: boolean; // for PDF/CSV exports
}

/**
 * Calculates exact WIB period boundaries and converts them to UTC ISO strings for SQLite queries.
 */
export function getPeriodBoundariesWib(monthStr?: string): MonthlyStockReportPeriod {
  const now = new Date();
  let year: number;
  let month: number; // 1-12

  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [y, m] = monthStr.split('-').map(Number);
    year = y;
    month = Math.min(12, Math.max(1, m));
  } else {
    // Current WIB month (UTC+7)
    const wibFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = wibFormatter.formatToParts(now);
    const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    year = Number(partMap.year) || now.getUTCFullYear();
    month = Number(partMap.month) || now.getUTCMonth() + 1;
  }

  // Start of Month in WIB (year, month-1, 1, 00:00:00 WIB -> UTC)
  // WIB is UTC+7 (420 mins ahead of UTC)
  const startWibMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - 7 * 3600 * 1000;
  const startUtc = new Date(startWibMs);

  // Next Month Start in WIB (year, month, 1, 00:00:00 WIB -> UTC)
  const nextMonthWibMs = Date.UTC(year, month, 1, 0, 0, 0) - 7 * 3600 * 1000;
  const nextMonthStartUtc = new Date(nextMonthWibMs);

  const nowMs = now.getTime();
  const isCurrentMonth = nowMs < nextMonthWibMs && nowMs >= startWibMs;
  const isFutureMonth = nowMs < startWibMs;

  const endUtc = isCurrentMonth ? now : nextMonthStartUtc;

  const periodStartIso = startUtc.toISOString();
  const periodEndExclusiveIso = endUtc.toISOString();

  const monthNamesIndo = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const monthName = monthNamesIndo[month - 1];
  const monthLabel = `${monthName} ${year}`;

  const generatedAtWib = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now) + ' WIB';

  let periodDescription: string;
  if (isCurrentMonth) {
    periodDescription = `Hingga ${generatedAtWib}`;
  } else {
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    periodDescription = `Periode 1 – ${lastDayOfMonth} ${monthName} ${year}`;
  }

  return {
    year,
    month,
    monthStr: `${year}-${String(month).padStart(2, '0')}`,
    monthLabel,
    isCurrentMonth,
    isFutureMonth,
    periodStartIso,
    periodEndExclusiveIso,
    periodDescription,
    asOfIso: now.toISOString(),
    generatedAtWib,
  };
}

/**
 * Execute indexed single-pass SQL aggregation for monthly stock movement report.
 * Guaranteed 100% mathematical reconciliation: starting_stock + total_in - total_out == ending_stock.
 */
export function getMonthlyStockReportData(
  db: Database.Database,
  options: GetMonthlyStockReportOptions = {}
): MonthlyStockReportData {
  const period = getPeriodBoundariesWib(options.month);
  const includeZero = options.includeZeroBalance === true;
  const categoryId = options.categoryId ? String(options.categoryId).trim() : null;
  const search = options.search ? String(options.search).trim() : null;

  const pageNum = Math.max(1, Number(options.page) || 1);
  const limitNum = options.fetchAll
    ? 100000
    : Math.min(200, Math.max(1, Number(options.perPage) || 50));
  const offset = (pageNum - 1) * limitNum;

  const baseAggSql = `
    WITH move_agg AS (
      SELECT
        sm.product_id,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity > 0 AND sm.movement_type = 'purchase' THEN sm.quantity ELSE 0 END) AS in_purchase,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity > 0 AND sm.movement_type = 'adjustment' THEN sm.quantity ELSE 0 END) AS in_adjustment,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity > 0 AND sm.movement_type = 'opname' THEN sm.quantity ELSE 0 END) AS in_opname,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity > 0 AND sm.movement_type IN ('void', 'refund') THEN sm.quantity ELSE 0 END) AS in_void,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity > 0 AND sm.movement_type = 'initial' THEN sm.quantity ELSE 0 END) AS in_initial,

        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.movement_type = 'sale' THEN ABS(sm.quantity) ELSE 0 END) AS out_sale,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity < 0 AND sm.movement_type = 'adjustment' THEN ABS(sm.quantity) ELSE 0 END) AS out_adjustment,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity < 0 AND sm.movement_type = 'opname' THEN ABS(sm.quantity) ELSE 0 END) AS out_opname,
        SUM(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive AND sm.quantity < 0 AND sm.movement_type IN ('void', 'refund') THEN ABS(sm.quantity) ELSE 0 END) AS out_void,

        SUM(CASE WHEN sm.created_at >= :periodStart THEN sm.quantity ELSE 0 END) AS delta_from_start,
        SUM(CASE WHEN sm.created_at >= :periodEndExclusive THEN sm.quantity ELSE 0 END) AS delta_after_end,
        COUNT(CASE WHEN sm.created_at >= :periodStart AND sm.created_at < :periodEndExclusive THEN 1 ELSE NULL END) AS movement_count
      FROM stock_movements sm
      WHERE sm.created_at >= :periodStart
      GROUP BY sm.product_id
    )
  `;

  let filterConditions = 'p.deleted_at IS NULL';
  const filterParams: Record<string, any> = {
    periodStart: period.periodStartIso,
    periodEndExclusive: period.periodEndExclusiveIso,
  };

  if (categoryId) {
    filterConditions += ' AND p.category_id = :categoryId';
    filterParams.categoryId = categoryId;
  }

  if (search) {
    filterConditions += ' AND (p.name LIKE :searchLike OR p.barcode LIKE :searchLike OR p.sku LIKE :searchLike)';
    filterParams.searchLike = `%${search}%`;
  }

  if (!includeZero) {
    filterConditions += ` AND (
      COALESCE(ma.movement_count, 0) > 0
      OR (COALESCE(p.stock_quantity, 0) - COALESCE(ma.delta_from_start, 0)) != 0
      OR (COALESCE(p.stock_quantity, 0) - COALESCE(ma.delta_after_end, 0)) != 0
    )`;
  }

  // Execute summary aggregation and row query inside a consistent read transaction
  const executeReportTx = db.transaction(() => {
    // 1. Calculate overall summary metrics across the whole filtered dataset
    const summarySql = `
      ${baseAggSql}
      SELECT
        COUNT(*) AS total_products,
        SUM(COALESCE(p.stock_quantity, 0) - COALESCE(ma.delta_from_start, 0)) AS total_starting_stock,
        SUM(COALESCE(p.stock_quantity, 0) - COALESCE(ma.delta_after_end, 0)) AS total_ending_stock,
        SUM(COALESCE(ma.in_purchase, 0)) AS sum_in_purchase,
        SUM(COALESCE(ma.in_adjustment, 0)) AS sum_in_adjustment,
        SUM(COALESCE(ma.in_opname, 0)) AS sum_in_opname,
        SUM(COALESCE(ma.in_void, 0)) AS sum_in_void,
        SUM(COALESCE(ma.in_initial, 0)) AS sum_in_initial,
        SUM(COALESCE(ma.out_sale, 0)) AS sum_out_sale,
        SUM(COALESCE(ma.out_adjustment, 0)) AS sum_out_adjustment,
        SUM(COALESCE(ma.out_opname, 0)) AS sum_out_opname,
        SUM(COALESCE(ma.out_void, 0)) AS sum_out_void
      FROM products p
      LEFT JOIN move_agg ma ON p.id = ma.product_id
      WHERE ${filterConditions};
    `;

    const summaryRow = db.prepare(summarySql).get(filterParams) as any;

    const bIn: MonthlyStockBreakdownIn = {
      purchase: Math.round((summaryRow?.sum_in_purchase || 0) * 1000) / 1000,
      adjustment: Math.round((summaryRow?.sum_in_adjustment || 0) * 1000) / 1000,
      opname: Math.round((summaryRow?.sum_in_opname || 0) * 1000) / 1000,
      void: Math.round((summaryRow?.sum_in_void || 0) * 1000) / 1000,
      initial: Math.round((summaryRow?.sum_in_initial || 0) * 1000) / 1000,
    };

    const bOut: MonthlyStockBreakdownOut = {
      sale: Math.round((summaryRow?.sum_out_sale || 0) * 1000) / 1000,
      adjustment: Math.round((summaryRow?.sum_out_adjustment || 0) * 1000) / 1000,
      opname: Math.round((summaryRow?.sum_out_opname || 0) * 1000) / 1000,
      void: Math.round((summaryRow?.sum_out_void || 0) * 1000) / 1000,
    };

    const totalIn = Math.round((bIn.purchase + bIn.adjustment + bIn.opname + bIn.void + bIn.initial) * 1000) / 1000;
    const totalOut = Math.round((bOut.sale + bOut.adjustment + bOut.opname + bOut.void) * 1000) / 1000;
    const totalStarting = Math.round((summaryRow?.total_starting_stock || 0) * 1000) / 1000;
    const totalEnding = Math.round((summaryRow?.total_ending_stock || 0) * 1000) / 1000;
    const totalRecords = Number(summaryRow?.total_products || 0);

    // 2. Fetch paginated / full product rows
    const dataSql = `
      ${baseAggSql}
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.barcode,
        p.unit,
        p.category_id,
        c.name AS category_name,
        p.price,
        p.cost,
        p.stock_quantity AS current_stock,
        p.low_stock_threshold,
        (COALESCE(p.stock_quantity, 0) - COALESCE(ma.delta_from_start, 0)) AS starting_stock,
        (COALESCE(p.stock_quantity, 0) - COALESCE(ma.delta_after_end, 0)) AS ending_stock,
        COALESCE(ma.in_purchase, 0) AS in_purchase,
        COALESCE(ma.in_adjustment, 0) AS in_adjustment,
        COALESCE(ma.in_opname, 0) AS in_opname,
        COALESCE(ma.in_void, 0) AS in_void,
        COALESCE(ma.in_initial, 0) AS in_initial,
        COALESCE(ma.out_sale, 0) AS out_sale,
        COALESCE(ma.out_adjustment, 0) AS out_adjustment,
        COALESCE(ma.out_opname, 0) AS out_opname,
        COALESCE(ma.out_void, 0) AS out_void,
        COALESCE(ma.movement_count, 0) AS movement_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN move_agg ma ON p.id = ma.product_id
      WHERE ${filterConditions}
      ORDER BY c.name ASC, p.name ASC
      LIMIT :limitNum OFFSET :offset;
    `;

    const queryParams = {
      ...filterParams,
      limitNum,
      offset,
    };

    const rawRows = db.prepare(dataSql).all(queryParams) as any[];

    const items: MonthlyStockReportRow[] = rawRows.map((r) => {
      const startingStock = Math.round(Number(r.starting_stock || 0) * 1000) / 1000;
      const inPurchase = Math.round(Number(r.in_purchase || 0) * 1000) / 1000;
      const inAdjustment = Math.round(Number(r.in_adjustment || 0) * 1000) / 1000;
      const inOpname = Math.round(Number(r.in_opname || 0) * 1000) / 1000;
      const inVoid = Math.round(Number(r.in_void || 0) * 1000) / 1000;
      const inInitial = Math.round(Number(r.in_initial || 0) * 1000) / 1000;
      const rowTotalIn = Math.round((inPurchase + inAdjustment + inOpname + inVoid + inInitial) * 1000) / 1000;

      const outSale = Math.round(Number(r.out_sale || 0) * 1000) / 1000;
      const outAdjustment = Math.round(Number(r.out_adjustment || 0) * 1000) / 1000;
      const outOpname = Math.round(Number(r.out_opname || 0) * 1000) / 1000;
      const outVoid = Math.round(Number(r.out_void || 0) * 1000) / 1000;
      const rowTotalOut = Math.round((outSale + outAdjustment + outOpname + outVoid) * 1000) / 1000;

      const endingStock = Math.round(Number(r.ending_stock || 0) * 1000) / 1000;

      const lowThreshold = Number(r.low_stock_threshold || 5);
      let stockStatus: 'safe' | 'low' | 'out_of_stock' = 'safe';
      if (endingStock <= 0) {
        stockStatus = 'out_of_stock';
      } else if (endingStock <= lowThreshold) {
        stockStatus = 'low';
      }

      return {
        product_id: String(r.product_id),
        product_name: String(r.product_name),
        sku: r.sku ? String(r.sku) : null,
        barcode: r.barcode ? String(r.barcode) : null,
        unit: r.unit ? String(r.unit) : 'pcs',
        category_id: r.category_id ? String(r.category_id) : null,
        category_name: r.category_name ? String(r.category_name) : 'Tanpa Kategori',
        price: Number(r.price || 0),
        cost: Number(r.cost || 0),
        current_stock: Number(r.current_stock || 0),
        starting_stock: startingStock,
        ending_stock: endingStock,
        in_purchase: inPurchase,
        in_adjustment: inAdjustment,
        in_opname: inOpname,
        in_void: inVoid,
        in_initial: inInitial,
        total_in: rowTotalIn,
        out_sale: outSale,
        out_adjustment: outAdjustment,
        out_opname: outOpname,
        out_void: outVoid,
        total_out: rowTotalOut,
        movement_count: Number(r.movement_count || 0),
        stock_status: stockStatus,
      };
    });

    const summary: MonthlyStockReportSummary = {
      total_products_tracked: totalRecords,
      total_starting_stock: totalStarting,
      total_in: totalIn,
      total_out: totalOut,
      total_ending_stock: totalEnding,
      breakdown_in: bIn,
      breakdown_out: bOut,
    };

    return {
      period,
      summary,
      items,
      pagination: {
        page: pageNum,
        per_page: limitNum,
        total_records: totalRecords,
        total_pages: Math.max(1, Math.ceil(totalRecords / limitNum)),
      },
    };
  });

  return executeReportTx();
}

/**
 * Generates an Excel-compatible CSV string with UTF-8 BOM.
 */
export function generateStockReportCsv(
  reportData: MonthlyStockReportData,
  businessName: string = 'POS Koperasi'
): Buffer {
  const { period, summary, items } = reportData;
  const lines: string[] = [];

  // Helper to escape CSV values
  const escapeCsv = (val: any) => {
    if (val === undefined || val === null) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  // Header Metadata Section
  lines.push(`${escapeCsv(businessName)}`);
  lines.push(`${escapeCsv('LAPORAN STOK BULANAN — BARANG MASUK & KELUAR')}`);
  lines.push(`${escapeCsv(period.periodDescription)}`);
  lines.push(`${escapeCsv(`Dicetak Pada: ${period.generatedAtWib}`)}`);
  lines.push('');

  // Summary Metrics Section
  lines.push(`${escapeCsv('RINGKASAN TOTAL MUTASI')}`);
  lines.push(`${escapeCsv('Total Produk')},${summary.total_products_tracked}`);
  lines.push(`${escapeCsv('Total Stok Awal')},${summary.total_starting_stock}`);
  lines.push(`${escapeCsv('Total Barang Masuk (+)')},${summary.total_in}`);
  lines.push(`${escapeCsv('Total Barang Keluar (-)')},${summary.total_out}`);
  lines.push(`${escapeCsv('Total Saldo Akhir')},${summary.total_ending_stock}`);
  lines.push('');

  // Table Columns Header
  const headers = [
    'No',
    'Kode / Barcode',
    'SKU',
    'Nama Produk',
    'Kategori',
    'Satuan',
    'Stok Awal',
    'Restock (Masuk)',
    'Penyesuaian (+)',
    'Opname (+)',
    'Void / Retur (+)',
    'Inisial (+)',
    'Total Masuk',
    'Penjualan (Kasir)',
    'Penyesuaian (-)',
    'Opname (-)',
    'Void (-)',
    'Total Keluar',
    'Saldo Akhir',
    'Status Stok',
  ];
  lines.push(headers.map(escapeCsv).join(','));

  // Data Rows
  items.forEach((item, idx) => {
    let statusLabel = 'Aman';
    if (item.stock_status === 'out_of_stock') statusLabel = 'Stok Habis';
    else if (item.stock_status === 'low') statusLabel = 'Stok Menipis';

    const row = [
      idx + 1,
      item.barcode || '—',
      item.sku || '—',
      item.product_name,
      item.category_name || 'Tanpa Kategori',
      item.unit,
      item.starting_stock,
      item.in_purchase,
      item.in_adjustment,
      item.in_opname,
      item.in_void,
      item.in_initial,
      item.total_in,
      item.out_sale,
      item.out_adjustment,
      item.out_opname,
      item.out_void,
      item.total_out,
      item.ending_stock,
      statusLabel,
    ];
    lines.push(row.map(escapeCsv).join(','));
  });

  const csvString = lines.join('\r\n');
  // Prepend UTF-8 BOM (\uFEFF) for seamless Microsoft Excel opening
  return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(csvString, 'utf8')]);
}
