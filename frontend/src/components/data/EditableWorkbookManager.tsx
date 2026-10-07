'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';

type WorkbookKind = 'products' | 'members';

interface WorkbookPreview {
  valid: boolean;
  total_rows: number;
  valid_rows_count: number;
  error_rows_count: number;
  update_count: number;
  delete_count: number;
  errors: Array<{ row: number; field: string; message: string }>;
  rows: Array<{ row_number: number; id: string; action: 'UPDATE' | 'DELETE'; name: string }>;
  preview_limited?: boolean;
  errors_limited?: boolean;
}

interface Props {
  kind: WorkbookKind;
  onApplied?: () => void;
}

const workbookConfig = {
  products: {
    baseUrl: '/catalog-csv',
    filename: 'data-semua-produk-koperasi.xlsx',
    label: 'Produk',
    deleteNote: 'DELETE mengarsipkan produk agar riwayat transaksi tetap aman.',
    deleteVerb: 'diarsipkan',
  },
  members: {
    baseUrl: '/members-csv',
    filename: 'data-semua-anggota-koperasi.xlsx',
    label: 'Anggota',
    deleteNote: 'DELETE menghapus anggota tanpa transaksi; anggota dengan transaksi/jejak persetujuan akan dinonaktifkan agar riwayat tetap aman.',
    deleteVerb: 'dihapus',
  },
} satisfies Record<WorkbookKind, { baseUrl: string; filename: string; label: string; deleteNote: string; deleteVerb: string }>;

function getErrorMessage(error: unknown, fallback: string): string {
  const response = error as { response?: { data?: { error?: string } } };
  return response.response?.data?.error || fallback;
}

