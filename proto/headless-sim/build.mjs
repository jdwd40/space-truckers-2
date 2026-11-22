// PROTOTYPE: bundle the simulation for plain Node, with Phaser swapped for a 6-line stub.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const r = await build({
  entryPoints: [here("./main.ts")], outfile: here("./dist/headless-sim.mjs"), bundle: true, platform: "node", format: "esm",
  target: "node22", alias: { phaser: here("./phaser-stub.ts") }, metafile: true, logLevel: "warning",
});
const inputs = Object.keys(r.metafile.inputs).filter((f) => !f.includes("node_modules"));
console.log(`bundled ${inputs.length} modules: ${inputs.join(", ")}`);
console.log(`output ${(Object.values(r.metafile.outputs)[0].bytes / 1024).toFixed(0)} KB`);
