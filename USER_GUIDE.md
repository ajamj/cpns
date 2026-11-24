# Panduan Pengguna — CPNS BMKG SKB Prep

> **English summary:** How to import questions, study with Practice / CAT Mock Exam / SM-2 flashcards, read the dashboard, back up data, recover from storage warnings, and use the app offline.

## ⚠️ Baca dulu: data hanya ada di browser ini

Seluruh soal, progres, sesi, dan pengaturan CPNS BMKG SKB Prep disimpan **hanya di browser/perangkat yang Anda pakai** (IndexedDB). Aplikasi ini **tidak memiliki cloud sync, akun, atau aplikasi native**. Jika Anda menghapus data situs, menghapus browser, atau berpindah perangkat tanpa mengekspor cadangan, data belajar **tidak dapat dikembalikan**. Biasakan unduh berkas backup JSON secara berkala.

## Mulai memakai

1. Buka aplikasi melalui alamat `http://localhost:5173` (pengembangan) atau `http://127.0.0.1:4173` / alamat HTTPS hasil deploy. Membuka berkas lewat `file://` **tidak** mengaktifkan mode offline.
2. Saat pertama kali database kosong, aplikasi **mengimpor 42 soal contoh** otomatis dari `seed-questions.json`. Tidak perlu menekan tombol apa pun; bank soal langsung terisi.
3. Pasang PWA lewat tombol **Pasang Aplikasi** atau menu browser (lihat README). Setelah itu aplikasi dapat dipakai tanpa internet.
4. Gunakan tautan `Lewati ke konten utama` (Tab pertama) untuk lompat ke konten bagi pengguna keyboard, lalu berpindah halaman lewat tautan/tombol di dalam aplikasi (`#/dashboard`, `#/practice`, `#/mock-exam`, `#/flashcards`, `#/analytics`, `#/settings`, `#/import`, `#/export`, `#/trash`).

## Bank soal

- **Tambah / Edit / Hapus:** buka **Bank Soal** → *Tambah Soal*. Isi pertanyaan, 2–6 opsi (minimal satu kunci), penjelasan, topik kisi-kisi (`UM-…` / `KH-…`), tingkat kesulitan (1 Mudah, 2 Sedang, 3 Sulit), sumber, dan tag. Hapus soal memindahkannya ke **Tempat Sampah** (soft delete).
- **Tempat Sampah:** pulihkan atau hapus permanen soal yang dipilih. Soal yang sudah terhapus lebih dari **30 hari** dihapus permanen otomatis saat aplikasi dibuka.
- **Cari & filter:** kolom pencarian memakai Fuse.js dan menoleransi salah ketik; filter tersedia untuk topik, kesulitan, kemahiran, flag (*bookmarked*, *needsReview*, *disputed*), sumber, dan rentang tanggal. Baris styling virtual dipakai untuk bank soal besar.
- **Aksi massal:** pilih beberapa soal untuk memberi flag, memindahkan ke sampah, atau menghapus permanen.
- **Impor:** halaman **Impor** menerima `.json` (backup lengkap/array soal) atau `.csv` (kolom: `id,topicCode,stem,optionA–E,correctAnswer,explanation,difficulty,source,tags`). Akan ada pratinjau dan daftar konflik. Strategi gabung:
  - **Cerdas (smart):** ID sama ditimpa; teks pertanyaan mirip >90% ditandai untuk ditinjau; ID baru disisipkan.
  - **Lewati (skip):** ID yang sudah ada dilewati.
  - **Timpa (overwrite):** ID yang sudah ada diganti.
  - **Duplikat (duplicate):** semua soal disisipkan dengan ID baru.
- **Ekspor:** halaman **Ekspor** menghasilkan backup JSON lengkap dan CSV (soal, sesi, flashcard). Ekspor **Anki `.apkg` belum tersedia** di v1.0 (tombolnya hanya menampilkan pemberitahuan beta).

## Tiga alur belajar

### 1. Latihan (Practice)

