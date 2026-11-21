# Generate deterministic synthetic Mississippi-area point GeoParquet under a temporary
# directory. File sizes are approximate decimal MB, including Parquet framing.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 1)
dir.create(args[1], recursive = TRUE, showWarnings = FALSE)
con <- DBI::dbConnect(duckdb::duckdb())
DBI::dbExecute(con, "LOAD spatial")
make_file <- function(n, name) {
  path <- file.path(args[1], name)
  src <- sprintf("SELECT i::INTEGER AS event_id, md5(i::VARCHAR) AS reference,
    (i %% 19)::INTEGER AS category, (i %% 397)::INTEGER AS value,
    ST_Point(-91.4 + (hash(i) %% 3000000)::DOUBLE / 1e6,
             30.1 + (hash(i + 1081) %% 4800000)::DOUBLE / 1e6) AS geometry
    FROM range(%d) gen(i)", n)
  DBI::dbExecute(con, paste0("COPY (", src, ") TO ", DBI::dbQuoteString(con, path),
                             " (FORMAT parquet, COMPRESSION snappy, ROW_GROUP_SIZE 8192)"))
  file.size(path)
}
pilot <- make_file(100000, "pilot.parquet")
for (size in c(50, 500)) {
  n <- round(size * 1e6 / pilot * 1e5)
  bytes <- make_file(n, paste0("points", size, ".parquet"))
  cat(size, "MB target:", n, "rows,", bytes, "bytes\n")
}
DBI::dbDisconnect(con, shutdown = TRUE)
