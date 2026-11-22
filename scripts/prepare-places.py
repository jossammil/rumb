"""Extract the public Mississippi PLACES reference from CDC's national 2025 GIS-friendly tract CSV."""

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD = "https://data.cdc.gov/api/views/yjkw-uj5s/rows.csv?accessType=DOWNLOAD"
SOCIAL_DEFINITIONS = "https://www.cdc.gov/places/measure-definitions/health-related-social-needs.html"
MEASURES = {
    "transportation_barrier_pct": (
        "LACKTRPT", "Transportation barriers",
        "Adults whose lack of reliable transportation prevented travel for work, appointments, "
        "meetings or daily needs in the previous 12 months.", SOCIAL_DEFINITIONS,
    ),
    "food_insecurity_pct": (
        "FOODINSECU", "Food insecurity",
        "Adults who sometimes, usually or always ran out of purchased food and lacked money "
        "for more in the previous 12 months.", SOCIAL_DEFINITIONS,
    ),
    "housing_insecurity_pct": (
        "HOUSINSECU", "Housing insecurity",
        "Adults unable to pay their rent, mortgage or a utility bill in the previous 12 months.",
        SOCIAL_DEFINITIONS,
    ),
    "frequent_mental_distress_pct": (
        "MHLTH", "Frequent mental distress",
        "Adults who reported poor mental health on at least 14 of the previous 30 days.",
        "https://www.cdc.gov/places/measure-definitions/health-status.html",
    ),
}


def extract(csv_path, atlas_path):
    atlas = json.loads(atlas_path.read_text(encoding="utf-8"))
    tract_ids = {f["properties"]["GEOID"] for f in atlas["features"]}
    if len(tract_ids) != len(atlas["features"]):
        raise ValueError("Duplicate tract GEOID in the Atlas reference")
    measures = {
        key: {"label": label, "definition": definition, "definitionUrl": url,
              "estimateColumn": prefix + "_CrudePrev", "intervalColumn": prefix + "_Crude95CI"}
        for key, (prefix, label, definition, url) in MEASURES.items()
    }
    required = {"StateAbbr", "CountyFIPS", "TractFIPS", "TotalPop18plus"}
    for field in measures.values():
        required.update((field["estimateColumn"], field["intervalColumn"]))
    by_id = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CDC GIS-friendly tract CSV is missing columns {sorted(missing)}")
        for row in reader:
            if row["StateAbbr"] != "MS":
                continue
            geoid = row["TractFIPS"]
            if (not re.fullmatch(r"28[0-9]{9}", geoid) or geoid[:5] != row["CountyFIPS"]
                    or geoid not in tract_ids or geoid in by_id):
                raise ValueError(f"Unexpected or duplicate Mississippi tract {geoid!r}")
            record = {"adult_population_2020": int(row["TotalPop18plus"].replace(",", ""))}
            for key, field in measures.items():
                estimate = float(row[field["estimateColumn"]])
                interval = re.fullmatch(r"\(\s*([\d.]+),\s*([\d.]+)\s*\)", row[field["intervalColumn"]])
                if interval is None:
                    raise ValueError(f"Missing or invalid 95% CI for {geoid} {key}")
                lower, upper = map(float, interval.groups())
                if not 0 <= lower <= estimate <= upper <= 100:
                    raise ValueError(f"Estimate outside its 95% CI for {geoid} {key}")
                record[key] = estimate
                record[key + "_ci"] = [lower, upper]
            by_id[geoid] = record
    if len(by_id) != 870 or len(tract_ids) != 878:
        raise ValueError(f"Expected 870 CDC tracts joined to 878 Atlas tracts. Found {len(by_id)} and {len(tract_ids)}.")
    checksum = hashlib.sha256()
    with csv_path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return {
        "version": 1,
        "source": {
            "title": "CDC PLACES, 2025 release, census tract estimates",
            "url": "https://data.cdc.gov/500-Cities-Places/PLACES-Census-Tract-Data-GIS-Friendly-Format-2025-/yjkw-uj5s",
            "downloadUrl": DOWNLOAD,
            "sha256": checksum.hexdigest(),
            "methodology": "https://www.cdc.gov/places/methodology/index.html",
            "population": "Mississippi adults aged 18 years and older. Adult population counts come from the 2020 Census.",
            "period": "2023 Behavioral Risk Factor Surveillance System (BRFSS), published in the 2025 PLACES release.",
            "estimateType": "Model-based crude prevalence (%)",
            "uncertainty": "Each interval gives the original CDC model-based 95% confidence limits, in percent.",
            "geography": "2023 Census tract GEOIDs joined to the Atlas 2024 TIGER/Line tract geography.",
            "tractCount": len(by_id),
            "atlasTractCount": len(tract_ids),
        },
        "measures": measures,
        "byId": dict(sorted(by_id.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=f"Public national input: {DOWNLOAD}")
    parser.add_argument("csv", type=Path, help="Downloaded CDC PLACES 2025 GIS-friendly census tract CSV")
    parser.add_argument("--atlas", type=Path, default=ROOT / "public/data/ms/tracts.geojson")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/ms/places-2025.json")
    args = parser.parse_args()
    data = extract(args.csv, args.atlas)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['byId'])} Mississippi tract records to {args.output}")


if __name__ == "__main__":
    main()
