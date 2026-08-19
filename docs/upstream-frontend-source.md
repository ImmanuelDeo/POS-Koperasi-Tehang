# Upstream Frontend Source Documentation

## Overview
Dokumen ini mencatat asal-usul, versi, dan alasan pemilihan snapshot source code frontend yang disematkan (*pinned*) ke dalam repository **POS-Koperasi-Tehang** sebagai arsitektur monorepo.

---

## Metadata Sumber Pinned

| Properti | Nilai |
|---|---|
| **Repository Asal** | [`FreeOpenSourcePOS/FloCafe`](https://github.com/FreeOpenSourcePOS/FloCafe) |
| **Tag Rilis** | `v2.0.10` |
| **Commit SHA** | `270a84de65a4fd07280d393aa22422748ebcc1da` |
| **Tanggal Rilis / Commit** | 24 Juli 2026, 21:01:53 UTC |
| **Lisensi** | MIT License |
| **Path Sumber di Repo Asal** | `frontend/` |
| **Target Penempatan** | `frontend/` (Monorepo Tracked Directory) |

---

## Versi Dependensi & Runtime Kunci

### Root & Runtime Compatibility
* **Electron Compatibility:** `^31.7.7` (100% cocok dengan Electron 31 basis FloDesktop kita)
* **Express Compatibility:** `^4.19.2` (100% cocok dengan Express 4 basis kita)
* **better-sqlite3:** `^12.11.1` (kompatibel dengan SQLite database engine kita)

### Frontend Framework
* **Next.js:** `^16.2.10` (App Router)
* **React / React DOM:** `19.2.7`
* **State Management:** Zustand `^5.0.14`
* **Styling:** Tailwind CSS `^4` + Radix UI + shadcn/ui
* **Icons:** Lucide React `^1.25.0`
* **HTTP Client:** Axios `^1.18.1`

---

## Alasan Pemilihan Tag `v2.0.10`

1. **Titik Puncak Kematangan Generasi Electron 31:**  
   Rilis `v2.0.10` adalah rilis stabil terakhir sebelum lompatan besar (*breaking upgrade*) di `v2.1.0` yang beralih ke Electron 43.2.0, Express 5.2.1, dan better-sqlite3 13.0.1.
2. **Kesiapan App Router `/pos` & `(dashboard)`:**  
   Memiliki struktur Next.js App Router yang matang, antarmuka kasir `/pos` yang siap dimodifikasi untuk sembako, dan layout dashboard yang siap dikembangkan menjadi `/office`.
3. **Kesiapan Dynamic LAN Networking:**  
   File `src/lib/api.ts` secara dinamis mengambil `baseURL` dari `window.location.origin + '/api'`, sehingga langsung dapat melayani PC Office via jaringan LAN tanpa URL hardcoded.
4. **Bebas dari Over-Engineering Fitur v3.x:**  
   Belum terpapar kompleksitas fitur FloCafe versi 3.x (seperti tax plugin marketplace, tableside ordering, dan multi-currency RTL matrix) yang tidak relevan untuk operasional koperasi sembako karyawan.
