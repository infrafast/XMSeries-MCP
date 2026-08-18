import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("src/index.ts", "utf8");
const automation = fs.readFileSync("src/automation.ts", "utf8");

assert.match(index, /transport\.onclose[\s\S]*shutdown\(0\)/);
assert.match(index, /transport\.onerror[\s\S]*shutdown\(1\)/);
assert.ok(index.includes('process.once("SIGINT", () => shutdown(0))'));
assert.ok(index.includes('process.once("SIGTERM", () => shutdown(0))'));
assert.ok(index.includes("automation.cancelAll();"));
assert.ok(index.includes("closeOscClient(osc);"));
assert.ok(automation.includes("cancelAll(): void"));
console.log("stdio lifecycle checks passed");
