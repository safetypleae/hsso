# Risk survey extension setup (manual only)

No resource was created and no local/production D1 migration was applied by this change.

Back up the existing D1 database, review, and manually apply
`migrations/0009_risk_survey_extensions.sql` before enabling new survey creation
or editing. The migration is additive: it leaves existing survey and response
columns, IDs, public tokens, and response JSON unchanged. The two historical
photo tables remain in the migration for compatibility with databases where it
was already applied, but the application no longer reads or writes them and no
R2 binding is required.

New responses store the schema version, revision, answers, and question snapshot
in the existing `response_data` JSON. Legacy response columns remain populated
for CSV, list, and detail consumers. The first edit saves revision 0 of a legacy
survey. Removed, renamed, or retyped questions keep their historical statistics
and XLSX columns. Question descriptions are stored with each definition but are
not response values or Excel columns. Changing only a description keeps existing
answers attached to the same question.

Without the migration, old surveys still load and accept responses. New schema-2
creation and editing returns `MIGRATION_REQUIRED` instead of saving partial data.
