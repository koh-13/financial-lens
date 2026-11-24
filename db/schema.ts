import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
export const analyses = sqliteTable('analyses', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  code: text('code').notNull(), name: text('name').notNull(),
  docId: text('doc_id').notNull(), data: text('data').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('analyses_owner').on(t.userId, t.createdAt)]);
export const filings = sqliteTable('filings', {
  docId: text('doc_id').primaryKey(), code: text('code').notNull(), name: text('name').notNull(),
  periodEnd: text('period_end'), submitted: text('submitted').notNull(),
  csvFlag: text('csv_flag').notNull(), pdfFlag: text('pdf_flag').notNull(), docType: text('doc_type').notNull(),
}, t => [index('filings_code').on(t.code, t.periodEnd, t.submitted)]);
export const indexedDates = sqliteTable('indexed_dates', { date: text('date').primaryKey() });
