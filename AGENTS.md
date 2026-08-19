# FloDesktop Development Guidelines

## Non-Negotiable Rules

### 1. Database Migrations - NEVER DESTRUCTIVE

When modifying the database schema:
- **ALWAYS use incremental migrations** - Add new tables/columns, never drop existing ones
- **Use `CREATE TABLE IF NOT EXISTS`** and **`ALTER TABLE ADD COLUMN`** for new features
- **Never use `DROP TABLE` or `DROP COLUMN`** in migrations
- **Test migrations on existing data** - Always verify that existing data survives upgrades
- **Version bump migrations** - Each schema change gets its own version increment

**Example of CORRECT migration:**
```typescript
// Good - Add printer table without destroying data
if (!columnExists('printers')) {
  db.exec(`CREATE TABLE IF NOT EXISTS printers (...)`);
}
db.exec(`ALTER TABLE orders ADD COLUMN printer_id TEXT`);
```

**Example of WRONG migration (NEVER DO THIS):**
```typescript
// BAD - Drops all tables and recreates!
if (version < NEW_VERSION) {
  dropAllTables();  // NEVER DO THIS
  createSchema();
  seedData();
}
```

### 2. Test Import/Export Before Major Releases

Before building release packages:
- **Test database export** creates valid backup
- **Test database import** restores data correctly
- **Test on existing database** with sample data
- **Verify all tables** are included in backup

### 3. Version Control

- Bump version in `package.json` before building releases
- Create git tags for releases: `git tag -a v1.x.x -m "message"`
- Push tags: `git push origin --tags`
- Update GitHub Releases with build artifacts

## Release Checklist

- [ ] Non-destructive database migration tested
- [ ] Import/Export feature tested
- [ ] All platforms built (macOS, Windows, Linux)
- [ ] Git tag created and pushed
- [ ] GitHub Release published with assets
- [ ] README and docs updated if needed

## Architecture Notes

### Database
- SQLite with better-sqlite3
- Schema version tracked in `settings` table
- All tables use `id TEXT PRIMARY KEY` (string IDs for cross-platform compatibility)

### Key Tables
- `settings` - Key-value business configuration
- `products` - Product catalog
- `categories` - Product categories
- `orders`, `order_items` - Order management
- `bills` - Billing and payments
- `customers` - Customer database
- `printers` - Printer configurations
- `users` - Authentication

### Printers
- Thermal printing via ESC/POS protocol
- Support for USB and Network printers
- Configurable paper widths (58mm/80mm)

4. Konteks Proyek
Ini adalah aplikasi Point of Sale (POS) untuk koperasi sembako karyawan, bukan restoran/kafe. Proyek ini adalah fork dan modifikasi dari basis kode open-source FloDesktop (awalnya dibuat untuk restoran/retail umum di India).

Dua komponen sistem yang wajib bisa saling terhubung lewat network/LAN:

Kasir (Electron, kiosk-mode terkunci) — berjalan di PC kasir yang di-lock hanya untuk aplikasi ini. Tidak boleh bisa diakses/di-minimize/di-close oleh user biasa.

Office (web-based) — dashboard manajemen stok, member, dan laporan, diakses lewat browser dari PC kantor koperasi.

Kedua komponen mengakses satu sumber data yang sama (SQLite dihost oleh Express server server.ts), mengikuti pola yang sudah ada di basis kode untuk Kitchen Display System (kds-server.ts).

Metode pembayaran khusus: potong gaji.
Selain cash, ada metode "Potong Gaji" — member koperasi bisa belanja tanpa uang tunai, dan nilainya dicatat sebagai piutang/potongan gaji. Sistem ini TIDAK terintegrasi langsung ke sistem payroll perusahaan. Pencatatan hanya masuk ke tabel internal (salary_deductions) dengan status pending, lalu dikonfirmasi manual oleh staf HR/koperasi lewat halaman Office setelah dicocokkan secara manual dengan sistem payroll asli. Agent tidak boleh membangun integrasi otomatis apa pun ke sistem payroll eksternal kecuali diminta eksplisit oleh user.

5. Fitur yang Dipertahankan vs Dihapus dari Basis FloDesktop
Dipertahankan dan dimodifikasi:

