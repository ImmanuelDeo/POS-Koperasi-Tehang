# Panduan Menyelamatkan dan Memulihkan Database POS Koperasi di Windows

Panduan ini untuk kondisi aplikasi POS Koperasi tidak bisa dibuka, hanya menampilkan loading, atau perlu dipasang ulang sementara database belum sempat di-backup.

> **Prioritas utama: selamatkan salinan data sebelum reinstall, reset Windows, atau mencoba memperbaiki database.**
> Jangan hapus folder AppData. Jangan uninstall dahulu sebelum langkah penyalinan pada panduan ini selesai.

## Jawaban singkat

Database aplikasi tersimpan lokal di PC kasir. Nama file database aktif pada versi aplikasi ini adalah **`flo.db`**, bukan `flo-desktop.db`. Aplikasi menyimpan file tersebut di folder **Electron userData**. Di Windows, lokasinya biasanya berada di bawah `%APPDATA%` (Roaming), dalam folder bernama seperti `POS Koperasi` atau `flo-desktop`. Nama folder pastinya dapat berbeda antarversi atau instalasi.

Database SQLite memakai mode **WAL**. Jika aplikasi masih berjalan atau sebelumnya mati mendadak, transaksi terakhir mungkin masih berada di file `flo.db-wal`. Karena itu, salin **seluruh folder data aplikasi**, bukan hanya `flo.db`. Sertakan `flo.db-wal`, `flo.db-shm`, folder `backups`, dan file lain yang ada jika tersedia.

File yang ditemukan di AppData kemungkinan merupakan database yang digunakan aplikasi tersebut. **Ukuran dan waktu modifikasi bukan bukti mutlak** bahwa itu salinan paling baru atau sehat. Jika ada beberapa file/folder kandidat, simpan semuanya dan jangan menebak.

## Sebelum mulai

Siapkan:

- Flashdisk atau drive eksternal dengan ruang cukup.
- Akses ke akun Windows yang biasa dipakai menjalankan POS.
- Waktu untuk menghentikan aplikasi selama proses penyalinan/pemulihan.

Jangan unggah atau kirim database ke chat, email umum, atau penyimpanan publik. Database berisi data anggota, transaksi, dan informasi usaha koperasi.

## Bagian A — Amankan data sebelum reinstall

### 1. Jangan menghapus data aplikasi

Jangan:

- menghapus folder `%APPDATA%` atau `%LOCALAPPDATA%`;
- memilih opsi “hapus data pengguna” atau aplikasi pembersih;
- reset/reinstall Windows;
- memindahkan database dari folder aslinya;
- mencoba restore dari file yang belum diketahui sumbernya.

Reinstall aplikasi biasanya memasang ulang programnya saja dan tidak selalu menghapus AppData, tetapi jangan mengandalkan hal tersebut sebagai backup.

### 2. Hentikan POS sepenuhnya

1. Coba tutup aplikasi dengan cara biasa.
2. Jika tidak merespons, tekan `Ctrl+Shift+Esc` untuk membuka **Task Manager**.
3. Pada tab **Processes** atau **Details**, cari proses **POS Koperasi** atau `POS Koperasi.exe`.
4. Pilih proses tersebut lalu tekan **End task**. Jika ada beberapa proses POS, hentikan semua proses POS.
5. Tunggu sekitar 10 detik. Jangan jalankan kembali aplikasi selama menyalin database.

Jangan menghentikan proses lain yang namanya tidak jelas. Jika ragu, minta bantuan petugas IT.

### 3. Cari file database dan backup lokal

#### Cara melalui File Explorer

1. Buka File Explorer.
2. Klik address bar, ketik `%APPDATA%`, lalu tekan Enter.
3. Cari folder bernama `POS Koperasi`, `flo-desktop`, atau nama serupa.
4. Cari file `flo.db`.
5. Jika tidak ditemukan, periksa `%LOCALAPPDATA%`.
6. Di dalam folder data aplikasi, cari juga folder `backups` dan file bernama `flo-backup-....db`.

#### Cara pencarian dengan PowerShell

1. Klik Start, ketik **PowerShell**, lalu buka Windows PowerShell.
2. Jalankan perintah pencarian ini (perintah hanya membaca daftar file):

   ```powershell
   $roots = @($env:APPDATA, $env:LOCALAPPDATA)
   Get-ChildItem -Path $roots -Filter 'flo.db' -File -Recurse -ErrorAction SilentlyContinue |
     Sort-Object LastWriteTime -Descending |
     Select-Object FullName, Length, LastWriteTime
   ```

3. Cari juga backup yang pernah dibuat oleh aplikasi:

   ```powershell
   $roots = @($env:APPDATA, $env:LOCALAPPDATA)
   Get-ChildItem -Path $roots -Filter 'flo-backup-*.db' -File -Recurse -ErrorAction SilentlyContinue |
     Sort-Object LastWriteTime -Descending |
     Select-Object FullName, Length, LastWriteTime
   ```

Pencarian dapat memerlukan waktu. Jika akses ditolak pada sebagian folder, hasil dari folder tersebut mungkin tidak muncul.

### 4. Salin seluruh folder data ke media eksternal

1. Dari hasil pencarian, buka lokasi folder yang berisi `flo.db`.
2. Salin **folder data aplikasi secara keseluruhan** ke flashdisk/drive eksternal. Contoh lokasi tujuan:

   ```text
   E:\Recovery-POS-2026-10-29\
   ```

3. Pastikan salinan memuat `flo.db` dan semua file/folder pendamping yang ada, terutama:
   - `flo.db-wal`
   - `flo.db-shm`
   - folder `backups`
   - file log aplikasi, jika tersedia
