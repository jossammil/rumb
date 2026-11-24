// Map projections in plain JavaScript, so distances and areas work offline
// with no database. Transverse Mercator (EPSG:3814, Mississippi TM, and the
// like) uses Krüger's series to sixth order in n, with Karney's (2011)
// coefficients: accurate to well under a millimetre across a state. Albers
// equal-area conic (EPSG:5070, EPSG:3338, and state-wide custom ones) uses
// Snyder's (1987, §14) ellipsoidal formulas. The region's catalog supplies the
// parameters (catalog.region.projection.tmerc or .aea). Pure.

/** Degrees folded into [−180, 180]; values already inside are returned as they are. */
const wrap = (d) => (d > 180 || d < -180 ? d - 360 * Math.round(d / 360) : d);

/** A projection { forward([lon, lat]) → [x, y] metres, inverse([x, y]) → [lon, lat] }. */
export function transverseMercator({ lat0, lon0, k0, x0, y0, a, rf }) {
  const f = 1 / rf,
    n = f / (2 - f),
    e = Math.sqrt(f * (2 - f));
  const [n2, n3, n4, n5, n6] = [n ** 2, n ** 3, n ** 4, n ** 5, n ** 6];
  const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
    (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
    (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
    (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
    (212378941 * n6) / 319334400,
  ];
  const beta = [
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
    n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
    (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
    (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
    (4583 * n5) / 161280 - (108847 * n6) / 3991680,
    (20648693 * n6) / 638668800,
  ];
  const rad = Math.PI / 180;
  /** The tangent of the conformal latitude. */
  const conformal = (phi) => {
    const s = Math.sin(phi);
    return Math.sinh(Math.atanh(s) - e * Math.atanh(e * s));
  };
  const series = (xi1, eta1, coef, sign) => {
    let xi = xi1,
      eta = eta1;
    coef.forEach((c, j) => {
      const k = 2 * (j + 1);
      xi += sign * c * Math.sin(k * xi1) * Math.cosh(k * eta1);
      eta += sign * c * Math.cos(k * xi1) * Math.sinh(k * eta1);
    });
    return [xi, eta];
  };
  const xiOrigin = series(Math.atan(conformal(lat0 * rad)), 0, alpha, 1)[0];

  function forward([lon, lat]) {
    const lam = wrap(lon - lon0) * rad,
      t = conformal(lat * rad);
    const xi1 = Math.atan2(t, Math.cos(lam)),
      eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    const [xi, eta] = series(xi1, eta1, alpha, 1);
    return [x0 + k0 * A * eta, y0 + k0 * A * (xi - xiOrigin)];
  }

  function inverse([x, y]) {
    const xi = (y - y0) / (k0 * A) + xiOrigin,
      eta = (x - x0) / (k0 * A);
    const [xi1, eta1] = series(xi, eta, beta, -1);
    const tau1 = Math.sin(xi1) / Math.sqrt(Math.sinh(eta1) ** 2 + Math.cos(xi1) ** 2);
    const lam = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
    // Newton's method from the conformal latitude back to the geographic one.
    let tau = tau1;
    for (let i = 0; i < 8; i++) {
      const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
      const t1 = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
      const step =
        ((tau1 - t1) / Math.sqrt(1 + t1 * t1)) *
        ((1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau)));
      tau += step;
      if (Math.abs(step) < 1e-14) break;
    }
    return [wrap(lon0 + lam / rad), Math.atan(tau) / rad];
  }
  return { forward, inverse };
}

/**
 * Albers equal-area conic on the ellipsoid, after Snyder (1987) §14: lat1 and
 * lat2 are the standard parallels, lat0/lon0 the origin. Same interface as
 * transverseMercator.
 */
export function albersEqualArea({ lat0, lon0, lat1, lat2, x0, y0, a, rf }) {
  const f = 1 / rf,
    e2 = f * (2 - f),
    e = Math.sqrt(e2),
    rad = Math.PI / 180;
  // Snyder (14-15): m, and (3-12): q, the authalic function of latitude.
  const m = (phi) => Math.cos(phi) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const q = (phi) => {
    const s = Math.sin(phi);
    return (1 - e2) * (s / (1 - e2 * s * s) + Math.atanh(e * s) / e);
  };
  const [p0, p1, p2] = [lat0, lat1, lat2].map((d) => d * rad);
  const [m1, m2] = [m(p1), m(p2)],
    [q0, q1, q2] = [q(p0), q(p1), q(p2)];
  // (14-14), with a single standard parallel when the two coincide.
  const n = Math.abs(p1 - p2) < 1e-12 ? Math.sin(p1) : (m1 * m1 - m2 * m2) / (q2 - q1);
  const C = m1 * m1 + n * q1; // (14-13)
  const rho = (qq) => (a * Math.sqrt(Math.max(C - n * qq, 0))) / n; // (14-12)
  const rho0 = rho(q0);
  const qPole = q(Math.PI / 2);

  function forward([lon, lat]) {
    const r = rho(q(lat * rad)),
      theta = n * wrap(lon - lon0) * rad; // (14-4)
    return [x0 + r * Math.sin(theta), y0 + rho0 - r * Math.cos(theta)]; // (14-1), (14-2)
  }

  function inverse([x, y]) {
    // (14-10), (14-11): with n < 0 the signs of x, y and ρ all reverse.
    const sx = n < 0 ? -1 : 1;
    const dx = sx * (x - x0),
      dy = sx * (rho0 - (y - y0));
    const r = Math.hypot(dx, dy),
      theta = Math.atan2(dx, dy);
    const qq = (C - (r * r * n * n) / (a * a)) / n; // (14-19)
    let phi;
    if (Math.abs(qq) >= qPole - 1e-15) phi = Math.sign(qq) * (Math.PI / 2);
    else {
      // (3-16): iterate from the authalic sphere's latitude.
      phi = Math.asin(qq / 2);
      for (let i = 0; i < 16; i++) {
        const s = Math.sin(phi),
          w = 1 - e2 * s * s;
        const step = ((w * w) / (2 * Math.cos(phi))) * (qq / (1 - e2) - s / w - Math.atanh(e * s) / e);
        phi += step;
        if (Math.abs(step) < 1e-15) break;
      }
    }
    return [wrap(lon0 + theta / n / rad), phi / rad]; // (14-9)
  }
  return { forward, inverse };
}

/**
 * The region's projection, or a local one centred on its bounds when the
 * catalog names none. region.projection holds tmerc or aea parameters, and
 * optionally epsg or proj (a PROJ string) for DuckDB's ST_Transform.
 */
export function regionProjection(region) {
  const t = region?.projection?.tmerc;
  if (t) return transverseMercator(t);
  const c = region?.projection?.aea;
  if (c) return albersEqualArea(c);
  const [[w, s], [e, n]] = region?.bounds || [[-1, -1], [1, 1]];
  return transverseMercator({
    lat0: (s + n) / 2,
    lon0: (w + e) / 2,
    k0: 1,
    x0: 0,
    y0: 0,
    a: 6378137,
    rf: 298.257222101,
  });
}
