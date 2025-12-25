\# UPDATE: Codex Instructions — Schema Creation



This update modifies the Codex build plan to include schema creation using the attached RO (o.pdf) as the canonical template.



PII CONFIRMED (STORE IN pii\_vault ONLY, ENCRYPTED AT ALL TIMES):

\- customer name

\- email

\- phone numbers

\- VIN

\- license plate

\- payment method

\- address (city/state/zip)

Non-PII CONFIRMED (ALLOW IN repair\_orders):

\- vehicle year/make/model (+ optional color)

\- technician names/codes

\- advisor name/tag

\- mileage and dates

\- financial totals



==================================================

INSERT INTO CODEX BUILD FLOW (REPLACES TASK 4)

==================================================



Add the following as Task 4 in docs/codex\_tasks.md, replacing any prior “apply schema” task:



TASK 4 — CREATE RO ASSISTANT SCHEMA FROM TEMPLATE RO (o.pdf)

GOAL:

Create implementation-ready Postgres schema for the RO Assistant workload based on the canonical RO template.



FILES TO CREATE:

\- workloads/ro-assistant/db/migrations/0001\_init.sql

\- workloads/ro-assistant/db/migrations/0002\_ro\_core.sql

\- workloads/ro-assistant/db/migrations/0003\_ro\_line\_items.sql

\- workloads/ro-assistant/db/migrations/0004\_pii\_vault.sql

\- scripts/migrate.ts

\- package.json (add db:migrate script)



RULES:

\- Migrations are immutable; never edit earlier migration files after committed.

\- Every tenant-scoped table MUST have RLS enabled and a tenant isolation policy.

\- No plaintext PII columns outside pii\_vault.



DONE CHECKS:

\- `npm run db:migrate` succeeds against a fresh local database

\- RLS is enabled on all workload tables

\- TECH role cannot SELECT from pii\_vault

\- Queries fail closed if app.tenant\_id is not set



==================================================

MIGRATION FILE CONTENTS (COPY EXACTLY)

==================================================



--- workloads/ro-assistant/db/migrations/0001\_init.sql ---

BEGIN;



CREATE SCHEMA IF NOT EXISTS app;




CREATE EXTENSION IF NOT EXISTS vector;




DO $$ BEGIN

&nbsp; CREATE TYPE app.user\_role AS ENUM ('TECH', 'ADMIN', 'PII\_APPROVED');

EXCEPTION WHEN duplicate\_object THEN NULL;

END $$;



CREATE OR REPLACE FUNCTION app.current\_tenant\_id()

RETURNS uuid

LANGUAGE sql STABLE AS $$

&nbsp; SELECT nullif(current\_setting('app.tenant\_id', true), '')::uuid;

$$;



CREATE OR REPLACE FUNCTION app.current\_user\_id()

RETURNS uuid

LANGUAGE sql STABLE AS $$

&nbsp; SELECT nullif(current\_setting('app.user\_id', true), '')::uuid;

$$;



CREATE OR REPLACE FUNCTION app.current\_role()

RETURNS text

LANGUAGE sql STABLE AS $$

&nbsp; SELECT nullif(current\_setting('app.role', true), '');

$$;



-- Minimal base tables needed for workload + audit

CREATE TABLE IF NOT EXISTS app.tenants (

&nbsp; tenant\_id   uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

&nbsp; name        text NOT NULL,

&nbsp; is\_active   boolean NOT NULL DEFAULT true,

&nbsp; created\_at  timestamptz NOT NULL DEFAULT now()

);



CREATE TABLE IF NOT EXISTS app.users (

&nbsp; user\_id     uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

&nbsp; tenant\_id   uuid NOT NULL REFERENCES app.tenants(tenant\_id) ON DELETE CASCADE,

&nbsp; email       text NOT NULL,

&nbsp; pass\_hash   text NOT NULL,

&nbsp; role        app.user\_role NOT NULL DEFAULT 'TECH',

&nbsp; is\_active   boolean NOT NULL DEFAULT true,

&nbsp; created\_at  timestamptz NOT NULL DEFAULT now(),

&nbsp; UNIQUE (tenant\_id, email)

);



ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users\_tenant\_isolation

