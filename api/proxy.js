/**
 * Vercel Serverless Function Proxy for OpenTune Web
 *
 * Proxies Innertube and YouTube Music API requests when running in browser environments
 * (e.g. Vercel deployment at opentunex.vercel.app), bypassing browser CORS restrictions.
 */

export default async function handler(req, res) {
  // Set CORS headers so any origin or client can query
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let payload = req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {}
    }

    const { url, method = "GET", headers = {}, body_base64 } = payload || {};
    if (!url) {
      return res.status(400).json({ error: "Missing required 'url' property" });
    }

    const fetchHeaders = { ...headers };
    // Remove headers that Node fetch will manage
    delete fetchHeaders.host;
    delete fetchHeaders.connection;
    delete fetchHeaders["content-length"];

    let body = undefined;
    if (body_base64 && method !== "GET" && method !== "HEAD") {
      body = Buffer.from(body_base64, "base64");
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body,
      redirect: "follow",
    });

    const arrayBuffer = await response.arrayBuffer();
    const responseBodyBase64 = Buffer.from(arrayBuffer).toString("base64");
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const setCookie = response.headers.get("set-cookie") || undefined;

    return res.status(200).json({
      status: response.status,
      headers: responseHeaders,
      body_base64: responseBodyBase64,
      cookie: setCookie,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      status: 500,
      headers: {},
      body_base64: Buffer.from(JSON.stringify({ error: errorMsg })).toString("base64"),
      error: errorMsg,
    });
  }
}
