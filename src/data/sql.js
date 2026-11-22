// Quoting for SQL text that rumb writes for DuckDB.

/** A string literal: O'Brien → 'O''Brien'. */
export const sqlString = (value) => "'" + String(value).replaceAll("'", "''") + "'";

/** An identifier: my "col" → "my ""col""". */
export const ident = (value) => '"' + String(value).replaceAll('"', '""') + '"';
