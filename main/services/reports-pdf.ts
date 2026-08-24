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
          text: `POS Koperasi Tehang — Laporan Rekapitulasi Potong Gaji (Dokumen Internal)`,
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
              { text: data.businessName || 'POS KOPERASI TEHANG', fontSize: 14, bold: true, color: '#0F766E' },
              { text: 'Sistem Manajemen Koperasi & Kasir Sembako', fontSize: 9, color: '#4B5563', margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: 'REKAPITULASI TRANSAKSI POTONG GAJI', fontSize: 13, bold: true, color: '#111827' },
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
          text: `POS Koperasi Tehang — Rincian Bon Potong Gaji Anggota (Dokumen Sah)`,
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
              { text: data.businessName || 'POS KOPERASI TEHANG', fontSize: 13, bold: true, color: '#0F766E' },
              { text: 'Laporan Bon Belanja Potong Gaji Karyawan', fontSize: 9, color: '#4B5563', margin: [0, 2, 0, 0] },
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
