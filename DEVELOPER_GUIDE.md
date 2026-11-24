# Panduan Pengembang — CPNS BMKG SKB Prep

> **English summary:** Repo layout, path aliases, how to add views/routes/Dexie migrations/settings keys, local checks, Lighthouse, CSS/a11y conventions, and the GitHub Pages + tag release flow.

Proyek ini memakai **Vanilla TypeScript + Vite** (tanpa framework UI), **Dexie.js** untuk IndexedDB, **Workbox** lewat `vite-plugin-pwa`, **hash router** buatan sendiri, **Fuse.js** untuk pencarian, `@tanstack/virtual-core` untuk daftar besar, dan **SM-2** untuk kartu hafalan. Bahasa utama antarmuka adalah Indonesia (`src/core/i18n.ts` memiliki terjemahan `id` dan `en`). Tidak ada backend.

## Prasyarat dan skrip npm

Node.js **20+**, npm, dan browser modern. Skrip yang tersedia di `package.json`:

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan Vite (`http://localhost:5173`) |
| `npm run build` | `vite build` lalu `npm run check:size` |
| `npm run check:size` | Laporan ukuran gzip `dist/`; gagal bila > 5 MiB (source map dikecualikan) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run preview` | Pratinjau hasil build oleh Vite |
| `npm run serve` | Server statis `dist/` di `http://127.0.0.1:4173` (`scripts/serve.mjs`) — jalur SW/offline lokal |
| `npm run lint` | ESLint pada `*.ts`/`*.tsx`, nol warning |
| `npm run format` | Prettier untuk `src/**/*.{ts,tsx,css,md}` |
| `npm run test` / `npm run test:run` | Vitest (watch / sekali jalan) |
| `npm run test:ui` | Antarmuka Vitest |
| `npm run test:e2e` | Playwright (server web dijalankan otomatis oleh `playwright.config.ts` memakai `npm run serve`) |
| `npm run prepare` | Instal hook Husky |

Untuk mencoba offline secara lokal: `npm run build && npm run serve`. **Service worker tidak dapat didaftarkan dari `file://`**; gunakan `http://localhost` atau HTTPS.

## Struktur repository

```
.
├── index.html                  # shell SPA: skip link + <main id="main-content">
├── vite.config.ts              # build, manualChunks, alias, VitePWA/Workbox
├── vitest.config.ts            # konfigurasi unit test
├── playwright.config.ts        # proyek E2E + webServer npm run serve
├── tsconfig.json               # strict TS + path mapping
├── public/
│   ├── manifest.json           # nama, ikon 72–512, shortcuts
│   ├── offline.html            # fallback navigasi mandiri (inline CSS)
│   ├── kisi-kisi.json          # 21 topik BMKG 2024 + bobot default
│   ├── seed-questions.json     # 42 soal contoh
│   ├── favicon.svg
│   └── icons/                  # ikon PWA
├── scripts/
│   ├── serve.mjs               # server statis dist/ + fallback hash route
│   └── check-bundle-size.mjs   # anggaran 5 MiB gzipped
├── src/
│   ├── app.ts                  # bootstrap, render rute, toast, shortcut global
│   ├── core/
│   │   ├── router.ts           # daftar rute, parse hash, judul halaman, fokus
│   │   ├── pwa.ts              # registrasi SW, update, storage persist/quota
│   │   ├── a11y.ts             # proyeksi preferensi ke <html data-*>
│   │   ├── i18n.ts             # terjemahan id/en + t()
│   │   ├── config.ts           # APP_CONFIG (versi, batas, bobot topik)
│   │   ├── events.ts           # eventBus (mitt)
│   │   ├── modal.ts            # focus trap + restoreFocus
│   │   ├── app-utils.ts        # navigate, toast helper, memoizeSelector
│   │   └── utils.ts            # id, waktu, CSV, unduh berkas, debounce
│   ├── db/
│   │   ├── schema.ts           # AppDatabase (Dexie, versi 1)
│   │   └── repositories/       # questions, sessions, attempts, flashcards,
│   │                           # settings, backup
│   ├── features/kisi-kisi/registry.ts
│   ├── shared/types/index.ts   # SettingKey, SettingsDict, model data
│   ├── shared/styles/main.css  # token warna/tipografi, tema, aksesibilitas
│   └── views/                  # 10 view (lihat src/views/index.ts)
└── tests/
    ├── unit/contrast.test.ts   # kontras token WCAG AA
    └── e2e/                    # offline-session, pwa-update, a11y-axe
```

