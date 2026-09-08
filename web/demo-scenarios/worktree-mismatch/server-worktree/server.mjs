import { createServer } from "node:http";
import { banner } from "./app.mjs";

createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<h1>${banner}</h1><p>served from: ${process.cwd()}</p>`);
}).listen(4317, () => console.log(`preview http://localhost:4317\nroot: ${process.cwd()}`));
