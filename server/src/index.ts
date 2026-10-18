import "dotenv/config";
import { createApp } from "./app";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required");
}

const port = Number(process.env.PORT) || 3000;

createApp().listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