products — tambah kolom unit (kg/liter/pcs/sak), harga member vs harga umum, stok, reorder level.

customers → generalisasi jadi members — tambah employee ID, department, limit potongan gaji.

orders / bills — tambah kolom payment_method (cash | salary_deduction) dan relasi ke member_id.

staff, printers, auth — dipertahankan apa adanya, relevan untuk sistem kasir apa pun.

Dihapus (fitur restoran yang tidak relevan):

tables.ts dan skema terkait meja.

kitchen-stations.ts, kds.ts, kds-server.ts, kitchen.ts.

addon-groups.ts kecuali user secara eksplisit minta dipertahankan untuk kasus lain.

Agent TIDAK BOLEH mengembalikan atau menambah kembali fitur-fitur yang sudah diputuskan untuk dihapus di atas, kecuali diminta eksplisit oleh user dalam prompt saat itu.

6. Aturan Database & Migrasi
Semua perubahan schema HARUS lewat migration script yang reversible (ada up dan down), tidak boleh mengedit langsung struktur tabel produksi tanpa jalur rollback.

Dilarang menjalankan DROP TABLE atau DELETE FROM tanpa migration terpisah yang di-review dan disetujui user secara eksplisit.

Penamaan tabel dan kolom konsisten snake_case, mengikuti konvensi yang sudah ada di main/db.ts.

Setiap tabel transaksional (orders, bills, salary_deductions) wajib punya created_at dan updated_at.

Data dummy/seed untuk testing harus ditandai jelas (misal prefix TEST_) dan tidak pernah di-commit sebagai seed default produksi.

Sebelum mengubah schema, agent wajib menampilkan ringkasan dampak (tabel apa yang terpengaruh, apakah ada data yang berisiko hilang) sebagai bagian dari plan/artifact sebelum eksekusi.

7. Aturan Keamanan (Wajib, Tidak Bisa Dinegosiasi)
Dilarang menyimpan kredensial, API key, atau secret apa pun langsung di kode. Gunakan environment variable (.env) dan pastikan .env selalu ada di .gitignore.

Endpoint API yang menyentuh data finansial (salary_deductions, orders, bills) wajib melalui autentikasi staf/kasir yang sudah login — tidak boleh ada endpoint publik tanpa auth untuk operasi tulis.

Validasi input di sisi server wajib ada untuk semua endpoint yang menerima data dari kasir maupun office, tidak cukup validasi di sisi client saja.

Konfirmasi potong gaji oleh staf HR wajib mencatat confirmed_by (user/staff ID) dan confirmed_at (timestamp) untuk keperluan audit — tidak boleh ada perubahan status tanpa jejak siapa yang melakukannya.

Dilarang membuka akses network server (server.ts) ke internet publik tanpa mekanisme otentikasi tambahan. Server ini didesain untuk LAN internal koperasi.

8. Aturan Git & Workflow
Dilarang commit atau push langsung ke branch main/master. Semua pekerjaan wajib di branch fitur baru dengan format feat/nama-fitur atau fix/nama-bug.

Dilarang melakukan git push --force ke branch mana pun tanpa izin eksplisit dari user pada saat itu juga.

Setiap task/fitur besar diselesaikan sebagai satu Pull Request yang bisa direview user sebelum merge — bukan langsung merge otomatis oleh agent.

Commit message wajib deskriptif dalam format: <tipe>: <deskripsi singkat> (contoh: feat: tambah tabel salary_deductions dan endpoint konfirmasi).

Sebelum memulai task baru, agent wajib mengecek branch aktif saat ini dan mengonfirmasi ke user jika branch tidak sesuai ekspektasi.

9. Aturan Eksekusi & Testing
Agent wajib menjalankan aplikasi secara lokal dan memverifikasi tidak ada error runtime dasar sebelum melaporkan task selesai.

Untuk perubahan yang menyentuh flow pembayaran atau schema database, agent wajib membuat/menjalankan test kecil (unit test atau manual test case) yang membuktikan flow tersebut bekerja, bukan hanya "kode ter-compile".

Dilarang menghapus atau menonaktifkan test yang sudah ada tanpa alasan yang dijelaskan ke user dan disetujui.

