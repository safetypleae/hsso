# Risk survey extension setup (manual only)

No resource was created and no local/production D1 migration was applied by this change.

## D1

Back up the existing D1 database, review and manually apply
`migrations/0009_risk_survey_extensions.sql` before enabling new creation/editing.
It adds four side tables: metadata (company/departments/revision), historical
definitions, photo metadata, and a durable R2 deletion queue. Existing columns,
survey IDs, public tokens, and responses are unchanged. No legacy data rewrite.
Without this migration, old surveys still load/accept responses; new schema-2
creation/editing returns `MIGRATION_REQUIRED` rather than saving partial data.

Every new response stores `schemaVersion`, revision, answers and the question
snapshot in the existing `response_data` JSON. Legacy response columns remain
populated for the old CSV/list/detail consumers. The first edit saves revision 0
of a legacy survey. Removed/renamed/retyped questions keep their historical
statistics and XLSX columns. An already-open form must reload after an edit (409).
An old survey with no company displays “회사 미등록”. No company is inferred.
Legacy departments remain in old responses/filters. New public UI never offers
free text: unconfigured old surveys show an unavailable department selector.
The owner can register departments by editing. Anonymous responses continue to
discard name, department and employee ID.

## Private R2

Create a private R2 bucket yourself, and add a Pages Functions R2 binding named
`RISK_PHOTOS`. Do not enable r2.dev/public domain access. No public bucket URL or
presigned read URL is used. GET photo endpoints require the survey owner's session.
Use a different bucket/binding for preview. Existing `wrangler.jsonc` is unchanged.
Example fragment (replace names yourself):

```json
{"r2_buckets":[{"binding":"RISK_PHOTOS","bucket_name":"YOUR_PRIVATE_BUCKET","preview_bucket_name":"YOUR_PREVIEW_BUCKET"}]}
```

Sources: [R2 Worker binding/API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
Uploads use the existing anonymous response POST, with multipart `payload` JSON
and up to three `photos` fields. JPEG/PNG only, 5 MiB each, bounded total body,
magic-header/MIME/dimension validation (40M pixels), no SVG or arbitrary files.
The UI disables uploads if binding/migration is absent; API rejects attempted
uploads rather than silently dropping a file. XLSX stores attachment counts only.

## Cleanup worker

Deploy `workers/risk-photo-cleanup.js` as a separate scheduled Worker yourself,
bound to the SAME `DB` and `RISK_PHOTOS`, e.g. hourly. A ready-to-fill configuration
is in `workers/risk-photo-cleanup.example.jsonc` (not the active app configuration).
Successful commits remove upload cleanup jobs. Interrupted uploads are queued
for cleanup after 24 hours. Survey deletion atomically queues all keys and deletes
survey/response/history/photo rows; immediate R2 cleanup is attempted and failures
remain for the scheduled worker. No access survives survey deletion, even while
physical object cleanup is pending. Keep the scheduled worker active and monitor
failures so objects do not remain orphaned. Do not set a bucket-wide expiration
that would remove attachments of active surveys.

All automated tests use disposable in-memory SQLite and a fake R2 binding; actual
R2 bindings, preview deployment and device photo uploads require manual validation.