## Path alias

Alias didefinisikan dua kali agar TypeScript dan Vite sepakat (lihat `tsconfig.json#compilerOptions.paths` dan `vite.config.ts#resolve.alias`):

| Alias | Target |
|---|---|
| `@/*` | `src/*` |
| `@shared/*` | `src/shared/*` |
| `@features/*` | `src/features/*` |
| `@core/*` | `src/core/*` |
| `@db/*` | `src/db/*` |

Ada juga alias khusus `easymde` ke `node_modules/easymde/dist/easymde.min.js`. Saat menambah alias, ubah **kedua** berkas.

## Menambah view dan rute

1. Buat kelas di `src/views/ContohView.ts` dengan `constructor(params: Record<string, string>)` dan `render(): HTMLElement`; gunakan `t('kunci')` untuk teks dan repositori Dexie untuk data. Ekspor di `src/views/index.ts`.
2. Tambahkan nama ke tipe `ViewName` dan ke `routeMap` di `src/core/router.ts` (kunci `''` adalah dasbor). `parseHash()` menerima `#/contoh` maupun `#contoh`; query menjadi `route.params`.
3. Daftarkan render di `src/app.ts`:
   - untuk view yang harus tampil pada paint pertama, tambahkan `case` di `switch` `renderRoute()`;
   - untuk view lain, tambahkan entri di objek `lazyViews` dengan `import('./views/ContohView')` — chunk baru otomatis ikut ter-precache saat build.
4. Tambahkan judul di `VIEW_TITLES` (`src/core/router.ts`) agar `document.title` dan pengumuman rute benar. Tautan antarhalaman memakai hash, misalnya `<a href="#/contoh">`. Jika menambah tab navigasi, beri kelas `.nav-tab` dan `href="#/contoh"` agar `updateActiveNav()` dapat menandainya dengan `aria-current="page"`.
5. Pastikan satu `<h1>` per view, turunan `<h2>`/`<h3>` berurutan, dan kontrol interaktif memiliki label. Jalankan `npm run lint`, `npm run test:e2e -- tests/e2e/a11y-axe.spec.ts`, lalu `npm run build`.

## Menambah migrasi Dexie

Skema saat ini ada di `src/db/schema.ts` pada **`this.version(1).stores({...})`** dengan nama database `cpns-bmgk-db`.

1. Tambahkan blok `this.version(2).stores({ ...semua tabel... })` — Dexie memerlukan daftar lengkap store pada tiap versi, bukan hanya yang berubah. Sertakan indeks baru pada tabel yang bersangkutan.
2. Gunakan `.upgrade(tx => tx.table('...').toCollection().modify(...))` untuk mengisi/mengubah data lama; transaksi ini berjalan sekali saat pengguna membuka aplikasi dengan versi baru.
3. Jika bentuk berkas cadangan berubah, naikkan juga `schemaVersion` dan `dbVersion` di `src/core/config.ts` serta sesuaikan `src/shared/types/index.ts` (`ExportData`) dan `src/db/repositories/backup.ts`. `restoreBackup()` menolak backup dengan `schemaVersion` lebih baru dari aplikasi.
4. Uji dengan database yang sudah berisi data (bukan hanya profil bersih): jalankan `npm run dev`, buka aplikasi lama, build versi baru, lalu muat ulang dan cek jumlah record serta indeks baru di DevTools → Application → IndexedDB.
5. Perbarui daftar kolom CSV di `backupRepo.exportQuestionsCSV()` / `importFromCSV()` bila kolom soal bertambah.

