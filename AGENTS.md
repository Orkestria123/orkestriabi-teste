# Architecture rules

- Statement exports receive a snapshot from StatementTable so visible columns, analysis, grouping and hierarchy match the consulted view; PDFs navigate between fixed detail views with internal links rather than viewer-dependent JavaScript.

- Executive reports reuse the BI statement and indicator engines, with calendar-based coverage and explicit missing periods, so PDFs never invent data or diverge from the company ledger.
- The executive PDF renderer uses locally bundled approved-reference fonts and client-side generation, preserving editable drafts and avoiding native server PDF dependencies.- Users may belong to several tenants via tenant_usuarios; profiles.tenant_id is the active tenant switched by alternar_tenant_ativo, so existing RLS (get_my_tenant_id) keeps isolating data unchanged.
