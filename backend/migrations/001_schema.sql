-- Plumb: field inspections that can be edited offline and synced later.

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(80)  NOT NULL,
    email         VARCHAR(160) NOT NULL,
    password_hash TEXT         NOT NULL,
    role          VARCHAR(12)  NOT NULL DEFAULT 'inspector' CHECK (role IN ('inspector', 'supervisor')),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));

CREATE TABLE sites (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(120) NOT NULL UNIQUE,
    area    VARCHAR(80)  NOT NULL,
    address VARCHAR(200) NOT NULL DEFAULT ''
);

-- One counter for every change. Clients remember the last number they saw and ask
-- only for inspections that changed after it.
CREATE SEQUENCE change_seq;

CREATE TABLE inspections (
    id           UUID PRIMARY KEY,                      -- made on the device, so it works offline
    site_id      INTEGER      NOT NULL REFERENCES sites (id),
    inspector_id INTEGER      NOT NULL REFERENCES users (id),
    title        VARCHAR(120) NOT NULL,
    kind         VARCHAR(20)  NOT NULL CHECK (kind IN ('fire_safety', 'electrical', 'scaffolding', 'housekeeping')),
    status       VARCHAR(10)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
    notes        VARCHAR(1000) NOT NULL DEFAULT '',
    version      INTEGER      NOT NULL DEFAULT 1,
    field_versions JSONB      NOT NULL DEFAULT '{}',    -- which version and device last changed each field
    updated_by   INTEGER      REFERENCES users (id),
    seq          BIGINT       NOT NULL DEFAULT nextval('change_seq'),
    created_at   TIMESTAMPTZ  NOT NULL,                 -- when the inspector started it (device clock)
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ
);
CREATE INDEX idx_inspections_seq ON inspections (seq);
CREATE INDEX idx_inspections_inspector ON inspections (inspector_id);

CREATE TABLE inspection_items (
    id            UUID PRIMARY KEY,
    inspection_id UUID         NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    position      INTEGER      NOT NULL,
    label         VARCHAR(160) NOT NULL,
    result        VARCHAR(8)   NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'pass', 'fail', 'na')),
    severity      VARCHAR(8)   CHECK (severity IN ('low', 'medium', 'high')),
    note          VARCHAR(500) NOT NULL DEFAULT '',
    version       INTEGER      NOT NULL DEFAULT 1,
    field_versions JSONB       NOT NULL DEFAULT '{}',
    updated_by    INTEGER      REFERENCES users (id),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- A failed item always has a severity, and only failed items have one.
    CONSTRAINT items_severity_rule CHECK ((result = 'fail') = (severity IS NOT NULL))
);
CREATE INDEX idx_items_inspection ON inspection_items (inspection_id, position);

-- Every change a device sends has an id (op_id). We keep the answer, so a retry of the
-- same change after a dropped connection gets the same answer and is never applied twice.
CREATE TABLE sync_ops (
    op_id      UUID PRIMARY KEY,
    user_id    INTEGER     NOT NULL REFERENCES users (id),
    result     JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
