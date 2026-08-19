# Ruang Lingkup & Kriteria Penerimaan Versi 1 (Version 1 Scope & Roadmap)

> **Proyek:** POS Koperasi Sembako Karyawan (`POS-Koperasi-Tehang`)  
> **Versi Target:** 1.0.0 (Fase 1: Inti Kasir Sembako & Pengamanan Kiosk)  
> **Status Dokumen:** Dokumen Ruang Lingkup Resmi (Scope of Work & Acceptance Criteria)

---

## 1. Ruang Lingkup Fitur yang SUDAH SELESAI (Versi 1 Baseline)

Fitur-fitur berikut telah selesai diimplementasikan, diuji melalui serangkaian unit/integration test lokal, dan siap digunakan pada rilis Versi 1:

| Area Fitur | Komponen / Deskripsi Fungsional | Status |
| :--- | :--- | :--- |
| **Arsitektur Inti** | Aplikasi desktop Electron (PC Kasir) + Embedded Express API + Database SQLite lokal (`flo.db`) | ✅ Selesai |
| **Katalog Produk Sembako** | Dukungan satuan sembako (`kg`, `liter`, `pcs`, `sak`), kategori produk, harga reguler vs harga member, stok saat ini, dan reorder level | ✅ Selesai |
| **Pencatatan Member Koperasi** | Pengelolaan data member: NIK / Employee ID, Departemen, Plafon Limit Bulanan, dan Pelacakan Limit Terpakai | ✅ Selesai |
| **Alur Kasir POS Modern** | Antarmuka kasir sembako terintegrasi scan barcode keyboard-wedge, pemilihan member modal (`F2`), dan tombol checkout cepat (`F4`) | ✅ Selesai |
| **Dukungan Dual-Price Otomatis** | Keranjang belanja otomatis menerapkan harga member saat member dipilih, lengkap dengan kalkulator penghematan belanja | ✅ Selesai |
| **Pembayaran Tunai (Cash)** | Transaksi tunai untuk pembeli umum maupun member dengan kalkulator kembalian instan | ✅ Selesai |
| **Pembayaran Potong Gaji** | Transaksi belanja tanpa uang tunai khusus member dengan validasi plafon limit otomatis dan penerbitan nomor deduction | ✅ Selesai |
| **Backend API Potong Gaji** | Endpoint API pengelolaan status deduction (`pending` $\rightarrow$ `confirmed`, `rejected`, `cancelled`) dengan pencatatan audit `confirmed_by` dan `confirmed_at` | ✅ Selesai |
| **Ledger Mutasi Stok** | Pencatatan otomatis setiap mutasi barang (penjualan kasir, retur, penyesuaian) ke dalam tabel `stock_movements` | ✅ Selesai |
| **Keamanan & RBAC Backend** | Token JWT (minimal 32 karakter secret), otorisasi least-privilege per role (`owner`, `admin`, `cashier`, `office_inventory`, `office_hr`) | ✅ Selesai |
| **Privasi & Anti-Egress** | Penonaktifan total upstream auto-updater, telemetry, dan cloud sync; kebijakan CORS LAN lokal | ✅ Selesai |
| **Lapisan Kiosk Electron** | Mode kiosk fullscreen frameless pada production (`ENABLE_KIOSK_MODE=true`), pemblokiran shortcut reload/DevTools/close, dan rate limit 5x salah $\rightarrow$ 60 detik lockout | ✅ Selesai |
| **Admin Recovery Dialog** | Dialog pemulihan admin ber-PIN dengan verifikasi hash `bcrypt`, perbandingan *timing-safe* untuk PIN legacy, dan auto-upgrade in-place | ✅ Selesai |
| **Pencetakan Struk Thermal** | Driver ESC/POS USB/LAN (58mm/80mm) dengan penanganan kegagalan printer non-blocking (pembayaran tidak gagal jika printer offline) | ✅ Selesai |
| **Backup Database Internal** | Integrasi API backup SQLite untuk pencadangan data lokal yang aman | ✅ Selesai |

---

## 2. Ruang Lingkup yang BELUM DIBANGUN / ROADMAP FASE SELANJUTNYA

Fitur-fitur berikut **TIDAK TERMASUK** pada rilis Versi 1 saat ini dan dijadwalkan pada fase pengembangan berikutnya:

