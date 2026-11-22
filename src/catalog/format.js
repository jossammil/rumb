// Number formatting for every label, legend and table in the app.

/** 1234.5 → "1,234.5"; missing or non-finite → "Unavailable". */
export const number = (v, digits = 1) =>
  v == null || !Number.isFinite(Number(v))
    ? "Unavailable"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });

/** "1 file", "3 files". */
export const plural = (n, word, many = word + "s") =>
  number(n, 0) + " " + (n === 1 ? word : many);
