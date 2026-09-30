# Blood Donor Finder

A web app for finding **blood banks** and **willing blood donors** near a PIN code (India) or ZIP code (United States).
It works in phone and desktop browsers and can be added to a phone's home screen.

> **Status: working prototype.** It runs on your computer with demo data. Before real-world use, see
> [Before going live](#before-going-live).

## What it does

| For people who need blood | For donors |
|---|---|
| Search by PIN/ZIP code, distance (km in India, miles in the US) and blood group | Sign up with name, email, optional phone, blood group and PIN/ZIP |
| Option to include compatible groups (e.g. O-/O+/A-/A+ donors for an A+ patient) | Confirm email before appearing in search |
| See nearby blood banks with phone number and published stock | Pause, update or delete the profile through a private link |
| Send a **masked contact request** to a donor | Accept or decline each request |
| Get the donor's phone/email **only after the donor accepts** | Hidden automatically for 90 days (India) / 56 days (US) after a donation |

### Privacy by design

- Search results show only the donor's **first name + last initial, blood group, area and rough distance**. Donor
  locations are stored as the centre of their postal code, never as an exact address.
- Phone and email are exchanged only when a donor **accepts** a request, and both sides get each other's details by email.
- Links in emails carry a secret token in the URL fragment (`#token=…`), and only a hash of it is stored. A link
  only shows a page; you still click Accept or Decline yourself, so email scanners that open links can't respond for you.
- Abuse limits: 5 requests per requester per hour, at most 3 open requests per donor per day, no duplicate pending
  requests, and a per-IP limit on all write endpoints. Unanswered requests expire after 72 hours.

## Run it

Requires **Node.js 22.13 or newer**. The database uses Node's built-in SQLite, so there's nothing native to compile.

```bash
cd blood-donor-finder
npm install
npm start          # http://localhost:3000
```

On first start the database (`data/app.db`) is filled with **demo data**: 30 postal codes, one demo blood bank and four
demo donors around each. Demo records are labelled "Demo data" in the UI. Try PIN `560034` (Bengaluru) or ZIP `10001`
(New York).

**Emails:** if no SMTP server is configured, emails are not sent. Read them at
**http://localhost:3000/dev/outbox** and click the links to act as the donor or requester. To send real email, copy
`.env.example` to `.env` and fill in `SMTP_*` and `BASE_URL`.

```bash
npm test                 # unit and API tests (node:test)
npm run seed -- --reset        # wipe banks/donors/requests and reload demo data
npm run seed -- --remove-demo  # delete only demo banks/donors (set SEED_DEMO=false too)
```

## Host it on Render (free, open it from your phone)

The repository root has a `render.yaml` Blueprint that sets everything up.

1. Sign up at [render.com](https://render.com) with **GitHub**, and allow Render to access this repository.
2. In the Render dashboard, choose **New → Blueprint**, pick this repository and the branch that contains
   `render.yaml`, then **Apply**.
3. When the deploy is live, open the `https://….onrender.com` link on your phone. Use **Add to Home Screen** to open
   it like an app.
4. Emails are in `https://….onrender.com/dev/outbox`. Enter any username, and use the `OUTBOX_PASSWORD` shown under
   the service's **Environment** tab.

Free-plan notes: the app sleeps after about 15 minutes idle and takes about 30 seconds to wake. Its SQLite file is
wiped on every restart or redeploy, which puts the demo data back and removes anything added since. Email links use
Render's `RENDER_EXTERNAL_URL` automatically.

## Real data

### Postal codes (any PIN / ZIP)

Postal codes that aren't in the local table are looked up online at [zippopotam.us](https://zippopotam.us), and each
result is saved for next time. To work fully offline, or for better coverage, import the free
[GeoNames](https://download.geonames.org/export/zip/) files (CC BY 4.0):

```bash
# download and unzip US.zip and IN.zip from https://download.geonames.org/export/zip/
npm run import:postal -- US.txt IN.txt
```

### Blood banks

Blood banks don't publish donors' personal details, so donors come only from people who sign up here. Blood bank
**locations** can be imported from public directories:

- **India:** the *Blood Bank Directory* on [data.gov.in](https://data.gov.in) (National Health Portal) includes names,
  addresses, PIN codes, phone numbers and coordinates. Live stock is shown on
  [e-RaktKosh](https://eraktkosh.mohfw.gov.in); ask them about access before building an integration.
- **United States:** there's no single open directory. Use lists from regional blood centres, the American Red Cross,
  or America's Blood Centers, with their permission.

```bash
npm run import:banks -- --country IN blood-bank-directory.csv --source data.gov.in
npm run import:banks -- --country US us-centers.csv --source my-list --replace
```

Column names are matched case-insensitively (`name`/`blood bank name`, `address`, `city`/`district`, `state`,
`pincode`/`zip`, `phone`/`contact no`, `website`, `latitude`, `longitude`). You can also add one column per blood
group (`A+`, `O-`, …) with units in stock. Rows without coordinates are placed at their postal code's centre.
`--replace` first deletes that country's banks from the same `--source`. To remove the demo data, run
`npm run seed -- --remove-demo` and set `SEED_DEMO=false` in `.env`.

After an import, check the `Imported … / Skipped …` lines. If most rows were skipped, the file's column names
don't match the list above: rename the header row, or add the new names to `ALIASES` in
`scripts/import-blood-banks.js`.

## How it's built

```
src/
  server.js      entry point (loads .env, opens DB, seeds demo data)
  app.js         Express app: search, donors, masked requests, dev outbox
  blood.js       blood groups, compatibility, per-country rules (postal format, unit, deferral days)
  geo.js         distance, bounding box, postal-code lookup (local table -> zippopotam.us)
  db.js          SQLite schema (node:sqlite)
  mailer.js      SMTP via nodemailer, plus an outbox table for development
  seed.js        demo postal codes, banks and donors
scripts/         seed, import-postal-codes, import-blood-banks
public/          static pages (plain HTML/CSS/JS, no build step)
test/            node:test unit and API tests
```

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Countries, blood groups, urgency options |
| GET | `/api/search?country=IN&postalCode=560001&radius=10&bloodGroup=A%2B&compatible=1` | Nearby banks and donors |
| POST | `/api/donors` | Register (sends a confirm email and a manage link) |
| POST | `/api/donors/verify` | Confirm email `{token}` |
| POST | `/api/donors/manage-link` | Email a new manage link `{email}` |
| GET/PATCH/DELETE | `/api/donors/me` | Own profile (header `x-manage-token`) |
| POST | `/api/requests` | Send a masked contact request to a donor |
| GET/POST | `/api/requests/respond` | Donor views, accepts or declines (header `x-request-token`) |
| GET | `/api/requests/status` | Requester tracks the request (header `x-request-token`) |

## Before going live

- Host it somewhere with HTTPS, set `NODE_ENV=production` (this turns off `/dev/outbox`), and set `BASE_URL` and SMTP
  settings (e.g. Amazon SES, SendGrid, Postmark).
- Replace demo data with imported blood banks, and get permission from data owners.
- Add a CAPTCHA to sign-up and request forms, and a way for donors to report misuse.
- Write a privacy policy that covers consent and data deletion. In India this falls under the DPDP Act 2023. US
  state privacy laws may also apply.
- Optional next steps: SMS alerts, map view, "use my current location", admin screen for blood banks to update stock,
  and more than one server instance (the in-memory rate limiter assumes a single process).
