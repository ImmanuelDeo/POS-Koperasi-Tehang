import { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { maskNik } from './privacy';

const pdfMake = require('pdfmake');

// Strict offline security policies: block external URL downloads and arbitrary local file system access
pdfMake.setUrlAccessPolicy(() => false);
pdfMake.setLocalAccessPolicy((filePath: string) => {
  // Only allow standard built-in PDF font references
  return ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier', 'Times'].includes(filePath);
});

// Configure built-in Helvetica fonts
pdfMake.addFonts({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

export function formatRupiah(amount: number): string {
  return 'Rp ' + Math.round(amount || 0).toLocaleString('id-ID');
}

export function formatDateIndo(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function formatDateTimeIndo(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const datePart = d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const timePart = d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${datePart} ${timePart}`;
  } catch {
    return dateStr;
  }
}

export interface SalaryDeductionReportItem {
  id: number;
  deduction_number: string;
  period_month: string;
  created_at: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  member_name: string;
  member_no: string | null;
  employee_id: string | null;
  nik?: string | null;
  nik_masked?: string | null;
  department: string | null;
  bill_receipt_no?: string | null;
  created_by_name?: string | null;
  confirmed_by_name?: string | null;
  confirmed_at?: string | null;
  rejection_reason?: string | null;
}

export interface SalaryDeductionRekapReportData {
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  reportHeaderTitle?: string;
  startDate: string;
  endDate: string;
  statusFilter: string;
  printedAt: string;
  printedByName: string;
  printedByRole: string;
  items: SalaryDeductionReportItem[];
}

export interface MemberSalaryDeductionReportData {
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  reportHeaderTitle?: string;
  member: {
    id: string;
    name: string;
    member_no: string | null;
    employee_id: string | null;
    nik_masked: string | null;
    department: string | null;
    monthly_deduction_limit: number;
    outstanding_deduction_limit: number;
    is_active: boolean;
  };
  startDate: string;
  endDate: string;
  printedAt: string;
  printedByName: string;
  printedByRole: string;
  items: SalaryDeductionReportItem[];
}

export async function createPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const doc = pdfMake.createPdf(docDefinition);
  return doc.getBuffer();
}

/**
 * Generates consolidated PDF summary and itemized table for Salary Deductions (Landscape A4)
 */
export async function generateSalaryDeductionsRekapPdf(data: SalaryDeductionRekapReportData): Promise<Buffer> {
  const totalAmount = data.items.reduce((sum, item) => sum + (item.amount || 0), 0);
  const confirmedAmount = data.items
    .filter((item) => item.status === 'confirmed')
    .reduce((sum, item) => sum + (item.amount || 0), 0);
  const pendingAmount = data.items
    .filter((item) => item.status === 'pending')
    .reduce((sum, item) => sum + (item.amount || 0), 0);
  const rejectedAmount = data.items
    .filter((item) => item.status === 'rejected')
    .reduce((sum, item) => sum + (item.amount || 0), 0);

  const uniqueMembers = new Set(data.items.map((i) => i.member_name)).size;

  // Build table rows
  const tableBody: TableCell[][] = [
    [
      { text: 'No.', style: 'tableHeader', alignment: 'center' },
      { text: 'No. Bon / Struk', style: 'tableHeader' },
      { text: 'Waktu Transaksi', style: 'tableHeader' },
      { text: 'No. Anggota', style: 'tableHeader' },
      { text: 'Nama Anggota', style: 'tableHeader' },
      { text: 'NIK (Masked)', style: 'tableHeader' },
      { text: 'Departemen', style: 'tableHeader' },
      { text: 'Nominal', style: 'tableHeader', alignment: 'right' },
      { text: 'Status', style: 'tableHeader', alignment: 'center' },
      { text: 'Petugas / Kasir', style: 'tableHeader' },
    ],
  ];

  if (data.items.length === 0) {
    tableBody.push([
      {
        text: 'Tidak ada transaksi potong gaji pada periode dan filter yang dipilih.',
        colSpan: 10,
        alignment: 'center',
        italics: true,
        color: '#6B7280',
        margin: [0, 10, 0, 10],
      },
      ...Array(9).fill({ text: '' }),
    ]);
  } else {
    data.items.forEach((item, index) => {
      const masked = item.nik_masked || maskNik(item.nik) || '—';
      const statusLabel =
        item.status === 'confirmed'
          ? 'Disetujui'
          : item.status === 'pending'
          ? 'Tertunda'
          : item.status === 'rejected'
          ? 'Ditolak'
          : 'Dibatalkan';

      const statusColor =
        item.status === 'confirmed'
          ? '#059669'
          : item.status === 'pending'
          ? '#D97706'
          : item.status === 'rejected'
          ? '#DC2626'
          : '#6B7280';

      tableBody.push([
        { text: String(index + 1), alignment: 'center', fontSize: 8 },
        { text: item.deduction_number || `BON-${item.id}`, fontSize: 8, bold: true },
        { text: formatDateTimeIndo(item.created_at), fontSize: 8 },
        { text: item.member_no || item.employee_id || '—', fontSize: 8 },
        { text: item.member_name, fontSize: 8, bold: true },
        { text: masked, fontSize: 8, color: '#374151' },
        { text: item.department || '—', fontSize: 8 },
        { text: formatRupiah(item.amount), fontSize: 8, alignment: 'right', bold: true },
        { text: statusLabel, fontSize: 8, alignment: 'center', color: statusColor, bold: true },
        { text: item.created_by_name || 'Kasir', fontSize: 8 },
      ]);
    });

    // Total summary row
    tableBody.push([
      { text: 'TOTAL REKAPITULASI', colSpan: 7, bold: true, alignment: 'right', fontSize: 9 },
      ...Array(6).fill({ text: '' }),
      { text: formatRupiah(totalAmount), bold: true, alignment: 'right', fontSize: 9 },
      { text: `${data.items.length} Bon`, colSpan: 2, bold: true, alignment: 'center', fontSize: 8 },
      { text: '' },
    ]);
  }

  const docDefinition: TDocumentDefinitions = {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [30, 30, 30, 40],
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 9,
      color: '#1F2937',
    },
    header: () => null,
    footer: (currentPage, pageCount) => ({
      margin: [30, 10, 30, 0],
      columns: [
        {
          text: `POS Koperasi — Laporan Rekapitulasi Potong Gaji (Dokumen Internal)`,
          fontSize: 8,
          color: '#9CA3AF',
        },
        {
          text: `Halaman ${currentPage} dari ${pageCount}`,
          alignment: 'right',
          fontSize: 8,
          color: '#9CA3AF',
        },
      ],
    }),
    content: [
      // Header Section
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: data.businessName || 'POS KOPERASI', fontSize: 14, bold: true, color: '#0F766E' },
              { text: data.businessAddress ? (data.businessAddress + (data.businessPhone ? ` • Telp: ${data.businessPhone}` : '')) : 'Sistem Manajemen Koperasi & Kasir Sembako', fontSize: 9, color: '#4B5563', margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: data.reportHeaderTitle || 'REKAPITULASI TRANSAKSI POTONG GAJI', fontSize: 13, bold: true, color: '#111827' },
              {
                text: `Periode: ${formatDateIndo(data.startDate)} s/d ${formatDateIndo(data.endDate)}`,
                fontSize: 9,
                color: '#374151',
                margin: [0, 2, 0, 0],
              },
              {
                text: `Dicetak: ${data.printedAt} oleh ${data.printedByName} (${data.printedByRole})`,
                fontSize: 8,
                color: '#6B7280',
                margin: [0, 2, 0, 0],
              },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 10, x2: 782, y2: 10, lineWidth: 1.5, lineColor: '#0F766E' }] },
      { text: '', margin: [0, 8] },

      // Summary Cards Block
      {
        table: {
          widths: ['*', '*', '*', '*', '*', '*'],
          body: [
            [
              { text: 'Total Transaksi', style: 'summaryHeader' },
              { text: 'Anggota Terlibat', style: 'summaryHeader' },
              { text: 'Total Nominal', style: 'summaryHeader' },
              { text: 'Disetujui (Confirmed)', style: 'summaryHeader' },
              { text: 'Tertunda (Pending)', style: 'summaryHeader' },
              { text: 'Ditolak / Batal', style: 'summaryHeader' },
            ],
            [
              { text: `${data.items.length} Transaksi`, style: 'summaryVal' },
              { text: `${uniqueMembers} Orang`, style: 'summaryVal' },
              { text: formatRupiah(totalAmount), style: 'summaryVal', bold: true, color: '#0F766E' },
              { text: formatRupiah(confirmedAmount), style: 'summaryVal', color: '#059669' },
              { text: formatRupiah(pendingAmount), style: 'summaryVal', color: '#D97706' },
              { text: formatRupiah(rejectedAmount), style: 'summaryVal', color: '#DC2626' },
            ],
          ],
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#F3F4F6' : '#FFFFFF'),
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      },
      { text: '', margin: [0, 6] },

      // Detail Table
      {
        table: {
          headerRows: 1,
          widths: [20, 85, 75, 55, 110, 85, 65, 80, 55, 65],
          body: tableBody,
        },
        layout: {
          fillColor: (rowIndex: number) => {
            if (rowIndex === 0) return '#0F766E';
            if (rowIndex === tableBody.length - 1 && data.items.length > 0) return '#F9FAFB';
            return rowIndex % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
          },
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
    styles: {
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#FFFFFF',
      },
      summaryHeader: {
        fontSize: 8,
        bold: true,
        color: '#4B5563',
        alignment: 'center',
      },
      summaryVal: {
        fontSize: 9,
        alignment: 'center',
      },
    },
  };

  return createPdfBuffer(docDefinition);
}

/**
 * Generates individual member salary deduction statement (Portrait A4)
 */
export async function generateMemberSalaryDeductionPdf(data: MemberSalaryDeductionReportData): Promise<Buffer> {
  const totalAmount = data.items.reduce((sum, item) => sum + (item.amount || 0), 0);
  const confirmedAmount = data.items
    .filter((item) => item.status === 'confirmed')
    .reduce((sum, item) => sum + (item.amount || 0), 0);
  const pendingAmount = data.items
    .filter((item) => item.status === 'pending')
    .reduce((sum, item) => sum + (item.amount || 0), 0);

  const tableBody: TableCell[][] = [
    [
      { text: 'No.', style: 'tableHeader', alignment: 'center' },
      { text: 'No. Bon / Struk', style: 'tableHeader' },
      { text: 'Tanggal & Waktu', style: 'tableHeader' },
      { text: 'Nominal Potong Gaji', style: 'tableHeader', alignment: 'right' },
      { text: 'Status Approval', style: 'tableHeader', alignment: 'center' },
      { text: 'Petugas Approval', style: 'tableHeader' },
    ],
  ];

  if (data.items.length === 0) {
    tableBody.push([
      {
        text: 'Tidak ada transaksi potong gaji untuk anggota ini pada periode terpilih.',
        colSpan: 6,
        alignment: 'center',
        italics: true,
        color: '#6B7280',
        margin: [0, 10, 0, 10],
      },
      ...Array(5).fill({ text: '' }),
    ]);
  } else {
    data.items.forEach((item, index) => {
      const statusLabel =
        item.status === 'confirmed'
          ? 'Disetujui'
          : item.status === 'pending'
          ? 'Tertunda'
          : item.status === 'rejected'
          ? 'Ditolak'
          : 'Dibatalkan';

      const statusColor =
        item.status === 'confirmed'
          ? '#059669'
          : item.status === 'pending'
          ? '#D97706'
          : item.status === 'rejected'
          ? '#DC2626'
          : '#6B7280';

      tableBody.push([
        { text: String(index + 1), alignment: 'center', fontSize: 8 },
        { text: item.deduction_number || `BON-${item.id}`, fontSize: 8, bold: true },
        { text: formatDateTimeIndo(item.created_at), fontSize: 8 },
        { text: formatRupiah(item.amount), fontSize: 8, alignment: 'right', bold: true },
        { text: statusLabel, fontSize: 8, alignment: 'center', color: statusColor, bold: true },
        { text: item.confirmed_by_name || (item.status === 'pending' ? 'Menunggu HR' : '—'), fontSize: 8 },
      ]);
    });

    tableBody.push([
      { text: 'TOTAL POTONG GAJI', colSpan: 3, bold: true, alignment: 'right', fontSize: 9 },
      ...Array(2).fill({ text: '' }),
      { text: formatRupiah(totalAmount), bold: true, alignment: 'right', fontSize: 9, color: '#0F766E' },
      { text: `${data.items.length} Bon`, colSpan: 2, bold: true, alignment: 'center', fontSize: 8 },
      { text: '' },
    ]);
  }

  const docDefinition: TDocumentDefinitions = {
    pageOrientation: 'portrait',
    pageSize: 'A4',
    pageMargins: [35, 35, 35, 45],
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 9,
      color: '#1F2937',
    },
    footer: (currentPage, pageCount) => ({
      margin: [35, 10, 35, 0],
      columns: [
        {
          text: `POS Koperasi — Rincian Bon Potong Gaji Anggota (Dokumen Sah)`,
          fontSize: 8,
          color: '#9CA3AF',
        },
        {
          text: `Halaman ${currentPage} dari ${pageCount}`,
          alignment: 'right',
          fontSize: 8,
          color: '#9CA3AF',
        },
      ],
    }),
    content: [
      // Header
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: data.businessName || 'POS KOPERASI', fontSize: 13, bold: true, color: '#0F766E' },
              { text: data.businessAddress ? (data.businessAddress + (data.businessPhone ? ` • Telp: ${data.businessPhone}` : '')) : 'Laporan Bon Belanja Potong Gaji Karyawan', fontSize: 9, color: '#4B5563', margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: `Periode: ${formatDateIndo(data.startDate)} s/d ${formatDateIndo(data.endDate)}`, fontSize: 9, bold: true },
              { text: `Dicetak: ${data.printedAt}`, fontSize: 8, color: '#6B7280', margin: [0, 2, 0, 0] },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 10, x2: 525, y2: 10, lineWidth: 1.5, lineColor: '#0F766E' }] },
      { text: '', margin: [0, 6] },

      // Member Bio Card
      {
        table: {
          widths: ['25%', '35%', '20%', '20%'],
          body: [
            [
              { text: 'Nama Anggota', style: 'cardLabel' },
              { text: data.member.name, bold: true, fontSize: 10 },
              { text: 'Limit Bulanan', style: 'cardLabel' },
              { text: formatRupiah(data.member.monthly_deduction_limit), bold: true },
            ],
            [
              { text: 'No. Anggota / ID', style: 'cardLabel' },
              { text: data.member.member_no || data.member.employee_id || '—' },
              { text: 'Sisa Limit', style: 'cardLabel' },
              { text: formatRupiah(data.member.outstanding_deduction_limit), color: '#0F766E', bold: true },
            ],
            [
              { text: 'NIK (Masked)', style: 'cardLabel' },
              { text: data.member.nik_masked || '—', bold: true },
              { text: 'Total Belanja', style: 'cardLabel' },
              { text: formatRupiah(totalAmount), bold: true },
            ],
            [
              { text: 'Departemen', style: 'cardLabel' },
              { text: data.member.department || '—' },
              { text: 'Status Disetujui', style: 'cardLabel' },
              { text: formatRupiah(confirmedAmount), color: '#059669', bold: true },
            ],
          ],
        },
        layout: {
          fillColor: () => '#F9FAFB',
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
      { text: '', margin: [0, 8] },

      // Detail Table
      {
        table: {
          headerRows: 1,
          widths: [20, 110, 95, 95, 75, 90],
          body: tableBody,
        },
        layout: {
          fillColor: (rowIndex: number) => {
            if (rowIndex === 0) return '#0F766E';
            if (rowIndex === tableBody.length - 1 && data.items.length > 0) return '#F9FAFB';
            return rowIndex % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
          },
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
      { text: '', margin: [0, 15] },

      // Signatures
      {
        columns: [
          {
            width: '*',
            alignment: 'center',
            stack: [
              { text: 'Anggota Koperasi,', fontSize: 9 },
              { text: '', margin: [0, 25] },
              { text: `( ${data.member.name} )`, bold: true, fontSize: 9 },
              { text: `NIK: ${data.member.nik_masked || '—'}`, fontSize: 8, color: '#6B7280' },
            ],
          },
          {
            width: '*',
            alignment: 'center',
            stack: [
              { text: 'Pengurus / HR Koperasi,', fontSize: 9 },
              { text: '', margin: [0, 25] },
              { text: `( ${data.printedByName} )`, bold: true, fontSize: 9 },
              { text: `Jabatan: ${data.printedByRole}`, fontSize: 8, color: '#6B7280' },
            ],
          },
        ],
      },
    ],
    styles: {
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#FFFFFF',
      },
      cardLabel: {
        fontSize: 8,
        color: '#6B7280',
      },
    },
  };

  return createPdfBuffer(docDefinition);
}

// ── Transaction Report (Orders Section) ─────────────────────────────────────

export interface TransactionReportOrderItem {
  id: number;
  order_number: string;
  bill_number?: string;
  created_at: string;
  customer_name?: string;
  customer_nik?: string;
  customer_member_no?: string;
  payment_method: string;
  payment_status: string;
  order_status: string;
  items_summary: string;
  subtotal: number;
  discount_amount: number;
  total: number;
}

export interface OrdersTransactionReportData {
  businessName: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  printedAt: string;
  printedByName: string;
  printedByRole: string;
  summary: {
    totalOrders: number;
    grossSales: number;
    totalDiscounts: number;
    netSales: number;
    cashSales: number;
    salaryDeductionSales: number;
  };
  orders: TransactionReportOrderItem[];
}

/**
 * Generate a formal PDF for Orders Transaction Report.
 */
export async function generateOrdersTransactionReportPdf(data: OrdersTransactionReportData): Promise<Buffer> {
  const tableBody: TableCell[][] = [
    [
      { text: 'No', style: 'tableHeader', alignment: 'center' },
      { text: 'Waktu (WIB)', style: 'tableHeader', alignment: 'center' },
      { text: 'No. Struk / Order', style: 'tableHeader' },
      { text: 'Anggota / Pelanggan', style: 'tableHeader' },
      { text: 'Rincian Barang', style: 'tableHeader' },
      { text: 'Metode', style: 'tableHeader', alignment: 'center' },
      { text: 'Status', style: 'tableHeader', alignment: 'center' },
      { text: 'Total (Rp)', style: 'tableHeader', alignment: 'right' },
    ],
  ];

  if (data.orders.length === 0) {
    tableBody.push([
      { text: 'Tidak ada transaksi pada periode ini.', colSpan: 8, alignment: 'center', italics: true, color: '#6B7280', fontSize: 8, margin: [0, 8, 0, 8] },
      {}, {}, {}, {}, {}, {}, {}
    ]);
  } else {
    data.orders.forEach((ord, index) => {
      let timeStr = '—';
      try {
        const d = new Date(ord.created_at);
        timeStr = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(d);
      } catch {
        timeStr = ord.created_at;
      }

      const methodLabel =
        ord.payment_method === 'salary_deduction'
          ? 'Potong Gaji'
          : ord.payment_method === 'cash'
          ? 'Tunai'
          : ord.payment_method || '—';

      const customerLabel = ord.customer_name
        ? `${ord.customer_name}${ord.customer_nik ? `\nNIK: ${ord.customer_nik}` : ''}`
        : 'Pelanggan Umum';

      const statusBadge = ord.order_status === 'cancelled' ? 'BATAL' : ord.payment_status === 'paid' ? 'LUNAS' : ord.payment_status.toUpperCase();

      tableBody.push([
        { text: String(index + 1), fontSize: 7.5, alignment: 'center' },
        { text: timeStr, fontSize: 7.5, alignment: 'center' },
        {
          stack: [
            { text: ord.bill_number || '—', bold: true, fontSize: 7.5 },
            { text: ord.order_number, fontSize: 7, color: '#6B7280' },
          ],
        },
        { text: customerLabel, fontSize: 7.5 },
        { text: ord.items_summary || '—', fontSize: 7, color: '#374151' },
        { text: methodLabel, fontSize: 7.5, alignment: 'center' },
        { text: statusBadge, fontSize: 7, alignment: 'center', bold: true, color: ord.order_status === 'cancelled' ? '#DC2626' : ord.payment_status === 'paid' ? '#059669' : '#D97706' },
        { text: formatRupiah(ord.total), fontSize: 7.5, alignment: 'right', bold: true },
      ]);
    });

    // Grand total row
    tableBody.push([
      { text: 'TOTAL PENJUALAN BERSIH', colSpan: 7, bold: true, fontSize: 8, alignment: 'right', color: '#0F766E' },
      {}, {}, {}, {}, {}, {},
      { text: formatRupiah(data.summary.netSales), bold: true, fontSize: 8.5, alignment: 'right', color: '#0F766E' },
    ]);
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [25, 25, 25, 25],
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 8,
      color: '#1F2937',
    },
    content: [
      // Header Banner
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: data.businessName || 'POS KOPERASI', fontSize: 13, bold: true, color: '#0F766E' },
              { text: 'Laporan Rekapitulasi Transaksi Penjualan', fontSize: 10, bold: true, margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: `Periode: ${data.periodLabel}`, fontSize: 9, bold: true, color: '#111827' },
              { text: `Dicetak: ${data.printedAt}`, fontSize: 8, color: '#6B7280', margin: [0, 2, 0, 0] },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 792, y2: 8, lineWidth: 1.5, lineColor: '#0F766E' }] },
      { text: '', margin: [0, 5] },

      // Summary KPIs Box
      {
        table: {
          widths: ['16.6%', '16.6%', '16.6%', '16.6%', '16.6%', '17%'],
          body: [
            [
              { text: 'Total Transaksi', style: 'cardLabel', alignment: 'center' },
              { text: 'Penjualan Kotor', style: 'cardLabel', alignment: 'center' },
              { text: 'Total Diskon', style: 'cardLabel', alignment: 'center' },
              { text: 'Penjualan Bersih', style: 'cardLabel', alignment: 'center' },
              { text: 'Bayar Tunai', style: 'cardLabel', alignment: 'center' },
              { text: 'Potong Gaji (Bon)', style: 'cardLabel', alignment: 'center' },
            ],
            [
              { text: `${data.summary.totalOrders} Order`, bold: true, fontSize: 9, alignment: 'center' },
              { text: formatRupiah(data.summary.grossSales), bold: true, fontSize: 9, alignment: 'center' },
              { text: formatRupiah(data.summary.totalDiscounts), bold: true, fontSize: 9, alignment: 'center', color: '#D97706' },
              { text: formatRupiah(data.summary.netSales), bold: true, fontSize: 9.5, alignment: 'center', color: '#0F766E' },
              { text: formatRupiah(data.summary.cashSales), bold: true, fontSize: 9, alignment: 'center', color: '#2563EB' },
              { text: formatRupiah(data.summary.salaryDeductionSales), bold: true, fontSize: 9, alignment: 'center', color: '#059669' },
            ],
          ],
        },
        layout: {
          fillColor: () => '#F9FAFB',
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
      { text: '', margin: [0, 6] },

      // Detailed Orders Table
      {
        table: {
          headerRows: 1,
          widths: [18, 55, 95, 110, 215, 65, 45, 75],
          body: tableBody,
        },
        layout: {
          fillColor: (rowIndex: number) => {
            if (rowIndex === 0) return '#0F766E';
            if (rowIndex === tableBody.length - 1 && data.orders.length > 0) return '#E6FFFA';
            return rowIndex % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
          },
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3.5,
          paddingBottom: () => 3.5,
        },
      },
      { text: '', margin: [0, 10] },

      // Signatures Block
      {
        columns: [
          {
            width: '*',
            alignment: 'center',
            stack: [
              { text: 'Kasir / Petugas,', fontSize: 8.5 },
              { text: '', margin: [0, 20] },
              { text: `( ${data.printedByName} )`, bold: true, fontSize: 8.5 },
              { text: `Jabatan: ${data.printedByRole}`, fontSize: 7.5, color: '#6B7280' },
            ],
          },
          {
            width: '*',
            alignment: 'center',
            stack: [
              { text: 'Pengurus / Pengawas Koperasi,', fontSize: 8.5 },
              { text: '', margin: [0, 20] },
              { text: '( ___________________________ )', bold: true, fontSize: 8.5 },
              { text: 'Ketua / Bendahara Koperasi', fontSize: 7.5, color: '#6B7280' },
            ],
          },
        ],
      },
    ],
    styles: {
      tableHeader: {
        fontSize: 7.5,
        bold: true,
        color: '#FFFFFF',
      },
      cardLabel: {
        fontSize: 7.5,
        color: '#6B7280',
      },
    },
  };

  return createPdfBuffer(docDefinition);
}

/**
 * Generate CSV text for Orders Transaction Report.
 */
export function generateOrdersTransactionReportCsv(orders: TransactionReportOrderItem[]): string {
  const headers = [
    'No',
    'Waktu (WIB)',
    'No Struk',
    'No Order',
    'Pelanggan',
    'NIK',
    'No Anggota',
    'Metode Bayar',
    'Status Bayar',
    'Status Order',
    'Rincian Barang',
    'Subtotal',
    'Diskon',
    'Total',
  ];

  const escapeCsv = (val: string | number | undefined | null): string => {
    if (val === undefined || val === null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = orders.map((ord, idx) => {
    let timeStr = ord.created_at;
    try {
      const d = new Date(ord.created_at);
      timeStr = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {}

    const method =
      ord.payment_method === 'salary_deduction'
        ? 'Potong Gaji'
        : ord.payment_method === 'cash'
        ? 'Tunai'
        : ord.payment_method || '—';

    return [
      idx + 1,
      escapeCsv(timeStr),
      escapeCsv(ord.bill_number || ''),
      escapeCsv(ord.order_number),
      escapeCsv(ord.customer_name || 'Pelanggan Umum'),
      escapeCsv(ord.customer_nik || ''),
      escapeCsv(ord.customer_member_no || ''),
      escapeCsv(method),
      escapeCsv(ord.payment_status),
      escapeCsv(ord.order_status),
      escapeCsv(ord.items_summary),
      ord.subtotal,
      ord.discount_amount,
      ord.total,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

export interface MonthlyStockPdfReportData {
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  reportHeaderTitle?: string;
  periodDescription: string;
  generatedAtWib: string;
  printedByName: string;
  printedByRole: string;
  summary: {
    total_products_tracked: number;
    total_starting_stock: number;
    total_in: number;
    total_out: number;
    total_ending_stock: number;
  };
  items: Array<{
    barcode?: string | null;
    sku?: string | null;
    product_name: string;
    unit: string;
    category_name: string | null;
    starting_stock: number;
    total_in: number;
    total_out: number;
    ending_stock: number;
    stock_status: 'safe' | 'low' | 'out_of_stock';
  }>;
}

/**
 * Generates official Monthly Stock In/Out Report PDF (A4 Landscape).
 */
export async function generateMonthlyStockReportPdf(data: MonthlyStockPdfReportData): Promise<Buffer> {
  const tableBody: TableCell[][] = [
    [
      { text: 'No.', style: 'tableHeader', alignment: 'center' },
      { text: 'Kode / Barcode', style: 'tableHeader' },
      { text: 'Nama Produk', style: 'tableHeader' },
      { text: 'Satuan', style: 'tableHeader', alignment: 'center' },
      { text: 'Kategori', style: 'tableHeader' },
      { text: 'Stok Awal', style: 'tableHeader', alignment: 'right' },
      { text: 'Masuk (+)', style: 'tableHeader', alignment: 'right' },
      { text: 'Keluar (-)', style: 'tableHeader', alignment: 'right' },
      { text: 'Saldo Akhir', style: 'tableHeader', alignment: 'right' },
      { text: 'Status', style: 'tableHeader', alignment: 'center' },
    ],
  ];

  if (data.items.length === 0) {
    tableBody.push([
      {
        text: 'Tidak ada data pergerakan stok untuk filter dan periode yang dipilih.',
        colSpan: 10,
        alignment: 'center',
        italics: true,
        color: '#6B7280',
        margin: [0, 8, 0, 8],
      },
      ...new Array(9).fill({ text: '' }),
    ]);
  } else {
    data.items.forEach((item, idx) => {
      const isEven = idx % 2 === 0;
      const rowBg = isEven ? '#FFFFFF' : '#F9FAFB';

      let statusBadgeText = 'Aman';
      let statusColor = '#059669';
      if (item.stock_status === 'out_of_stock') {
        statusBadgeText = 'Habis';
        statusColor = '#DC2626';
      } else if (item.stock_status === 'low') {
        statusBadgeText = 'Menipis';
        statusColor = '#D97706';
      }

      tableBody.push([
        { text: String(idx + 1), alignment: 'center', fontSize: 7, fillColor: rowBg },
        { text: item.barcode || item.sku || '—', fontSize: 7, color: '#374151', fillColor: rowBg },
        { text: item.product_name, fontSize: 7.5, bold: true, color: '#111827', fillColor: rowBg },
        { text: item.unit || 'pcs', fontSize: 7, alignment: 'center', fillColor: rowBg },
        { text: item.category_name || '—', fontSize: 7, color: '#4B5563', fillColor: rowBg },
        {
          text: item.starting_stock.toLocaleString('id-ID'),
          alignment: 'right',
          fontSize: 7,
          color: '#374151',
          fillColor: rowBg,
        },
        {
          text: item.total_in > 0 ? `+${item.total_in.toLocaleString('id-ID')}` : '0',
          alignment: 'right',
          fontSize: 7,
          bold: item.total_in > 0,
          color: item.total_in > 0 ? '#059669' : '#9CA3AF',
          fillColor: rowBg,
        },
        {
          text: item.total_out > 0 ? `-${item.total_out.toLocaleString('id-ID')}` : '0',
          alignment: 'right',
          fontSize: 7,
          bold: item.total_out > 0,
          color: item.total_out > 0 ? '#DC2626' : '#9CA3AF',
          fillColor: rowBg,
        },
        {
          text: item.ending_stock.toLocaleString('id-ID'),
          alignment: 'right',
          fontSize: 7.5,
          bold: true,
          color: '#111827',
          fillColor: rowBg,
        },
        {
          text: statusBadgeText,
          alignment: 'center',
          fontSize: 6.5,
          bold: true,
          color: statusColor,
          fillColor: rowBg,
        },
      ]);
    });
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [25, 25, 25, 30],
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 8,
      color: '#1F2937',
    },
    footer: (currentPage, pageCount) => ({
      margin: [25, 0, 25, 0],
      columns: [
        {
          text: `Dicetak: ${data.generatedAtWib} oleh ${data.printedByName} (${data.printedByRole})`,
          fontSize: 7,
          color: '#6B7280',
        },
        {
          text: `Halaman ${currentPage} dari ${pageCount}`,
          alignment: 'right',
          fontSize: 7,
          color: '#6B7280',
        },
      ],
    }),
    content: [
      // Header Kop Koperasi Dinamis
      {
        columns: [
          {
            width: '*',
            stack: [
              {
                text: (data.businessName || 'POS KOPERASI').toUpperCase(),
                fontSize: 13,
                bold: true,
                color: '#065F46',
              },
              data.businessAddress
                ? { text: data.businessAddress, fontSize: 8, color: '#4B5563', margin: [0, 1.5, 0, 0] }
                : { text: '' },
              data.businessPhone
                ? { text: `Telp/WA: ${data.businessPhone}`, fontSize: 7.5, color: '#6B7280', margin: [0, 1, 0, 0] }
                : { text: '' },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              {
                text: 'LAPORAN STOK BULANAN',
                fontSize: 11,
                bold: true,
                color: '#111827',
              },
              {
                text: 'BARANG MASUK & KELUAR',
                fontSize: 8.5,
                bold: true,
                color: '#059669',
                margin: [0, 1, 0, 0],
              },
              {
                text: data.periodDescription,
                fontSize: 8,
                italics: true,
                color: '#374151',
                margin: [0, 2, 0, 0],
              },
            ],
          },
        ],
      },
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 6,
            x2: 792,
            y2: 6,
            lineWidth: 1.5,
            lineColor: '#059669',
          },
        ],
      },
      { text: '', margin: [0, 5] },

      // Summary Cards Row
      {
        table: {
          widths: ['*', '*', '*', '*', '*'],
          body: [
            [
              {
                stack: [
                  { text: 'TOTAL PRODUK', fontSize: 7, color: '#6B7280', bold: true },
                  { text: `${data.summary.total_products_tracked.toLocaleString('id-ID')} Item`, fontSize: 10, bold: true, color: '#1F2937' },
                ],
                fillColor: '#F3F4F6',
                margin: [4, 4, 4, 4],
              },
              {
                stack: [
                  { text: 'TOTAL STOK AWAL', fontSize: 7, color: '#6B7280', bold: true },
                  { text: `${data.summary.total_starting_stock.toLocaleString('id-ID')}`, fontSize: 10, bold: true, color: '#374151' },
                ],
                fillColor: '#F3F4F6',
                margin: [4, 4, 4, 4],
              },
              {
                stack: [
                  { text: 'TOTAL MASUK (+)', fontSize: 7, color: '#047857', bold: true },
                  { text: `+${data.summary.total_in.toLocaleString('id-ID')}`, fontSize: 10, bold: true, color: '#059669' },
                ],
                fillColor: '#ECFDF5',
                margin: [4, 4, 4, 4],
              },
              {
                stack: [
                  { text: 'TOTAL KELUAR (-)', fontSize: 7, color: '#B91C1C', bold: true },
                  { text: `-${data.summary.total_out.toLocaleString('id-ID')}`, fontSize: 10, bold: true, color: '#DC2626' },
                ],
                fillColor: '#FEF2F2',
                margin: [4, 4, 4, 4],
              },
              {
                stack: [
                  { text: 'TOTAL SALDO AKHIR', fontSize: 7, color: '#1E40AF', bold: true },
                  { text: `${data.summary.total_ending_stock.toLocaleString('id-ID')}`, fontSize: 10, bold: true, color: '#1D4ED8' },
                ],
                fillColor: '#EFF6FF',
                margin: [4, 4, 4, 4],
              },
            ],
          ],
        },
        layout: 'noBorders',
      },
      { text: '', margin: [0, 4] },

      // Main Table
      {
        table: {
          headerRows: 1,
          widths: [20, 70, '*', 32, 65, 52, 52, 52, 54, 40],
          body: tableBody,
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#065F46' : null),
          hLineWidth: (i: number, node: any) =>
            i === 0 || i === 1 || i === node.table.body.length ? 0.75 : 0.4,
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i === 1 ? '#065F46' : '#E5E7EB'),
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
      { text: '', margin: [0, 10] },

      // Signature Block for Physical Verification
      {
        columns: [
          {
            width: '*',
            alignment: 'center',
            stack: [
              { text: 'Disiapkan oleh,', fontSize: 8 },
              { text: '', margin: [0, 16] },
              { text: `( ${data.printedByName} )`, bold: true, fontSize: 8 },
              { text: `Jabatan: ${data.printedByRole}`, fontSize: 7, color: '#6B7280' },
            ],
          },
          {
            width: '*',
            alignment: 'center',
            stack: [
              { text: 'Diperiksa oleh,', fontSize: 8 },
              { text: '', margin: [0, 16] },
              { text: '( ___________________________ )', bold: true, fontSize: 8 },
              { text: 'Pengurus / Pengawas Koperasi', fontSize: 7, color: '#6B7280' },
            ],
          },
        ],
      },
    ],
    styles: {
      tableHeader: {
        fontSize: 7,
        bold: true,
        color: '#FFFFFF',
      },
    },
  };

  return createPdfBuffer(docDefinition);
}
