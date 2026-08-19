# Standar Operasional Prosedur (SOP) Backup & Pemulihan Database

> **Proyek:** POS Koperasi Sembako Karyawan (`POS-Koperasi-Tehang`)  
> **Database:** SQLite 3 (Mode WAL: Write-Ahead Logging)  
> **Status Dokumen:** Standar Operasional Prosedur (SOP) Manajemen Data & Pemulihan Bencana

---

## 1. Prinsip Dasar Database SQLite POS Koperasi

Database aplikasi POS Koperasi disimpan secara lokal pada PC Kasir dalam file:
- `flo.db` (File basis data utama)
- `flo.db-wal` (Write-Ahead Log: catatan transaksi sementara yang belum di-checkpoint)
- `flo.db-shm` (Shared Memory: index koordinasi akses file WAL)

> [!WARNING]
> **Peringatan Penting Saat Meng-copy Database:**
> Jika aplikasi sedang berjalan aktif, **JANGAN PERNAH** hanya meng-copy file `flo.db`. Transaksi terbaru yang berada pada `flo.db-wal` akan tertinggal, mengakibatkan data backup tidak konsisten atau korup.

---

## 2. Prosedur Backup Database

### Metode A: Backup Melalui Fitur Internal Aplikasi (Sangat Direkomendasikan)
Metode ini memanfaatkan fungsi backup bawaan SQLite (`better-sqlite3` backup API) yang secara otomatis menyinkronkan data WAL ke file backup tanpa menghentikan sistem:
1. Login ke aplikasi POS menggunakan akun berwenang (**`owner`** atau **`admin`**).
2. Buka menu **Pengaturan / Database Management** $\rightarrow$ pilih **Backup Database**.
3. Tentukan lokasi folder penyimpanan backup (misalnya `D:\Backup_Koperasi\`).
4. File backup akan tersimpan dengan format nama: `flo-backup-YYYY-MM-DDTHH-mm-ss.db`.

### Metode B: Cold Backup Manual (Saat Aplikasi Ditutup)
Gunakan metode ini sebelum melakukan update software atau pemeliharaan perangkat:
1. Keluar dari aplikasi POS secara bersih menggunakan dialog **Admin Recovery** (`Ctrl+Shift+X` $\rightarrow$ pilih **Tutup Aplikasi POS**).
2. Tunggu 5 detik hingga proses background Express & SQLite tertutup sepenuhnya (file `flo.db-wal` otomatis ter-checkpoint).
3. Buka folder data aplikasi di Windows.
4. Salin file `flo.db` ke media penyimpanan cadangan.

---

## 3. Kebijakan Retensi & Penyimpanan Cadangan

Pengurus koperasi wajib menerapkan jadwal dan rotasi backup berkala:

| Frekuensi | Waktu Pelaksanaan | Kebijakan Retensi | Media Penyimpanan |
| :--- | :--- | :--- | :--- |
| **Harian** | Setiap akhir shift kasir / sebelum toko tutup | Simpan 7 hari terakhir | Folder lokal terpisah (`D:\Backup\Daily`) |
| **Mingguan** | Setiap hari Sabtu / akhir pekan operasional | Simpan 4 minggu terakhir | Flashdisk terenkripsi BitLocker |
| **Bulanan** | Setiap akhir periode rekapitulasi potong gaji | Simpan 12 bulan terakhir | Harddisk Eksternal Khusus Pengurus |
| **Pra-Update** | Tepat sebelum migrasi schema / upgrade app | Disimpan permanen | Arsip IT Koperasi |

### Aturan Keamanan & Kerahasiaan Backup:
- **Dilarang keras** mengunggah file backup ke repositori Git / GitHub publik.
- **Dilarang** menyimpan backup pada Google Drive / Dropbox pribadi tanpa enkripsi password.
- **Dilarang** meletakkan backup pada Windows Shared Folder yang dapat diakses oleh semua pengguna jaringan tanpa proteksi hak akses.

---

## 4. Prosedur Pemulihan Database (Disaster Recovery SOP)

Lakukan langkah-langkah berikut jika terjadi kerusakan hardware, kesalahan data fatal, atau kebutuhan pemulihan data:

### Langkah 1: Hentikan Aplikasi & Amankan Bukti
1. Tutup aplikasi POS kasir secara bersih.
2. Buka folder data database yang bermasalah.
3. Buat salinan folder/file yang bermasalah sebagai arsip investigasi:
   - Ubah nama `flo.db` menjadi `flo.db.corrupt_<timestamp>`.
   - Simpan file `-wal` dan `-shm` jika masih ada.

### Langkah 2: Tempatkan File Backup yang Valid
1. Pilih file backup terverifikasi terakhir dari media penyimpanan cadangan.
2. Salin file backup tersebut ke lokasi database utama.
3. Ubah nama file backup menjadi `flo.db`.
4. Hapus file `flo.db-wal` dan `flo.db-shm` lama jika masih tertinggal.

### Langkah 3: Verifikasi Integritas & Fungsionalitas
1. Jalankan aplikasi POS Koperasi.
2. Verifikasi startup berjalan mulus tanpa error schema.
3. Lakukan pengujian fungsionalitas dasar:
   - Login staf/kasir berhasil.
   - Daftar produk dan stok sembako sesuai dengan kondisi tanggal backup.
   - Daftar member dan limit potongan gaji tampil normal.
   - Buat 1 transaksi uji coba tunai dan potong gaji untuk memastikan penulisan database berfungsi normal.

### Langkah 4: Pencatatan Log Insiden
Catat pelaksanaan restore pada Buku Log Operasional Koperasi:
- **Waktu Restore:** Tanggal & Jam.
- **Petugas Pelaksana:** Nama & ID Staf IT / Admin.
- **Alasan Pemulihan:** Kerusakan file, kegagalan hardware, atau error manusia.
- **File Backup yang Dipakai:** Nama file dan tanggal pembuatan backup.

---

## 5. Panduan Penanganan Insiden Operasional

| Gejala Masalah | Penyebab Utama | Tindakan yang BENAR | Tindakan yang SALAH |
| :--- | :--- | :--- | :--- |
| **Printer Thermal Macet / Mati** | Kertas habis, kabel USB lepas, atau power printer mati | Periksa kabel & isi kertas. Transaksi **sudah aman tersimpan** di database. Lakukan reprint dari riwayat bill jika diperlukan. | **JANGAN lakukan restore database!** Kegagalan printer tidak merusak data transaksi. |
| **Koneksi LAN / Wi-Fi Putus** | Router LAN kantor mati atau kabel jaringan terlepas | POS Kasir tetap dapat beroperasi normal 100% melayani pembeli. Sambungkan kembali router untuk akses PC Office. | **JANGAN panik mematikan PC Kasir.** Sistem POS beroperasi lokal mandiri. |
| **Pesan Error `Database Disk Image is Malformed`** | PC Kasir mati mendadak saat penulisan tanpa UPS | Hentikan aplikasi, amankan file, dan lakukan prosedur restore dari backup harian terakhir. | **JANGAN terus-menerus mencoba checkout.** Hal ini dapat memperluas area korupsi data. |
