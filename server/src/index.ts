import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app";
import { initRealtime } from "./realtime/ws";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required");
}

const port = Number(process.env.PORT) || 3000;
const app = createApp();
const server = createServer(app);

initRealtime(server);

server.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}/ws`);
});
