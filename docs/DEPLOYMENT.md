# Deploying WMHS Portal v2

## 1. Before the first deploy (10 minutes)

| Do this | Why |
|---|---|
| Set **`JWT_SECRET`** to 48+ random characters (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). Render's blueprint generates one. | The server refuses to start without a strong secret. |
| Set **`ADMIN_EMAIL`** and **`ADMIN_PASSWORD`** in the host's dashboard. | Used once, to create the first admin. If you leave the password empty, a random one is printed once in the logs. The admin must change it at first sign-in. |
| Choose file storage: a **persistent disk** (`STORAGE_MODE=local`, `UPLOAD_DIR` on the disk) **or** Cloudinary (`STORAGE_MODE=cloudinary` + 3 keys). | On most hosts the container's own disk is wiped at every deploy – uploaded work would vanish. |
| Use a **paid** database plan with backups. | Free tiers expire or have no backups. A school's grades must not live on a free tier. |
| Rotate any credentials that were ever committed (the old `issues` file held real DB and Cloudinary secrets; it has been removed from this zip, but the secrets must be rotated at their source). | They are in your git history. |

## 2. First start

`npm start` runs, in order: `db/init.js` (creates/upgrades tables, safe to run every time), `db/seed.js` (9 starter classes with **random** join codes, first admin if none exists), then the server.

Upgrading from v1: nothing to export or convert. Existing admins/teachers are asked to choose a new password at next sign-in; the old published join codes are replaced automatically; every existing assignment, announcement and grade is placed in an academic year named after the current calendar year.

## 3. Day-to-day settings worth knowing

| Variable | Default | Meaning |
|---|---|---|
| `GRADUATE_ACCESS_MONTHS` | 12 | How long graduates keep read-only access to their results |
| `JWT_EXPIRES_IN` | 1d | Session length |
| `RATE_LIMIT_MAX_REQUESTS` | 3000 per 15 min per IP | Generous because a school often shares one public IP |
| `LOGIN_RATE_LIMIT_MAX` | 10 per 15 min per IP+email | Password-guessing protection |
| `DB_POOL_MAX` | 20 | Database connections |
| `MAX_FILE_SIZE_MB` | 10 | Upload limit |

## 4. Backups (do this, tell someone it exists)

* Managed Postgres: enable automatic backups and **test a restore once** into a scratch database.
* Extra safety, any host: `pg_dump "$DATABASE_URL" -Fc -f wmhs-$(date +%F).dump` nightly (cron / GitHub Action), keep 14 days off-site.
* If uploads are on a disk, back that folder up too; with Cloudinary, files are already off-site.

## 5. After deploying – run the checks

```bash
# on a TEST copy of the site, never on the live school data:
BASE_URL=https://your-test-site ADMIN_EMAIL=... ADMIN_PASSWORD='...' node tests/wmhs-e2e.js
BASE_URL=https://your-test-site ADMIN_PASSWORD='...' USERS=100 node tests/wmhs-load.js   # from another computer
```
For the load test start the test copy with `RATE_LIMIT_MAX_REQUESTS=1000000 REGISTER_RATE_LIMIT_MAX=1000000`.

## 6. Capacity (measured on a 2-core test machine, one Node process)

The measurements from the audit still apply: the database is rarely the bottleneck; bcrypt (password hashing) is. A whole class logging in at once is fine; several hundred at the same second queue up for a few seconds. v2 also lowered background traffic: the student dashboard now refreshes once a minute (was every 10 s) and stops while the tab is hidden.
