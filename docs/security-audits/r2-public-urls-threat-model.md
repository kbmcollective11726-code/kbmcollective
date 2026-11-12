# R2 public object URLs — threat model (M1)

**Status:** Accepted with mitigations (re-audit #9 remediation)

## Risk
Feed / avatar / event images are served from a public Cloudflare R2 hostname. Anyone who obtains a full object URL can fetch the bytes without a Supabase session.

## Mitigations in place
1. **Opaque keys** — object keys include event UUID + user UUID + timestamp (not sequential IDs).
2. **No public listing** — bucket listing is not exposed to clients; guessing requires a UUID.
3. **Upload authz** — `get-r2-upload-url` / `upload-image-to-r2` require a signed-in active user and path/role allowlists; `contentLength` + jpeg/png binding on presign.
4. **Sensitive ops stay off public R2** — registration attachments prefer Storage paths under event folders; no intentional PII documents on the public feed host.

## Residual
URL leakage (screenshot, logs, referrer) still reveals the object. Signed GET URLs for all assets remain a future option if product requires it.
