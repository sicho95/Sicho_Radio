import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const PORT = parseInt(process.env.PORT || "8080", 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

async function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (urlPath === "/health") {
    send(res, 200, { "content-type": "text/plain; charset=utf-8" }, "ok");
    return true;
  }

  if (urlPath === "/api/status" || urlPath === "/") {
    // On continue de renvoyer le JSON sur /, pratique pour tes tests rapides.
    // La PWA reste accessible via /pwa
    if (urlPath === "/") {
      send(res, 200, { "content-type": "application/json" }, JSON.stringify({ name: "sicho-radio", status: "running" }));
      return true;
    }
    send(res, 200, { "content-type": "application/json" }, JSON.stringify({ name: "sicho-radio", status: "running" }));
    return true;
  }

  // La PWA est servie sous /pwa pour ne pas casser ton endpoint JSON '/'
  if (urlPath === "/pwa" || urlPath.startsWith("/pwa/")) {
    const rel = urlPath === "/pwa" ? "/index.html" : urlPath.replace(/^\/pwa/, "");
    const safePath = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR)) return false;

    try {
      const ext = path.extname(filePath);
      const contentType = MIME[ext] || "application/octet-stream";
      const data = await fs.readFile(filePath);
      send(res, 200, { "content-type": contentType, "cache-control": "no-cache" }, data);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const handled = await serveStatic(req, res);
  if (handled) return;

  send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Map();

function safeSend(ws, data, opts) {
  if (ws.readyState === ws.OPEN) ws.send(data, opts);
}

function broadcast(channel, fromWs, data, isBinary) {
  for (const [ws, meta] of clients.entries()) {
    if (ws !== fromWs && meta.channel === channel) {
      safeSend(ws, data, { binary: isBinary });
    }
  }
}

wss.on("connection", (ws) => {
  clients.set(ws, { channel: 1, role: "unknown" });

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try { msg = JSON.parse(data.toString("utf8")); } catch { return; }

      if (msg.type === "join") {
        const ch = Math.max(1, Math.min(255, (msg.channel | 0) || 1));
        const role = (msg.role === "gw" || msg.role === "pwa") ? msg.role : "unknown";
        clients.set(ws, { channel: ch, role });
        safeSend(ws, JSON.stringify({ type: "joined", channel: ch }), { binary: false });
        return;
      }

      if (msg.type === "ptt" || msg.type === "busy") {
        const { channel } = clients.get(ws) || { channel: 1 };
        broadcast(channel, ws, JSON.stringify(msg), false);
        return;
      }

      return;
    }

    const { channel } = clients.get(ws) || { channel: 1 };
    broadcast(channel, ws, data, true);
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sicho-radio listening on ${PORT}`);
});
