import ExcelJS from 'exceljs';
import {
  SalaryDeductionReportItem,
  SalaryDeductionRekapReportData,
  MemberSalaryDeductionReportData,
  OrdersTransactionReportData,
  TransactionReportOrderItem,
  formatDateIndo,
  formatDateTimeIndo,
} from './reports-pdf';
import { MonthlyStockReportData } from './stock-reports';

// Styling constants for professional look
const HEADER_FILL_COLOR = 'FF1E3A8A'; // Dark Navy Blue
const HEADER_TEXT_COLOR = 'FFFFFFFF'; // White
const SUBHEADER_FILL_COLOR = 'FFF1F5F9'; // Light Slate Gray
const BORDER_COLOR = 'FFE2E8F0';

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: BORDER_COLOR } },
  left: { style: 'thin', color: { argb: BORDER_COLOR } },
  bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
  right: { style: 'thin', color: { argb: BORDER_COLOR } },
};

/**
 * 1. Generate Excel (.xlsx) for Orders Transaction Report
 */
export async function generateOrdersTransactionReportExcel(payload: OrdersTransactionReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = payload.businessName || 'POS Koperasi';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Laporan Transaksi', {
    views: [{ showGridLines: true }],
  });

  // Title block
  worksheet.mergeCells('A1:N1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = (payload.businessName || 'POS KOPERASI').toUpperCase();
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E293B' } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };

  worksheet.mergeCells('A2:N2');
  const subtitleCell = worksheet.getCell('A2');
  subtitleCell.value = `LAPORAN TRANSAKSI PENJUALAN (${payload.periodLabel.toUpperCase()})`;
  subtitleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF475569' } };
  subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };

  // Metadata block
  worksheet.getCell('A4').value = 'Periode Tanggal:';
  worksheet.getCell('B4').value = `${payload.startDate} s/d ${payload.endDate}`;
  worksheet.getCell('A5').value = 'Waktu Unduh:';
  worksheet.getCell('B5').value = payload.printedAt;
  worksheet.getCell('A6').value = 'Petugas / Role:';
  worksheet.getCell('B6').value = `${payload.printedByName} (${payload.printedByRole})`;

  ['A4', 'A5', 'A6'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  // Summary KPI box
  worksheet.getCell('D4').value = 'Total Transaksi:';
  worksheet.getCell('E4').value = payload.summary.totalOrders;
  worksheet.getCell('E4').numFmt = '#,##0';

  worksheet.getCell('D5').value = 'Penjualan Bruto:';
  worksheet.getCell('E5').value = payload.summary.grossSales;
  worksheet.getCell('E5').numFmt = '"Rp" #,##0';

  worksheet.getCell('D6').value = 'Total Diskon:';
  worksheet.getCell('E6').value = payload.summary.totalDiscounts;
  worksheet.getCell('E6').numFmt = '"Rp" #,##0';

  worksheet.getCell('G4').value = 'Penjualan Bersih:';
  worksheet.getCell('H4').value = payload.summary.netSales;
  worksheet.getCell('H4').numFmt = '"Rp" #,##0';
  worksheet.getCell('H4').font = { bold: true, color: { argb: 'FF166534' } };

  worksheet.getCell('G5').value = 'Pembayaran Tunai:';
  worksheet.getCell('H5').value = payload.summary.cashSales;
  worksheet.getCell('H5').numFmt = '"Rp" #,##0';

  worksheet.getCell('G6').value = 'Potong Gaji:';
  worksheet.getCell('H6').value = payload.summary.salaryDeductionSales;
  worksheet.getCell('H6').numFmt = '"Rp" #,##0';

  ['D4', 'D5', 'D6', 'G4', 'G5', 'G6'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  // Table headers
  const tableStartRow = 8;
  const headers = [
    'No',
    'No. Pesanan',
    'No. Struk',
    'Tanggal & Waktu',
    'Pelanggan / Anggota',
    'NIK',
    'No. Anggota',
    'Metode Bayar',
    'Status Bayar',
    'Status Pesanan',
    'Rincian Produk',
    'Subtotal',
    'Diskon',
    'Total Akhir',
  ];

  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = headers;
  headerRow.height = 24;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_TEXT_COLOR } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });

  // Data rows
  payload.orders.forEach((order, idx) => {
    const rowNum = tableStartRow + 1 + idx;
    const row = worksheet.getRow(rowNum);

    const paymentMethodLabel = order.payment_method === 'salary_deduction' ? 'Potong Gaji' : 'Tunai';
    const paymentStatusLabel = order.payment_status === 'paid' ? 'Lunas' : order.payment_status === 'unpaid' ? 'Belum Lunas' : order.payment_status;
    const orderStatusLabel = order.order_status === 'completed' ? 'Selesai' : order.order_status === 'cancelled' ? 'Dibatalkan' : order.order_status;

    row.values = [
      idx + 1,
      order.order_number,
      order.bill_number || '—',
      formatDateTimeIndo(order.created_at),
      order.customer_name || 'Pelanggan Umum',
      order.customer_nik || '—',
      order.customer_member_no || '—',
      paymentMethodLabel,
      paymentStatusLabel,
      orderStatusLabel,
      order.items_summary || '—',
      order.subtotal,
      order.discount_amount,
      order.total,
    ];

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(8).alignment = { horizontal: 'center' };
    row.getCell(9).alignment = { horizontal: 'center' };
    row.getCell(10).alignment = { horizontal: 'center' };

    row.getCell(12).numFmt = '"Rp" #,##0';
    row.getCell(13).numFmt = '"Rp" #,##0';
    row.getCell(14).numFmt = '"Rp" #,##0';

    row.eachCell((cell) => {
      cell.border = thinBorder;
      cell.font = { name: 'Calibri', size: 10 };
    });
  });

  // Auto column widths
  worksheet.columns = [
    { width: 6 },  // No
    { width: 16 }, // No. Pesanan
    { width: 16 }, // No. Struk
    { width: 18 }, // Tanggal & Waktu
    { width: 22 }, // Pelanggan / Anggota
    { width: 18 }, // NIK
    { width: 14 }, // No. Anggota
    { width: 14 }, // Metode Bayar
    { width: 14 }, // Status Bayar
    { width: 14 }, // Status Pesanan
    { width: 32 }, // Rincian Produk
    { width: 15 }, // Subtotal
    { width: 14 }, // Diskon
    { width: 16 }, // Total Akhir
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 2. Generate Excel (.xlsx) for Salary Deductions Recap (Rekapitulasi Potong Gaji)
 */
export async function generateSalaryDeductionsRekapExcel(payload: SalaryDeductionRekapReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = payload.businessName || 'POS Koperasi';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Rekap Potong Gaji', {
    views: [{ showGridLines: true }],
  });

  // Title
  worksheet.mergeCells('A1:L1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = (payload.businessName || 'POS KOPERASI').toUpperCase();
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E293B' } };

  worksheet.mergeCells('A2:L2');
  const subtitleCell = worksheet.getCell('A2');
  subtitleCell.value = payload.reportHeaderTitle || 'REKAPITULASI TRANSAKSI POTONG GAJI';
  subtitleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF475569' } };

  // Metadata
  worksheet.getCell('A4').value = 'Periode:';
  worksheet.getCell('B4').value = `${payload.startDate} s/d ${payload.endDate}`;
  worksheet.getCell('A5').value = 'Filter Status:';
  worksheet.getCell('B5').value = payload.statusFilter === 'all' ? 'Semua Status' : payload.statusFilter.toUpperCase();
  worksheet.getCell('A6').value = 'Waktu Unduh:';
  worksheet.getCell('B6').value = payload.printedAt;

  ['A4', 'A5', 'A6'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  const totalAmount = payload.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  worksheet.getCell('D4').value = 'Total Transaksi:';
  worksheet.getCell('E4').value = payload.items.length;
  worksheet.getCell('E4').numFmt = '#,##0';

  worksheet.getCell('D5').value = 'Total Potongan:';
  worksheet.getCell('E5').value = totalAmount;
  worksheet.getCell('E5').numFmt = '"Rp" #,##0';
  worksheet.getCell('E5').font = { bold: true, color: { argb: 'FF166534' } };

  ['D4', 'D5'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  // Table header
  const tableStartRow = 8;
  const headers = [
    'No',
    'No. Potong Gaji',
    'Periode',
    'Tanggal & Waktu',
    'Nama Anggota',
    'No. Anggota',
    'NIK',
    'Departemen',
    'Nominal Potongan',
    'Status',
    'Dibuat Oleh',
    'Dikonfirmasi Oleh',
    'Waktu Konfirmasi',
  ];

  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = headers;
  headerRow.height = 24;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_TEXT_COLOR } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });

  // Data rows
  payload.items.forEach((item, idx) => {
    const rowNum = tableStartRow + 1 + idx;
    const row = worksheet.getRow(rowNum);

    const statusLabel =
      item.status === 'confirmed'
        ? 'Disetujui'
        : item.status === 'pending'
        ? 'Pending'
        : item.status === 'rejected'
        ? 'Ditolak'
        : 'Dibatalkan';

    row.values = [
      idx + 1,
      item.deduction_number,
      item.period_month,
      formatDateTimeIndo(item.created_at),
      item.member_name,
      item.member_no || item.employee_id || '—',
      item.nik_masked || item.nik || '—',
      item.department || 'Umum',
      Number(item.amount || 0),
      statusLabel,
      item.created_by_name || 'Kasir',
      item.confirmed_by_name || '—',
      item.confirmed_at ? formatDateTimeIndo(item.confirmed_at) : '—',
    ];

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'center' };
    row.getCell(10).alignment = { horizontal: 'center' };
    row.getCell(13).alignment = { horizontal: 'center' };

    row.getCell(9).numFmt = '"Rp" #,##0';

    row.eachCell((cell) => {
      cell.border = thinBorder;
      cell.font = { name: 'Calibri', size: 10 };
    });
  });

  worksheet.columns = [
    { width: 6 },  // No
    { width: 18 }, // No. Potong Gaji
    { width: 12 }, // Periode
    { width: 18 }, // Tanggal & Waktu
    { width: 24 }, // Nama Anggota
    { width: 14 }, // No. Anggota
    { width: 18 }, // NIK
    { width: 16 }, // Departemen
    { width: 18 }, // Nominal Potongan
    { width: 14 }, // Status
    { width: 16 }, // Dibuat Oleh
    { width: 18 }, // Dikonfirmasi Oleh
    { width: 18 }, // Waktu Konfirmasi
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 3. Generate Excel (.xlsx) for Member Salary Deduction Bon (Bon Potong Gaji Anggota)
 */
export async function generateMemberSalaryDeductionExcel(payload: MemberSalaryDeductionReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = payload.businessName || 'POS Koperasi';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Bon Anggota', {
    views: [{ showGridLines: true }],
  });

  // Title
  worksheet.mergeCells('A1:H1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = (payload.businessName || 'POS KOPERASI').toUpperCase();
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E293B' } };

  worksheet.mergeCells('A2:H2');
  const subtitleCell = worksheet.getCell('A2');
  subtitleCell.value = 'RINCIAN BON POTONG GAJI ANGGOTA';
  subtitleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF475569' } };

  // Member info
  worksheet.getCell('A4').value = 'Nama Anggota:';
  worksheet.getCell('B4').value = payload.member.name;
  worksheet.getCell('A5').value = 'No. Anggota / ID:';
  worksheet.getCell('B5').value = payload.member.member_no || payload.member.employee_id || '—';
  worksheet.getCell('A6').value = 'NIK:';
  worksheet.getCell('B6').value = payload.member.nik_masked || '—';
  worksheet.getCell('A7').value = 'Departemen:';
  worksheet.getCell('B7').value = payload.member.department || 'Umum';

  ['A4', 'A5', 'A6', 'A7'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  const totalAmount = payload.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  worksheet.getCell('D4').value = 'Periode Bon:';
  worksheet.getCell('E4').value = `${payload.startDate} s/d ${payload.endDate}`;
  worksheet.getCell('D5').value = 'Limit Bulanan:';
  worksheet.getCell('E5').value = payload.member.monthly_deduction_limit ? Number(payload.member.monthly_deduction_limit) : 0;
  worksheet.getCell('E5').numFmt = '"Rp" #,##0';
  worksheet.getCell('D6').value = 'Total Bon Periode Ini:';
  worksheet.getCell('E6').value = totalAmount;
  worksheet.getCell('E6').numFmt = '"Rp" #,##0';
  worksheet.getCell('E6').font = { bold: true, color: { argb: 'FF166534' } };

  ['D4', 'D5', 'D6'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  // Table header
  const tableStartRow = 9;
  const headers = [
    'No',
    'No. Bon / Potong Gaji',
    'Tanggal & Waktu',
    'Periode',
    'Nominal (Rp)',
    'Status',
    'Kasir Pembuat',
    'Dikonfirmasi Oleh',
    'Waktu Konfirmasi',
  ];

  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = headers;
  headerRow.height = 24;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_TEXT_COLOR } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });

  payload.items.forEach((item, idx) => {
    const rowNum = tableStartRow + 1 + idx;
    const row = worksheet.getRow(rowNum);

    const statusLabel =
      item.status === 'confirmed'
        ? 'Disetujui'
        : item.status === 'pending'
        ? 'Pending'
        : item.status === 'rejected'
        ? 'Ditolak'
        : 'Dibatalkan';

    row.values = [
      idx + 1,
      item.deduction_number,
      formatDateTimeIndo(item.created_at),
      item.period_month,
      Number(item.amount || 0),
      statusLabel,
      item.created_by_name || 'Kasir',
      item.confirmed_by_name || '—',
      item.confirmed_at ? formatDateTimeIndo(item.confirmed_at) : '—',
    ];

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(9).alignment = { horizontal: 'center' };

    row.getCell(5).numFmt = '"Rp" #,##0';

    row.eachCell((cell) => {
      cell.border = thinBorder;
      cell.font = { name: 'Calibri', size: 10 };
    });
  });

  worksheet.columns = [
    { width: 6 },  // No
    { width: 18 }, // No. Bon
    { width: 18 }, // Tanggal & Waktu
    { width: 12 }, // Periode
    { width: 18 }, // Nominal
    { width: 14 }, // Status
    { width: 16 }, // Kasir
    { width: 18 }, // Dikonfirmasi Oleh
    { width: 18 }, // Waktu Konfirmasi
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 4. Generate Excel (.xlsx) for Monthly Stock Report (Laporan Mutasi Stok Bulanan)
 */
export async function generateMonthlyStockReportExcel(
  reportData: MonthlyStockReportData,
  businessName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = businessName || 'POS Koperasi';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Mutasi Stok Bulanan', {
    views: [{ showGridLines: true }],
  });

  // Title block
  worksheet.mergeCells('A1:R1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = (businessName || 'POS KOPERASI').toUpperCase();
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E293B' } };

  worksheet.mergeCells('A2:R2');
  const subtitleCell = worksheet.getCell('A2');
  subtitleCell.value = `LAPORAN MUTASI STOK BULANAN - ${reportData.period.monthLabel.toUpperCase()}`;
  subtitleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF475569' } };

  // Metadata
  worksheet.getCell('A4').value = 'Periode:';
  worksheet.getCell('B4').value = reportData.period.periodDescription;
  worksheet.getCell('A5').value = 'Waktu Generate:';
  worksheet.getCell('B5').value = reportData.period.generatedAtWib;

  ['A4', 'A5'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  // Summary KPI
  worksheet.getCell('D4').value = 'Total Produk Dimonitor:';
  worksheet.getCell('E4').value = reportData.summary.total_products_tracked;
  worksheet.getCell('E4').numFmt = '#,##0';

  worksheet.getCell('D5').value = 'Total Stok Awal:';
  worksheet.getCell('E5').value = reportData.summary.total_starting_stock;
  worksheet.getCell('E5').numFmt = '#,##0';

  worksheet.getCell('G4').value = 'Total Barang Masuk:';
  worksheet.getCell('H4').value = reportData.summary.total_in;
  worksheet.getCell('H4').numFmt = '#,##0';
  worksheet.getCell('H4').font = { bold: true, color: { argb: 'FF166534' } };

  worksheet.getCell('G5').value = 'Total Barang Keluar:';
  worksheet.getCell('H5').value = reportData.summary.total_out;
  worksheet.getCell('H5').numFmt = '#,##0';
  worksheet.getCell('H5').font = { bold: true, color: { argb: 'FF991B1B' } };

  worksheet.getCell('J4').value = 'Total Stok Akhir:';
  worksheet.getCell('K4').value = reportData.summary.total_ending_stock;
  worksheet.getCell('K4').numFmt = '#,##0';
  worksheet.getCell('K4').font = { bold: true, color: { argb: 'FF1E3A8A' } };

  ['D4', 'D5', 'G4', 'G5', 'J4'].forEach((addr) => {
    worksheet.getCell(addr).font = { bold: true, color: { argb: 'FF334155' } };
  });

  // Table header
  const tableStartRow = 8;
  const headers = [
    'No',
    'Kode / SKU',
    'Barcode',
    'Nama Produk',
    'Kategori',
    'Satuan',
    'Harga Jual',
    'Harga Pokok',
    'Stok Awal',
    'Masuk: Beli',
    'Masuk: Koreksi',
    'Masuk: Opname',
    'Total Masuk',
    'Keluar: Jual',
    'Keluar: Koreksi',
    'Keluar: Opname',
    'Total Keluar',
    'Stok Akhir',
    'Status Stok',
    'Estimasi Nilai Stok Akhir',
  ];

  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = headers;
  headerRow.height = 24;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: HEADER_TEXT_COLOR } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder;
  });

  reportData.items.forEach((item, idx) => {
    const rowNum = tableStartRow + 1 + idx;
    const row = worksheet.getRow(rowNum);

    const statusLabel =
      item.stock_status === 'safe'
        ? 'Aman'
        : item.stock_status === 'low'
        ? 'Menipis'
        : 'Habis';

    const stockValue = Number(item.ending_stock || 0) * Number(item.cost || item.price || 0);

    row.values = [
      idx + 1,
      item.sku || '—',
      item.barcode || '—',
      item.product_name,
      item.category_name || 'Umum',
      item.unit || 'pcs',
      Number(item.price || 0),
      Number(item.cost || 0),
      Number(item.starting_stock || 0),
      Number(item.in_purchase || 0),
      Number(item.in_adjustment || 0),
      Number(item.in_opname || 0),
      Number(item.total_in || 0),
      Number(item.out_sale || 0),
      Number(item.out_adjustment || 0),
      Number(item.out_opname || 0),
      Number(item.total_out || 0),
      Number(item.ending_stock || 0),
      statusLabel,
      stockValue,
    ];

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(19).alignment = { horizontal: 'center' };

    row.getCell(7).numFmt = '"Rp" #,##0';
    row.getCell(8).numFmt = '"Rp" #,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = '#,##0';
    row.getCell(11).numFmt = '#,##0';
    row.getCell(12).numFmt = '#,##0';
    row.getCell(13).numFmt = '#,##0';
    row.getCell(14).numFmt = '#,##0';
    row.getCell(15).numFmt = '#,##0';
    row.getCell(16).numFmt = '#,##0';
    row.getCell(17).numFmt = '#,##0';
    row.getCell(18).numFmt = '#,##0';
    row.getCell(20).numFmt = '"Rp" #,##0';

    row.eachCell((cell) => {
      cell.border = thinBorder;
      cell.font = { name: 'Calibri', size: 9.5 };
    });
  });

  worksheet.columns = [
    { width: 5 },  // No
    { width: 14 }, // SKU
    { width: 16 }, // Barcode
    { width: 30 }, // Nama Produk
    { width: 16 }, // Kategori
    { width: 8 },  // Satuan
    { width: 14 }, // Harga Jual
    { width: 14 }, // Harga Pokok
    { width: 11 }, // Stok Awal
    { width: 11 }, // Masuk: Beli
    { width: 11 }, // Masuk: Koreksi
    { width: 11 }, // Masuk: Opname
    { width: 12 }, // Total Masuk
    { width: 11 }, // Keluar: Jual
    { width: 11 }, // Keluar: Koreksi
    { width: 11 }, // Keluar: Opname
    { width: 12 }, // Total Keluar
    { width: 12 }, // Stok Akhir
    { width: 12 }, // Status Stok
    { width: 18 }, // Estimasi Nilai Stok
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
