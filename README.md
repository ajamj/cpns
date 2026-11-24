# CPNS BMKG SKB Prep

> **English summary:** An offline-first Progressive Web App for SKB CAT practice for the CPNS BMKG position *Pengamat Meteorologi dan Geofisika Ahli Pertama* (JF0016503). It follows the 21 topics of the BMKG 2024 kisi-kisi, stores all data locally, and sends no telemetry.

Aplikasi persiapan **Seleksi Kompetensi Bidang (SKB) CPNS BMKG** yang dapat dipakai **tanpa koneksi internet** setelah pemasangan. Ditujukan untuk formasi **Pengamat Meteorologi dan Geofisika Ahli Pertama**. Tidak ada akun, server, atau sinkronisasi cloud: semua soal dan progres belajar disimpan di browser perangkat yang dipakai.

## Kisi-kisi yang dipakai

Kisi-kisi **BMKG 2024** — sumber: *BMKG Pengumuman No. B/KP.01.00/016/SU/XI/2024 Lampiran I* — terdiri dari **21 topik** yang dibundel dalam `public/kisi-kisi.json`:

- **9 Kemampuan Umum** (`UM-01` … `UM-09`): meteorologi dasar, pengolahan data meteorologi, prediksi cuaca, klimatologi dan kualitas udara, prakiraan iklim ekstrem, geofisika dasar, sedimentologi dan stratigrafi, peralatan teknologi MKG, kalibrasi peralatan MKG.
- **12 Kemampuan Khusus** (`KH-01` … `KH-12`): model prakiraan meteorologi, peralatan operasional meteorologi, analisis meteorologi kompleks, pengolahan data klimatologi lanjutan, analisis klimatologi kompleks, iklim ekstrem, teknis operasional geofisika, pengolahan data geofisika, analisis geofisika kompleks, peralatan teknologi canggih, pengujian peralatan, kalibrasi peralatan canggih.

Bersamaan dengan kisi-kisi, aplikasi membundel **42 soal contoh** (`public/seed-questions.json`) yang diimpor otomatis saat database masih kosong. Versi kisi-kisi lain (misalnya 2025) **tidak** termasuk dalam rilis ini.

## Tampilan (deskripsi, tanpa tangkapan layar)

Antarmuka satu halaman berbahasa Indonesia (opsi English di Pengaturan) dengan halaman: **Dasbor, Bank Soal, Latihan, Ujian CAT, Kartu Hafalan, Analitik, Pengaturan, Impor, Ekspor, dan Tempat Sampah**. Navigasi memakai rute hash (`#/dashboard`, `#/practice`, …), kartu-kartu ringkasan, tabel soal yang dapat difilter, dan formulir konfigurasi latihan/ujian. Tidak ada Gambar pemasaran atau tangkapan layar yang dibundel; ikon aplikasi berada di `public/icons/`.

## Persyaratan

- **Node.js 20+** dan npm (untuk membangun/menjalankan dari sumber).
- Browser modern dengan dukungan **Service Worker, IndexedDB, dan localStorage** (Chrome, Edge, Firefox, Safari — dua versi terakhir).
- Tidak memerlukan backend, akun, atau koneksi internet saat dipakai (setelah aset termuat).

## Menjalankan

```bash
# Pengembangan
npm ci
npm run dev
# Vite melayani http://localhost:5173

# Build produksi + server statis lokal (jalur offline yang didukung)
npm run build
npm run serve
# http://127.0.0.1:4173
```

`npm run build` menjalankan Vite lalu `npm run check:size` (anggaran **5 MiB gzipped**). Hasil build ada di `dist/`, termasuk `sw.js` dan `offline.html` yang dihasilkan Workbox.

> **Penting — `file://` tidak mendukung PWA.** Service worker hanya bisa didaftarkan dari *secure context*: `http://localhost` atau HTTPS. Membuka `dist/index.html` langsung lewat `file://` tidak akan mendaftarkan service worker, sehingga mode offline tidak berfungsi. **`npm run serve` adalah jalur resmi untuk mencoba offline secara lokal.** (`npm run preview` tersedia untuk pratinjau Vite, tetapi tidak menggantikan `npm run serve` untuk pengujian SW.)

## Memasang aplikasi (PWA)

