// Daily safety checklists, transcribed from
// "Form Checklist & SOP Operasional Bus Sekolah" (Pre-Operational Check —
// Driver, and Safety Trip Procedure — Helper). Item text lives here, not in
// the database, the same way GRADES/VIOLATION_CATEGORIES live in lib/cards.js:
// a submitted checklist stores item_key + status/note, and the label is looked
// up at read time. If the SOP wording is revised later, past submissions read
// with the new wording rather than needing a versioned snapshot — acceptable
// here because this is an internal compliance record, not the parent consent
// flow (which does snapshot, in applications.submitted_snapshot).

const CHECKLISTS = {
  driver_pre_op: {
    label: 'Pre-Operational Check Bus (Driver)',
    role_label: 'Driver',
    intro: 'Memiliki SIM B1 / B1 Umum yang resmi dan berlaku; sehat jasmani & rohani '
         + '(bebas dari pengaruh alkohol, obat-obatan yang menyebabkan kantuk, atau '
         + 'anjuran medis/dokter untuk tidak mengoperasikan kendaraan); menggunakan '
         + 'seragam kerja tim transportasi sekolah lengkap dan rapi.',
    sections: [
      {
        key: 'A',
        title: 'Kesiapan Pengemudi & Administrasi',
        items: [
          { key: 'fit_to_work', text: 'Kondisi Kesehatan & Fit to Work: Bebas dari kantuk, alkohol, obat-obatan yang memicu kantuk, atau instruksi medis yang melarang mengemudi.' },
          { key: 'uniform', text: 'Kerapian & Seragam: Menggunakan seragam kerja resmi tim transportasi sekolah.' },
          { key: 'license', text: 'Kelengkapan Dokumen: Memiliki dan membawa SIM B1 / B1 Umum aktif yang sesuai peruntukan.' },
          { key: 'communication', text: 'Etika & Komunikasi: Menggunakan bahasa yang santun dan ramah saat berkomunikasi dengan siswa, guru, orang tua, maupun tim operasional.' },
          { key: 'no_phone', text: 'Penggunaan Gawai: Dilarang mengoperasikan HP, membaca/membalas pesan, atau menggunakan pemutar media dengan headset/earphone saat mengemudi (HP hanya untuk keadaan mendesak, bus dihentikan di lokasi aman terlebih dahulu).' },
        ],
      },
      {
        key: 'B',
        title: 'Pengecekan Fisik & Mekanis Kendaraan (Pra-Operasi)',
        items: [
          { key: 'tires', text: 'Kondisi Ban: Memeriksa tekanan angin, ketaatan baut roda, dan keausan/kondisi fisik ban.' },
          { key: 'brakes', text: 'Sistem Pengereman: Mengecek fungsi rem kaki, rem tangan/parkir, dan rem angin (jika ada).' },
          { key: 'lights', text: 'Sistem Pencahayaan: Memeriksa lampu utama/depan (wajib selalu dihidupkan di area operasional/PTFI), lampu sein, lampu rem, lampu mundur, dan hazard.' },
          { key: 'fluids', text: 'Level Cairan Kendaraan: Memeriksa level oli mesin, air radiator, minyak rem, dan air washer wiper.' },
          { key: 'cctv', text: 'Kamera & CCTV Keselamatan: Memastikan kamera CCTV dalam kabin dan kamera mundur berfungsi dengan baik.' },
          { key: 'horn', text: 'Klakson & Prosedur Isyarat: Memeriksa fungsi klakson (wajib: 1x sebelum nyala mesin, 2x sebelum bergerak maju, 3x sebelum bergerak mundur; di perumahan diimbangi mengemudi pelan/hati-hati).' },
          { key: 'wipers_mirrors', text: 'Pengusap Kaca & Spion: Memeriksa kebersihan/fungsi wiper, air wiper, serta kerapian dan penyetelan kaca spion.' },
          { key: 'doors_seatbelt', text: 'Pintu & Sabuk Pengaman Pengemudi: Memastikan pintu utama/darurat berfungsi baik dan sabuk pengaman pengemudi terpasang dengan benar.' },
          { key: 'dashboard', text: 'Panel Indikator Dashboard: Memeriksa indikator bahan bakar, suhu mesin, tekanan oli, pengisian aki, dan peringatan instrumen lainnya.' },
        ],
      },
    ],
  },

  helper_safety_trip: {
    label: 'Safety Trip Procedure (Helper)',
    role_label: 'Helper',
    intro: 'Menggunakan seragam kerja tim transportasi sekolah, berpenampilan rapi, '
         + 'dan santun; kondisi sehat/fit to work dan siap bertugas; bertindak sebagai '
         + 'panduan keselamatan, kelancaran, dan ketertiban penumpang selama perjalanan.',
    sections: [
      {
        key: 'A',
        title: 'Kesiapan Helper & Komunikasi',
        items: [
          { key: 'fit_to_work', text: 'Kondisi Kesehatan & Fit to Work: Dalam kondisi sehat, tidak mengantuk, dan bebas dari pengaruh obat-obatan.' },
          { key: 'uniform', text: 'Seragam Kerja: Menggunakan seragam kerja resmi tim transportasi sekolah.' },
          { key: 'communication', text: 'Sikap & Komunikasi: Berkomunikasi secara santun, ramah, dan sopan kepada siswa, guru, maupun orang tua murid.' },
          { key: 'briefing', text: 'Pengarahan Aturan Bus: Membacakan/menyampaikan aturan keselamatan bus kepada siswa sebelum kendaraan bergerak.' },
        ],
      },
      {
        key: 'B',
        title: 'Prosedur Keberangkatan & Naik Penumpang',
        items: [
          { key: 'capacity', text: 'Kapasitas Penumpang: Memastikan jumlah penumpang tidak melebihi kapasitas tempat duduk / sabuk pengaman yang tersedia.' },
          { key: 'boarding_assist', text: 'Pendampingan Naik Bus: Membantu dan mengawasi siswa naik bus melalui pintu depan secara tertib dan aman.' },
          { key: 'seatbelt_check', text: 'Pemeriksaan Sabuk Pengaman: Memastikan seluruh penumpang telah mengenakan sabuk pengaman dengan benar sebelum bus mulai bergerak.' },
        ],
      },
      {
        key: 'C',
        title: 'Pengawasan Selama Perjalanan (In-Transit)',
        items: [
          { key: 'no_standing', text: 'Ketertiban Kabin: Memastikan tidak ada penumpang yang berdiri atau berjalan saat bus sedang bergerak.' },
          { key: 'conduct', text: 'Pengawasan Perilaku: Memastikan siswa tetap duduk tenang, sopan, dan menjaga ketertiban selama perjalanan.' },
          { key: 'first_aid_apar', text: 'Peralatan P3K & APAR: Memeriksa ketersediaan dan kesiapan kotak P3K serta Alat Pemadam Api Ringan (APAR).' },
          { key: 'spotter', text: 'Peran Spotter: Berperan sebagai spotter dari posisi aman (di luar blind spot & tanpa headset/HP) saat membantu driver melakukan manuver berisiko atau mundur.' },
        ],
      },
      {
        key: 'D',
        title: 'Prosedur Penurunan Penumpang & Menyeberang Jalan',
        items: [
          { key: 'alighting_front_door', text: 'Pengarahan Turun Bus: Mengarahkan penumpang untuk turun secara tertib hanya melalui pintu depan.' },
          { key: 'crossing_behind_bus', text: 'Prosedur Menyeberang Jalan: Memastikan penumpang yang akan menyeberang jalan wajib melewati area belakang bus (dilarang keras melewati area depan bus).' },
          { key: 'cabin_sweep', text: 'Pemeriksaan Akhir Kabin (Sweeping): Memeriksa seluruh area kabin di akhir rute untuk memastikan tidak ada siswa maupun barang yang tertinggal.' },
        ],
      },
      {
        key: 'E',
        title: 'Tanggap Darurat',
        items: [
          { key: 'emergency_evacuation', text: 'Evakuasi Darurat: Memahami dan siap memandu evakuasi penumpang ke area aman berjarak minimal 11 meter dari unit bus jika terjadi kondisi darurat/kebakaran.' },
        ],
      },
    ],
  },
};

const CHECKLIST_TYPES = Object.keys(CHECKLISTS);

function checklistDef(type) {
  return CHECKLISTS[type] || null;
}

/** Flat [{key, text, section}] list — used to validate a submission covers every item. */
function itemKeys(type) {
  const def = checklistDef(type);
  if (!def) return [];
  return def.sections.flatMap((s) => s.items.map((i) => i.key));
}

function itemText(type, key) {
  const def = checklistDef(type);
  if (!def) return key;
  for (const section of def.sections) {
    const item = section.items.find((i) => i.key === key);
    if (item) return item.text;
  }
  return key;
}

module.exports = { CHECKLISTS, CHECKLIST_TYPES, checklistDef, itemKeys, itemText };
