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
