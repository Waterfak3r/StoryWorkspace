import http from "node:http";

const port = Number.parseInt(process.env.FAKE_OPENAI_PORT || "43141", 10);

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body was not JSON"));
      }
    });
    request.on("error", reject);
  });
}

function markdownForRequest(payload) {
  const input = Array.isArray(payload?.input) ? payload.input : [];
  const userText = input
    .flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    .map((content) => typeof content?.text === "string" ? content.text : "")
    .join("\n");
  const hasBibleContext = userText.includes("[bible]") && userText.includes("Mara hears the beacon beneath the flood.");
  const hasOutlineContext = userText.includes("[outline]") && userText.includes("The Beacon");
  const contextMarker = hasBibleContext && hasOutlineContext
    ? "CONTEXT CHECK: THE SIGNAL + THE BEACON"
    : "CONTEXT CHECK: NO EXPLICIT STORY CONTEXT";
  return [
    contextMarker,
    "INT. LANTERN ROOM - NIGHT",
    "",
    "MARA studies the storm map while the lantern signal returns.",
    "",
    "MARA",
    hasBibleContext && hasOutlineContext ? "The signal is still alive." : "The room holds its breath.",
  ].join("\n");
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url?.endsWith("/responses")) {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
    sendJson(response, 404, { error: { message: "Fake provider route not found" } });
    return;
  }

  try {
    const payload = await readBody(request);
    sendJson(response, 200, {
      id: "fake-response",
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({ markdown: markdownForRequest(payload) }),
        }],
      }],
    });
  } catch {
    sendJson(response, 400, { error: { message: "Fake provider received malformed JSON" } });
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, "127.0.0.1", () => {
  console.log(`Fake OpenAI provider listening on http://127.0.0.1:${port}`);
});
