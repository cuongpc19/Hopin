// Set the CSV "l1" column (index 17) for given level numbers. Usage:
//   node scripts/set-l1.mjs 5 126,127 146,147,148,...
// First arg = new l1; rest = comma lists of level numbers.
import fs from "node:fs";
import path from "node:path";
const CSV = path.join(process.cwd(), "Manythings/Design winrate/winratedesign1.csv");
const val = process.argv[2];
const nums = new Set(process.argv.slice(3).flatMap((a) => a.split(",")).map(Number).filter(Boolean));
const lines = fs.readFileSync(CSV, "utf8").split("\n");
let changed = 0;
const out = lines.map((l) => {
  const c = l.split(",");
  const n = parseInt(c[0], 10);
  if (!nums.has(n) || c.length < 18) return l;
  c[17] = val; changed++;
  return c.join(",");
});
fs.writeFileSync(CSV, out.join("\n"));
console.log(`set l1=${val} on ${changed} rows`);
