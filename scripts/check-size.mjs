// Fails the deploy when dist/ would not fit GitHub Pages: a site over the
// budget (default 900 MB, under Pages' 1 GB limit) or any file over 100 MB.
//   node scripts/check-size.mjs [dir] [budget MB]
import fs from "node:fs";
import path from "node:path";

const [dir = "dist", budget = 900] = process.argv.slice(2);
let total = 0;
const big = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const size = fs.statSync(p).size;
      total += size;
      if (size > 100 * 1024 * 1024) big.push(p);
    }
  }
};
walk(dir);
const mb = total / 1048576;
console.log(`${dir}: ${mb.toFixed(0)} MB (budget ${budget} MB)`);
if (big.length) console.log("Over 100 MB: " + big.join(", "));
if (mb > Number(budget) || big.length) process.exit(1);
