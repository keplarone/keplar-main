import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_FETCH_OPTIONS, FetchPolicyError, htmlToText, publicAddressesOnly, safeFetch, validateUrl } from "../src/capabilities/safe-fetch.js";

describe("address policy", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "224.0.0.1",
  ])("blocks %s", (addr) => {
    expect(publicAddressesOnly(addr)).toBe(false);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])("allows public %s", (addr) => {
    expect(publicAddressesOnly(addr)).toBe(true);
  });
});

describe("URL validation", () => {
  it.each(["file:///etc/passwd", "gopher://x", "http://user:pw@example.com", "http://example.com:8080/", "not a url"])("rejects %s", (u) => {
    expect(() => validateUrl(u)).toThrow(FetchPolicyError);
  });

  it("accepts ordinary web URLs", () => {
    expect(validateUrl("https://example.com/path?q=1").hostname).toBe("example.com");
  });
});

describe("safeFetch against a local server", () => {
  let server: http.Server;
  let port = 0;
  const base = () => `http://127.0.0.1:${port}`;
  const loopbackAllowed = { ...DEFAULT_FETCH_OPTIONS, addressPolicy: (a: string) => a === "127.0.0.1", allowedPorts: [80, 443] };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/page") {
        res.setHeader("content-type", "text/html");
        res.end("<html><head><title>Hello &amp; welcome</title><script>alert(1)</script></head><body><p>Readable text here.</p></body></html>");
      } else if (req.url === "/to-metadata") {
        res.statusCode = 302;
        res.setHeader("location", "http://169.254.169.254/latest/meta-data/");
        res.end();
      } else if (req.url === "/big") {
        res.setHeader("content-type", "text/plain");
        res.end("x".repeat(10_000));
      } else {
        res.statusCode = 404;
        res.end("nope");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    loopbackAllowed.allowedPorts = [port];
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("refuses loopback under the default production policy", async () => {
    await expect(safeFetch(`${base()}/page`, { ...DEFAULT_FETCH_OPTIONS, allowedPorts: [port] })).rejects.toThrow(/Blocked address/);
  });

  it("refuses hostnames that resolve to private addresses (checked at connect time)", async () => {
    await expect(safeFetch(`http://localhost:${port}/page`, { ...DEFAULT_FETCH_OPTIONS, allowedPorts: [port] })).rejects.toThrow(/Blocked address/);
  });

  it("fetches when policy allows, and extracts text without scripts", async () => {
    const res = await safeFetch(`${base()}/page`, loopbackAllowed);
    expect(res.status).toBe(200);
    const { title, text } = htmlToText(res.body);
    expect(title).toBe("Hello & welcome");
    expect(text).toContain("Readable text here.");
    expect(text).not.toContain("alert");
  });

  it("re-validates every redirect hop", async () => {
    await expect(safeFetch(`${base()}/to-metadata`, loopbackAllowed)).rejects.toThrow(FetchPolicyError);
  });

  it("caps response size", async () => {
    const res = await safeFetch(`${base()}/big`, { ...loopbackAllowed, maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
  });
});
