import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

// Custom Node server. Holds the single long lived process that owns the
// SessionManager, pollers, pi SDK sessions and the SSE hub. Everything runs in
// this one process so the in memory managers persist across requests.

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Eagerly load the manager so pollers with enabled=true auto resume on boot.
  await import("./lib/server/manager");

  createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    handle(req, res, parsedUrl);
  }).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Nit ready on http://localhost:${port}`);
  });
});
