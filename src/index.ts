import dotenv from "dotenv";
import { createServer } from "node:http";
import { createNodeMiddleware, Probot } from "probot";
import { createApp } from "./app";

dotenv.config();

const required = ["APP_ID", "WEBHOOK_SECRET", "PRIVATE_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `海姆达尔启动失败：缺少环境变量 ${missing.join(", ")}。请复制 .env.example 为 .env 并填写。`
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const probot = new Probot({
    appId: Number(process.env.APP_ID),
    // .env 里可以用字面换行，也可以用 \n 转义，这里统一还原
    privateKey: process.env.PRIVATE_KEY!.replace(/\\n/g, "\n"),
    secret: process.env.WEBHOOK_SECRET,
  });

  const middleware = createNodeMiddleware(createApp, {
    probot,
    webhooksPath: "/api/github/webhooks",
  });

  const port = Number(process.env.PORT ?? 3000);
  createServer((req, res) => {
    middleware(req, res, () => {
      res.writeHead(404);
      res.end("Not Found");
    });
  }).listen(port, () => {
    console.log(`海姆达尔 webhook 服务已启动：http://localhost:${port}/api/github/webhooks`);
  });
}

main().catch((err) => {
  console.error("海姆达尔启动失败:", err);
  process.exit(1);
});
