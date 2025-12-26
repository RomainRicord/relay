-- Supabase schema for shared E2EE documents (groups + devices + wrapped DEKs + Storage policies)
-- Apply in your Supabase DB (self-hosted): put this file in `supabase/docker/volumes/db/init/`
-- (then reset volumes) OR run it once with psql against the Supabase Postgres.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- RLS helper functions to avoid policy self-references (infinite recursion).
-- They run with row_security disabled and only return booleans.
CREATE OR REPLACE FUNCTION public.is_group_member(gid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.group_members
        WHERE group_id = gid
          AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(gid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.group_members
        WHERE group_id = gid
          AND user_id = auth.uid()
          AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_group_creator(gid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.groups
        WHERE id = gid
          AND created_by = auth.uid()
    );
$$;

CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_members (
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON public.group_members(user_id);

CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    ecdh_pubkey BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS devices_user_idx ON public.devices(user_id);

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    storage_bucket TEXT NOT NULL DEFAULT 'docs',
    storage_path TEXT NOT NULL,
    content_nonce BYTEA NOT NULL,
    content_aad BYTEA,
    content_alg TEXT NOT NULL DEFAULT 'xchacha20poly1305',
    created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (storage_bucket, storage_path)
);

-- Ensure defaults are present even if tables already existed.
ALTER TABLE public.groups ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.devices ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.documents ALTER COLUMN created_by SET DEFAULT auth.uid();

-- PostgREST evaluates RLS WITH CHECK on missing columns as NULL, so use triggers to fill auth.uid().
CREATE OR REPLACE FUNCTION public.set_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.created_by := auth.uid();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.user_id := auth.uid();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_groups_set_created_by ON public.groups;
CREATE TRIGGER trg_groups_set_created_by
BEFORE INSERT ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_documents_set_created_by ON public.documents;
CREATE TRIGGER trg_documents_set_created_by
BEFORE INSERT ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_devices_set_user_id ON public.devices;
CREATE TRIGGER trg_devices_set_user_id
BEFORE INSERT ON public.devices
FOR EACH ROW
EXECUTE FUNCTION public.set_user_id();

CREATE INDEX IF NOT EXISTS documents_group_idx ON public.documents(group_id);

CREATE TABLE IF NOT EXISTS public.document_keys (
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    wrapped_dek BYTEA NOT NULL,
    wrapped_nonce BYTEA NOT NULL,
    wrapped_alg TEXT NOT NULL DEFAULT 'xchacha20poly1305',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, device_id)
);

CREATE INDEX IF NOT EXISTS document_keys_device_idx ON public.document_keys(device_id);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_keys ENABLE ROW LEVEL SECURITY;

-- groups: visible to members; creator can manage
DROP POLICY IF EXISTS groups_select_if_member ON public.groups;
CREATE POLICY groups_select_if_member
ON public.groups FOR SELECT
TO authenticated
USING (
    public.is_group_member(groups.id)
);

DROP POLICY IF EXISTS groups_insert_self ON public.groups;
CREATE POLICY groups_insert_self
ON public.groups FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS groups_update_creator ON public.groups;
CREATE POLICY groups_update_creator
ON public.groups FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS groups_delete_creator ON public.groups;
CREATE POLICY groups_delete_creator
ON public.groups FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- group_members: readable by members; writable by group admins/creator; allow creator to bootstrap self as admin
DROP POLICY IF EXISTS group_members_select_if_member ON public.group_members;
CREATE POLICY group_members_select_if_member
ON public.group_members FOR SELECT
TO authenticated
USING (
    public.is_group_member(group_members.group_id)
);

DROP POLICY IF EXISTS group_members_insert_admins ON public.group_members;
CREATE POLICY group_members_insert_admins
ON public.group_members FOR INSERT
TO authenticated
WITH CHECK (
    public.is_group_admin(group_members.group_id)
    OR (
        user_id = auth.uid()
        AND role = 'admin'
        AND public.is_group_creator(group_members.group_id)
    )
);

DROP POLICY IF EXISTS group_members_update_admins ON public.group_members;
CREATE POLICY group_members_update_admins
ON public.group_members FOR UPDATE
TO authenticated
USING (
    public.is_group_admin(group_members.group_id)
)
WITH CHECK (
    public.is_group_admin(group_members.group_id)
);

DROP POLICY IF EXISTS group_members_delete_admins ON public.group_members;
CREATE POLICY group_members_delete_admins
ON public.group_members FOR DELETE
TO authenticated
USING (
    public.is_group_admin(group_members.group_id)
);

-- devices:
-- - manage own devices
-- - allow reading devices (public keys) of users who share at least one group with you
DROP POLICY IF EXISTS devices_select_own ON public.devices;
CREATE POLICY devices_select_own
ON public.devices FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM public.group_members gm_self
        JOIN public.group_members gm_other
          ON gm_other.group_id = gm_self.group_id
        WHERE gm_self.user_id = auth.uid()
          AND gm_other.user_id = devices.user_id
    )
);

