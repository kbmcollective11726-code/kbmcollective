-- Public bucket object URLs do not require SELECT policies. Removing these
-- broad policies prevents anonymous enumeration through storage.objects.
DROP POLICY IF EXISTS "Avatar images are publicly accessible"
  ON storage.objects;
DROP POLICY IF EXISTS "Event assets are publicly accessible"
  ON storage.objects;
DROP POLICY IF EXISTS "Event photos are publicly accessible"
  ON storage.objects;
