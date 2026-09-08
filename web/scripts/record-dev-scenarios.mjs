import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve("demo-scenarios");
const output = resolve("public/demo-recordings");
mkdirSync(output, { recursive: true });

const run = (file, args, cwd) => {
  try { return execFileSync(file, args, { cwd, encoding: "utf8", stdio: "pipe" }); }
  catch (error) { return `${error.stdout ?? ""}${error.stderr ?? ""}`; }
};

const migrationRoot = join(root, "missing-migration");
rmSync(join(migrationRoot, "demo.db"), { force: true });
const migrationOutput = run("python", ["app.py"], migrationRoot).replaceAll(migrationRoot, "C:\\worktrees\\migration-demo");
const testRoot = join(root, "test-regression");
const testOutput = run("node", ["--test", "price.test.mjs"], testRoot).replaceAll(testRoot.replaceAll("\\", "/"), "C:/worktrees/checkout-tests");
const serverRoot = join(root, "worktree-mismatch", "server-worktree");
const previewServer = spawn(process.execPath, ["server.mjs"], { cwd: serverRoot, stdio: ["ignore", "pipe", "pipe"] });
let previewOutput = "";
await new Promise((resolveReady, reject) => {
  const timeout = setTimeout(() => reject(new Error("preview server did not start")), 5_000);
  previewServer.stdout.on("data", chunk => {
    previewOutput += chunk;
    if (previewOutput.includes("preview http://localhost:4317")) { clearTimeout(timeout); resolveReady(); }
  });
  previewServer.once("error", reject);
});
const previewHtml = await fetch("http://localhost:4317").then(response => response.text());
previewServer.kill();
previewOutput = `${previewOutput.replaceAll(serverRoot, "C:\\worktrees\\checkout-main")}GET / 200`;
const previewText = previewHtml.replace(/<[^>]+>/g, "\n").split("\n").map(value => value.trim()).filter(Boolean).join("\n\n").replaceAll(serverRoot, "C:\\worktrees\\checkout-main");

const scenarios = [
  {
    id: "missing-migration", folder: "missing-migration", active: "app.py", next: "002_add_avatar.sql",
    files: ["app.py", "002_add_avatar.sql"],
    code: `import sqlite3\n\nconnection = sqlite3.connect("demo.db")\nconnection.execute("create table if not exists users (id integer primary key, name text not null)")\nconnection.execute("insert or ignore into users values (1, 'Mina')")\n\nfor row in connection.execute("select id, name, avatar_url from users"):\n    print(row)`,
    nextCode: `-- migration exists, but was never applied\nalter table users add column avatar_url text;`,
    command: "python app.py", output: migrationOutput, marker: "avatar_url", markerLine: 7,
  },
  {
    id: "test-regression", folder: "test-regression", active: "price.test.mjs", next: "price.mjs",
    files: ["price.test.mjs", "price.mjs"],
    code: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { normalizePrice } from "./price.mjs";\n\ntest("keeps cents from the checkout API", () => {\n  assert.equal(normalizePrice("12.99"), 12.99);\n});`,
    nextCode: `export function normalizePrice(value) {\n  return Number.parseInt(value, 10);\n}`,
    command: "node --test price.test.mjs", output: testOutput, marker: "12 !== 12.99", markerLine: 2,
  },
  {
    id: "worktree-mismatch", folder: "edited-worktree", active: "app.mjs", next: "preview",
    files: ["edited-worktree/app.mjs", "server-worktree/app.mjs"],
    code: `// C:\\worktrees\\checkout-redesign\\app.mjs\nexport const banner = "Checkout v2 — free shipping";`,
    nextCode: previewText,
    command: "node server.mjs  # cwd: server-worktree", output: previewOutput, marker: "edited-worktree ≠ server-worktree", markerLine: 2, running: true,
  },
];

