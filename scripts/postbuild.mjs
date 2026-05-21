import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const file = "dist/bin/contrakt.js";
let content = readFileSync(file, "utf8");

// Replace any existing shebang (tsx, ts-node, etc.) with plain node
content = content.replace(/^#!.*\n/, "");
writeFileSync(file, "#!/usr/bin/env node\n" + content);
chmodSync(file, 0o755);

console.log("✓  dist/bin/contrakt.js — shebang set to node");
