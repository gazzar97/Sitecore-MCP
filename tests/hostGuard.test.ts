import { describe, expect, it } from "vitest";
import { assertLocalUrl, isLocalAddress, matchesHostPattern } from "../src/safety/hostGuard.js";
import { HostNotAllowedError } from "../src/errors.js";

const noLookup = async (): Promise<string[]> => {
  throw new Error("should not resolve");
};

describe("isLocalAddress", () => {
  it.each(["127.0.0.1", "127.5.5.5", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "::1", "fd12:3456::1", "::ffff:127.0.0.1"])(
    "accepts %s",
    (ip) => expect(isLocalAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "2001:4860::8888", "not-an-ip"])("rejects %s", (ip) =>
    expect(isLocalAddress(ip)).toBe(false),
  );
});

describe("matchesHostPattern", () => {
  it("matches exact and wildcard patterns", () => {
    expect(matchesHostPattern("cm.dev.local", "cm.dev.local")).toBe(true);
    expect(matchesHostPattern("CM.dev.local", "*.dev.local")).toBe(true);
    expect(matchesHostPattern("dev.local", "*.dev.local")).toBe(false);
    expect(matchesHostPattern("evil-dev.local", "*.dev.local")).toBe(false);
  });
});

describe("assertLocalUrl", () => {
  it("allows localhost names and local IPs without DNS", async () => {
    await assertLocalUrl("https://localhost", [], noLookup);
    await assertLocalUrl("https://xmcloudcm.localhost/sitecore", [], noLookup);
    await assertLocalUrl("http://127.0.0.1:8080", [], noLookup);
    await assertLocalUrl("http://[::1]:8080", [], noLookup);
  });

  it("allows configured hosts", async () => {
    await assertLocalUrl("https://sc104.dev.local", ["*.dev.local"], noLookup);
  });

  it("allows names that resolve only to local addresses (hosts file)", async () => {
    await assertLocalUrl("https://myproject.sc", [], async () => ["127.0.0.1"]);
  });

  it("rejects public IPs and names resolving to any public address", async () => {
    await expect(assertLocalUrl("https://8.8.8.8", [], noLookup)).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(assertLocalUrl("https://prod.example.com", [], async () => ["127.0.0.1", "52.1.1.1"])).rejects.toThrow(
      /Refusing to connect/,
    );
  });

  it("rejects names that do not resolve", async () => {
    await expect(
      assertLocalUrl("https://nowhere.test", [], async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/could not resolve/);
  });
});
