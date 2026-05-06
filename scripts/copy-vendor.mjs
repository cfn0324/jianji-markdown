import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  ["node_modules/markdown-it/dist/markdown-it.min.js", "vendor/markdown-it/markdown-it.min.js"],
  ["node_modules/katex/dist/katex.min.js", "vendor/katex/katex.min.js"],
  ["node_modules/katex/dist/katex.min.css", "vendor/katex/katex.min.css"],
  ["node_modules/markdown-it-texmath/texmath.js", "vendor/markdown-it-texmath/texmath.js"],
  ["node_modules/markdown-it-texmath/css/texmath.css", "vendor/markdown-it-texmath/texmath.css"],
  ["node_modules/mermaid/dist/mermaid.min.js", "vendor/mermaid/mermaid.min.js"]
];

const fontSource = "node_modules/katex/dist/fonts";
const fontTarget = "vendor/katex/fonts";

for (const [source] of files) {
  if (!existsSync(join(root, source))) {
    throw new Error(`Missing ${source}. Run npm install first.`);
  }
}

if (!existsSync(join(root, fontSource))) {
  throw new Error(`Missing ${fontSource}. Run npm install first.`);
}

for (const [, target] of files) {
  const targetPath = join(root, target);
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

if (existsSync(join(root, fontTarget))) {
  rmSync(join(root, fontTarget), { recursive: true, force: true });
}

for (const [source, target] of files) {
  const targetPath = join(root, target);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(join(root, source), targetPath);
}

mkdirSync(join(root, fontTarget), { recursive: true });
for (const entry of readdirSync(join(root, fontSource), { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  copyFileSync(join(root, fontSource, entry.name), join(root, fontTarget, entry.name));
}

console.log("Vendor assets copied.");