4. Jangan hanya menyalin shortcut aplikasi atau folder instalasi di `Program Files`.
5. Jangan mengubah, mengganti nama, atau menghapus file di salinan arsip.
6. Buka folder tujuan dan pastikan file hasil salin terlihat serta ukurannya bukan 0 byte.

Jika ditemukan beberapa folder data atau beberapa `flo.db`, salin **semua kandidat ke folder arsip yang berbeda** dan catat path, ukuran, serta waktu modifikasinya. Jangan mengganti file asli dengan salah satu kandidat sebelum diverifikasi.

## Bagian B — Reinstall dengan risiko minimum

1. Pastikan Bagian A selesai dan salinan eksternal tersedia.
2. Pasang ulang POS Koperasi seperti biasa.
3. Jangan memilih penghapusan data pengguna jika installer atau Windows menawarkannya.
4. Jalankan aplikasi satu kali dan tunggu beberapa menit. Aplikasi bisa memerlukan waktu untuk startup atau migrasi database.
5. Jika data lama tampil, database masih berada di lokasi yang digunakan aplikasi; **tidak perlu menyalin atau restore apa pun**.
6. Jika aplikasi terus loading atau meminta setup awal padahal sebelumnya sudah memiliki data, tutup aplikasi sepenuhnya lewat Task Manager. Jangan buat akun/setup baru dahulu. Lanjut ke Bagian C.

## Bagian C — Pulihkan dari salinan folder data

> Lakukan hanya setelah salinan eksternal dibuat. Langkah ini mengganti folder data yang sedang digunakan aplikasi dengan salinan lama. Jangan melakukan merge file database dari dua folder berbeda.

1. Pastikan semua proses POS sudah ditutup.
2. Temukan folder data baru yang dibuat/digunakan instalasi ulang. Cari `flo.db` dengan perintah PowerShell pada Bagian A. Jika belum yakin folder mana yang aktif, **berhenti dan minta petugas IT memeriksanya**.
3. Buat salinan tambahan dari folder data baru sebelum menggantinya. Misalnya, salin folder itu dengan nama `POS-Koperasi-baru-sebelum-restore`.
4. Tentukan satu folder arsip lama yang akan dipulihkan. Pastikan folder arsip tersebut memuat database dan file pendampingnya, jika tersedia.
5. Jika folder lama dan folder aktif memiliki nama/path yang sama, jangan menimpa satu per satu sambil membiarkan file lain tertinggal. Ganti seluruh folder aktif:
   - Ubah nama folder aktif menjadi, misalnya, `POS-Koperasi-sebelum-restore`.
   - Salin seluruh folder arsip lama ke lokasi induk yang sama, sehingga folder hasil pemulihan kembali memiliki nama/path yang digunakan aplikasi.
6. Jika lokasi folder lama berbeda dengan lokasi userData instalasi baru, jangan sekadar meletakkan `flo.db` di folder lama dan menganggapnya sudah dipulihkan. Database harus berada pada folder yang benar-benar digunakan aplikasi versi baru. Minta petugas IT memastikan lokasi aktifnya.
7. Jalankan aplikasi dan periksa login, anggota, produk, stok, serta transaksi.
8. Pertahankan folder arsip eksternal dan folder `sebelum-restore` sampai seluruh pemeriksaan selesai dan ada backup baru yang tervalidasi.

**Penting untuk file WAL:** pertahankan `flo.db`, `flo.db-wal`, dan `flo.db-shm` dari satu folder/snapshot yang sama. Jangan mencampurkan `flo.db` lama dengan file `-wal` atau `-shm` dari instalasi baru. Bila file sidecar tidak ada pada salinan lama, jangan membuatnya sendiri.

## Jika database tidak sehat atau aplikasi tetap loading

- Jangan berulang kali mencoba restore pada satu-satunya salinan.
- Jangan menghapus `flo.db-wal` dari satu-satunya salinan. File tersebut mungkin berisi transaksi terbaru.
- Jangan jalankan aplikasi dengan database asli yang dicurigai bermasalah berkali-kali.
- Simpan salinan folder asli tanpa perubahan dan buat salinan kerja terpisah untuk pemeriksaan.
- Hubungi petugas IT/pengembang dengan informasi path, nama file, ukuran, dan waktu modifikasi. Jangan mengirim isi database melalui kanal publik.
- Jika ada backup `flo-backup-....db`, pertahankan juga. Backup tersebut dapat lebih mudah dipulihkan, tetapi mungkin tidak mencakup transaksi setelah waktu backup dibuat.

## Setelah berhasil pulih

1. Periksa data penting bersama petugas koperasi: jumlah anggota, beberapa produk dan stok, serta transaksi terakhir yang diketahui.
2. Buat backup melalui fitur backup aplikasi setelah startup dan data terverifikasi.
3. Salin file backup ke media penyimpanan terpisah yang aman.
4. Jangan hapus salinan database lama sampai backup baru berhasil dibuat dan dibuka/diverifikasi oleh petugas IT.
5. Atur backup rutin, misalnya setiap akhir hari operasional dan sebelum update aplikasi.

## Ringkasan

- Database aktif bernama **`flo.db`**.
- Lokasinya berada di folder Electron `userData`, umumnya di bawah `%APPDATA%`; path pasti perlu dicari pada PC kasir.
- Data berada lokal di PC tersebut; file backup tidak otomatis tersedia kecuali fitur backup pernah dijalankan.
- **Tutup aplikasi, lalu salin seluruh folder data** sebelum reinstall atau restore.
- Sertakan file `-wal` dan `-shm` jika ada; jangan campur file dari snapshot berbeda.
- Jika ada beberapa database kandidat atau aplikasi tetap loading, pertahankan semuanya dan minta petugas IT memeriksa sebelum memilih salah satunya.
