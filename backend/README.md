# Healthcare Platform — Backend API

REST API for a clinic: patients book appointments with doctors, doctors run appointments and keep medical records, nurses handle reception and lab work, and administrators manage the system.

**Stack:** NestJS 12 · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL (Supabase) · JWT · class-validator · Vitest

## Contents

- [Getting started](#getting-started)
- [General API rules](#general-api-rules)
- [Roles and access](#roles-and-access)
- [Endpoints](#endpoints)
  - [Public and auth](#public-and-auth)
  - [Departments](#departments-departments)
  - [Diagnoses](#diagnoses-diagnoses)
  - [Notifications](#notifications-notifications)
  - [Patient](#patient-patient)
  - [Doctor](#doctor-doctor)
  - [Nurse](#nurse-nurse)
  - [Admin](#admin-admin)
- [Business rules](#business-rules)
- [Tests](#tests)
- [Project structure](#project-structure)

---

## Getting started

```bash
npm install
cp .env.example .env        # fill in the values (see below)
npx prisma migrate deploy   # apply migrations to the database
npx prisma generate         # build the Prisma client
npm run start:dev           # http://localhost:3000
```

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Application connection. Supabase **transaction pooler**, port `6543`. |
| `DIRECT_URL` | Connection used by migrations. Supabase **session pooler**, port `5432`. |
| `JWT_SECRET` | Secret used to sign tokens. The app will not start without it. |
| `PORT` | Server port (default `3000`). |

### First administrator

An admin cannot be created through the API (registration only creates patients). Promote the first one by hand: register a user via `POST /auth/register`, then in Supabase → **Table Editor → users** change that user's `role` to `ADMIN`. After that the admin creates all other staff via `POST /auth/staff`.

### Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Run with auto-reload |
| `npm run build` / `npm run start:prod` | Build and run |
| `npm run test:all` | All tests (see [Tests](#tests)) |
| `npx prisma migrate dev --name <name>` | Create a migration after editing `prisma/schema.prisma` |

---

## General API rules

### Authentication

Every route except those marked **public** requires the header:

```
Authorization: Bearer <accessToken>
```

The token is issued by `POST /auth/register` or `POST /auth/login` and is valid for **1 day**. The user's role and status are checked against the database on every request, so a blocked user loses access immediately.

### Error format

```json
{ "statusCode": 400, "error": "Bad Request", "message": ["email must be an email", "password must be longer than or equal to 8 characters"] }
```

`message` is a string, or an array of strings for validation errors.

| Code | When |
|---|---|
| `400` | Invalid body or parameters; a business rule is violated |
| `401` | Missing, invalid or expired token; inactive account; wrong email/password |
| `403` | Wrong role (`"Insufficient role"`) or someone else's data (`"Not your patient"`) |
| `404` | Resource not found **or it belongs to another user** |
| `409` | Conflict: email taken, slot taken, record already exists, deleting a catalogue entry that is in use |

### Validation

- Request bodies and query strings are validated automatically. **Unknown fields are rejected with `400`** (for example, you cannot send `role` when registering).
- `:id` in a path must be an integer, otherwise `400`.
- In the tables below, `*` marks a required field.

### Data formats

| Type | Format | Example |
|---|---|---|
| Date and time | ISO 8601 | `2030-01-02T10:00:00.000Z` |
| Date (no time) | `YYYY-MM-DD` | `2030-01-02` |
| Time of day | `HH:mm` (24h, **UTC**) | `09:30` |

### Pagination

Endpoints marked **📄** accept `?page=1&limit=50` (`page` ≥ 1, `limit` 1–200; defaults 1 and 50) and return:

```json
{ "items": [ ... ], "total": 125, "page": 1, "limit": 50 }
```

### Enums

| Enum | Values |
|---|---|
| `Role` | `PATIENT`, `DOCTOR`, `NURSE`, `ADMIN` |
| `Gender` | `MALE`, `FEMALE`, `OTHER` |
| `UserStatus` | `ACTIVE`, `INACTIVE`, `BLOCKED` |
| `AppointmentStatus` | `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED` |
| `TestStatus` | `PENDING`, `COMPLETED`, `CANCELLED` |

---

## Roles and access

| Route group | PATIENT | DOCTOR | NURSE | ADMIN |
|---|:-:|:-:|:-:|:-:|
| `/auth/register`, `/auth/login`, `GET /` | ✅ public | ✅ | ✅ | ✅ |
| `/auth/me`, `/notifications/*`, `GET /departments*` | ✅ | ✅ | ✅ | ✅ |
| `/patient/*` | ✅ | — | — | — |
| `/doctor/*` | — | ✅ | — | — |
| `/nurse/*` | — | — | ✅ | — |
| `/admin/*`, `POST /auth/staff` | — | — | — | ✅ |
| `GET /diagnoses*` | — | ✅ | ✅ | ✅ |
| `POST /diagnoses` | — | ✅ | — | ✅ |
| `PATCH/DELETE /diagnoses/:id`, writes to `/departments` | — | — | — | ✅ |

**Data isolation.** Every user sees and changes only their own data: a patient their own appointments and medical history, a doctor their own appointments and the records attached to them. Someone else's resource returns `404`.

---

## Endpoints

Legend: **Q** — query parameters, **Body** — JSON body, **→** — response.

### Public and auth

#### `GET /` — public
Health check. → `200`, text `Hello World!`.

#### `POST /auth/register` — public
Registers a patient. The role is always `PATIENT` and cannot be chosen.

| Body | Type | Rules |
|---|---|---|
| `firstName`* | string | up to 100 characters |
| `lastName`* | string | up to 100 characters |
| `email`* | string | valid email; stored lower-cased |
| `password`* | string | 8–72 characters |
| `phone` | string | |
| `gender` | `Gender` | |
| `dateOfBirth` | date | `YYYY-MM-DD` |
| `address` | string | |

→ `201` `{ "user": { id, firstName, lastName, email, phone, gender, dateOfBirth, address, role, status, createdAt }, "accessToken": "…" }`
Errors: `400` validation · `409` email already registered.

#### `POST /auth/login` — public
Body: `email`*, `password`*. → `200` `{ "accessToken": "…" }`
Errors: `401` wrong email/password, or the account is not `ACTIVE`.

#### `GET /auth/me`
The current user. → `200` user object (same fields as in `register`, no password).

#### `POST /auth/staff` — ADMIN
Creates a staff member (doctor, nurse, admin, or a patient). For `DOCTOR` a doctor profile is created automatically.
Body: all `register` fields + `role`* (`Role`), `specialization`, `licenseNumber` (the last two are used only for `DOCTOR`).
→ `201` user object. Errors: `400` · `409`.

---

### Departments (`/departments`)

| Method and path | Access | Description |
|---|---|---|
| `GET /departments` | any role | List of departments, ordered by name |
| `GET /departments/:id` | any role | Department + `_count.doctors`. `404` |
| `POST /departments` | ADMIN | Create → `201` |
| `PATCH /departments/:id` | ADMIN | Update. `404` |
| `DELETE /departments/:id` | ADMIN | → `204`. `409` if the department still has doctors |

Body (`POST` requires `departmentName`, `PATCH` makes everything optional): `departmentName`* (up to 200), `description`, `location`.

---

### Diagnoses (`/diagnoses`)

A catalogue of diagnoses. A doctor takes `diagnosisId` from here when writing a medical record.

| Method and path | Access | Description |
|---|---|---|
| `GET /diagnoses` 📄 | DOCTOR, NURSE, ADMIN | **Q:** `search` (by name, case-insensitive), `page`, `limit`. Ordered by name |
| `GET /diagnoses/:id` | DOCTOR, NURSE, ADMIN | `404` |
| `POST /diagnoses` | DOCTOR, ADMIN | `201` |
| `PATCH /diagnoses/:id` | ADMIN | `404` |
| `DELETE /diagnoses/:id` | ADMIN | `204`. `409` if the diagnosis is used in medical records |

Body: `name`* (up to 200; optional in `PATCH`), `description`.

---

### Notifications (`/notifications`)

Available to every role; each user sees only their own.

| Method and path | Description |
|---|---|
| `GET /notifications` | **Q:** `unread=true` — unread only. → array of `{ id, userId, appointmentId, title, message, isRead, createdAt }`, newest first |
| `PATCH /notifications/:id/read` | Mark as read → `{ id, isRead: true }`. `404` if it is not yours |
| `PATCH /notifications/read-all` | Mark all as read → `{ updated: <count> }` |

Notifications are created automatically: a new booking → the doctor; a cancellation by the patient → the doctor; a status change by a doctor or nurse → the patient. An admin can also send one (`POST /admin/notifications`).

---

### Patient (`/patient`)

`PATIENT` role only.

#### Profile

| Method and path | Description |
|---|---|
| `GET /patient/profile` | Your own profile |
| `PATCH /patient/profile` | Update. Body (all optional): `firstName`, `lastName`, `phone`, `gender`, `dateOfBirth`, `address`. Email, role and status cannot be changed |

#### Doctor catalogue

| Method and path | Description |
|---|---|
| `GET /patient/departments` | List of departments |
| `GET /patient/doctors` | **Q:** `departmentId` (int), `specialization` (substring, case-insensitive). Active doctors only. → `[{ staffId, specialization, department: { id, departmentName, location } \| null, user: { firstName, lastName }, averageRating: number \| null, feedbackCount }]`. Email and licence number are not exposed |
| `GET /patient/doctors/:id/schedule` | The doctor's working slots from today onwards → `[{ id, doctorId, workDate, startTime, endTime }]`. `404` if the doctor is not found |

#### Appointments

| Method and path | Description |
|---|---|
| `POST /patient/appointments` | Book an appointment with a doctor |
| `GET /patient/appointments` | **Q:** `status` (`AppointmentStatus`). Your appointments, newest first, with doctor details |
| `GET /patient/appointments/:id` | One of your appointments. `404` |
| `PATCH /patient/appointments/:id/cancel` | Cancel (only `PENDING` / `CONFIRMED`) → the updated appointment |

**`POST /patient/appointments`**

| Body | Type | Rules |
|---|---|---|
| `doctorId`* | int | doctor id (`staffId` from the catalogue) |
| `appointmentDate`* | datetime | ISO 8601, strictly in the future, inside the doctor's working hours (UTC; the end of a shift is exclusive) |
| `reason` | string | up to 1000 characters |

→ `201` `{ id, patientId, doctorId, appointmentDate, status: "PENDING", reason, notes }`
Errors: `400` time in the past / outside the schedule / booking yourself · `404` doctor not found · `409` slot already taken. Cancelled appointments do not occupy a slot.

#### Medical data (read-only, your own)

| Method and path | Description |
|---|---|
| `GET /patient/records` | Medical history: `[{ id, appointmentId, treatment, prescription, createdAt, diagnosis, prescriptions[], testResults[], appointment: { id, appointmentDate, doctor } }]`, newest first |
| `GET /patient/records/:id` | One record. `404` |
| `GET /patient/prescriptions` | All prescriptions `[{ id, recordId, medicationName, dosage, frequency, duration }]` |
| `GET /patient/test-results` | All test results `[{ id, recordId, testName, resultDetails, testDate, status }]` |

#### Feedback

| Method and path | Description |
|---|---|
| `POST /patient/feedbacks` | Leave a review for a doctor |
| `GET /patient/feedbacks` | Your own reviews |

**`POST /patient/feedbacks`** Body: `doctorId`* (int), `rating`* (integer 1–5), `comment` (up to 2000).
→ `201`. Errors: `400` no `COMPLETED` appointment with this doctor · `404` doctor not found · `409` you have already reviewed this doctor.

---

### Doctor (`/doctor`)

`DOCTOR` role only. Every request is scoped to the doctor's own data.

#### Profile and patients

| Method and path | Description |
|---|---|
| `GET /doctor/profile` | Profile: department, specialization, licence, user details |
| `GET /doctor/patients` | Patients who have had an appointment with this doctor |
| `GET /doctor/patients/:id/records` | Full medical history of such a patient (diagnoses, prescriptions, tests). `403` if the patient is not yours |

#### Appointments

| Method and path | Description |
|---|---|
| `GET /doctor/appointments` | **Q:** `status`, `from`, `to` (ISO datetime, by appointment date). Your appointments in ascending date order, with patient details |
| `GET /doctor/appointments/:id` | Appointment + patient + medical record (if any). `404` |
| `PATCH /doctor/appointments/:id/status` | Change the status. The patient is notified |

**`PATCH …/status`** Body: `status`* (`AppointmentStatus`), `notes`.
Allowed transitions: `PENDING → CONFIRMED | CANCELLED`, `CONFIRMED → COMPLETED | CANCELLED`. A completed or cancelled appointment cannot be changed → `400`.

#### Medical records

| Method and path | Description |
|---|---|
| `POST /doctor/records` | Create a record for one of your appointments |
| `GET /doctor/records` | Your records |
| `GET /doctor/records/:id` | One record with diagnosis, prescriptions, tests and patient. `404` |
| `PATCH /doctor/records/:id` | Update `diagnosisId`, `treatment`, `prescription` (all optional) |

**`POST /doctor/records`**

| Body | Type | Rules |
|---|---|---|
| `appointmentId`* | int | your own appointment; the patient is taken from it |
| `diagnosisId` | int | must exist in `/diagnoses` |
| `treatment` | string | |
| `prescription` | string | free text |
| `prescriptions` | array | up to 50 items: `{ medicationName*, dosage, frequency, duration }` |

→ `201`. Errors: `404` appointment is not yours / diagnosis not found · `409` a record for this appointment already exists.

#### Prescriptions (medication)

| Method and path | Description |
|---|---|
| `POST /doctor/records/:id/prescriptions` | Add to your record. Body: `medicationName`* (up to 200), `dosage`, `frequency`, `duration` → `201` |
| `PATCH /doctor/prescriptions/:id` | Update (all fields optional) |
| `DELETE /doctor/prescriptions/:id` | → `204` |

#### Test results

| Method and path | Description |
|---|---|
| `POST /doctor/records/:id/test-results` | Add a test result to your record → `201` |
| `PATCH /doctor/test-results/:id` | Update |
| `DELETE /doctor/test-results/:id` | → `204` |

Body (`POST`): `testName`* (up to 200), `testDate`* (ISO datetime), `resultDetails`, `status` (`TestStatus`, default `PENDING`). In `PATCH` every field is optional.

#### Schedule

| Method and path | Description |
|---|---|
| `GET /doctor/schedule` | Your schedule ordered by date and start time |
| `POST /doctor/schedule` | Add a working slot → `201` |
| `DELETE /doctor/schedule/:id` | → `204`. `404` for someone else's slot |

**`POST /doctor/schedule`** Body: `workDate`* (`YYYY-MM-DD`), `startTime`* (`HH:mm`), `endTime`* (`HH:mm`). `startTime` must be earlier than `endTime`, otherwise `400`.

#### Feedback

`GET /doctor/feedbacks` → `{ averageRating: number | null, total, items: [{ id, rating, comment, createdAt, patient: { id, firstName } }] }`

---

### Nurse (`/nurse`)

`NURSE` role only. Reception and laboratory.

| Method and path | Description |
|---|---|
| `GET /nurse/appointments` 📄 | **Q:** `status`, `doctorId`, `from`, `to`, `page`, `limit`. Appointments of all doctors in ascending date order, with patient and doctor |
| `PATCH /nurse/appointments/:id/status` | Confirm or cancel a **new** booking. The patient is notified |
| `GET /nurse/patients` 📄 | **Q:** `search` (first name, last name or phone, case-insensitive), `page`, `limit`. → `{ id, firstName, lastName, phone, gender, dateOfBirth }` |
| `GET /nurse/test-results` 📄 | **Q:** `status` (`TestStatus`), `page`, `limit`. Test results with the patient |
| `PATCH /nurse/test-results/:id` | Update a result. Body: `resultDetails`, `status` (both optional) |

**`PATCH …/appointments/:id/status`** Body: `status`* — only `CONFIRMED` or `CANCELLED`, and only while the appointment is `PENDING`. Only a doctor can complete an appointment (`COMPLETED`) → otherwise `400`.

---

### Admin (`/admin`)

`ADMIN` role only.

#### Users

| Method and path | Description |
|---|---|
| `GET /admin/users` 📄 | **Q:** `role`, `status`, `search` (first name, last name or email, case-insensitive), `page`, `limit`. Passwords are never returned |
| `GET /admin/users/:id` | User + doctor and department details. `404` |
| `PATCH /admin/users/:id` | Update a user |
| `DELETE /admin/users/:id` | **Deactivation** (`status = INACTIVE`), not deletion: appointment history is kept. → the updated user |
| `POST /admin/users/:id/password` | Set a new password. Body: `password`* (8–72) → `204` |

**`PATCH /admin/users/:id`** Body (all optional): `firstName`, `lastName`, `phone`, `gender`, `dateOfBirth`, `address`, `role`, `status`.
Changing the role to `DOCTOR` automatically creates the doctor profile. An admin **cannot** demote or deactivate themselves → `400`.

#### Doctors and their schedule

| Method and path | Description |
|---|---|
| `GET /admin/doctors` | All doctors with department and user details |
| `PATCH /admin/doctors/:id` | Body (all optional): `departmentId`, `hireDate`, `licenseNumber`, `specialization`. `404` if the doctor or department does not exist |
| `GET /admin/doctors/:id/schedule` | The schedule of any doctor |
| `POST /admin/doctors/:id/schedule` | Body as in `POST /doctor/schedule` → `201` |
| `DELETE /admin/doctors/:id/schedule/:scheduleId` | → `204` |

#### Appointments

| Method and path | Description |
|---|---|
| `GET /admin/appointments` 📄 | **Q:** `status`, `doctorId`, `patientId`, `from`, `to`, `page`, `limit`. Newest first, with patient and doctor |
| `GET /admin/appointments/:id` | One appointment. `404` |
| `PATCH /admin/appointments/:id` | Body: `status` (any `AppointmentStatus`, transitions are not checked), `notes` |

#### Feedback and notifications

| Method and path | Description |
|---|---|
| `GET /admin/feedbacks` 📄 | **Q:** `doctorId`, `page`, `limit` |
| `DELETE /admin/feedbacks/:id` | Delete a review (moderation) → `204`. `404` |
| `POST /admin/notifications` | Send a notification. Body: `userId`*, `title`* (up to 200), `message`, `appointmentId` → `201`. `404` if the user does not exist |

---

## Business rules

- **Registration** creates patients only. Staff are created by an admin (`POST /auth/staff`).
- **A doctor is a user with the `DOCTOR` role** plus a row in the doctors table; the doctor's `staffId` equals their `user_id`.
- **Booking:** the time must fall inside the doctor's schedule (UTC), be in the future and not overlap another non-cancelled appointment with the same doctor.
- **Appointment lifecycle:** `PENDING → CONFIRMED → COMPLETED`; it can be cancelled (`CANCELLED`) at any point before completion. A doctor or nurse can confirm or cancel a new booking; only a doctor can complete it.
- **One medical record per appointment.** The doctor creates it and the patient is taken from the appointment.
- **Feedback** is allowed only after a completed appointment, once per doctor, with a rating from 1 to 5.
- **Users are never deleted**, only deactivated, because medical history refers to them.
- **Catalogues** (departments, diagnoses) cannot be deleted while in use → `409`.

---

## Tests

| Command | Suite | What it checks |
|---|---|---|
| `npm test` | unit | Basic unit tests |
| `npm run test:e2e` | API (562 tests) | Every route over HTTP with a mocked database: a role matrix for each endpoint, validation, business rules. The suite compares the list of registered routes with the matrix, so a new endpoint without an access rule fails the build |
| `npm run test:db` | SQL (44 tests) | The same code against a **real PostgreSQL**: an end-to-end clinic scenario, data isolation between users, database constraints, pagination and search |
| `npm run test:all` | everything | |

`test:db` starts a throw-away PostgreSQL on a random local port (the `embedded-postgres` package, no Docker needed), applies the migrations from `prisma/migrations` and deletes the database afterwards. The `.env` file and the Supabase database are never used by tests.

## Project structure

```
prisma/              schema and migrations
src/
  auth/              registration, login, JWT, guards, role decorators
  patient/ doctor/ nurse/ admin/    role-specific APIs
  departments/ diagnoses/ notifications/   shared resources
  prisma/            PrismaService (Supabase connection)
  common/            pagination
test/                API tests; test/db — tests against real SQL
```
