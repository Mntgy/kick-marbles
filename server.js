const WebSocket = require("ws");
const http      = require("http");
const https     = require("https");
const fs        = require("fs");
const path      = require("path");

// ─── Static file server ───────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Kick chatroom-ID lookup proxy  (/api/chatroom?channel=xyz)
  if (req.url.startsWith("/api/chatroom")) {
    const url  = new URL(req.url, `http://${req.headers.host}`);
    const chan  = (url.searchParams.get("channel") || "").trim().toLowerCase();
    if (!chan) { res.writeHead(400); res.end(JSON.stringify({ error: "missing channel" })); return; }

    const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(chan)}`;
    https.get(apiUrl, { headers: { "User-Agent": "KickMarbles/1.0" } }, apiRes => {
      let body = "";
      apiRes.on("data", d => body += d);
      apiRes.on("end", () => {
        try {
          const json = JSON.parse(body);
          const id   = json && json.chatroom && json.chatroom.id;
          if (!id) { res.writeHead(404); res.end(JSON.stringify({ error: "channel not found" })); return; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ chatroomId: id, channel: json.slug || chan }));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: "parse error" }));
        }
      });
    }).on("error", err => {
      res.writeHead(502); res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Static files
  let filePath = req.url === "/" ? "/setup.html" : req.url;
  filePath = path.join(__dirname, filePath.split("?")[0]);
  const ext  = path.extname(filePath);
  const mime = MIME[ext] || "text/plain";

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log("[Server] Listening on http://localhost:" + PORT);
  console.log("[Server] Open http://localhost:" + PORT + " to set up your stream");
});

// ─── Game WebSocket server ─────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

// sessions: Map<ws, { chatroomId, channel, kickWs, pingInterval }>
const sessions = new Map();

const PUSHER_APP_KEY = "32cbd69e4b950bf97679";
const PUSHER_CLUSTER = "us2";

function pusherUrl() {
  return "wss://ws-" + PUSHER_CLUSTER + ".pusher.com/app/" + PUSHER_APP_KEY + "?protocol=7&client=js&version=7.0.3&flash=false";
}

function connectKick(ws, chatroomId, channel) {
  const session = sessions.get(ws);
  if (!session) return;

  if (session.kickWs) { try { session.kickWs.terminate(); } catch (e) {} }
  if (session.pingInterval) clearInterval(session.pingInterval);

  console.log("[Kick] Connecting for channel \"" + channel + "\" (room " + chatroomId + ")...");
  const kickWs = new WebSocket(pusherUrl());
  session.kickWs     = kickWs;
  session.chatroomId = chatroomId;
  session.channel    = channel;

  kickWs.on("open", () => {
    console.log("[Kick] Connected — subscribing to chatrooms." + chatroomId + ".v2");
    kickWs.send(JSON.stringify({
      event: "pusher:subscribe",
      data: { auth: "", channel: "chatrooms." + chatroomId + ".v2" }
    }));
    session.pingInterval = setInterval(() => {
      if (kickWs.readyState === WebSocket.OPEN)
        kickWs.send(JSON.stringify({ event: "pusher:ping", data: {} }));
    }, 30000);
  });

  kickWs.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.event === "pusher_internal:subscription_succeeded") {
        console.log("[Kick] Subscribed — viewers on kick.com/" + channel + " can type !join");
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "connected", channel: channel }));
        return;
      }
      if (msg.event === "pusher:pong" || msg.event === "pusher:connection_established") return;
      if (msg.event === "pusher:error") {
        console.error("[Kick] Pusher error:", msg.data);
        return;
      }

      if (msg.event === "App\\Events\\ChatMessageEvent") {
        const payload  = JSON.parse(msg.data);
        const username = payload && payload.sender && payload.sender.username;
        const content  = payload && payload.content && payload.content.trim();
        if (!username || !content) return;

        if (content.toLowerCase() === "!join") {
          console.log("[Chat] " + channel + " -> " + username + " joined");
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "join", username: username }));
        }
      }
    } catch (e) { /* ignore */ }
  });

  kickWs.on("error", err => console.error("[Kick] WS error (" + channel + "):", err.message));

  kickWs.on("close", code => {
    console.warn("[Kick] Disconnected (" + channel + ", code " + code + ")");
    clearInterval(session.pingInterval);
    if (sessions.has(ws)) {
      console.log("[Kick] Reconnecting in 10s...");
      setTimeout(function() { if (sessions.has(ws)) connectKick(ws, chatroomId, channel); }, 10000);
    }
  });
}

wss.on("connection", ws => {
  sessions.set(ws, { kickWs: null, pingInterval: null, chatroomId: null, channel: null });
  console.log("[Game] Browser connected (" + sessions.size + " active)");

  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "configure" && msg.chatroomId) {
        connectKick(ws, msg.chatroomId, msg.channel || "unknown");
      }
    } catch (e) {}
  });

  ws.on("close", () => {
    const session = sessions.get(ws);
    if (session) {
      if (session.kickWs) { try { session.kickWs.terminate(); } catch (e) {} }
      if (session.pingInterval) clearInterval(session.pingInterval);
    }
    sessions.delete(ws);
    console.log("[Game] Browser disconnected (" + sessions.size + " remaining)");
  });

  ws.on("error", err => console.error("[Game] WS error:", err.message));
});