ON app.users

USING (tenant\_id = app.current\_tenant\_id())

WITH CHECK (tenant\_id = app.current\_tenant\_id());



COMMIT;



--- workloads/ro-assistant/db/migrations/0002\_ro\_core.sql ---

BEGIN;



-- Documents (source file records)

CREATE TABLE IF NOT EXISTS app.documents (

&nbsp; doc\_id        uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

&nbsp; tenant\_id     uuid NOT NULL REFERENCES app.tenants(tenant\_id) ON DELETE CASCADE,

&nbsp; filename      text NOT NULL,

&nbsp; mime\_type     text NOT NULL,

&nbsp; sha256        bytea NOT NULL,

&nbsp; storage\_path  text NOT NULL,

&nbsp; status        text NOT NULL DEFAULT 'stored',

&nbsp; created\_by    uuid NOT NULL REFERENCES app.users(user\_id),

&nbsp; created\_at    timestamptz NOT NULL DEFAULT now(),

&nbsp; UNIQUE (tenant\_id, sha256)

);



ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents\_tenant\_isolation

ON app.documents

USING (tenant\_id = app.current\_tenant\_id())

WITH CHECK (tenant\_id = app.current\_tenant\_id());



-- Repair Orders (derived from attached RO template o.pdf)

CREATE TABLE IF NOT EXISTS app.repair\_orders (

&nbsp; ro\_id              uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

&nbsp; tenant\_id          uuid NOT NULL REFERENCES app.tenants(tenant\_id) ON DELETE CASCADE,

&nbsp; doc\_id             uuid NOT NULL REFERENCES app.documents(doc\_id) ON DELETE CASCADE,



&nbsp; ro\_number          text NOT NULL,

&nbsp; ro\_open\_date       date,

&nbsp; ro\_close\_date      date,

&nbsp; ro\_status          text,



&nbsp; advisor\_name       text,

&nbsp; advisor\_tag        text,



&nbsp; technician\_name    text,

&nbsp; technician\_code    text,



&nbsp; vehicle\_year       int,

&nbsp; vehicle\_make       text,

&nbsp; vehicle\_model      text,

&nbsp; vehicle\_color      text,



&nbsp; mileage\_in         int,

&nbsp; mileage\_out        int,

&nbsp; in\_service\_date    date,

&nbsp; delivery\_date      date,



&nbsp; labor\_total        numeric(10,2),

&nbsp; parts\_total        numeric(10,2),

&nbsp; sublet\_total       numeric(10,2),

&nbsp; shop\_supplies      numeric(10,2),

&nbsp; hazardous\_total    numeric(10,2),

&nbsp; tax\_total          numeric(10,2),

&nbsp; discount\_total     numeric(10,2),

&nbsp; total\_due          numeric(10,2),



&nbsp; created\_at         timestamptz NOT NULL DEFAULT now(),



&nbsp; UNIQUE (tenant\_id, ro\_number)

);



ALTER TABLE app.repair\_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY ro\_tenant\_isolation

ON app.repair\_orders

USING (tenant\_id = app.current\_tenant\_id())

WITH CHECK (tenant\_id = app.current\_tenant\_id());



COMMIT;



--- workloads/ro-assistant/db/migrations/0003\_ro\_line\_items.sql ---

BEGIN;



-- Labor Line Items (template supports oil/filter change line)

CREATE TABLE IF NOT EXISTS app.ro\_labor\_lines (

&nbsp; labor\_id        uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

&nbsp; tenant\_id       uuid NOT NULL REFERENCES app.tenants(tenant\_id) ON DELETE CASCADE,

&nbsp; ro\_id           uuid NOT NULL REFERENCES app.repair\_orders(ro\_id) ON DELETE CASCADE,

&nbsp; operation       text,

&nbsp; description     text,

&nbsp; technician\_name text,

&nbsp; technician\_code text,

&nbsp; amount          numeric(10,2),

&nbsp; created\_at      timestamptz NOT NULL DEFAULT now()

);



