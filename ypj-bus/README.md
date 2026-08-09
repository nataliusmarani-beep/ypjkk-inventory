# YPJ School Bus Management Application

Replaces the 2024/25 Microsoft Forms + Excel process for YPJ Kuala Kencana school bus
registration. Same stack as the YPJ Inventory app — Express + `node:sqlite` + React/Vite,
one Railway service — so there is nothing new to learn to maintain it, and parents open a
link instead of installing an app.

Full specification (analysis of the 223 old submissions, ERD, flowcharts, wireframes,
rollout plan) is in [docs/SPEC.md](docs/SPEC.md).

```
ypj-bus/
├── railway.json                  NIXPACKS build + `node backend/server.js`
├── package.json                  build / start / install:all / seed:admins
├── .env.example
├── backend/
│   ├── server.js                 Helmet, CORS, rate limits, static frontend, nightly job
│   ├── db.js                     Schema + idempotent seed (19 TPS, employers, rules v1.0)
│   ├── seed-admins.js            Creates the two Transport Team accounts
│   ├── middleware/auth.js        JWT cookie auth + requireRole
│   ├── lib/
│   │   ├── cards.js              Submit gate, capacity guard, card issuance, reconcile
│   │   ├── qr.js                 Signed static payload + rotating single-use token
│   │   ├── files.js              Photo/signature storage on the Railway volume
│   │   └── notify.js             In-app + Resend email (same approach as Inventory)
│   └── routes/
│       ├── auth.js               Parent self-registration, login, profile
│       ├── meta.js               Stops with live load, employers, rules, notifications
│       ├── applications.js       Module 1 — the whole form in one transactional POST
│       ├── admin.js              Module 2 — queue, decisions, cards, sanctions, export
│       ├── cards.js              Module 3 — parent's cards + QR minting
│       ├── scan.js               Attendant scanning + violation reports
│       └── files.js              Ownership-checked photo/signature serving
└── frontend/
    └── src/
        ├── App.jsx               Role-based routing, heavy pages code-split
        ├── api.js                Fetch wrapper (cookie credentials, 401 → logout)
        ├── index.css             YPJ blue/gold, 16px base, 48px touch targets
        ├── components/           SignaturePad · PhotoCapture · StopPicker · RulesPanel
        └── pages/
            ├── LoginPage.jsx
            ├── ParentHomePage.jsx        One card per child
            ├── ApplicationFormPage.jsx   Module 1 — 4-step consent form
            ├── BusCardPage.jsx           Module 3 — card + rotating QR + save/print
            ├── AdminQueuePage.jsx        Module 2 — queue + review drawer
            └── ScannerPage.jsx           Attendant QR scanner
```

## Local development

```bash
npm run install:all
```

Backend on :3001, frontend on :5173 (Vite proxies `/api` through):

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

Create the Transport Team accounts once (Yoce Pallo, Natalius Marani — the two admins
named in the rules sheet):

```bash
npm run seed:admins
```

That prints the starting password; change it after the first sign-in. Everyone else —
parents — registers themselves from the login screen.

## Deploying to Railway

Same shape as the Inventory app: one service, NIXPACKS, `node backend/server.js`.

1. New Railway project pointed at this directory, then **attach a volume**. 1 GB is
   ample: a student photo is capped at 100 KB and a signature at 150 KB, so a full
   250-student intake is ~25 MB including the database.
2. Environment variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DB_PATH` | `/data/bus.sqlite` (inside the volume) |
| `UPLOAD_DIR` | `/data/uploads` (inside the volume) |
| `FRONTEND_URL` | the public Railway URL — used for CORS and email links |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `QR_SECRET` | `openssl rand -hex 32` — **rotating this invalidates every issued card**, so change it only between academic years |
| `RESEND_API_KEY` | same key/domain the Inventory app uses |
| `MAIL_FROM_DOMAIN` | `ypj.sch.id` |

3. Deploy, then run `npm run seed:admins` once from the Railway shell.

The database and uploads must both live on the volume: anything written elsewhere is
lost on the next deploy.

## Business rules enforced in the backend, not just the UI

| Rule | Where |
|---|---|
| No submission without a student photo, a drawn signature, and the revocation acknowledgement | `lib/cards.js` → `assertSubmittable()`, re-checked inside the submit transaction |
| One application per student per academic year, and a parent cannot create the same child twice | partial unique indexes `applications_one_live_per_student_year` + `students_unique_per_parent` |
| Rejection and revision requests require a reason | table CHECK constraints + route validation |
| Approval automatically issues the Bus ID card, transit ID and expiry | `issueCard()` inside the approval transaction |
| A stop or route at capacity cannot be approved into | `assertCapacity()` |
| A suspension or revocation disables the card at the next scan | `POST /admin/cards/:id/sanction` → `verifyPayload()` |
| Photos and signatures are only readable by the owning parent or staff | `routes/files.js` |
| A parent may upload up to 2 MB, but never more than 100 KB per photo is stored | browser re-encode in `components/PhotoCapture.jsx`, ceiling enforced again in `lib/files.js` |
| The QR carries opaque identifiers only — never a name, address or phone number | `lib/qr.js` |

## What was verified

The whole path was exercised against a real SQLite database and a live browser:
parent registers → submits the 4-step form with a camera photo and a drawn signature →
Transport Team sees it in the queue with eligibility, capacity and duplicate flags →
approves → card issues automatically with a live rotating QR → attendant scan returns
*Izinkan*, a replayed code returns *replay*, a tampered signature returns *unknown_card*,
and a suspended card is refused at the scanner. Capacity, duplicate-submission,
missing-signature and missing-consent guards were each confirmed to reject.

Upload budget: a 1.9 MB photo picked in the browser was stored as 91 KB; a 2.1 MB file
was refused at the picker; and a 1.4 MB photo posted straight to the API — the
compression bypassed — was refused by the server with no orphaned file left behind.

Not yet exercised: Resend email delivery (needs the API key), and the attendant scanner
against a real phone camera.
