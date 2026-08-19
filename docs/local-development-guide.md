# Panduan Pengembangan Lokal (Local Development Guide)

> **Proyek:** POS Koperasi Sembako Karyawan (`POS-Koperasi-Tehang`)  
> **Target Arsitektur:** Electron POS (PC Kasir) + Embedded Express API + SQLite (`flo.db`) + Next.js Frontend  
> **Status Dokumen:** Panduan Resmi Pengembangan & Pengujian Lokal

---

## 1. Prasyarat Lingkungan Pengembangan

Untuk mengembangkan dan menguji aplikasi di komputer lokal (developer workstation), pastikan perangkat telah terinstal perangkat lunak berikut:

* **Sistem Operasi:** Windows 10 / Windows 11 (disarankan) atau Linux / macOS untuk pengembangan kode umum.
* **Git:** Versi 2.30+ untuk manajemen version control.
* **Node.js:** Versi LTS `v20.x` atau `v22.x`.
* **npm:** Versi 9.x atau 10.x (bawaan Node.js).
* **Terminal:** Windows PowerShell atau Git Bash.
* **Database Server Eksternal:** **TIDAK DIPERLUKAN**. Aplikasi ini tidak menggunakan Laragon, XAMPP, MySQL, atau PostgreSQL. Seluruh data disimpan pada database SQLite lokal (`flo.db`).

---

## 2. Setup Awal Repositori & Cabang Git

1. Buka terminal pada folder proyek:
   ```bash
   # [READ-ONLY VERIFICATION] Periksa status branch aktif
   git branch --show-current
   git status --short
   ```
2. Pastikan Anda berada pada cabang fitur yang benar (misalnya `feat/koperasi-schema-v9`):
   ```bash
   git checkout feat/koperasi-schema-v9
   ```

---

## 3. Konfigurasi Lingkungan Lokal (`.env`)

Salin file contoh konfigurasi `.env.example` menjadi `.env` lokal:

```bash
# [SETUP] Salin file konfigurasi lingkungan
cp .env.example .env
```

Isi file `.env` untuk lingkungan pengembangan lokal:
```ini
# Runtime environment
NODE_ENV=development
PORT=3001

# JWT Secret untuk sesi autentikasi staf (minimal 32 karakter acak)
# Pada mode development, jika dikosongkan sistem akan membuat runtime secret sementara.
# Disarankan diisi agar sesi login tidak reset saat server restart:
JWT_SECRET=dev_secret_koperasi_pos_tehang_32_chars_local_test_key!

# Kebijakan Kiosk: WAJIB 'false' untuk development lokal
ENABLE_KIOSK_MODE=false

# Kebijakan Keamanan & Privasi: WAJIB 'false' (mencegah koneksi ke server cloud eksternal)
ENABLE_AUTO_UPDATER=false
ENABLE_CLOUD_SYNC=false
```

> [!IMPORTANT]
> **Aturan Keamanan Database Development:**
> - Gunakan database dummy/test lokal. **Dilarang keras** menggunakan file database produksi koperasi (`flo.db` riil) untuk proses coding dan testing fitur baru.
> - File database (`*.db`, `*.db-wal`, `*.db-shm`), file `.env`, serta folder `node_modules/` telah terdaftar pada `.gitignore` dan **dilarang di-commit ke Git**.

---

## 4. Perintah Kompilasi & Menjalankan Aplikasi

Berikut adalah daftar perintah yang tersedia di dalam proyek:

### A. Membangun Aplikasi (Build)
```bash
# [BUILD] Kompilasi frontend Next.js ke static HTML export (frontend/out)
npm run build:frontend

# [BUILD] Kompilasi backend TypeScript (main/ -> dist/)
npm run build
```

### B. Menjalankan Mode Development
```bash
# [RUN DEV] Menjalankan Electron dan Express API secara bersamaan
npm run dev

# [RUN DEV] Menjalankan server Next.js frontend saja (akses browser http://localhost:3000)
npm run dev:frontend
```

