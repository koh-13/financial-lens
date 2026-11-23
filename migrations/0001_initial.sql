CREATE TABLE analyses (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, doc_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX analyses_owner ON analyses(user_id, created_at DESC);
CREATE TABLE filings (doc_id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, period_end TEXT, submitted TEXT NOT NULL, csv_flag TEXT NOT NULL, pdf_flag TEXT NOT NULL, doc_type TEXT NOT NULL);
CREATE INDEX filings_code ON filings(code, period_end DESC, submitted DESC);
CREATE TABLE indexed_dates (date TEXT PRIMARY KEY);
