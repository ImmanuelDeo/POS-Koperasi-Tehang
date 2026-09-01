/**
 * Centralized Indonesian Label Mapping for POS Koperasi
 * (Standar Istilah & Terminologi Bahasa Indonesia Koperasi Sembako)
 */

export const LABELS = {
  // ── General Actions ──────────────────────────────────────────────────────────
  actions: {
    save: 'Simpan',
    cancel: 'Batal',
    delete: 'Hapus',
    edit: 'Ubah',
    create: 'Tambah Baru',
    search: 'Cari...',
    filter: 'Filter',
    reset: 'Reset',
    close: 'Tutup',
    back: 'Kembali',
    confirm: 'Konfirmasi',
    import: 'Impor Data',
    export: 'Ekspor',
    download_template: 'Unduh Template',
    download_excel: 'Unduh Excel (.xlsx)',
    download_csv: 'Unduh CSV (.csv)',
    upload_file: 'Unggah File',
    preview: 'Pratinjau',
    process_import: 'Proses Impor',
    retry: 'Coba Lagi',
    print: 'Cetak',
    select: 'Pilih',
  },

  // ── Product Domain ──────────────────────────────────────────────────────────
  product: {
    title: 'Katalog Produk Sembako',
    name: 'Nama Produk',
    barcode: 'Barcode',
    sku: 'Kode SKU',
    category: 'Kategori',
    unit: 'Satuan',
    selling_price: 'Harga Jual (Umum)',
    member_price: 'Harga Anggota',
    cost_price: 'Harga Beli (HPP)',
    stock: 'Jumlah Stok',
    low_stock_threshold: 'Batas Stok Minimum',
    min_reorder_qty: 'Min Reorder Qty',
    allow_decimal: 'Boleh Desimal',
    is_active: 'Status Aktif',
    description: 'Deskripsi Produk',
    created_at: 'Tanggal Ditambahkan',
    updated_at: 'Terakhir Diperbarui',
    all_categories: 'Semua Kategori',
    bundles_tab: '🎁 Promo & Bundling',
    out_of_stock: 'Stok Habis',
    low_stock: 'Stok Menipis',
    unlimited: 'Tanpa Batas',
    multiple_match_title: 'Pilih Varian Produk Barcode',
    multiple_match_desc: 'Barcode ini terdaftar untuk beberapa produk. Silakan pilih produk yang sesuai:',
  },

  // ── Member / Customer Domain ────────────────────────────────────────────────
  member: {
    title: 'Data Anggota & Pelanggan',
    name: 'Nama Lengkap',
    nik: 'NIK (16 Digit)',
    employee_id: 'NIK Karyawan / NIP',
    member_no: 'Nomor Anggota',
    department: 'Departemen / Divisi',
    phone: 'No HP / WhatsApp',
    email: 'Alamat Email',
    address: 'Alamat Tempat Tinggal',
    salary_deduction_limit: 'Limit Potong Gaji (Bulan Ini)',
    salary_deduction_enabled: 'Status Potong Gaji',
    outstanding_balance: 'Sisa Piutang Berjalan',
    whatsapp_opt_in: 'Opt-in Promo WhatsApp',
    is_member: 'Tipe Keanggotaan',
    is_active: 'Status Keanggotaan',
    notes: 'Catatan Anggota',
    active: 'Aktif',
    inactive: 'Non-Aktif',
  },

  // ── POS & Cashier Domain ────────────────────────────────────────────────────
  pos: {
    cart_title: 'Keranjang Belanja',
    item: 'Item',
    qty: 'Kuantitas',
    subtotal: 'Subtotal',
    discount: 'Diskon',
    total: 'Total Bayar',
    payment_method: 'Metode Pembayaran',
    cash: 'Tunai (Cash)',
    salary_deduction: 'Potong Gaji (Payroll)',
    cash_received: 'Uang Diterima',
    change: 'Uang Kembalian',
    process_payment: 'Proses Pembayaran',
    hold_bill: 'Tahan Transaksi (Hold)',
    recall_bill: 'Buka Transaksi Tertahan',
    clear_cart: 'Kosongkan Keranjang',
    receipt_printed: 'Struk Berhasil Dicetak',
    print_failed_queued: 'Gagal mencetak struk. Pekerjaan cetak masuk antrean otomatis.',
    select_member_first: 'Pilih anggota terlebih dahulu untuk pembayaran potong gaji',
    limit_exceeded: 'Total belanja melebihi sisa limit potong gaji anggota',
  },

  // ── Promotion & Bundling Domain ─────────────────────────────────────────────
  bundle: {
    title: 'Paket Promo & Add-Ons',
    bundle_name: 'Nama Paket Promo',
    bundle_price: 'Harga Paket',
    components: 'Rincian Komponen Produk',
    start_date: 'Tanggal Mulai',
    end_date: 'Tanggal Selesai',
    is_forever: 'Berlaku Selamanya',
    show_in_pos: 'Tampilkan di Kasir POS',
    original_total: 'Total Harga Asli',
    savings: 'Hemat',
  },

  // ── Stock Movement & Inventory Domain ───────────────────────────────────────
  stock: {
    title: 'Mutasi & Riwayat Stok',
    movement_type: 'Jenis Mutasi',
    in: 'Masuk (+)',
    out: 'Keluar (-)',
    adjustment: 'Penyesuaian (Opname)',
    initial: 'Stok Awal',
    balance_before: 'Stok Sebelum',
    balance_after: 'Stok Sesudah',
    reference: 'Referensi Transaksi',
    operator: 'Petugas / Kasir',
    notes: 'Keterangan Mutasi',
  },

  // ── Reports & Finance Domain ────────────────────────────────────────────────
  reports: {
    sales_summary: 'Ringkasan Penjualan',
    daily_sales: 'Laporan Penjualan Harian',
    monthly_sales: 'Laporan Penjualan Bulanan',
    salary_deductions_report: 'Rekap Potong Gaji Anggota',
    stock_value: 'Valuasi & Nilai Persediaan',
    cash_flow: 'Arus Kas Kasir',
    period: 'Periode Laporan',
    date_from: 'Dari Tanggal',
    date_to: 'Sampai Tanggal',
    export_pdf: 'Unduh Laporan PDF',
    export_excel: 'Unduh Rekap Excel',
  },

  // ── Staff & Authorization Domain ────────────────────────────────────────────
  staff: {
    title: 'Manajemen Staf & Hak Akses',
    username: 'Username',
    name: 'Nama Staf',
    role: 'Peran / Role',
    permissions: 'Hak Akses Sistem',
    roles: {
      admin: 'Administrator Utama',
      manager: 'Pengurus / Manager',
      cashier: 'Kasir Toko',
      office_hr: 'Staf HR / Personalia',
      office_inventory: 'Staf Gudang & Logistik',
    },
  },
} as const;

export type LabelCategory = keyof typeof LABELS;
