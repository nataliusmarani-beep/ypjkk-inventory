-- =============================================================================
-- YPJ School Bus Management Application
-- Migration 0003 — reference data seed
--   * academic year 2025/2026
--   * the 19 pickup points (TPS) from the 2024/25 form, with capacities sized
--     from actual observed demand in the 223-row export
--   * employer lookup with the alias spellings found in that export
--   * "Peraturan dan Ketentuan Bis Sekolah YPJ" v1.0 (verbatim)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Academic year
-- -----------------------------------------------------------------------------

insert into academic_years (code, short_code, starts_on, ends_on, is_current)
values ('2025/2026', '2526', date '2025-07-14', date '2026-06-30', true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Pickup points. Codes and names are exactly the radio options of the old form.
-- seat_capacity is an initial plan; TPS#1/#2/#3/#17 carried the bulk of the
-- 2024/25 demand (33 / 31 / 45 / 47 students respectively).
-- -----------------------------------------------------------------------------

insert into bus_stops (code, name, area, seat_capacity, sort_order) values
  ('TPS#1',  'RWB KK',                                'KK',     45,  1),
  ('TPS#2',  'Halte Timika Indah 1',                  'TIMIKA', 45,  2),
  ('TPS#3',  'Halte Timika Indah 2',                  'TIMIKA', 50,  3),
  ('TPS#4',  'Depan Dealer Honda',                    'TIMIKA', 20,  4),
  ('TPS#5',  'Depan Petrosea',                        'TIMIKA', 20,  5),
  ('TPS#6',  'Depan Kantor KPPN SP2',                 'SP2',    20,  6),
  ('TPS#7',  'Depan Perumahan Hope / BPJS SP2',       'SP2',    25,  7),
  ('TPS#8',  'Halte Perumahan PEMDA SP2',             'SP2',    20,  8),
  ('TPS#9',  'Simpang 5 SP2 (Awalin)',                'SP2',    20,  9),
  ('TPS#10', 'Halte Karitas (Depan Gereja Diaspora SP3)', 'SP3', 25, 10),
  ('TPS#11', 'Jalur 3 SP2',                           'SP2',    20, 11),
  ('TPS#12', 'Jalur 4 SP2',                           'SP2',    20, 12),
  ('TPS#13', 'Depan Kantor KPU lama - SP3',           'SP3',    20, 13),
  ('TPS#14', 'Depan Perumahan Regency / BRI SP3',     'SP3',    20, 14),
  ('TPS#15', 'Jalur Jl. Ketapang SP3',                'SP3',    25, 15),
  ('TPS#16', 'Depan Batako Papua SP3',                'SP3',    20, 16),
  ('TPS#17', 'Depan Pondok Amor SP3',                 'SP3',    50, 17),
  ('TPS#18', 'Depan Jalur SD Seminari TSM – SP3',     'SP3',    20, 18),
  ('TPS#19', 'Halte Koramil SP3',                     'SP3',    20, 19)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Employers. `aliases` holds the real spellings harvested from the 2024/25
-- export so the app can auto-match what parents type and so the import script
-- can collapse 87 strings into these rows.
-- -----------------------------------------------------------------------------

insert into companies (name, short_name, is_ptfi_group, aliases) values
  ('PT Freeport Indonesia', 'PTFI', true, array[
    'PTFI','PTFi','PTfi','PT FI','PT. FI','PT.FI','FI','PT Freeport',
    'PT. Freeport','PT.Freeport','PT freeport','PT, Freeport',
    'PT Freeport Indonesia','PT. Freeport Indonesia','PT.Freeport Indonesia',
    'PT. Freeport indonesia','PT.FREEPORT INDONESIA','PT. FREEPORT INDONESIA',
    'FREEPORT INDONESIA','Freeport','Freeport indonesia','Preeport Indonesia',
    'PGT','PT.FI (SRM)','PTFI-SRM','PTFI/PGT','PTFI-NMI','Fi - PGT','FI (SLD)',
    'PT Freeport/ TRMP','PT. Freeport/ TRMP','PTFI/ TRMP','PTFI/TRMP',
    'PT. Freeport/Finance Accounting','PTFI / GBC Engineering',
    'PTFI GBC Engineering','PTFI / L&OD','PTFI / UG Engineering',
    'PTFI Geoengineer','PTFI /Enviromental Div','PTFI/MIS Dept','FI/MIS DEPT',
    'PTFI-Dept Facilities & Town Management','PTFI, Departemen: HR-IR',
    'PTFI Departement Industrial Relations',
    'PTFI Departement  Industrial Relations',
    'PTFI departement Industrial Relations','PTFI/ IR','IR PTFI',
    'PT. Freeport Indonesia. Department : HR-IR',
    'PT. Freeport Indonesia / SHE Ops. Maintenance',
    'PT.Freeport Indonesia/SHE Ops.Maintenance',
    'PT.Freeport Indonesia,Central Service','Operation Support',
    'Power Generation Transmision (PGT)','Power generation & transmition',
    'Power generation and transmission','PGT coal plant',
    'Supply Chains Management (SCM)','Supply Chains management (SCM)',
    'Devisi Enviroment','Enviromental','TEL (Timika Enviromental Labiatory)- PT. FI']),
  ('PT Kuala Pelabuhan Indonesia', 'KPI', true, array[
    'KPI','PT. KPI','PT.KPI','PT Kuala Pelabuhan Indonesia (KPI)',
    'KPI/MARINE OPERATION']),
  ('Yayasan Pendidikan Jayawijaya', 'YPJ', true, array[
    'YPJ','Ypj','YPJ SCHOOL','Ypj School']),
  ('Nemangkawi Mining Institute', 'NMI', true, array[
    'Nemangkawi','Nemangkawi Mining Institut','PTFI-NMI']),
  ('International SOS / PT Alas Emas Abadi', 'ISOS', false, array[
    'ISOS','ISOS (AEA)','AEA','Internasional SOS','International SOS',
    'international SOS','PT Alas Emas Abadi (ISOS)',
    'PT Alas Emas Abadi Internasional SOS']),
  ('PT Trakindo Utama', 'Trakindo', false, array[
    'PT Trakindo Utama','PT.Trakindo utama']),
  ('Brunel Service Indonesia', 'Brunel', false, array['Brunel Service Indonesia']),
  ('PT Sandvik', 'Sandvik', false, array['SANDVIK']),
  ('PHMC', 'PHMC', false, array['PHMC']),
  ('Geoinjinering / Qiaqisi', null, false, array['Geoinjinering /Qiaqisi']),
  ('Lainnya / Other', 'OTHER', false, array['Perusahaan'])
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- Initial routes for 2025/2026, mirroring the corridors in the stop list.
-- -----------------------------------------------------------------------------

insert into routes (academic_year_id, code, name, seat_capacity)
select ay.id, r.code, r.name, r.cap
from academic_years ay,
     (values ('KK-A',  'Kuala Kencana — RWB',        45),
             ('TMK-A', 'Timika Indah 1 & 2',         90),
             ('SP2-A', 'SP2 Koridor (Hope–PEMDA–Jalur 3/4)', 90),
             ('SP3-A', 'SP3 Koridor (Pondok Amor–Ketapang)', 90),
             ('SP3-B', 'SP3 Koridor (Karitas–Koramil–Seminari)', 45)
     ) as r(code, name, cap)
where ay.is_current
on conflict (academic_year_id, code) do nothing;

insert into route_stops (route_id, bus_stop_id, sequence, pickup_time)
select r.id, s.id, x.seq, x.pickup::time
from (values
    ('KK-A',  'TPS#1',  1, '06:15'),
    ('TMK-A', 'TPS#2',  1, '06:05'),
    ('TMK-A', 'TPS#3',  2, '06:10'),
    ('TMK-A', 'TPS#4',  3, '06:15'),
    ('TMK-A', 'TPS#5',  4, '06:20'),
    ('SP2-A', 'TPS#6',  1, '06:05'),
    ('SP2-A', 'TPS#7',  2, '06:10'),
    ('SP2-A', 'TPS#8',  3, '06:15'),
    ('SP2-A', 'TPS#9',  4, '06:20'),
    ('SP2-A', 'TPS#11', 5, '06:25'),
    ('SP2-A', 'TPS#12', 6, '06:30'),
    ('SP3-A', 'TPS#13', 1, '06:05'),
    ('SP3-A', 'TPS#14', 2, '06:10'),
    ('SP3-A', 'TPS#15', 3, '06:15'),
    ('SP3-A', 'TPS#16', 4, '06:20'),
    ('SP3-A', 'TPS#17', 5, '06:25'),
    ('SP3-B', 'TPS#10', 1, '06:05'),
    ('SP3-B', 'TPS#18', 2, '06:12'),
    ('SP3-B', 'TPS#19', 3, '06:18')
  ) as x(route_code, stop_code, seq, pickup)
join academic_years ay on ay.is_current
join routes r on r.code = x.route_code and r.academic_year_id = ay.id
join bus_stops s on s.code = x.stop_code
on conflict (route_id, bus_stop_id) do nothing;

-- -----------------------------------------------------------------------------
-- Rules document v1.0 — text as printed on the 2024/25 form, plus the parent
-- confirmation paragraph that appeared above the signature question.
-- -----------------------------------------------------------------------------

insert into rule_documents (version, title, body_md, effective_from, published_at)
values (
  '1.0',
  'Peraturan dan Ketentuan Bis Sekolah YPJ',
$md$
## I. KETENTUAN

- **Bis sekolah YPJ diperuntukan hanya** untuk pelajar/Guru YPJ yang telah terdaftar dan eligible.
- **Pelayanan kepada siswa YPJ tidak dipungut biaya.** Gratis dan melayani selama jam operasional sekolah.
- **Bis hanya berhenti di halte/TPS** yang telah ditetapkan.
- **Jumlah penumpang tidak boleh melebihi** seat yang tersedia.

## II. PERILAKU BERBAHAYA DI DALAM BIS SEKOLAH

- **Berdiri atau berjalan diatas bus saat bus berjalan** tanpa pegangan yang aman.
- **Berteriak atau membuat keributan** yang mengganggu konsentrasi sopir.
- **Mendorong atau berkelahi** dengan sesama siswa.
- **Melempar barang** di dalam bus.
- **Bullying dan berbicara kotor atau kasar serta provokasi** terhadap teman/petugas.
- **Makan dan minum di dalam bus** sehingga mengotori bis dengan tumpahan makanan.
- **Mengganggu sopir** saat mengemudi.
- **Tidak mematuhi instruksi petugas bus** atau sopir.
- **Sengaja merusak fasilitas bus.**

Sejalan dengan kebijakan PTFI mengenai prioritas keselamatan, YPJ menilai keselamatan
penumpang Bis sekolah merupakan prioritas utama. Tidak ada toleransi terhadap perilaku
tidak selamat di dalam Bis sekolah seperti termuat di atas.

Semua siswa/guru wajib mematuhi aturan penumpang Bis sebagaimana ditetapkan dalam Form
Kontrak Pengguna Bis ini. Orangtua siswa pengguna jasa Bis Sekolah wajib menyetujui
perjanjian pemakaian Bis Sekolah.

**Jika terjadi pelanggaran aturan Bus Sekolah YPJ, Hak istimewa pengguna Bis Sekolah
dapat dicabut.**

## III. KONFIRMASI ORANG TUA

Demikian form pengajuan penggunaan bus sekolah dan pernyataan ini disampaikan dengan
sebenarnya; jika dikemudian hari ditemukan ketidaksesuaian atas informasi yang disebutkan
di atas atau melakukan pelanggaran seperti tertera di atas; saya bersedia menerima
pencabutan akses tanggungan saya serta peninjauan kelayakan pendaftaran masuk sekolah,
sebagaimana ditetapkan dalam kebijakan Pemenuhan Syarat Pendaftaran di Sekolah yang
Disponsori PTFI (HR.EDUC.01).

## IV. KONTAK ADMIN

- Yoce Pallo — ypallo@fmi.com — HP 0823 4444 75224
- Natalius Marani — nmarani@fmi.com — HP 0813 4433 7315
$md$,
  date '2025-07-01',
  now()
)
on conflict (version) do nothing;
