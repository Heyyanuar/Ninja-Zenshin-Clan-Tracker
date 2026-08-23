# Ninja Zenshin Clan Ranking Tracker

Web tracker real-time untuk memantau pergerakan reputasi clan, kontribusi member, dan aktivitas clan war pada game **Ninja Zenshin**. 

Project ini dirancang untuk di-deploy ke **Cloudflare Pages** (gratis) dan menggunakan **Cloudflare Pages Functions** sebagai proxy backend untuk mengambil data secara real-time dari website game tanpa mengalami masalah pembatasan CORS.

## Fitur Utama

- **Real-time Leaderboard**: Daftar peringkat clan yang selalu terupdate otomatis setiap 30 detik.
- **Recent Activity Column**: Kolom khusus di tabel utama yang menampilkan nama member yang baru saja mendapatkan kontribusi reputasi beserta jumlah kenaikannya.
- **Live Activity Feed**: Kolom umpan aktivitas di sebelah kanan yang menampilkan catatan log real-time dari seluruh aktivitas penambahan reputasi clan.
- **Session Gain Summary**: Panel statistik yang merangkum total kenaikan reputasi per clan selama sesi tracker aktif berjalan di browser.
- **Audio Chime Notification**: Suara retro game chime (level up/ding) yang disintesis langsung menggunakan Web Audio API setiap kali ada member yang mendapatkan reputasi baru (bisa di-mute dengan toggle).
- **Search & Filter**: Cari clan atau nama member tertentu dengan cepat melalui kotak pencarian.
- **Clan Members Modal**: Klik pada nama clan untuk melihat daftar anggota lengkap beserta level dan poin kontribusinya.
- **Optimization Polling**: Sistem deteksi cerdas yang hanya melakukan request data detail member jika total reputasi clan mengalami perubahan, sehingga sangat menghemat bandwidth dan mencegah alamat IP Anda terkena blokir/rate-limit oleh server game.

## Cara Deploy ke Cloudflare Pages

Ada dua metode mudah untuk mengunggah tracker ini ke Cloudflare Pages (`pages.dev`):

### Metode 1: Melalui Hubungan GitHub (Sangat Direkomendasikan)
1. Buat repositori baru di akun GitHub Anda (misalnya: `ninja-zenshin-tracker`).
2. Upload semua file dalam direktori ini ke repositori tersebut.
3. Masuk ke dashboard [Cloudflare](https://dash.cloudflare.com/).
4. Buka menu **Workers & Pages** -> **Create** -> pilih tab **Pages** -> **Connect to Git**.
5. Pilih repositori GitHub Anda.
6. Pada bagian **Build settings**:
   - **Framework preset**: Pilih `None`.
   - **Build command**: Kosongkan (atau isi dengan perintah kosong).
   - **Root directory**: `/` (default).
7. Klik **Save and Deploy**. Cloudflare akan secara otomatis membangun website statis beserta fungsi backend di folder `/functions` dan memberikan URL gratis berakhiran `.pages.dev`!

### Metode 2: Menggunakan Wrangler CLI (Lokal & Deploy)
Jika Anda memiliki Node.js di komputer Anda, Anda dapat melakukan deploy langsung dari command line:
1. Buka terminal di folder project ini.
2. Jalankan perintah instalasi wrangler jika belum ada:
   ```bash
   npm install
   ```
3. Untuk menjalankan server development lokal:
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:8788`.
4. Untuk mendeploy langsung ke Cloudflare Pages tanpa git:
   ```bash
   npx wrangler pages deploy .
   ```
   Ikuti instruksi login dan pilih nama project untuk mendeploy.

## Struktur Project

- `/index.html` - Struktur utama antarmuka dashboard pelacak.
- `/style.css` - Lembar gaya desain visual kustom bertema Crimson & Dark Ninja.
- `/app.js` - Logika frontend utama, pengukur selisih reputasi (diff engine), pemutar suara, pencarian, dan modal.
- `/functions/api/clans.js` - Fungsi backend Cloudflare Pages untuk men-scrape halaman leaderboard publik game.
- `/functions/api/members.js` - Fungsi backend Cloudflare Pages untuk meneruskan detail anggota clan.
- `/package.json` - Deklarasi dependensi development untuk kenyamanan pengujian lokal.