Contoh migrasi sudah tersedia sebagai komentar di bawah deklarasi `version(1)` pada `src/db/schema.ts`.

## Menambah kunci pengaturan

1. Tambahkan nama kunci ke union `SettingKey` **dan** properti ke `SettingsDict` di `src/shared/types/index.ts` (keduanya dipakai `settingsRepo.get<K>()`).
2. Tambahkan nilai awal di `SETTINGS_DEFAULTS` (`src/db/repositories/settings.ts`). Repositori menyimpan ke tabel `settings` dan mencerminkan nilai ke `localStorage` dengan kunci `setting:<nama>`; `settings:changed` dipancarkan lewat `eventBus`.
3. Tambahkan kontrol di tab yang sesuai pada `src/views/SettingsView.ts` (Umum / Ujian CAT / Kartu Belajar / Data / Aksesibilitas / Tentang), lalu pasang *listener* yang memanggil `settingsRepo.set('namaKunci', nilai)`.
4. Untuk preferensi aksesibilitas, jangan menulis atribut `<html>` langsung dari view: gunakan `applyAccessibilitySettings()` di `src/core/a11y.ts`, yang dipanggil ulang pada init, perubahan pengaturan, dan sebelum setiap render rute.
5. Jika pengaturan ikut dicadangkan, pastikan jalur ekspor/restore di `backupRepo` tetap menyertakan tabel `settings`.

## Pemeriksaan lokal

```bash
npm run lint          # ESLint, tanpa warning
npm run test:run      # Vitest (termasuk tests/unit/contrast.test.ts)
npm run test:e2e      # Playwright: offline, update PWA, axe; butuh build
npm run check:size    # ukuran gzip dist/ (< 5 MiB)
npm run build         # build + check:size
```

