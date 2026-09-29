const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || 'super_secret_session_key';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server running');
});

const wss = new WebSocketServer({ server });

// Map of sessionId to Set of WebSocket clients
const sessions = new Map();
// Map of sessionId to latest active translation payload
const sessionLatestTranslations = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    ws.close(1008, 'Session ID required');
    return;
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Set());
  }

  sessions.get(sessionId).add(ws);
  ws.sessionId = sessionId;
  console.log(`[WS SERVER] client connected`);
  console.log(`[WS SERVER] client joined session: ${sessionId}`);

  // Send retained latest translation to newly connected client in this session if present
  const latest = sessionLatestTranslations.get(sessionId);
  if (latest && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(latest));
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'TRANSLATION') {
        console.log(`[WS SERVER] broadcast session=${ws.sessionId}`);
        sessionLatestTranslations.set(ws.sessionId, data);
      } else if (data.type === 'CLEAR_TRANSLATION' || data.type === 'SESSION_STOPPED') {
        sessionLatestTranslations.delete(ws.sessionId);
      }

      // Broadcasting to same session
      const sessionClients = sessions.get(ws.sessionId);
      if (sessionClients) {
        for (const client of sessionClients) {
          if (client.readyState === 1 /* OPEN */) {
            client.send(JSON.stringify(data));
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  });

  ws.on('close', () => {
    const sessionClients = sessions.get(ws.sessionId);
    if (sessionClients) {
      sessionClients.delete(ws);
      if (sessionClients.size === 0) {
        sessions.delete(ws.sessionId);
        sessionLatestTranslations.delete(ws.sessionId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});
