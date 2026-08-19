# Checklist Persiapan & Panduan Demo Klien (Client Demo Checklist)

> **Proyek:** POS Koperasi Sembako Karyawan (`POS-Koperasi-Tehang`)  
> **Versi:** 1.0.0-rc (Baseline Koperasi Sembako)  
> **Status Dokumen:** Panduan Presentasi Teknis & Validasi Klien

---

## 1. Checklist Persiapan Sebelum Demo (Pre-Demo Checklist)

Pastikan seluruh poin berikut telah disiapkan dan diverifikasi sebelum memulai sesi presentasi kepada pengurus/klien koperasi:

- [ ] **Database Khusus Demo:** Gunakan database demo terpisah (`flo-demo.db`). **Dilarang** menampilkan data riil NIK, nomor telepon, atau data payroll karyawan asli.
- [ ] **Data Sampel Sembako Siap:** Pastikan produk sembako standar telah terisi (Beras 5kg, Minyak Goreng 1L, Gula Pasir 1kg, Telur 1kg, Mi Instan Dus) lengkap dengan satuan (`kg`, `liter`, `pcs`, `sak`) dan harga dual-tier (Harga Umum vs Harga Member).
- [ ] **Data Sampel Member Siap:** Minimal siapkan 2 member uji coba:
  - Member A (*Saldo Limit Cukup*): misal Limit Rp1.000.000, Outstanding Rp0.
  - Member B (*Saldo Limit Menipis*): misal Limit Rp500.000, Outstanding Rp480.000 (sisa Rp20.000) untuk mendemonstrasikan penolakan over-limit.
- [ ] **Konfigurasi Lingkungan (`.env`):** Pastikan menggunakan konfigurasi demo terisolasi.
- [ ] **Hardware Printer Thermal:**
  - Siapkan printer thermal 58mm/80mm dengan kertas terpasang.
  - *Skenario Cadangan:* Jika demo dilakukan tanpa printer fisik, siapkan penjelasan bahwa sistem tetap memproses pembayaran secara normal dengan notifikasi toast peringatan non-blocking.
- [ ] **Hardware Barcode Scanner:**
  - Barcode scanner USB (keyboard-wedge) terhubung, atau siapkan barcode scanner simulator / keyboard shortcut.
- [ ] **Pengujian PIN Admin Kiosk:** Pastikan PIN admin demo (contoh: `1234` atau `9876`) telah diuji pada dialog Admin Recovery.
- [ ] **File Backup Demo Tersedia:** Siapkan 1 file `.db` backup demo untuk menunjukkan keandalan pemulihan data.

---

## 2. Skenario Alur Demonstrasi Versi 1 (Step-by-Step)

Jalankan urutan demonstrasi berikut di hadapan klien:

```text
[1. Login Kasir] ──> [2. Antarmuka POS] ──> [3. Scan / Pilih Produk]
        │
        ├──> [4. Checkout Pembeli Umum (Harga Reguler - Tunai)]
        │
        └──> [5. Pilih Member (F2)] ──> [6. Harga Member & Limit Tampil]
                    │
                    ├──> [7. Checkout Potong Gaji Sukses]
                    │
                    ├──> [8. Uji Coba Belanja Melebihi Limit (Ditolak)]
                    │
                    └──> [9. Audit Ledger Mutasi Stok & Kiosk Lock]
```

### Langkah 1: Login Kasir & Buka Antarmuka POS
- Tunjukkan proses login kasir yang cepat dan responsif.
- Masuk ke route `/pos` $\rightarrow$ perlihatkan antarmuka kasir sembako yang bersih, modern, dan dioptimalkan untuk layar sentuh / keyboard.

### Langkah 2: Transaksi Pembeli Umum (Non-Member)
1. Pilih produk *Beras Premium 5kg* dan *Minyak Goreng 1L*.
2. Perlihatkan harga reguler yang tertera pada keranjang.
3. Tekan **Checkout** (`F4`) $\rightarrow$ pilih metode **Tunai (Cash)**.
4. Masukkan nominal uang yang diterima $\rightarrow$ perlihatkan perhitungan kembalian otomatis.
5. Konfirmasi pembayaran $\rightarrow$ struk tercetak dan keranjang otomatis bersih.

