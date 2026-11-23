// Dense linear algebra for the models: least squares by Householder QR, the
// inverse of X'X from R, Cholesky factors, and the eigenvalues of a
// symmetric matrix (Householder tridiagonalization, then implicit QR steps
// with Wilkinson shifts). Written from Golub & Van Loan, *Matrix
// Computations* (4th ed.), Algorithms 5.1.1, 5.2.1, 4.2.1, 8.3.1–8.3.3.
// Matrices are arrays of rows; vectors are arrays. Pure.

const EPS = 2.220446049250313e-16;

/** The Householder QR of an n × p matrix X (n ≥ p), as R and the reflectors. */
export function qr(X) {
  const n = X.length,
    p = X[0]?.length ?? 0;
  if (n < p) throw new Error("A model needs at least as many areas as coefficients.");
  // Column-major working copy.
  const A = Array.from({ length: p }, (_, j) => Float64Array.from(X, (row) => row[j]));
  const vs = [],
    betas = new Float64Array(p),
    R = Array.from({ length: p }, () => new Float64Array(p));
  let largest = 0;
  for (let k = 0; k < p; k++) {
    const col = A[k];
    let norm = 0;
    for (let i = k; i < n; i++) norm += col[i] * col[i];
    norm = Math.sqrt(norm);
    largest = Math.max(largest, norm);
    if (!(norm > 1e-10 * Math.max(1, largest))) {
      const error = new Error("The predictors are collinear: column " + (k + 1) + " adds nothing to the ones before it.");
      error.column = k;
      throw error;
    }
    const alpha = col[k] > 0 ? -norm : norm;
    const v = col.slice(k);
    v[0] -= alpha;
    let vv = 0;
    for (const x of v) vv += x * x;
    const beta = 2 / vv;
    vs.push(v);
    betas[k] = beta;
    // Apply the reflector to the remaining columns.
    for (let j = k; j < p; j++) {
      const c = A[j];
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * c[k + i];
      s *= beta;
      for (let i = 0; i < v.length; i++) c[k + i] -= s * v[i];
    }
    for (let j = k; j < p; j++) R[k][j] = A[j][k];
  }
  return { n, p, R, vs, betas };
}

/** Qᵀy for a QR from qr(). */
export function qrQty(f, y) {
  const out = Float64Array.from(y);
  f.vs.forEach((v, k) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * out[k + i];
    s *= f.betas[k];
    for (let i = 0; i < v.length; i++) out[k + i] -= s * v[i];
  });
  return out;
}

/** Solves the upper-triangular system R b = c. */
export function backSolve(R, c) {
  const p = R.length,
    b = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = c[i];
    for (let j = i + 1; j < p; j++) s -= R[i][j] * b[j];
    b[i] = s / R[i][i];
  }
  return b;
}

/** Least-squares coefficients of y on X: { coef, fitted, residuals, qr }. */
export function leastSquares(X, y, f = qr(X)) {
  const coef = backSolve(f.R, qrQty(f, y));
  const fitted = X.map((row) => row.reduce((s, x, j) => s + x * coef[j], 0));
  return { coef: Array.from(coef), fitted, residuals: y.map((v, i) => v - fitted[i]), qr: f };
}

/** The inverse of an upper-triangular matrix. */
export function upperInverse(R) {
  const p = R.length,
    inv = Array.from({ length: p }, () => new Float64Array(p));
  for (let j = 0; j < p; j++) {
    inv[j][j] = 1 / R[j][j];
    for (let i = j - 1; i >= 0; i--) {
      let s = 0;
      for (let k = i + 1; k <= j; k++) s += R[i][k] * inv[k][j];
      inv[i][j] = -s / R[i][i];
    }
  }
  return inv;
}

/** (XᵀX)⁻¹ from the R of a QR: R⁻¹ R⁻ᵀ (R's chol2inv on the R factor). */
export function crossprodInverse(R) {
  const inv = upperInverse(R),
    p = R.length;
  return Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0;
      for (let k = Math.max(i, j); k < p; k++) s += inv[i][k] * inv[j][k];
      return s;
    }),
  );
}

/** The lower Cholesky factor L of a symmetric positive-definite matrix, A = LLᵀ. */
export function cholesky(A) {
  const n = A.length,
    L = Array.from({ length: n }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
    if (!(d > 0)) throw new Error("The matrix is not positive definite.");
    L[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/** The inverse of a symmetric positive-definite matrix through its Cholesky factor. */
export function choleskyInverse(A) {
  const L = cholesky(A),
    n = A.length;
  // R = Lᵀ is upper triangular, and A⁻¹ = R⁻¹ R⁻ᵀ.
  const R = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (j >= i ? L[j][i] : 0)));
  return crossprodInverse(R);
}

/** Solves A x = b for a square A by Gaussian elimination with partial pivoting. */
export function solve(A, b) {
  const n = A.length,
    M = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[pivot][k])) pivot = i;
    if (!(Math.abs(M[pivot][k]) > 0)) throw new Error("The system is singular.");
    [M[k], M[pivot]] = [M[pivot], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** The inverse of a small square matrix. */
export const inverse = (A) => {
  const n = A.length,
    cols = Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))));
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
};