Buka **Latihan** → atur filter topik, jumlah soal (10/20/30/50/100/semua), komposisi kesulitan (total 100%), prioritas area lemah, sertakan soal berflag/perlu ulang, urutan acak, dan penjelasan langsung → **Mulai Latihan**. Jawaban langsung dinilai, penjelasan dapat ditampilkan, dan soal bisa ditandai *Flag* atau *Tandai Ulang*. Sesi disimpan otomatis setiap **5 detik**; tombol *Selesai Latihan* menampilkan ringkasan skor dan tinjauan kesalahan.

| Tombol | Fungsi |
|---|---|
| `1`–`5` | Pilih opsi jawaban 1–5 |
| `←` / `→` | Soal sebelumnya / berikutnya |
| `F` | Flag / batalkan flag soal |
| `M` | Tandai perlu ditinjau / batalkan |
| `Ctrl/Cmd + K` | Fokus ke kolom pencarian (jika tersedia di halaman) |
| `Esc` | Tutup dialog terbuka |

### 2. Ujian Mock CAT

Buka **Ujian CAT** → atur durasi (30–180 menit; default 90), jumlah soal (10–200; default 60), komposisi kesulitan, dan bobot topik (default UM = 1,0; KH = 1,5) → **Mulai Ujian**. Aplikasi meminta mode layar penuh, menjalankan timer, dan mengirim jawaban otomatis saat waktu habis. Peringatan waktu diumumkan pada batas **5 menit** dan **1 menit**. Saat mengirim, akan ada konfirmasi bila masih ada soal belum dijawab atau berflag. Hasil menampilkan skor, per-topik, dan mode tinjau kunci jawaban.

| Tombol | Fungsi |
|---|---|
| `1`–`5` | Pilih opsi jawaban |
| `←` / `→` | Berpindah soal |
| `F` / `M` | Flag / tandai tinjau |
| `Ctrl/Cmd + Enter` | Konfirmasi pengiriman ujian |
| `Esc` | Tutup dialog terbuka |

> Selesaikan ujian sebelum menyetujui refresh pembaruan aplikasi; muat ulang saat ujian berjalan dapat mengganggu sesi yang belum selesai.

### 3. Kartu Hafalan (SM-2)

Buka **Kartu Hafalan** untuk melihat kartu yang jatuh tempo hari ini. Klik kartu (atau tekan `Spasi` / `Enter`) untuk membalik. Beri nilai:

| Tombol | Penilaian | Efek |
|---|---|---|
| `1` | Lagi (*Again*) | Interval diulang dari awal, *lapses* bertambah |
| `2` | Sulit (*Hard*) | Interval diulang dari awal, *ease factor* turun |
| `3` | Baik (*Good*) | Interval berkembang (1 hari → 6 hari → …) |
| `4` | Mudah (*Easy*) | Interval dikali bonus kemudahan |

Kartu dapat dibuat otomatis dari soal yang diflag (**Buat dari Soal Flagged**) atau dibuat manual, dan parameter SM-2 (interval awal/kedua, bonus, penalti, batas harian) diatur di **Pengaturan → Kartu Belajar**.

## Memahami Dasbor dan Analitik

- **Jumlah soal** = total soal aktif di bank; **Jatuh tempo hari ini** = kartu hafalan yang perlu diulang; **Streak** = hari berturut-turut belajar; **Kesiapan** = rata-rata kemahiran 21 topik dalam persentase.
- **Kesiapan** dikategorikan: `<40%` Belum Siap, `40–59%` Perlu Ulang, `60–79%` Siap, `≥80%` Sangat Siap. Ini adalah estimasi berdasarkan kemahiran soal, bukan jaminan nilai ujian.
- **Area lemah prioritas** adalah hingga 5 topik dengan kemahiran `<70%`, diurutkan berdasarkan kemahiran dibagi bobot topik. Mengetuknya membuka latihan untuk topik tersebut.
- **Peta kemahiran 21 topik** menampilkan level Baru / Belajar / Ulang / Mahir per topik.
- Halaman **Analitik** menambahkan riwayat sesi terbaru dan tombol unduh **laporan mingguan (Markdown)** serta **sertifikat kesiapan (HTML)**.