1. **Antarmuka Web Office Dashboard (`/office` UI):**
   - *Status saat ini:* Backend API untuk stok, member, dan approval deduction sudah 100% siap; antarmuka visual berbasis web di browser PC Office akan dibangun pada Task/Fase berikutnya.
2. **Implementasi Scripting Otomatis Windows Assigned Access / GPO:**
   - *Status saat ini:* Konfigurasi pengerasan OS Windows dilakukan secara manual oleh staf IT menggunakan panduan SOP; scripting otomatis belum dimasukkan ke installer.
3. **Trigger Pembuka Laci Kasir Otomatis (RJ11 Cash Drawer Kick):**
   - *Status saat ini:* Perintah pembuka laci melalui port printer thermal direncanakan pada pembaruan hardware driver berikutnya.
4. **Input Kuantitas Desimal / Integrasi Timbangan Digital:**
   - *Status saat ini:* Kuantitas barang pada Versi 1 menggunakan angka bulat (*integer*). Input desimal (misal `1.35 kg`) direncanakan pada Versi 2.
5. **Enkripsi HTTPS LAN Internal & Session HttpOnly:**
   - *Status saat ini:* Jaringan LAN internal beroperasi via HTTP lokal terproteksi JWT token; sertifikat SSL mandiri untuk LAN direncanakan pada roadmap pengerasan jaringan.
6. **Import Massal Member dari Excel / Sinkronisasi Otomatis Payroll:**
   - *Status saat ini:* Penginputan member dilakukan melalui API/UI kasir. Fitur import massal CSV/Excel dan integrasi payroll eksternal direncanakan pada fase Office.
7. **Sinkronisasi Multi-Kasir / Multi-Cabang:**
   - *Status saat ini:* Sistem didesain untuk satu PC Kasir utama sebagai host database koperasi tunggal.
8. **Manajemen Purchase Order (PO) & Supplier:**
   - *Status saat ini:* Pengelolaan stok mencakup saldo dan mutasi; modul faktur supplier masuk ke roadmap Office.
9. **Installer Executable (.exe / .msi) Build Otomatis:**
   - *Status saat ini:* Pengujian dilakukan pada runtime Electron/Node.js lokal; build installer produksi akan divalidasi pada fase release packaging.

---

## 3. Kriteria Penerimaan Klien (Client Acceptance Criteria V1)

Sebelum sistem dinyatakan siap *Go-Live* di lingkungan koperasi, seluruh kriteria pengujian operasional berikut wajib dipenuhi:

- [ ] **Akurasi Transaksi Tunai:** Seluruh perhitungan subtotal, diskon/harga umum, dan kembalian tunai terbukti akurat 100% tanpa selisih.
- [ ] **Validasi Plafon Potong Gaji:** Anggota tidak dapat berbelanja melebihi sisa limit potongan gaji yang telah ditetapkan pengurus.
- [ ] **Penerapan Harga Khusus Member:** Harga barang otomatis turun ke harga member saat nama anggota dipilih pada sistem kasir.
- [ ] **Konsistensi Stok Barang:** Stok barang di database berkurang secara otomatis dan tercatat pada buku besar mutasi (*stock ledger*) setiap kali transaksi berhasil.
- [ ] **Resiliensi Pencetakan Struk:** Jika printer thermal kehabisan kertas atau offline, transaksi pembayaran tetap tersimpan aman di database dan tidak terjadi duplikasi bon.
- [ ] **Keandalan Kiosk PC Kasir:** Kasir tidak dapat menutup aplikasi, membuka browser internet, atau mengakses file sistem Windows tanpa izin admin.
- [ ] **Keamanan Admin Recovery:** Hanya pemilik/admin ber-PIN valid yang dapat membuka mode kiosk atau mematikan aplikasi kasir.
- [ ] **Operasional 100% Offline:** Transaksi kasir tetap berjalan lancar tanpa ketergantungan pada koneksi internet eksternal.
- [ ] **Uji Coba Backup & Restore:** Prosedur backup database menghasilkan file cadangan yang valid dan dapat dipulihkan kembali saat terjadi simulasi bencana data.
- [ ] **Pelatihan Operator Kasir:** Kasir memahami pengoperasian tombol fungsi (`F2` Member, `F4` Checkout) dan prosedur penanganan printer.
