CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encrypted_payload BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,

    -- clé publique ECDH
    ecdh_pubkey BYTEA,

    a2f_secret BYTEA,
    a2f_enabled BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_keys (
    client_id UUID REFERENCES clients(id),
    user_id UUID REFERENCES users(id),
    encrypted_key BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    PRIMARY KEY (client_id, user_id)
);

