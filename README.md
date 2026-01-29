# Sicho Radio (PWA test)

- Backend: Node.js + ws (WebSocket relay)
- PWA: disponible sur `/pwa`

## Endpoints
- `/` : JSON status (conservé pour compat)
- `/api/status` : JSON status
- `/health` : healthcheck
- `/ws` : WebSocket

## Test PWA
Ouvre `https://<ton-service>/pwa` sur deux téléphones, même canal, puis maintiens le bouton PTT.
