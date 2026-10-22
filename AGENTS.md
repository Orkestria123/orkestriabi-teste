# Architecture rules

- Calculated DRE cost components reuse indicator expressions with stable semantic keys and company-over-tenant precedence; visibility is presentation-only and never changes ledger totals or formula inputs.

- Public demo routes reuse exported client BI screens and the BI query adapter, which substitutes allowlisted bundled fictional data and isolates query/storage keys; never execute private queries, auth, AI calls or mutations in demo mode, so client visual changes propagate without publishing real ledger data.

- Statement exports receive a snapshot from StatementTable so visible columns, analysis, grouping and hierarchy match the consulted view; PDFs navigate between fixed detail views with internal links rather than viewer-dependent JavaScript.

- Executive reports reuse the BI statement and indicator engines, with calendar-based coverage and explicit missing periods, so PDFs never invent data or diverge from the company ledger.
- Executive report presentation filters and snapshot-derived indicators live in a browser-safe tested adapter, keeping PDF selection independent of ledger calculations and compatible with saved drafts.
- Executive reports persist separate accounting and managerial BI snapshots when effective adjustments exist; the browser-safe comparison adapter joins their rows and computes differences without mutating either ledger view.
- The executive PDF renderer uses locally bundled approved-reference fonts and client-side generation, preserving editable drafts and avoiding native server PDF dependencies.- Users may belong to several tenants via tenant_usuarios; profiles.tenant_id is the active tenant switched by alternar_tenant_ativo, so existing RLS (get_my_tenant_id) keeps isolating data unchanged.
