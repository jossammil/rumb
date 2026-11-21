# Rebuild the independently calculated statewide score fixture from published inputs.
library(jsonlite)
tracts <- fromJSON("public/data/tracts.geojson", simplifyVector=FALSE)$features
cdc <- fromJSON("public/data/places-2025.json", simplifyVector=FALSE)$byId
get_value <- function(x) if(is.null(x)) NA_real_ else x
ids <- vapply(tracts, function(f) f$id, "")
x <- vapply(tracts, function(f) get_value(f$properties$poverty_pct), 0)
y <- vapply(ids, function(id) get_value(cdc[[id]]$transportation_barrier_pct), 0)
keep <- complete.cases(x,y)
x <- x[keep]
y <- y[keep]
pct <- function(v) (rank(v,ties.method="min")-1)/(length(v)-1)
score <- round(50*pct(x)+50*pct(y),1)
ref <- data.frame(id=ids[keep], score, rank=rank(-score,ties.method="min"),
                  quadrant=paste0(ifelse(x>=median(x),"H","L"),ifelse(y>=median(y),"H","L")))
write_json(ref,"tests/comparison-reference.json",auto_unbox=TRUE,digits=8)
