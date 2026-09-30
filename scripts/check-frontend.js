'use strict';

// Static check for frontend import wiring: every relative import must point at
// a file that exists, and every named import must be exported by that file.
//
// Undefined helper references (a view using `input()` without importing it) are
// deliberately NOT checked here - those are caught for real by opening each
// route in a browser, which is the only trustworthy way to see a ReferenceError.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const problems = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.join(__dirname, '..'), file);

  // import targets exist
  const importRe = /from\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src))) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) problems.push(`${rel}: imports missing file ${m[1]}`);
  }

  // named imports exist in the target module
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
  while ((m = namedRe.exec(src))) {
    const target = path.resolve(path.dirname(file), m[2]);
    if (!fs.existsSync(target)) continue;
    const targetSrc = fs.readFileSync(target, 'utf8');
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      const exported = [
        new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`),
        new RegExp(`export\\s+(const|let|var|class)\\s+${name}\\b`),
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
        new RegExp(`export\\s+default\\s+(async\\s+)?function\\s+${name}\\b`),
      ].some((re) => re.test(targetSrc));
      if (!exported) problems.push(`${rel}: '${name}' is not exported by ${m[2]}`);
    }
  }
}

if (problems.length) {
  console.log(`${problems.length} problem(s):\n`);
  problems.forEach((p) => console.log(`  ${p}`));
  process.exit(1);
}

console.log(`All ${files.length} frontend modules have valid imports.`);