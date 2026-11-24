# Changelog

Semua perubahan tercatat dalam format [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), dan proyek ini mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [1.0.0] - 2026-11-24

Rilis pertama CPNS BMKG SKB Prep: aplikasi PWA offline untuk persiapan SKB CPNS BMKG formasi **Pengamat Meteorologi dan Geofisika Ahli Pertama (JF0016503)**. Seluruh data disimpan lokal di browser; tidak ada telemetri atau sinkronisasi cloud.

### Added

- **Fondasi (Fase 1):** aplikasi Vanilla TypeScript + Vite dengan router hash, 10 halaman (Dasbor, Bank Soal, Latihan, Ujian CAT, Kartu Hafalan, Analitik, Pengaturan, Impor, Ekspor, Tempat Sampah), penyimpanan Dexie/IndexedDB, event bus, dan dua bahasa (Indonesia utama, English).
- **Kisi-kisi dan bank soal (Fase 1–2):** 21 topik kisi-kisi BMKG 2024 (9 Kemampuan Umum + 12 Kemampuan Khusus) beserta bobot default, 42 soal contoh yang diimpor otomatis saat database kosong, CRUD soal, pencarian Fuse.js, filter dan aksi massal, sampah dengan auto-purge 30 hari, impor JSON/CSV dengan empat strategi gabung, serta ekspor backup JSON dan CSV.
- **Tiga mode belajar (Fase 2–3):** Latihan dengan konfigurasi topik/kesulitan dan tinjauan kesalahan; simulasi Ujian CAT dengan bobot topik, timer, peringatan waktu, layar penuh, auto-submit, dan hasil per topik; kartu hafalan dengan algoritma SM-2, batas harian, dan pembuatan kartu dari soal berflag.
- **Analitik (Fase 3):** peta kemahiran 21 topik, area lemah prioritas, estimasi kesiapan, streak belajar, riwayat sesi, laporan mingguan Markdown, dan sertifikat kesiapan HTML.
- **PWA (Fase 4–5):** manifest dengan ikon 72–512 px dan pintasan, service worker Workbox yang ter-precache, halaman offline mandiri, prompt pemasangan, alur pembaruan dengan toast dan refresh yang dikonfirmasi pengguna, penyimpanan persisten, dan peringatan kuota 80%.
- **Aksesibilitas dan performa (Fase 5):** skip link, fokus terlihat dan terkelola, kontras token AA, target sentuh ≥44 px, preferensi skala font 80–150%, kurangi animasi, kontras tinggi, chunk view malas, daftar soal tervirtualisasi, selector termemoisasi, dan anggaran ukuran bundle.
- **Dokumentasi (Fase 5):** `README.md`, `USER_GUIDE.md`, `DEVELOPER_GUIDE.md`, dan `CHANGELOG.md` ini.

### Changed

- Aset font eksternal dihapus; seluruh aset aplikasi disajikan dari origin yang sama agar tidak ada permintaan jaringan otomatis ke pihak ketiga.
- Source map tidak disertakan dalam hasil build produksi.
- Total `dist/` terukur **143,47 KiB gzipped** dari 32 berkas, di bawah anggaran 5 MiB (`npm run check:size`).

### Security

- Validasi `schemaVersion` saat memulihkan cadangan dan sanitasi konten Markdown sebelum dirender ke DOM.
- Pemberian izin penyimpanan persisten dan pembatasan peringatan kuota menjadi satu kali per sesi agar kegagalan penyimpanan tidak mengganggu alur belajar.

Tidak ada fitur "Unreleased" yang didokumentasikan pada rilis ini. Fitur di luar cakupan v1.0 (misalnya sinkronisasi cloud, aplikasi native, pembaruan kisi-kisi 2025, dan ekspor Anki `.apkg`) tidak disertakan.