## Cadangan, pemulihan, dan masalah penyimpanan

**Membuat cadangan:** buka **Pengaturan → Data → Ekspor Semua Data**, atau **Ekspor → JSON (Full Backup)**. Berkas JSON berisi `schemaVersion`, `exportedAt`, `appVersion`, serta soal, sesi, attempt, flashcard, pengaturan, dan data kisi-kisi. Simpan berkas di tempat aman di luar browser (misalnya folder unduhan atau drive pribadi). **CSV hanya berisi soal**, bukan cadangan lengkap.

**Memulihkan:** buka **Impor**, pilih berkas JSON/CSV, periksa pratinjau, tentukan strategi gabung, lalu **Terapkan Impor**. Perlu diketahui: alur Impor saat ini memulihkan **data soal**; sesi, attempt, flashcard, dan pengaturan dari berkas tidak ditimpa otomatis lewat layar ini. Simpan berkas backup tetap utuh agar dapat dipakai untuk pemulihan manual di kemudian hari.

**Pemeriksaan otomatis:** aplikasi memeriksa jadwal auto-backup tiap jam ( Pengaturan → Data → Auto Backup, default aktif tiap 7 hari) dan menyimpan metadata backup lokal. Ini bukan pengganti unduhan berkas cadangan ke perangkat lain.

**Peringatan kuota 80%:** jika pemakaian penyimpanan mencapai **≥80% dari kuota**, muncul satu peringatan per sesi. Pengaturan → Data menampilkan angka *Digunakan x MB dari y MB*, status *Persistent: yes/no*, dan tombol **Request persistent storage**. Jika penyimpanan hampir penuh:

1. Ekspor backup JSON dan simpan di luar browser.
2. Kosongkan **Tempat Sampah** / hapus soal lama yang tidak diperlukan.
3. Tekan **Request persistent storage** bila status masih `no` agar browser tidak menghapus data saat ruang terdesak.
4. Muat ulang halaman; bila masih penuh, hapus data aplikasi lain pada perangkat atau gunakan browser dengan kuota lebih besar.

## Pembaruan aplikasi

Service worker mengunduh versi baru di latar belakang. Saat versi baru siap, muncul toast **Update Tersedia** dengan tombol **Refresh untuk Update**: pembaruan **hanya diterapkan bila Anda menekan tombol tersebut**, sehingga pekerjaan Anda tidak langsung hilang. Setelah refresh, halaman memuat versi baru. Periksa versi di **Pengaturan → Tentang**.

## FAQ offline

| Pertanyaan | Jawaban |
|---|---|
| Apakah aplikasi bisa dibuka dari `file://`? | Tidak untuk fitur offline/PWA. Service worker memerlukan `http://localhost` atau HTTPS; gunakan `npm run serve` atau alamat deploy. |
| Setelah terpasang, apakah masih butuh internet? | Tidak untuk belajar. Muat aplikasi sekali saat online agar aset ter-precache; semua soal dan progres ada di perangkat. |
| Apakah data saya terkirim ke server? | Tidak. Tidak ada telemetri atau permintaan otomatis ke pihak ketiga. Tautan eksternal hanya terbuka bila Anda mengkliknya. |
| Apakah saya bisa memindahkan progres ke ponsel lain? | Ekspor JSON dari perangkat lama lalu impor di perangkat baru (dengan catatan pada bagian pemulihan di atas). |
| Kenapa muncul halaman “Halaman tidak tersedia offline”? | Halaman yang diminta belum tersimpan di cache. Periksa koneksi, tekan **Kembali / Retry**, lalu buka lagi saat online. |
| Kenapa tidak ada soal saat pertama dibuka? | Impor contoh hanya berjalan bila database kosong dan berkas `seed-questions.json` berhasil dimuat. Coba muat ulang lewat alamat HTTP/HTTPS yang valid, atau impor soal sendiri lewat halaman Impor. |

> Ringkasan EN: your data never leaves this browser; export a JSON backup regularly, and use the localhost/HTTPS URL — not `file://` — for offline PWA use.