Tombol **Pasang Aplikasi** muncul otomatis saat browser mendukung prompt instalasi; setelah terpasang, ikon *BMKG Prep* dapat dibuka seperti aplikasi lain. Jika prompt tidak muncul, gunakan menu browser:

| Platform | Langkah |
|---|---|
| **Chrome / Edge (Windows, macOS, Linux)** | Klik ikon *Install app* di bilah alamat, atau menu ⋮ → *Cast, save, and share* → *Install page as app*. |
| **Safari (macOS)** | menu **File** → *Add to Dock* (Safari terbaru), atau tombol Bagikan → *Add to Home Screen*. |
| **iOS (Safari)** | tombol Bagikan → **Add to Home Screen** → *Add*. |
| **Android (Chrome)** | menu ⋮ → **Install app** / *Add to Home screen* → konfirmasi. |

Buka aplikasi satu kali saat masih online agar semua aset tersimpan di cache service worker. Setelah itu, latihan, ujian, dan kartu hafalan tetap dapat dipakai tanpa jaringan.

## Arsitektur

```
                Vite + vite-plugin-pwa (Workbox)
                     │ build → dist/ (aset hash + sw.js)
                     ▼
  Browser ──► index.html ──► src/core/router.ts  (hash router, #/…)
                                   │
                                   ▼
                          src/app.ts → src/views/*.ts
                           (Dasbor, Bank Soal, Latihan, Ujian CAT,
                            Kartu Hafalan, Analitik, Pengaturan, …)
                             │              │              │
                             ▼              ▼              ▼
              src/db/repositories/*.ts   src/features/   src/core/pwa.ts
              (Dexie) → IndexedDB        kisi-kisi/      → /sw.js (Workbox)
              "cpns-bmgk-db"             kisi-kisi.json   precache + offline.html
                             │
                             └─► cermin pengaturan di localStorage (setting:*)

  Tidak ada backend, tidak ada permintaan jaringan otomatis ke origin lain.
```

Rute yang tidak dibutuhkan pada tampilan awal (Analitik, Pengaturan, Impor, Ekspor, Sampah) dimuat malas sebagai chunk terpisah, tetap ikut ter-precache oleh service worker.

## Offline dan privasi

- **Offline:** seluruh aset build (JS, CSS, HTML, JSON, PNG, SVG) ter-precache saat service worker terpasang. Jika navigasi gagal baik lewat jaringan maupun cache, halaman `public/offline.html` ditampilkan dengan tombol *Kembali / Retry*.
- **Privasi:** **nol telemetri**, tanpa Google Analytics, font eksternal, atau panggilan API pihak ketiga. Tautan ke situs BMKG/SSCASN di halaman Pengaturan → Tentang hanya membuka jaringan bila diklik pengguna.
- **Data:** soal, sesi, attempt, kartu hafalan, dan pengaturan hanya ada di IndexedDB browser ini (lihat USER_GUIDE untuk ekspor cadangan).
- **Ukuran:** total build **145,83 KiB gzipped** dari 34 berkas (`npm run check:size`), jauh di bawah anggaran 5 MiB. Tidak ada source map yang dikirim ke pengguna.
- **Lighthouse (pengukuran terakhir di host pengembangan bersama):** desktop — Performance **88**, Accessibility **100**, Best Practices **100**, PWA **100**; mobile — Performance **75**, Accessibility **100**, Best Practices **100**, PWA **100**. Ambang rilis tetap **≥90 / ≥95 / ≥90 / ≥90** untuk kedua profil; jalankan `npm run check:lighthouse` pada runner bersih dan pastikan hijau sebelum menandai rilis. Rincian semua percobaan ada di `reports/lighthouse.json`.

## Dokumentasi

- [USER_GUIDE.md](USER_GUIDE.md) — panduan pakai: impor soal, tiga mode belajar, cadangan, dan FAQ offline.
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) — struktur repo, cara menambah rute/migrasi/pengaturan, pengujian, dan rilis.
- [CHANGELOG.md](CHANGELOG.md) — ringkasan perubahan rilis 1.0.0.

## Lisensi dan kontribusi

Lisensi **MIT** (seperti tercantum di halaman Pengaturan → Tentang). Kontribusi dipersilakan lewat branch + pull request; sebelum mengirim perubahan, ikuti pemeriksaan di [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) (`npm run lint`, `npm run test:run`, `npm run build`). Panduan kontribusi terpisah belum disediakan; DEVELOPER_GUIDE adalah acuannya.
