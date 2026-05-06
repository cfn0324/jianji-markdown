import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "android", "app", "src", "main", "assets", "www");

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "assets",
  "vendor"
];

if (!existsSync(join(root, "vendor", "markdown-it", "markdown-it.min.js"))) {
  throw new Error("Missing vendor assets. Run npm install first.");
}

if (existsSync(target)) {
  const resolved = target.replace(/\\/g, "/");
  const expected = "/android/app/src/main/assets/www";
  if (!resolved.endsWith(expected)) {
    throw new Error(`Refusing to remove unexpected path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

mkdirSync(target, { recursive: true });

for (const file of files) {
  copyRecursive(join(root, file), join(target, file));
}

console.log("Android assets synced.");

function copyRecursive(source, destination) {
  const stats = statSync(source);

  if (stats.isFile()) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    return;
  }

  const entries = readdirSync(source, { withFileTypes: true });

  if (!entries.length) {
    mkdirSync(destination, { recursive: true });
    return;
  }

  mkdirSync(destination, { recursive: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      copyFileSync(sourcePath, destinationPath);
    }
  }
}
