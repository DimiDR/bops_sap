const tools = [
  { type: "function", function: { name: "read_note", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: {
    name: "propose_note",
    description: "Propose a change with the exact new text explicitly supplied by the user.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  } },
];

export function loadModels(env = process.env, request = fetch) {
  const profiles = JSON.parse(env.SAP_MODEL_PROFILES || "[]");
  if (!Array.isArray(profiles) || profiles.length > 10) throw new Error("Invalid SAP_MODEL_PROFILES");
  const models = new Map();
  for (const { id, url, model, keyEnv } of profiles) {
    const endpoint = new URL(url);
    const key = keyEnv ? env[keyEnv] : undefined;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
    if (!/^[a-z][a-z0-9-]{0,29}$/.test(id) || models.has(id) || typeof model !== "string" || !model ||
        endpoint.username || endpoint.password || endpoint.hash || endpoint.search ||
        (endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:")) ||
        (keyEnv && !key)) throw new Error("Invalid model profile or missing API key");
    models.set(id, { endpoint, model, key });
  }
  return {
    ids: [...models.keys()],
    async interpret(id, text) {
      const { endpoint, model, key } = models.get(id);
      const response = await request(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model,
          tools,
          messages: [
            { role: "system", content: "Use at most one tool for the test order's internal note. If the user supplies an exact replacement, pass that exact text. For any other request, return no tool call." },
            { role: "user", content: text },
          ],
        }),
      });
      if (!response.ok) throw new Error("Model endpoint rejected request");
      const calls = (await response.json()).choices?.[0]?.message?.tool_calls;
      if (!Array.isArray(calls) || calls.length !== 1) return null;
      const call = calls[0]?.function;
      if (call?.name === "read_note") return { action: "read" };
      if (call?.name !== "propose_note") return null;
      const args = JSON.parse(call.arguments);
      if (typeof args?.text !== "string" || !args.text || !text.includes(args.text)) return null;
      return { action: "propose", text: args.text };
    },
  };
}
