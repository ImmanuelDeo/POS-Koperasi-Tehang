# Panduan Deployment & Mode Kiosk Windows (Windows Kiosk Deployment SOP)

> **Proyek:** POS Koperasi Sembako Karyawan (`POS-Koperasi-Tehang`)  
> **Target OS:** Windows 10 Pro / Windows 11 Pro (64-bit)  
> **Status Dokumen:** Standar Operasional Prosedur (SOP) Deployment PC Kasir & Integrasi LAN

---

## 1. Arsitektur Deployment PC Kasir & PC Office

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ PC KASIR (Host Server Koperasi - Windows 10/11 Pro)                     │
│ ├─ Aplikasi Electron POS (Terkunci dalam Mode Kiosk)                   │
│ │  ├─ Antarmuka Kasir (/pos)                                            │
│ │  ├─ Embedded Express API Server (:3001)                               │
│ │  └─ Database SQLite Lokal (flo.db, flo.db-wal, flo.db-shm)            │
│ ├─ Thermal Printer ESC/POS (USB / LAN)                                  │
│ └─ Barcode Scanner (USB Keyboard-Wedge)                                 │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                    Jaringan LAN Privat Koperasi (Ethernet / Wi-Fi)
                    (Port 3001 TCP - Subnet Lokal Saja)
                                     │
┌────────────────────────────────────┴────────────────────────────────────┐
│ PC OFFICE (PC Kantor / HRD / Pengelola Stok)                            │
│ ├─ Web Browser (Chrome / Edge / Firefox)                                │
│ ├─ URL Akses: http://<IP-PC-KASIR>:3001/office                         │
│ └─ TIDAK PERNAH mengakses atau membuka file flo.db secara langsung      │
└─────────────────────────────────────────────────────────────────────────┘
```

> [!CAUTION]
> **Aturan Mutlak Arsitektur Database:**
> 1. File database SQLite (`flo.db`, `flo.db-wal`, `flo.db-shm`) **HANYA** boleh diakses oleh proses backend Express lokal di PC Kasir.
> 2. **Dilarang keras** membagikan folder database melalui Windows Network Sharing (SMB/CIFS), NAS, NFS, atau Cloud Drive (Google Drive / OneDrive / Dropbox). Hal ini dapat menyebabkan korupsi data permanen pada file SQLite.
> 3. PC Office **wajib** berkomunikasi melalui protokol REST API yang terproteksi token JWT dan otorisasi RBAC.

---

## 2. Pemisahan Akun Pengguna Windows (OS Level RBAC)

Untuk menjamin keamanan fisik pada PC Kasir, siapkan dua akun terpisah pada Windows:

### A. Akun `Kasir` (Standard User)
- **Tipe Akun:** Standard User (Non-Administrator).
- **Fungsi:** Khusus digunakan oleh kasir bertugas selama jam operasional koperasi.
- **Konfigurasi:** Auto-login saat PC Kasir dinyalakan.
- **Batasan:** Tidak memiliki hak instalasi software, tidak dapat mengubah pengaturan Windows, dan tidak dapat membuka Command Prompt atau Registry Editor.

### B. Akun `Admin Koperasi` (Administrator)
- **Tipe Akun:** Administrator berpassword kuat.
- **Fungsi:** Khusus digunakan oleh staf IT / pengurus koperasi untuk pemeliharaan sistem, backup database, instalasi update, atau penanganan insiden.

---

## 3. Konfigurasi Lingkungan Produksi (`.env`)

Pada PC Kasir, buat file `.env` di folder instalasi aplikasi dengan konfigurasi berikut:

```ini
# Lingkungan Produksi
NODE_ENV=production
PORT=3001

# JWT Secret Wajib 32+ Karakter Acak Kuat
# Contoh cara generate di PowerShell:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<MASUKKAN_STRING_ACAK_32_KARAKTER_DI_SINI>

# Mode Kiosk Produksi: WAJIB 'true' untuk mengunci layar kasir
ENABLE_KIOSK_MODE=true