---

## 5. Verifikasi Fungsionalitas Mode Development

Pada mode development (`NODE_ENV=development` & `ENABLE_KIOSK_MODE=false`), aplikasi berjalan dengan karakteristik berikut:

1. **Jendela Aplikasi Normal:**
   - Jendela berukuran `1400x900`, resizable (dapat diubah ukurannya), serta tombol Minimize, Maximize, dan Close (`X`) berfungsi normal tanpa perlu memasukkan PIN admin.
2. **Developer Tools (DevTools):**
   - DevTools tidak terbuka secara otomatis saat aplikasi dimulai.
   - Developer dapat membuka DevTools kapan saja dengan menekan tombol **`F12`** atau **`Ctrl+Shift+I`**.
3. **Shortcut Debugging:**
   - Shortcut reload browser (**`Ctrl+R`**, **`F5`**) tetap aktif untuk memudahkan refresh antarmuka saat coding.
4. **Pengujian Alur Kasir POS:**
   - Buka route `/pos`.
   - Lakukan penambahan produk ke keranjang belanja (klik katalog atau simulasi scan barcode).
   - Tekan **`F2`** untuk memilih Member Koperasi $\rightarrow$ verifikasi harga member dan limit potongan gaji tampil.
   - Tekan **`F4`** untuk checkout $\rightarrow$ uji pembayaran Tunai (Cash) dan Potong Gaji (Salary Deduction).

---

## 6. Panduan Pemecahan Masalah (Troubleshooting)

### 1. Port 3001 Terpakai (`EADDRINUSE`)
Jika server gagal berjalan karena port 3001 masih terkunci oleh proses Node.js sebelumnya:
```powershell
# [POWERSHELL] Cari Process ID (PID) yang menggunakan port 3001
netstat -ano | findstr :3001

# Hentikan proses zombie berdasarkan PID yang ditemukan
Stop-Process -Id <PID_ANGKA> -Force
```

### 2. Native Module Rebuild (`better-sqlite3`)
Jika muncul error native binding SQLite saat menjalankan Electron:
```bash
# [REBUILD] Rebuild binary better-sqlite3 agar sesuai dengan versi Electron
npm run rebuild
```

### 3. Database Locked / File WAL Menggantung
Jika SQLite menampilkan pesan error `database is locked`:
- Pastikan tidak ada proses Electron atau Express lain yang berjalan di background.
- Tutup aplikasi secara bersih agar file `flo.db-wal` dan `flo.db-shm` melakukan auto-checkpoint ke `flo.db`.

### 4. Printer Thermal Tidak Terhubung (Offline)
Jika printer thermal fisik belum terpasang di komputer developer:
- Transaksi pembayaran tetap akan diproses dan berhasil disimpan ke database.
- Sistem akan menampilkan notifikasi toast peringatan (*"Peringatan: Gagal mencetak struk thermal ke printer"*), membuktikan bahwa kegagalan hardware printer bersifat non-fatal dan tidak membatalkan pembayaran.

---

## 7. Standar Workflow Git & Kontribusi

Sesuai dengan pedoman non-negosiasi pada `AGENTS.md`:

1. **Selalu Bekerja pada Cabang Fitur:** Format cabang `feat/nama-fitur` atau `fix/nama-bug`. Dilarang commit langsung ke cabang `main` / `master`.
2. **Format Commit Message:** `<tipe>: <deskripsi singkat>` (contoh: `feat: implement member pricing and salary deduction`).
3. **Verifikasi Sebelum Commit:**
   - Pastikan seluruh test lokal lulus 100%.
   - Pastikan tidak ada file database (`*.db`), backup, secret `.env`, atau temporary build yang ikut ter-stage.
   - Gunakan staging eksplisit per file (jangan gunakan `git add .`).
4. **Push ke Remote:** Dilarang melakukan `git push` tanpa izin eksplisit dari penanggung jawab teknis. Dilarang keras menggunakan `git push --force`.