Jika sebuah task gagal atau ambigu instruksinya, agent wajib berhenti dan bertanya ke user daripada menebak dan melanjutkan dengan asumsi sendiri.

10. Gaya Kode & Konsistensi
Ikuti gaya TypeScript yang sudah ada di codebase (struktur route modular per-domain di main/routes/).

Fungsi dan variabel dalam bahasa Inggris (konsisten dengan basis kode asli), tapi komentar dan dokumentasi internal boleh Bahasa Indonesia jika membantu konteks bisnis koperasi.

Setiap endpoint API baru wajib didokumentasikan singkat (comment di atas fungsi: method, path, tujuan, parameter).

Hindari dependency baru yang tidak perlu — jika ingin menambah library baru (misal untuk printer/barcode), agent wajib menjelaskan alasannya ke user sebelum menambah ke package.json.

11. Batasan Scope per Task
Agent hanya boleh mengerjakan scope yang diminta dalam task/prompt saat itu. Dilarang melakukan refactor besar-besaran di luar scope tanpa diminta ("scope creep"), meskipun agent "melihat" kode lain yang menurutnya bisa diperbaiki.

Jika agent menemukan bug atau masalah di luar scope task saat ini, laporkan sebagai catatan/temuan ke user, jangan langsung diperbaiki dalam task yang sedang berjalan.

Perubahan pada folder frontend (submodule FloUI) memerlukan perhatian khusus karena merupakan git submodule terpisah — agent wajib mengonfirmasi ke user sebelum mengubah struktur submodule ini.

12. Prioritas Ketika Instruksi Tidak Jelas
Urutan prioritas yang harus diikuti agent bila ada ambiguitas:

Keamanan data dan integritas transaksi finansial (potong gaji, pembayaran) di atas segalanya.

Konsistensi dengan arsitektur yang sudah disepakati (kasir Electron kiosk-mode + office web, satu server pusat).

Kesesuaian dengan kebutuhan bisnis koperasi (bukan restoran).

Kecepatan pengerjaan — ini prioritas terakhir, tidak boleh mengorbankan tiga poin di atas.

Addendum: Arsitektur Host, LAN, dan Database
Bagian ini WAJIB ditambahkan ke AGENTS.md setelah bagian Aturan Keamanan.

Arsitektur Operasional yang Disetujui
Untuk versi pertama, PC kasir adalah host server pusat. Dalam satu perangkat yang sama berjalan Electron, Express API, dan SQLite (flo.db).

PC Office hanya mengakses antarmuka web dan REST API melalui LAN saat PC kasir hidup selama jam operasional koperasi.

PC Office TIDAK menyimpan, membuka, mengubah, atau mengakses file SQLite (flo.db, flo.db-wal, flo.db-shm) secara langsung.

Database SQLite hanya boleh diakses oleh proses backend/Express yang berjalan pada host yang sama dengan file database. Dilarang keras menggunakan shared folder Windows, SMB, NAS, network drive, NFS, atau mekanisme file sharing apa pun untuk memberi PC Office akses langsung ke file database.

Semua pertukaran data kasir–office wajib melalui API yang terautentikasi dan berotorisasi. Tidak ada akses database lintas perangkat.

Saat PC kasir dimatikan di luar jam operasional, Office tidak memiliki akses real-time ke data. Ini adalah perilaku yang diterima untuk versi pertama.

Agent tidak boleh menambahkan mekanisme database replication, sinkronisasi multi-device, cloud sync, atau akses database melalui jaringan tanpa proposal arsitektur tertulis, analisis risiko konflik/korupsi data, dan persetujuan eksplisit user.

Keamanan Network Server
Server Express boleh bind ke LAN hanya untuk kebutuhan Office setelah autentikasi JWT dan role-based authorization untuk endpoint sensitif selesai diterapkan.

Sebelum security hardening selesai, agent tidak boleh menyatakan sistem aman atau siap dipakai dari PC Office/lingkungan produksi.

Endpoint mutasi stok, transaksi, pembayaran, potong gaji, ekspor database, serta konfigurasi printer wajib memerlukan autentikasi dan otorisasi role yang sesuai.

Jangan pernah mengekspos server Express ke internet publik, melakukan port-forwarding router, atau menambahkan remote access tanpa persetujuan eksplisit user dan desain keamanan terpisah.