const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const lines = (value) => escapeHtml(value).split("\n").map((line, index) => `<div><i>${index + 1}</i><span>${line || " "}</span></div>`).join("");

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const scenario of scenarios) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><style>
    *{box-sizing:border-box}body{margin:0;background:#181818;color:#d4d4d4;font:14px Consolas,'Cascadia Code',monospace;overflow:hidden}
    header{height:35px;background:#181818;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid #2b2b2b;color:#aaa;font:12px Segoe UI,sans-serif}.traffic{display:flex;gap:7px;margin-right:18px}.traffic b{width:10px;height:10px;border-radius:50%;background:#555}.title{margin:auto}.badge{color:#9cdcfe}
    main{height:685px;display:grid;grid-template-columns:48px 230px 1fr}.rail{background:#181818;border-right:1px solid #2b2b2b;display:grid;align-content:start;gap:22px;padding:16px 13px;color:#858585;font-size:20px}.rail b:first-child{color:#eee;border-left:2px solid #ff6a2b;padding-left:10px;margin-left:-13px}.side{background:#181818;border-right:1px solid #2b2b2b}.side h2{font:11px Segoe UI,sans-serif;letter-spacing:.08em;margin:14px 18px}.tree{font:13px Segoe UI,sans-serif;line-height:2;padding:0 10px}.tree strong{color:#fff}.tree span{display:block;padding-left:18px}.work{display:grid;grid-template-rows:38px 1fr 0;transition:grid-template-rows .35s ease;background:#1e1e1e}.work.terminal-open{grid-template-rows:38px 1fr 230px}.tabs{display:flex;background:#181818}.tab{min-width:190px;padding:11px 16px;border-right:1px solid #2b2b2b;color:#aaa}.tab.active{background:#1e1e1e;color:#fff;border-top:1px solid #ff6a2b}.editor{overflow:hidden;padding:14px 0}.editor>div{display:grid;grid-template-columns:54px 1fr;min-height:23px;line-height:23px;white-space:pre}.editor i{font-style:normal;text-align:right;padding-right:18px;color:#6e7681;user-select:none}.editor span{color:#d4d4d4}.editor .focus{background:#3a2520}.terminal{border-top:1px solid #363636;background:#181818;padding:10px 18px;overflow:hidden;opacity:0;transition:opacity .25s}.terminal.show{opacity:1}.terminal nav{font:11px Segoe UI,sans-serif;color:#aaa;margin-bottom:12px}.terminal nav b{color:#fff;border-bottom:1px solid #ff6a2b;padding-bottom:7px;margin-right:20px}.terminal pre{margin:0;white-space:pre-wrap;font:12px/1.45 Consolas,monospace;color:#ddd}.terminal .error{color:#f48771}.cursor{display:inline-block;width:7px;height:16px;background:#ddd;vertical-align:-3px;animation:blink .8s steps(1) infinite}@keyframes blink{50%{opacity:0}}
    .toast{position:absolute;right:28px;bottom:28px;width:390px;padding:16px 18px;background:#252526;border:1px solid #555;box-shadow:0 10px 28px #0008;opacity:0;transform:translateY(10px);transition:.25s}.toast.show{opacity:1;transform:none}.toast small{display:block;color:#ff9b78;margin-bottom:7px}.toast strong{font:13px Segoe UI,sans-serif}.stamp{position:absolute;right:14px;top:45px;font:10px Segoe UI,sans-serif;color:#7f8a7f;background:#151715;padding:5px 8px;border:1px solid #333}
  </style><body><header><span class="traffic"><b></b><b></b><b></b></span><span>File&nbsp;&nbsp; Edit&nbsp;&nbsp; Selection&nbsp;&nbsp; View&nbsp;&nbsp; Go&nbsp;&nbsp; Run&nbsp;&nbsp; Terminal&nbsp;&nbsp; Help</span><span class="title">${scenario.active} — ${scenario.folder} — Visual Studio Code</span><span class="badge">● DEV</span></header><main><aside class="rail"><b>▱</b><b>⌕</b><b>⑂</b><b>▷</b></aside><aside class="side"><h2>EXPLORER</h2><div class="tree"><strong>${scenario.folder.toUpperCase()}</strong>${scenario.files.map(file => `<span>⌑ ${file}</span>`).join("")}</div></aside><section class="work" id="work"><div class="tabs"><div class="tab active" id="tab">${scenario.active}</div><div class="tab">${scenario.next}</div></div><div class="editor" id="editor">${lines(scenario.code)}</div><div class="terminal" id="terminal"><nav><b>TERMINAL</b> OUTPUT&nbsp;&nbsp; DEBUG CONSOLE&nbsp;&nbsp; PROBLEMS</nav><pre><span class="badge">PS C:\\demo\\${scenario.folder}&gt;</span> ${scenario.command}\n<span id="terminal-output"></span><span class="cursor"></span></pre></div></section></main><div class="stamp">ACTUAL LOCAL RUN · PATHS REDACTED</div><div class="toast" id="toast"><small>${scenario.running ? "PREVIEW STILL RUNNING" : "PROCESS EXITED WITH CODE 1"}</small><strong>${escapeHtml(scenario.marker)}</strong></div><script>
    const output=${JSON.stringify(scenario.output)}; const nextCode=${JSON.stringify(scenario.nextCode)};
    setTimeout(()=>{work.classList.add('terminal-open');terminal.classList.add('show')},1800);
    setTimeout(()=>{document.querySelector('#terminal-output').innerHTML='<span class="error">'+${JSON.stringify(escapeHtml(scenario.output))}.replaceAll('\\n','<br>')+'</span>';toast.classList.add('show')},3000);
    setTimeout(()=>{tab.textContent=${JSON.stringify(scenario.next)};editor.innerHTML=nextCode.split('\\n').map((line,i)=>'<div'+(i===${scenario.markerLine - 1}?' class="focus"':'')+'><i>'+(i+1)+'</i><span>'+line.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</span></div>').join('');toast.classList.remove('show')},6500);
  </script></body></html>`);
  await page.waitForTimeout(10_000);
  const video = page.video();
  await context.close();
  const path = await video.path();
  const destination = join(output, `${scenario.id}.webm`);
  rmSync(destination, { force: true });
  renameSync(path, destination);
}
await browser.close();
rmSync(join(migrationRoot, "demo.db"), { force: true });