# Keamanan & Privasi Koperasi: WAJIB 'false'
ENABLE_AUTO_UPDATER=false
ENABLE_CLOUD_SYNC=false
```

> [!WARNING]
> Jangan pernah mencatat JWT Secret nyata pada dokumen publik, repositori Git, atau stiker fisik.

---

## 4. Lapisan Keamanan Kiosk Aplikasi (Electron Kiosk Layer)

Saat `NODE_ENV=production` dan `ENABLE_KIOSK_MODE=true`, Electron menerapkan penguncian aplikasi:

1. **Layar Penuh Frameless:** Aplikasi langsung berjalan fullscreen tanpa tombol minimize, maximize, atau close standar.
2. **Penghapusan Menu & Tray:** Top menu bar dan tray icon ditiadakan untuk mencegah bypass aplikasi.
3. **Pemblokiran Tombol Shortcut Sistem:**
   - Reload: `F5`, `Ctrl+R`, `Ctrl+Shift+R` (diblokir).
   - DevTools: `F12`, `Ctrl+Shift+I` (diblokir).
   - Navigasi browser: `Alt+Left`, `Alt+Right` (diblokir).
   - Penutupan paksa: `Alt+F4` (di-intercept $\rightarrow$ memicu dialog Admin Recovery).
4. **Alur Pemulihan Admin (Admin Recovery Dialog):**
   - Tekan **`Ctrl+Shift+X`** atau klik tombol exit (jika tersedia).
   - Masukkan PIN Admin / Owner koperasi (4–12 digit).
   - Sistem memverifikasi PIN menggunakan pencocokan hash `bcrypt` (atau perbandingan *timing-safe* untuk PIN legacy, yang otomatis di-upgrade ke hash bcrypt).
   - Pilihan Aksi:
     * **Exit Kiosk (Windowed):** Mengubah jendela aplikasi menjadi mode jendela normal (untuk keperluan teknis/inspeksi).
     * **Tutup Aplikasi POS:** Mematikan aplikasi dan server secara aman dan bersih.
   - **Anti-Brute-Force:** Jika salah memasukkan PIN sebanyak 5 kali berturut-turut, akses terkunci (*lockout*) selama 60 detik.

---

## 5. Lapisan Pengerasan Windows OS (Windows Hardening Layer)

> [!NOTE]
> Lapisan Kiosk Electron mengamankan antarmuka aplikasi, namun pengamanan menyeluruh pada PC Kasir memerlukan pengerasan sistem operasi Windows.

### A. Auto-Start Aplikasi Saat Login Kasir
1. Tekan `Win + R`, ketik `shell:startup`, lalu tekan Enter.
2. Letakkan shortcut aplikasi POS Koperasi pada folder startup akun `Kasir`.
3. Atau daftarkan task pada **Windows Task Scheduler** dengan trigger *"At log on of Kasir"*.

### B. Rekomendasi Pengerasan Group Policy (GPO / `gpedit.msc`)
Terapkan kebijakan berikut pada profil pengguna `Kasir`:
- **Disable Task Manager:** `User Configuration -> Administrative Templates -> System -> Ctrl+Alt+Delete Options -> Remove Task Manager` (Enabled).
- **Disable Command Prompt & PowerShell:** `User Configuration -> Administrative Templates -> System -> Prevent access to the command prompt` (Enabled).
- **Disable Windows Run Dialog:** `User Configuration -> Administrative Templates -> Start Menu and Taskbar -> Remove Run menu from Start Menu` (Enabled).
- **Prevent Access to Drives:** Batasi akses ke Drive `C:\` melalui Windows Explorer.
- **Disable USB Storage:** Nonaktifkan akses flashdisk massal jika kebijakan koperasi melarang transfer file USB selain oleh admin.

### C. Prosedur Pemulihan / Keluar Darurat (Emergency Recovery)
1. Jika aplikasi kasir mengalami *freeze*, gunakan **Admin Recovery Dialog** (`Ctrl+Shift+X`).
2. Jika seluruh sistem operasi tidak merespons, tekan `Ctrl + Alt + Del` $\rightarrow$ pilih **Switch User** / **Sign Out** $\rightarrow$ Login menggunakan akun **`Admin Koperasi`**.
3. Buka Task Manager atau PowerShell sebagai Administrator untuk menganalisis log atau me-restart aplikasi.

---

## 6. Konfigurasi Jaringan LAN & Windows Firewall

### A. IP Static / DHCP Reservation
- Berikan IP lokal statis pada PC Kasir melalui router koperasi (contoh: `192.168.1.100`).

### B. Konfigurasi Windows Defender Firewall
1. Buka **Windows Defender Firewall with Advanced Security**.
2. Buat **Inbound Rule** baru:
   - **Rule Type:** Port.
   - **Protocol:** TCP.
   - **Specific Local Ports:** `3001`.
   - **Action:** Allow the connection.
   - **Profile:** Centang **Private** saja (Hapus centang pada **Public** dan **Domain** bila tidak relevan).
   - **Name:** `POS Koperasi Express LAN Server (Port 3001)`.
3. Pastikan jaringan pada PC Kasir diset ke profil **Private Network** (bukan Public).

### C. Larangan Port Forwarding
- **Dilarang keras** melakukan Port Forwarding port `3001` pada router internet ke IP publik. Seluruh akses wajib berada di dalam jaringan fisik lokal koperasi (LAN / Wi-Fi tertutup).

### D. Akses PC Office
- Setelah antarmuka Office Dashboard selesai dibangun pada roadmap selanjutnya, staf Office dapat membuka dashboard melalui browser pada alamat:
  ```text
  http://192.168.1.100:3001/office
  ```
- *Catatan Keamanan:* Komunikasi LAN pada Versi 1 menggunakan HTTP lokal pada subnet privat. Implementasi HTTPS LAN dengan sertifikat lokal mandiri direncanakan sebagai roadmap pengerasan keamanan lanjutan.
