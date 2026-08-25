import type http from "node:http";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
}

export function sendNotFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: "Not found" });
}

export function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export interface SseHub<T> {
  broadcast(state: T): void;
  addClient(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    initialState: T,
  ): void;
}

export function createSseHub<T>(): SseHub<T> {
  const clients = new Set<http.ServerResponse>();

  return {
    broadcast(state: T): void {
      const payload = `data: ${JSON.stringify(state)}\n\n`;
      for (const client of clients) {
        client.write(payload);
      }
    },
    addClient(req, res, initialState): void {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS_HEADERS,
      });
      res.write(`data: ${JSON.stringify(initialState)}\n\n`);
      clients.add(res);
      req.on("close", () => {
        clients.delete(res);
      });
    },
  };
}