/**
 * Reduces a symmetric matrix to tridiagonal form by Householder similarity
 * transforms: { d, e } with d the diagonal and e the subdiagonal.
 */
export function tridiagonalize(S) {
  const n = S.length,
    A = S.map((row) => Float64Array.from(row));
  const v = new Float64Array(n),
    p = new Float64Array(n),
    w = new Float64Array(n);
  for (let k = 0; k < n - 2; k++) {
    let norm = 0;
    for (let i = k + 1; i < n; i++) norm += A[i][k] * A[i][k];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = A[k + 1][k] > 0 ? -norm : norm;
    let vv = 0;
    for (let i = k + 1; i < n; i++) {
      v[i] = A[i][k];
      if (i === k + 1) v[i] -= alpha;
      vv += v[i] * v[i];
    }
    if (vv === 0) continue;
    const beta = 2 / vv;
    // p = β A v over the trailing block; w = p − (β pᵀv / 2) v.
    let pv = 0;
    for (let i = k + 1; i < n; i++) {
      let s = 0;
      const row = A[i];
      for (let j = k + 1; j < n; j++) s += row[j] * v[j];
      p[i] = beta * s;
      pv += p[i] * v[i];
    }
    const half = (beta * pv) / 2;
    for (let i = k + 1; i < n; i++) w[i] = p[i] - half * v[i];
    for (let i = k + 1; i < n; i++) {
      const row = A[i],
        vi = v[i],
        wi = w[i];
      for (let j = k + 1; j < n; j++) row[j] -= vi * w[j] + wi * v[j];
    }
    A[k + 1][k] = A[k][k + 1] = alpha;
    for (let i = k + 2; i < n; i++) A[i][k] = A[k][i] = 0;
  }
  return {
    d: Float64Array.from({ length: n }, (_, i) => A[i][i]),
    e: Float64Array.from({ length: Math.max(0, n - 1) }, (_, i) => A[i + 1][i]),
  };
}

/** The eigenvalues of a symmetric tridiagonal matrix (diagonal d, subdiagonal e), ascending. */
export function tridiagonalEigenvalues(diag, sub) {
  const d = Float64Array.from(diag),
    e = Float64Array.from(sub),
    n = d.length;
  let high = n - 1,
    iterations = 0;
  while (high > 0) {
    // Deflate: drop negligible off-diagonals, then find the unreduced block [low, high].
    for (let i = 0; i < high; i++) if (Math.abs(e[i]) <= EPS * (Math.abs(d[i]) + Math.abs(d[i + 1]))) e[i] = 0;
    while (high > 0 && e[high - 1] === 0) high--;
    if (high === 0) break;
    let low = high - 1;
    while (low > 0 && e[low - 1] !== 0) low--;
    if (++iterations > 60 * n) throw new Error("The eigenvalues did not converge.");
    // Wilkinson shift from the trailing 2 × 2 block.
    const t = (d[high - 1] - d[high]) / 2,
      b = e[high - 1];
    const mu = d[high] - (b * b) / (t + (t >= 0 ? 1 : -1) * Math.hypot(t, b));
    let x = d[low] - mu,
      z = e[low],
      bulge = 0;
    for (let k = low; k < high; k++) {
      // A rotation in the (k, k+1) plane that zeroes z against x.
      const r = Math.hypot(x, z),
        c = r === 0 ? 1 : x / r,
        s = r === 0 ? 0 : z / r;
      if (k > low) e[k - 1] = r;
      const a = d[k],
        bk = e[k],
        f = d[k + 1];
      d[k] = c * c * a + 2 * c * s * bk + s * s * f;
      d[k + 1] = s * s * a - 2 * c * s * bk + c * c * f;
      e[k] = c * s * (f - a) + (c * c - s * s) * bk;
      if (k + 1 < high) {
        bulge = s * e[k + 1];
        e[k + 1] *= c;
        x = e[k];
        z = bulge;
      }
    }
  }
  return Array.from(d).sort((a, b) => a - b);
}

/** The eigenvalues of a symmetric matrix, ascending. */
export function symmetricEigenvalues(S) {
  const { d, e } = tridiagonalize(S);
  return tridiagonalEigenvalues(d, e);
}