export default function EditableWorkbookManager({ kind, onApplied }: Props) {
  const config = workbookConfig[kind];
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [xlsxBase64, setXlsxBase64] = useState('');
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [applying, setApplying] = useState(false);

  const reset = () => {
    setFileName('');
    setXlsxBase64('');
    setPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const downloadWorkbook = async () => {
    setExporting(true);
    try {
      const response = await api.get(`${config.baseUrl}/export-all`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = config.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Workbook semua data ${config.label.toLowerCase()} berhasil diunduh`);
    } catch (error) {
      toast.error(getErrorMessage(error, `Gagal mengunduh data ${config.label.toLowerCase()}`));
    } finally {
      setExporting(false);
    }
  };

  const selectWorkbook = async (file?: File) => {
    reset();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Gunakan file Excel .xlsx hasil ekspor POS Koperasi.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Ukuran file Excel maksimal 10 MB.');
      return;
    }

    setFileName(file.name);
    setReading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      const xlsxBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      setXlsxBase64(xlsxBase64);
      const response = await api.post(`${config.baseUrl}/bulk-preview`, { xlsx_base64: xlsxBase64 });
      setPreview(response.data as WorkbookPreview);
    } catch (error) {
      setPreview(null);
      toast.error(getErrorMessage(error, 'Gagal memeriksa workbook.'));
    } finally {
      setReading(false);
    }
  };

  const applyWorkbook = async () => {
    if (!preview?.valid || !xlsxBase64) return;
    const warning = preview.delete_count > 0
      ? `Workbook ini berisi ${preview.delete_count} aksi DELETE. ${config.deleteNote} Lanjutkan?`
      : `Terapkan perubahan ke ${preview.update_count} data ${config.label.toLowerCase()}? Baris yang dihilangkan dari file tidak akan dihapus.`;
    if (!window.confirm(warning)) return;

    setApplying(true);
    try {
      const response = await api.post(`${config.baseUrl}/bulk-import`, { xlsx_base64: xlsxBase64 });
      const result = response.data?.result || {};
      const archived = result.archived_count ? `, ${result.archived_count} anggota diarsipkan` : '';
      const deletedLabel = kind === 'products' ? 'produk diarsipkan' : 'anggota dihapus';
      toast.success(`Selesai: ${result.updated_count || 0} diperbarui, ${result.deleted_count || 0} ${deletedLabel}${archived}.`);
      setOpen(false);
      reset();
      onApplied?.();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Gagal menerapkan perubahan. Tidak ada perubahan yang tersimpan.'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="border-sky-600 text-sky-700 hover:bg-sky-50 text-xs h-9"
      >
        <FileSpreadsheet size={14} className="mr-1.5" /> Excel Massal {config.label}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-100 pb-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                  <FileSpreadsheet size={19} className="text-sky-700" />
                  Kelola Semua {config.label} via Excel
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Ekspor data, edit workbook, lalu impor kembali untuk memperbarui atau menghapus secara massal.
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto py-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="flex items-start gap-2 font-semibold">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  ID adalah pengenal tetap—jangan diubah atau dihapus. Biarkan action kosong/UPDATE untuk menyimpan edit.
                </p>
                <p className="mt-1 pl-6">
                  Hanya baris dengan action <strong>DELETE</strong> yang ditandai untuk dihapus. Baris yang tidak ada di file tidak berubah.
                </p>
                <p className="mt-1 pl-6">{config.deleteNote}</p>
              </div>

              <Button type="button" variant="outline" onClick={downloadWorkbook} disabled={exporting}>
                {exporting ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Download size={15} className="mr-2" />}
                {exporting ? 'Membuat workbook...' : `Unduh Semua ${config.label}`}
              </Button>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center hover:border-sky-500 hover:bg-sky-50/40">
                <Upload size={23} className="mb-2 text-sky-700" />
                <span className="text-sm font-semibold text-gray-800">{fileName || 'Pilih workbook hasil ekspor (.xlsx)'}</span>
                <span className="mt-1 text-xs text-gray-500">Maksimal 10 MB dan 20.000 baris; file divalidasi sebelum diterapkan.</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(event) => void selectWorkbook(event.target.files?.[0])}
                />
              </label>

              {reading && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                  <Loader2 size={16} className="animate-spin" /> Memeriksa data, ID, dan konflik...
                </div>
              )}

              {preview && !reading && (
                <div className="space-y-3">
                  <div className={`rounded-xl border p-3 text-sm ${preview.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
                    <strong>{preview.valid ? 'Valid dan siap diterapkan' : 'Validasi gagal — tidak ada perubahan yang disimpan'}</strong>
                    <p className="mt-1 text-xs">
                      {preview.total_rows} baris • {preview.update_count} akan diperbarui • {preview.delete_count} ditandai DELETE • {preview.error_rows_count} error
                    </p>
                  </div>
                  {preview.rows.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded-lg border border-gray-200">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-gray-50 text-gray-500">
                          <tr><th className="p-2">Baris</th><th className="p-2">Aksi</th><th className="p-2">Nama</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {preview.rows.map((row) => (
                            <tr key={`${row.row_number}-${row.id}`}>
                              <td className="p-2">{row.row_number}</td>
                              <td className={`p-2 font-semibold ${row.action === 'DELETE' ? 'text-red-700' : 'text-sky-700'}`}>{row.action}</td>
                              <td className="p-2">{row.name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.preview_limited && <p className="p-2 text-xs text-gray-500">Pratinjau dibatasi 50 baris.</p>}
                    </div>
                  )}
                  {preview.errors.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                      {preview.errors.map((error, index) => (
                        <p key={`${error.row}-${error.field}-${index}`} className="mb-1">
                          Baris {error.row} [{error.field}]: {error.message}
                        </p>
                      ))}
                      {preview.errors_limited && <p>Rincian error dibatasi 50 baris.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
              <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={applying}>
                Batal
              </Button>
              <Button type="button" onClick={() => void applyWorkbook()} disabled={!preview?.valid || applying}>
                {applying && <Loader2 size={15} className="mr-2 animate-spin" />}
                Terapkan Perubahan
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
