-- 190_2026-06-19-pgtrgm-search-and-tasks-milestone-index.sql
-- Page-load perf audit (docs/reviews/2026-06-19-page-load-perf-audit.md) — [G2] + tasks.milestone_id.
--
-- [G2] Every user-facing search box runs `col ILIKE '%term%'` (leading wildcard),
-- which a B-tree cannot serve → each search was a SEQUENTIAL SCAN (measured:
-- /contacts search = 32 ms full scan of 1,390 rows). pg_trgm GIN indexes make the
-- existing search RPCs (search_contacts / search_companies / search_leads_by_query /
-- search_projects_lite) and the price-book / tasks `.or(...ilike)` filters
-- index-backed with NO application-code change. (NEVER-DO #23.)
--
-- Also adds the missing tasks.milestone_id index — the projects #completion tab
-- runs `tasks ... WHERE milestone_id IN (...)` which currently seq-scans (cheap at
-- ~233 rows today; keeps it index-backed as tasks grows).
--
-- Plain (non-CONCURRENT) CREATE INDEX: runs inside the migration transaction and
-- dev tables are small (largest indexed here = contacts ~1.4k rows). For a future
-- prod run, build these CONCURRENTLY out-of-band instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Contacts — search_contacts: name / phone / email ILIKE
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm  ON public.contacts USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm ON public.contacts USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm ON public.contacts USING gin (email gin_trgm_ops);

-- Companies — search_companies: name / city / gstin ILIKE
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm  ON public.companies USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_city_trgm  ON public.companies USING gin (city  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_gstin_trgm ON public.companies USING gin (gstin gin_trgm_ops);

-- Leads — search_leads_by_query: customer_name / phone ILIKE
CREATE INDEX IF NOT EXISTS idx_leads_customer_name_trgm ON public.leads USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm         ON public.leads USING gin (phone gin_trgm_ops);

-- Price book — item picker search: item_description / brand / vendor_name ILIKE
CREATE INDEX IF NOT EXISTS idx_price_book_desc_trgm   ON public.price_book USING gin (item_description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_price_book_brand_trgm  ON public.price_book USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_price_book_vendor_trgm ON public.price_book USING gin (vendor_name gin_trgm_ops);

-- Projects — search_projects_lite: project_number / customer_name ILIKE
CREATE INDEX IF NOT EXISTS idx_projects_project_number_trgm ON public.projects USING gin (project_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_customer_name_trgm  ON public.projects USING gin (customer_name gin_trgm_ops);

-- Tasks — all-tasks / sales-team search: title ILIKE  +  #completion milestone filter
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm   ON public.tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON public.tasks (milestone_id);