DROP POLICY IF EXISTS devices_insert_own ON public.devices;
CREATE POLICY devices_insert_own
ON public.devices FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS devices_update_own ON public.devices;
CREATE POLICY devices_update_own
ON public.devices FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS devices_delete_own ON public.devices;
CREATE POLICY devices_delete_own
ON public.devices FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- documents: readable to group members; writable by creator (must be member) or group admins
DROP POLICY IF EXISTS documents_select_if_member ON public.documents;
CREATE POLICY documents_select_if_member
ON public.documents FOR SELECT
TO authenticated
USING (
    public.is_group_member(documents.group_id)
);

DROP POLICY IF EXISTS documents_insert_if_member ON public.documents;
CREATE POLICY documents_insert_if_member
ON public.documents FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_group_member(documents.group_id)
);

DROP POLICY IF EXISTS documents_update_creator_or_admin ON public.documents;
CREATE POLICY documents_update_creator_or_admin
ON public.documents FOR UPDATE
TO authenticated
USING (
    created_by = auth.uid()
    OR public.is_group_admin(documents.group_id)
)
WITH CHECK (true);

DROP POLICY IF EXISTS documents_delete_creator_or_admin ON public.documents;
CREATE POLICY documents_delete_creator_or_admin
ON public.documents FOR DELETE
TO authenticated
USING (
    created_by = auth.uid()
    OR public.is_group_admin(documents.group_id)
);

-- document_keys:
-- - select: only keys for the caller's devices (and must still be in the group)
-- - write: allowed for document creator or group admins, and only targeting devices that belong to group members
DROP POLICY IF EXISTS document_keys_select_own_devices ON public.document_keys;
CREATE POLICY document_keys_select_own_devices
ON public.document_keys FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.devices d
        JOIN public.documents doc ON doc.id = document_keys.document_id
        WHERE d.id = document_keys.device_id
          AND d.user_id = auth.uid()
          AND public.is_group_member(doc.group_id)
    )
);

DROP POLICY IF EXISTS document_keys_insert_creator_or_admin ON public.document_keys;
CREATE POLICY document_keys_insert_creator_or_admin
ON public.document_keys FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.documents doc
        JOIN public.devices target_device ON target_device.id = document_keys.device_id
        WHERE doc.id = document_keys.document_id
          AND public.is_group_member(doc.group_id)
          AND EXISTS (
              SELECT 1
              FROM public.group_members gm_target
              WHERE gm_target.group_id = doc.group_id
                AND gm_target.user_id = target_device.user_id
          )
          AND (
              doc.created_by = auth.uid()
              OR public.is_group_admin(doc.group_id)
          )
    )
);

DROP POLICY IF EXISTS document_keys_update_creator_or_admin ON public.document_keys;
CREATE POLICY document_keys_update_creator_or_admin
ON public.document_keys FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.documents doc
        WHERE doc.id = document_keys.document_id
          AND public.is_group_member(doc.group_id)
          AND (
              doc.created_by = auth.uid()
              OR public.is_group_admin(doc.group_id)
          )
    )
)
WITH CHECK (true);

DROP POLICY IF EXISTS document_keys_delete_creator_or_admin ON public.document_keys;
CREATE POLICY document_keys_delete_creator_or_admin
ON public.document_keys FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.documents doc
        WHERE doc.id = document_keys.document_id
          AND public.is_group_member(doc.group_id)
          AND (
              doc.created_by = auth.uid()
              OR public.is_group_admin(doc.group_id)
          )
    )
);

-- Storage bucket + policies (encrypted blobs live in bucket 'docs')
INSERT INTO storage.buckets (id, name, public)
VALUES ('docs', 'docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS docs_select_if_member ON storage.objects;
CREATE POLICY docs_select_if_member
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'docs'
    AND EXISTS (
        SELECT 1
        FROM public.documents d
        WHERE d.storage_bucket = storage.objects.bucket_id
          AND d.storage_path = storage.objects.name
          AND public.is_group_member(d.group_id)
    )
);

DROP POLICY IF EXISTS docs_insert_if_member ON storage.objects;
CREATE POLICY docs_insert_if_member
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'docs'
    AND owner = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.documents d
        WHERE d.storage_bucket = storage.objects.bucket_id
          AND d.storage_path = storage.objects.name
          AND public.is_group_member(d.group_id)
    )
);