ALTER TABLE app.ro\_labor\_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY labor\_tenant\_isolation

ON app.ro\_labor\_lines

USING (tenant\_id = app.current\_tenant\_id())

WITH CHECK (tenant\_id = app.current\_tenant\_id());



-- Parts Line Items (template supports part\_number/qty/unit/line total)

CREATE TABLE IF NOT EXISTS app.ro\_parts\_lines (

&nbsp; part\_line\_id  uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

&nbsp; tenant\_id     uuid NOT NULL REFERENCES app.tenants(tenant\_id) ON DELETE CASCADE,

&nbsp; ro\_id         uuid NOT NULL REFERENCES app.repair\_orders(ro\_id) ON DELETE CASCADE,

&nbsp; part\_number   text,

&nbsp; description   text,

&nbsp; quantity      numeric(10,2),

&nbsp; unit\_price    numeric(10,2),

&nbsp; line\_total    numeric(10,2),

&nbsp; created\_at    timestamptz NOT NULL DEFAULT now()

);



ALTER TABLE app.ro\_parts\_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY parts\_tenant\_isolation

ON app.ro\_parts\_lines

USING (tenant\_id = app.current\_tenant\_id())

WITH CHECK (tenant\_id = app.current\_tenant\_id());



COMMIT;



--- workloads/ro-assistant/db/migrations/0004\_pii\_vault.sql ---

BEGIN;



-- PII Vault: ciphertext only; payload contains:

-- customer\_name, email, phones, address(city/state/zip), vin, license\_plate, payment\_method

CREATE TABLE IF NOT EXISTS app.pii\_vault (

&nbsp; tenant\_id    uuid NOT NULL REFERENCES app.tenants(tenant\_id) ON DELETE CASCADE,

&nbsp; ro\_id        uuid NOT NULL REFERENCES app.repair\_orders(ro\_id) ON DELETE CASCADE,

&nbsp; key\_ref      text NOT NULL,

&nbsp; nonce        bytea NOT NULL,

&nbsp; ciphertext   bytea NOT NULL,

&nbsp; created\_at   timestamptz NOT NULL DEFAULT now(),

&nbsp; updated\_at   timestamptz NOT NULL DEFAULT now(),

&nbsp; PRIMARY KEY (tenant\_id, ro\_id)

);



ALTER TABLE app.pii\_vault ENABLE ROW LEVEL SECURITY;



-- Read: ADMIN or PII\_APPROVED

CREATE POLICY pii\_vault\_read\_policy

ON app.pii\_vault

FOR SELECT

USING (

&nbsp; tenant\_id = app.current\_tenant\_id()

&nbsp; AND app.current\_role() IN ('ADMIN','PII\_APPROVED')

);



-- Write: ADMIN only

CREATE POLICY pii\_vault\_write\_policy

ON app.pii\_vault

FOR INSERT, UPDATE, DELETE

USING (

&nbsp; tenant\_id = app.current\_tenant\_id()

&nbsp; AND app.current\_role() = 'ADMIN'

)

WITH CHECK (

&nbsp; tenant\_id = app.current\_tenant\_id()

&nbsp; AND app.current\_role() = 'ADMIN'

);



COMMIT;



==================================================

MIGRATION RUNNER (Codex must create)

==================================================



Create scripts/migrate.ts that:

\- reads migrations directory in sorted order

\- runs each .sql in a transaction

\- prints filename as it runs

\- stops on error



Add to package.json scripts:

\- "db:migrate": "ts-node scripts/migrate.ts"



==================================================

LOCAL VERIFICATION COMMANDS

==================================================

1\) createdb dealer\_ai

2\) export DATABASE\_URL=postgres://USER:PASS@localhost:5432/dealer\_ai

3\) npm run db:migrate



RLS sanity checks (psql):

\- SET app.tenant\_id = NULL; SELECT count(\*) FROM app.repair\_orders;  -- should be 0 or error (fail closed)

\- SET app.tenant\_id = '<tenant uuid>'; SET app.role='TECH'; SELECT \* FROM app.pii\_vault; -- must be denied



END UPDATE