### Langkah 3: Transaksi Member Koperasi & Potong Gaji (Salary Deduction)
1. Pilih kembali produk sembako yang sama.
2. Tekan tombol **Pilih Member (`F2`)** atau tombol di keranjang.
3. Cari member *"Budi Santoso (NIK: EMP-1001)"*.
4. **Poin WOW:** Tunjukkan harga langsung berubah otomatis menjadi **Harga Member** yang lebih murah, dan keranjang menampilkan rincian total penghematan (*"Hemat Rp..."*).
5. Tunjukkan bahwa sistem menampilkan sisa limit bulanan dan limit yang masih dapat digunakan.
6. Tekan **Checkout (`F4`)** $\rightarrow$ pilih metode **Potong Gaji (Salary Deduction)**.
7. Konfirmasi transaksi $\rightarrow$ sistem menerbitkan nomor deduction resmi (contoh: `DED-202608-0001`), saldo limit terpotong seketika, dan struk tercetak mencantumkan nama member dan NIK.

### Langkah 4: Pengujian Pembatasan Limit (Safety Check)
1. Tekan `F2` dan pilih member dengan sisa limit kecil (*Member B*).
2. Masukkan produk dengan nilai belanja di atas sisa limitnya.
3. Tekan Checkout Potong Gaji $\rightarrow$ **Sistem menolak transaksi** dengan pesan error yang jelas (*"Sisa limit tidak mencukupi"*), mencegah risiko piutang macet bagi koperasi.

### Langkah 5: Keandalan Transaksi saat Printer Gagal
1. Simulasikan printer dimatikan / kertas habis.
2. Lakukan checkout $\rightarrow$ pembayaran tetap berhasil dicatat di sistem tanpa error fatal, membuktikan antrean kasir tidak akan terhenti hanya karena gangguan printer.

### Langkah 6: Audit Pengurangan Stok Otomatis
- Jelaskan bahwa setiap transaksi tunai maupun potong gaji langsung memotong stok produk secara akurat dan mencatat riwayat masuk/keluar ke dalam tabel *Stock Ledger* internal.

### Langkah 7: Pengamanan Mode Kiosk & Admin Recovery
1. Tunjukkan bahwa kasir tidak bisa meminimalkan layar, tidak bisa menutup aplikasi dengan tombol `X`, tidak bisa membuka DevTools (`F12`), dan tidak bisa reload sembarangan (`F5`).
2. Tekan **`Ctrl+Shift+X`** untuk membuka dialog **Admin Recovery**.
3. Simulasikan memasukkan PIN salah hingga 5 kali $\rightarrow$ tunjukkan sistem terkunci selama 60 detik (anti-brute-force).
4. Masukkan PIN Admin yang benar $\rightarrow$ pilih *Exit Kiosk* atau *Tutup Aplikasi* untuk membuktikan pemulihan terkendali.

### Langkah 8: Penjelasan Kedaulatan & Privasi Data
- Tegaskan kepada pengurus bahwa 100% data koperasi disimpan di PC Kasir lokal, tidak ada biaya langganan cloud, dan tidak ada data karyawan yang bocor ke server pihak ketiga di internet.

---

## 3. Panduan Narasi Presentasi (Demo Talk Track)

Gunakan contoh narasi Bahasa Indonesia berikut saat presentasi:

### A. Pembukaan & Latar Belakang Masalah
> *"Bapak/Ibu Pengurus Koperasi, pencatatan belanja sembako karyawan sering kali menghadapi dua masalah utama: perbedaan harga khusus anggota yang rumit dihitung manual, serta pencatatan bon potong gaji yang rawan tercecer atau melebihi plafon gaji karyawan. POS Koperasi Tehang kami bangun khusus untuk menjawab kebutuhan tersebut secara otomatis dan aman."*

### B. Menjelaskan Keunggulan Fitur
> *"Dengan sistem ini, saat kasir memilih nama anggota, seluruh harga barang langsung otomatis berubah menjadi harga anggota yang lebih hemat. Kasir juga tidak perlu menebak apakah anggota tersebut masih boleh berbelanja secara potong gaji, karena sistem langsung memvalidasi sisa limitnya secara real-time."*

### C. Menjelaskan Aspek Keamanan Kiosk
> *"Untuk menjaga kedisiplinan di meja kasir, aplikasi ini dilengkapi Mode Kiosk yang mengunci PC Kasir. Kasir tidak dapat membuka aplikasi lain, berselancar di internet, atau menutup program secara sengaja. Hanya pengurus atau admin koperasi ber-PIN khusus yang dapat membuka kunci atau mematikan sistem."*

### D. Menjelaskan Kedaulatan Data Lokal
> *"Seluruh data transaksi dan data karyawan berada 100% di komputer koperasi sendiri, tanpa ketergantungan pada koneksi internet publik dan bebas dari risiko kebocoran data keluar. Komputer kantor nantinya dapat memantau laporan cukup melalui jaringan LAN internal koperasi."*
