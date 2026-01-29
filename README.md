# Sicho_Radio (RoIP relay)

Minimal WebSocket relay (rooms by channel) for a RoIP proof-of-concept.

## Local run
```bash
npm install
npm start
```

Endpoints:
- HTTP: http://localhost:8080/
- Health: http://localhost:8080/health
- WS: ws://localhost:8080/ws

## Koyeb
Create a **Web Service** from this repo using **Buildpack**.

WebSocket endpoint once deployed:
- wss://<your-app>.koyeb.app/ws
