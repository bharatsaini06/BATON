// Build: bundles the web app into public/assets and the server into dist/.
// The output is committed, so deploying needs no install or build step.
import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = (...p) => path.join(root, ...p);
const watch = process.argv.includes("--watch");

async function clean(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

await clean(r("public/assets/js"));
await clean(r("dist"));

// 1. web app
await build({
  entryPoints: { app: r("src/client/main.tsx") },
  bundle: true,
  splitting: true,
  format: "esm",
  outdir: r("public/assets/js"),
  chunkNames: "chunks/[name]-[hash]",
  minify: !watch,
  sourcemap: false,
  target: ["es2020", "chrome100", "firefox100", "safari15"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff": "file" },
  legalComments: "none",
  logLevel: "info",
});
await build({
  entryPoints: { app: r("src/client/styles.css") },
  bundle: true,
  minify: !watch,
  outdir: r("public/assets"),
  external: ["/assets/fonts/*"],
  logLevel: "info",
});

// 2. pdf.js worker for in-browser PDF text extraction
const pdfWorker = path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
await fs.copyFile(pdfWorker, r("public/assets/js/pdf.worker.min.mjs"));

// 3. server (standalone) and API handler (Vercel)
const serverOpts = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: false,
  legalComments: "none",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
};
await build({ ...serverOpts, entryPoints: [r("server/index.ts")], outfile: r("dist/server.mjs") });
await build({ ...serverOpts, entryPoints: [r("server/handler.ts")], outfile: r("dist/handler.mjs") });

// 4. downloadable sample files (same synthetic data the sample project uses)
const tmp = r("dist/.sample.mjs");
await build({ ...serverOpts, entryPoints: [r("src/core/sample.ts")], outfile: tmp, banner: {} , logLevel: "warning" });
const { SAMPLE_FILES } = await import(tmp + "?t=" + Date.now());
await clean(r("public/samples"));
for (const [name, f] of Object.entries(SAMPLE_FILES)) await fs.writeFile(r("public/samples", name), f.text);
await fs.writeFile(
  r("public/samples/README.txt"),
  "Synthetic sample files for trying Baton's upload flow. All names, companies and numbers are invented.\n\n" +
    Object.entries(SAMPLE_FILES).map(([n, f]) => `${n} — ${f.note} — suggested access: ${f.access}`).join("\n") + "\n",
);
await fs.rm(tmp);
console.log("Build complete.");
