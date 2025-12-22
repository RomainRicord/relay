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

/*
🔁 Flux réel (création client)
🧑‍💻 Côté navigateur (user A)

Génère DEK_client

Chiffre les données client → encrypted_payload

Pour chaque user autorisé :

récupère sa clé publique

chiffre DEK_client pour lui

Envoie au serveur :

ciphertext

nonce

liste des clés chiffrées

🖥️ Côté serveur Go

Stocke sans comprendre

Applique uniquement les règles d’accès

Peut être compromis sans fuite de données

🔓 Flux lecture client
🧑‍💻 Côté navigateur

Récupère encrypted_payload

Récupère SA encrypted_key

Déchiffre la DEK

Déchiffre les données client

🚫 Ce que ton serveur NE PEUT PAS faire

❌ Lire les données clients
❌ Reconstituer une DEK
❌ Donner accès sans clé privée
❌ Fuir les données même avec dump DB

👉 Zero-knowledge réel
*/