# Architecture rules

- Executive reports reuse the BI statement and indicator engines, with calendar-based coverage and explicit missing periods, so PDFs never invent data or diverge from the company ledger.
- The executive PDF renderer uses locally bundled approved-reference fonts and client-side generation, preserving editable drafts and avoiding native server PDF dependencies.