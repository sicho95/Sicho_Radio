import http from "http";
import { WebSocketServer } from "ws";

const PORT = parseInt(process.env.PORT || "8080", 10);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ name: "sicho-radio", status: "running" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });

// ws -> { channel: number, role: "gw"|"pwa"|"unknown" }
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
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }

      if (msg.type === "join") {
        const ch = Math.max(1, Math.min(255, (msg.channel | 0) || 1));
        const role = (msg.role === "gw" || msg.role === "pwa") ? msg.role : "unknown";
        clients.set(ws, { channel: ch, role });
        safeSend(ws, JSON.stringify({ type: "joined", channel: ch }), { binary: false });
        return;
      }

      // Control messages (ptt/busy/etc.) -> relay within channel
      if (msg.type === "ptt" || msg.type === "busy") {
        const { channel } = clients.get(ws) || { channel: 1 };
        broadcast(channel, ws, JSON.stringify(msg), false);
        return;
      }

      return;
    }

    // Binary (audio) -> relay within channel
    const { channel } = clients.get(ws) || { channel: 1 };
    broadcast(channel, ws, data, true);
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sicho-radio listening on ${PORT}`);
});
