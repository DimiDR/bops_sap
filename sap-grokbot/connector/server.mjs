import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";

const hopHeaders = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade", "proxy-connection", "x-http-method-override",
  "x-method-override", "x-http-method", "x-original-url", "x-rewrite-url"];

function copyHeaders(headers) {
  const excluded = new Set([...hopHeaders, ...String(headers.connection ?? "").toLowerCase().split(",").map((h) => h.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key) &&
    !key.startsWith("x-forwarded-") && !key.startsWith("tailscale-") && key !== "forwarded"));
}

export function selectRule(rawUrl, method, rules) {
  if (typeof rawUrl !== "string" || rawUrl.length > 8192) return undefined;
  const path = rawUrl.split("?")[0];
  if (!/^\/[A-Za-z0-9_./~()'!$,:=@+-]*$/.test(path) ||
      path.includes("//") || /(?:^|\/)(?:\.{1,2}|\$batch)(?:\/|$)/i.test(path)) return undefined;
  return rules.find((rule) => rule.methods.includes(method) &&
    (rule.prefix ? path.startsWith(rule.path) : path === rule.path));
}

function origin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value) throw new Error("Expected an HTTPS origin without path");
  return url;
}

export function loadConnector(env = process.env) {
  const rules = JSON.parse(env.SAP_CONNECTOR_RULES || "[]");
  if (!Array.isArray(rules) || !rules.length || rules.some((rule) =>
    !/^[a-zA-Z0-9_-]{1,40}$/.test(rule.id) ||
    !/^\/sap\/[a-zA-Z0-9_./-]+$/.test(rule.path) ||
    (rule.prefix && !rule.path.endsWith("/")) ||
    !Array.isArray(rule.methods) || !rule.methods.length ||
    rule.methods.some((method) => !["GET", "HEAD", "POST", "PATCH", "PUT"].includes(method)))) {
    throw new Error("Invalid SAP_CONNECTOR_RULES");
  }
  return {
    upstream: origin(env.SAP_CONNECTOR_UPSTREAM),
    publicOrigin: origin(env.SAP_CONNECTOR_PUBLIC_ORIGIN),
    redirects: (env.SAP_CONNECTOR_LOGIN_ORIGINS || "").split(",").filter(Boolean).map((value) => origin(value).origin),
    rules,
  };
}

export function createConnectorHandler(config, requestUpstream = httpsRequest, log = console.log) {
  return async (request, response) => {
    let status = 502;
    const rule = selectRule(request.url, request.method, config.rules);
    function finish(code) {
      status = code;
      response.writeHead(code, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
      response.end("SAP Connector");
    }
    response.once("finish", () => log(JSON.stringify({ at: new Date().toISOString(), rule: rule?.id, status })));
    if (request.headers.host !== config.publicOrigin.host || !rule) return finish(403);
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          request.resume();
          return finish(413);
        }
        chunks.push(chunk);
      }
      const headers = copyHeaders(request.headers);
      headers.host = config.upstream.host;
      headers["x-forwarded-host"] = config.publicOrigin.host;
      headers["x-forwarded-proto"] = "https";
      headers["content-length"] = size;
      const remote = requestUpstream(config.upstream, {
        method: request.method, path: request.url, headers, signal: AbortSignal.timeout(15000),
      }, (reply) => {
        const outgoing = copyHeaders(reply.headers);
        if (outgoing.location) {
          let location;
          try {
            location = new URL(outgoing.location, new URL(request.url, config.publicOrigin));
          } catch {
            reply.resume();
            return finish(502);
          }
          if (location.origin === config.upstream.origin) {
            location = new URL(location.pathname + location.search + location.hash, config.publicOrigin);
          }
          if (location.username || location.password ||
              (location.origin === config.publicOrigin.origin
                ? !selectRule(location.pathname, [307, 308].includes(reply.statusCode) ? request.method : "GET", config.rules)
                : !config.redirects.includes(location.origin))) {
            reply.resume();
            return finish(502);
          }
          outgoing.location = location.href;
        }
        status = reply.statusCode ?? 502;
        response.writeHead(status, outgoing);
        reply.on("error", () => response.destroy());
        reply.pipe(response);
      });
      remote.on("error", () => response.headersSent ? response.destroy() : finish(502));
      response.once("close", () => { if (!response.writableFinished) remote.destroy(); });
      remote.end(Buffer.concat(chunks));
    } catch {
      if (response.headersSent) response.destroy();
      else finish(502);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(createConnectorHandler(loadConnector()));
  const port = Number(process.env.SAP_CONNECTOR_PORT || 3212);
  server.listen(port, "127.0.0.1", () => console.log(`Connector on 127.0.0.1:${port}`));
}
