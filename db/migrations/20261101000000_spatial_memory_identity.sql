-- Deploy the matching Web and CLI together while application writers are stopped.
-- Account IDs, credential hashes and sessions remain unchanged. The existing
-- email trigger maintains public.users; a mismatch aborts the entire migration.
LOCK TABLE auth.users, public.users, auth.account, auth.session, auth.verification
  IN SHARE ROW EXCLUSIVE MODE;

DO $identity$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) LIKE '%@phone.sanlinlaojie.local'
      AND lower(email) !~ '^[0-9]{11}@phone[.]sanlinlaojie[.]local$'
  ) THEN
    RAISE EXCEPTION 'Phone identity migration blocked: unexpected legacy account format';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users old_user
    JOIN auth.users other_user ON other_user.id <> old_user.id
      AND lower(other_user.email) IN (
        lower(old_user.email),
        split_part(old_user.email, '@', 1) || '@phone.spatialmemory.local'
      )
    WHERE lower(old_user.email) ~ '^[0-9]{11}@phone[.]sanlinlaojie[.]local$'
  ) THEN
    RAISE EXCEPTION 'Phone identity migration blocked: account destination conflict';
  END IF;

  UPDATE auth.users
  SET email = split_part(email, '@', 1) || '@phone.spatialmemory.local',
      updated_at = now()
  WHERE lower(email) ~ '^[0-9]{11}@phone[.]sanlinlaojie[.]local$';

  IF EXISTS (
    SELECT 1 FROM auth.users a LEFT JOIN public.users p ON p.user_id = a.id
    WHERE a.email ~ '^[0-9]{11}@phone[.]spatialmemory[.]local$'
      AND p.email IS DISTINCT FROM a.email
  ) THEN
    RAISE EXCEPTION 'Phone identity migration blocked: public account email did not synchronize';
  END IF;
END
$identity$;

-- Verification challenges can embed signed account identifiers: rewriting the
-- payload would invalidate their signatures. Expire only challenges mentioning
-- an old phone identity; unrelated OAuth state and verification values survive.
-- SMS tickets are stateless, expire after ten minutes, and must be re-requested
-- after cutover; no legacy-domain authentication branch is retained.
DELETE FROM auth.verification
WHERE identifier ~* '[0-9]{11}@phone[.]sanlinlaojie[.]local'
   OR value ~* '[0-9]{11}@phone[.]sanlinlaojie[.]local';