`npm run test:e2e` memakai `playwright.config.ts` dengan server `npm run serve` pada `http://127.0.0.1:4173`; jalankan `npm run build` lebih dulu. Spesifikasi E2E yang tersedia: `tests/e2e/offline-session.spec.ts`, `tests/e2e/pwa-update.spec.ts`, dan `tests/e2e/a11y-axe.spec.ts` (axe dijalankan pada seluruh rute dengan tag WCAG 2.1 A/AA; target **nol** pelanggaran *serious*/*critical*).

## Prosedur Lighthouse

Otomasi Phase 5 menyediakan `npm run check:lighthouse` (`scripts/lighthouse-check.mjs`): skrip ini menyalakan `node scripts/serve.mjs dist 4173`, menjalankan Lighthouse CLI headless untuk profil desktop dan mobile, menulis `reports/lighthouse.json`, dan gagal bila salah satu ambang tidak tercapai — **Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 90, PWA ≥ 90**. Jalankan setelah `npm run build && npm run check:size`.

> Otomasi distribusi Phase 5 sudah tersedia: `.github/workflows/deploy.yml`, `npm run release`, dan `npm run check:lighthouse` (bila skrip Lighthouse terpasang). Pemeriksaan manual di bawah tetap berguna untuk diagnosis lokal; perintah intinya adalah `npm run build`, `npm run check:size`, dan `npm run test:e2e`.

Pemeriksaan manual tanpa skrip: jalankan `npm run build && npm run serve`, buka Chrome DevTools → **Lighthouse**, pilih mode *Navigation* serta kategori Performance/Accessibility/Best Practices/PWA, jalankan untuk desktop dan mobile, lalu simpan hasilnya. Perbaiki penyebab konkret (aset tak ter-precache → PWA; console error → Best Practices; aturan axe → Accessibility; chunk besar → Performance), bukan menurunkan ambang atau menonaktifkan audit.

## Konvensi CSS dan aksesibilitas

- Semua warna, tipografi, radius, dan jarak memakai token CSS di `:root` pada `src/shared/styles/main.css` (`--color-*`, `--text-*`, `--space-*`, `--radius-*`). Tema terang/gelap memakai `[data-theme="light"]` / `[data-theme="dark"]` dan `prefers-color-scheme`; mode kontras tinggi memakai `:root[data-high-contrast="true"]` (hitam/putih/kuning, ≥7:1).
- Preferensi aksesibilitas bersifat **user setting ATAU OS**: `html[data-reduced-motion="true"]` dan `@media (prefers-reduced-motion: reduce)` sama-sama mematikan animasi; skala font memakai selector eksplisit `html[data-font-scale="0.8" … "1.5"]` (CSS `attr()` tidak dipakai karena dukungan terbatas).
- Fokus selalu terlihat: gunakan `:focus-visible` dengan `--color-focus`, jangan `outline: none`. Target sentuh minimum **44×44 px** pada tab, navigator soal, tombol penilaian kartu, dan checkbox massal.
- Struktur: satu `<h1>` per view, *skip link* sebagai elemen pertama di `index.html` menuju `#main-content`, judul halaman diperbarui router, toast memakai `role="status" aria-live="polite"`, dan hanya peringatan timer ujian yang memakai `aria-live="assertive"`. Modal memakai focus trap dan mengembalikan fokus ke pemicu (`src/core/modal.ts`).
- Kontras token diuji oleh `tests/unit/contrast.test.ts`; jangan menambah pasangan teks/latar baru tanpa menambah kasus uji di sana.

## Deployment GitHub Pages dan alur rilis

Workflow `.github/workflows/deploy.yml` (disiapkan bersama otomasi distribusi) berjalan pada push ke `main` dan pada tag `v*`, dengan izin minimal `contents: read`, `pages: write`, `id-token: write`, konkurensi grup `pages`, dan aksi yang di-*pin* pada versi mayor. Job `build` menjalankan `npm ci`, `npm run lint`, `npm run test:run`, `npm run build`, `npm run check:size`, lalu mengunggah `dist/`; job `deploy` mempublikasikannya lewat `actions/deploy-pages@v4`.

- Rute memakai hash, sehingga *deep link* tidak memerlukan rewrite server; plugin build di `vite.config.ts` menyalin `index.html` menjadi `dist/404.html`.
- Base path diatur lewat variabel lingkungan **`VITE_BASE`** bila memakai URL proyek (`https://<user>.github.io/<repo>/`): jalankan `VITE_BASE=/<repo>/ npm run build`. Nilai defaultnya `/` untuk domain kustom atau Pages level pengguna. Jangan menghardcode `/cpns/` bila memakai domain kustom. File `CNAME` hanya ditambahkan bila domain memang disediakan pemilik proyek.
- Tidak ada secret/PAT yang ditanam di workflow; autentikasi Pages memakai `id-token: write`.

Alur rilis dengan `npm run release -- 1.0.0`:

1. Pastikan branch `main`, worktree bersih, dan `CHANGELOG.md` memiliki judul `## [1.0.0] - <tanggal>` yang cocok.
2. Skrip rilis menolak dirty worktree / branch lain, memeriksa semver (kasus khusus: versi `1.0.0` yang sama diperbolehkan bila tag `v1.0.0` belum ada), lalu menjalankan `npm run lint`, `npm run test:run`, `npm run build`, dan `npm run check:size`.
3. Skrip membuat commit rilis untuk perubahan versi (`npm version --no-git-tag-version`), lalu **annotated tag** `v1.0.0` yang pesannya merujuk ke bagian changelog, lalu mencetak `git push origin main --follow-tags`. Tambahkan `--push` bila Anda ingin skrip yang melakukan push.
4. `npm run release -- 1.0.0 --dry-run` menjalankan semua pemeriksaan tanpa mengubah versi, membuat commit/tag, atau pushing; gerbang branch/worktree dilewati pada mode ini.
5. Setelah tag sampai ke remote, pantau Actions `build → deploy`, lalu verifikasi URL Pages mengembalikan HTTP 200, `manifest.json` valid, dan `sw.js` terdaftar.

Semua perintah di atas dijalankan dari akar repository. Perubahan dokumentasi mengikuti format Keep a Changelog di [CHANGELOG.md](CHANGELOG.md).
