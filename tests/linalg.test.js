// Linear algebra against R: qr.coef, chol2inv(qr.R()), chol and the
// eigenvalues of the symmetric matrix similar to row-standardized queen
// weights (counties and tracts), on Mississippi data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cholesky,
  choleskyInverse,
  crossprodInverse,
  inverse,
  leastSquares,
  qr,
  solve,
  symmetricEigenvalues,
} from "../src/stats/linalg.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./models-reference.json").linalg;
const columns = (file) => {
  const t = read("../public/data/ms/tables/" + file);
  return { at: new Map(t.ids.map((id, i) => [id, i])), columns: t.columns };
};
const acs = columns("tracts-acs.json"),
  places = columns("tracts-places.json");
const X = ref.ids.map((id) => [1, ...ref.covariates.map((c) => acs.columns[c][acs.at.get(id)])]);
const y = ref.ids.map((id) => places.columns[ref.outcome][places.at.get(id)]);
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

test("least squares by Householder QR matches qr.coef, and (X'X)⁻¹ matches chol2inv", () => {
  const fit = leastSquares(X, y);
  fit.coef.forEach((b, j) => close(b, ref.coef[j], 1e-10, "coef " + j));
  crossprodInverse(fit.qr.R).forEach((row, i) => row.forEach((v, j) => close(v, ref.xtxInverse[i][j], 1e-10, `inv ${i},${j}`)));
  const XtX = X[0].map((_, i) => X[0].map((_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  cholesky(XtX).forEach((row, i) => row.forEach((v, j) => close(v, ref.cholesky[i][j], 1e-10, `chol ${i},${j}`)));
  choleskyInverse(XtX).forEach((row, i) => row.forEach((v, j) => close(v, ref.xtxInverse[i][j], 1e-8, `cholinv ${i},${j}`)));
  // Residuals are orthogonal to every column.
  X[0].forEach((_, j) => assert.ok(Math.abs(X.reduce((s, r, i) => s + r[j] * fit.residuals[i], 0)) < 1e-8));
});

test("collinear predictors are named, and small systems solve", () => {
  assert.throws(() => qr([[1, 2, 4], [1, 3, 6], [1, 5, 10], [1, 7, 14]]), /collinear: column 3/);
  assert.deepEqual(solve([[2, 1], [1, 3]], [3, 5]).map((v) => +v.toFixed(12)), [0.8, 1.4]);
  const inv = inverse([[4, 7], [2, 6]]);
  close(inv[0][0], 0.6, 1e-12, "inverse");
  close(inv[1][0], -0.2, 1e-12, "inverse");
});

function similarMatrix(ids, graph) {
  const at = new Map(ids.map((id, i) => [id, i]));
  const rows = ids.map((id) => (graph[id] || []).filter((j) => at.has(j)).map((j) => at.get(j)));
  const dh = rows.map((r) => 1 / Math.sqrt(r.length));
  return rows.map((r, i) => {
    const row = new Float64Array(ids.length);
    for (const j of r) row[j] = dh[i] * dh[j];
    return row;
  });
}

test("symmetric eigenvalues match R's eigen for counties and tracts", () => {
  const chr = read("../public/data/ms/layers/chr_counties_2025.neighbors.json").queen;
  const counties = symmetricEigenvalues(similarMatrix(Object.keys(chr).sort(), chr));
  counties.forEach((v, i) => close(v, ref.eigenCounties[i], 1e-11, "county " + i));
  const queen = read("../public/data/ms/neighbors.json").queen;
  const tracts = symmetricEigenvalues(similarMatrix(ref.eigenTractIds, queen));
  assert.equal(tracts.length, ref.eigenTracts.length);
  tracts.forEach((v, i) => close(v, ref.eigenTracts[i], 1e-10, "tract " + i));
  close(tracts.at(-1), 1, 1e-12, "the largest eigenvalue of row-standardized weights");
});
