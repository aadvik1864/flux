import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { chromium, expect } from "@playwright/test";

const { key, secret } = JSON.parse(await readFile("/artifacts/keys.json", "utf8"));
const service = new RoomServiceClient("http://livekit:7880", key, secret);
const sdk = await readFile(new URL("./node_modules/livekit-client/dist/livekit-client.umd.js", import.meta.url));
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/sdk.js") { response.setHeader("Content-Type", "text/javascript"); response.end(sdk); return; }
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html><head><title>Local LiveKit feasibility fixture</title></head><body><h1>Local call prototype</h1><button id="share">Share screen</button><div id="media"></div><script src="/sdk.js"></script><script>
    const { Room, RoomEvent, Track } = LivekitClient;
    window.fixture = { room: null, state: 'disconnected', screen: null };
    window.join = async token => {
      const room = new Room({ adaptiveStream: false, dynacast: false }); fixture.room = room;
      room.on(RoomEvent.Connected, () => fixture.state = 'connected');
      room.on(RoomEvent.Disconnected, () => fixture.state = 'disconnected');
      room.on(RoomEvent.TrackSubscribed, track => { const element = track.attach(); element.autoplay = true; element.muted = true; document.getElementById('media').append(element); });
      await room.connect('ws://livekit:7880', token, { rtcConfig: { iceServers: [] }, maxRetries: 0 });
    };
    window.publish = async () => { await fixture.room.localParticipant.setMicrophoneEnabled(true); await fixture.room.localParticipant.setCameraEnabled(true); };
    window.received = async source => {
      for (const participant of fixture.room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
        if (publication.source !== source || !publication.track) continue;
        const report = await publication.track.getRTCStatsReport(); let received = false;
        report?.forEach(stat => { if (stat.type === 'inbound-rtp' && stat.bytesReceived > 0) received = true; });
        if (received) return true;
      }
      return false;
    };
    document.getElementById('share').onclick = async () => {
      try { await fixture.room.localParticipant.setScreenShareEnabled(true); fixture.screen = { passed: true }; }
      catch (error) { fixture.screen = { passed: false, error: error.message }; }
    };
  </script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ["--no-proxy-server", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--enable-usermedia-screen-capturing"] });
let phase = "startup";
const evidence = { server: "1.13.9", client: "2.22.4", serverSdk: "2.19.1", isolatedLocalFixture: true, fakeMicrophoneAndCamera: true,
  audioAndVideoPackets: false, invalidSignatureRejected: false, epochRevocationRejectedUnexpiredToken: false, nativeScreenShare: null };
const tokens = [];
async function token(identity, room, signingSecret = secret) {
  const access = new AccessToken(key, signingSecret, { identity, ttl: "5m" });
  access.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
  const value = await access.toJwt(); tokens.push(value); return value;
}
async function page() {
  const context = await browser.newContext({ permissions: ["microphone", "camera"] }); const page = await context.newPage(); await page.goto(origin); return page;
}
try {
  await expect.poll(async () => { try { await service.listRooms(); return true; } catch { return false; } }, { timeout: 20_000 }).toBe(true);
  phase = "two-independent-media-clients";
  await service.createRoom({ name: "workspace-epoch-0", maxParticipants: 4 });
  const a = await page(), b = await page();
  const oldToken = await token("member-a-session", "workspace-epoch-0");
  await a.evaluate(token => window.join(token), oldToken); await b.evaluate(token => window.join(token), await token("member-b-session", "workspace-epoch-0"));
  assert.equal((await service.listParticipants("workspace-epoch-0")).length, 2);
  await Promise.all([a.evaluate(() => window.publish()), b.evaluate(() => window.publish())]);
  for (const client of [a, b]) {
    await expect.poll(() => client.evaluate(() => window.received("microphone")), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => client.evaluate(() => window.received("camera")), { timeout: 20_000 }).toBe(true);
  }
  evidence.audioAndVideoPackets = true;
  phase = "native-screen-share";
  await a.getByRole("button", { name: "Share screen", exact: true }).click();
  await expect.poll(() => a.evaluate(() => fixture.screen !== null), { timeout: 20_000 }).toBe(true);
  evidence.nativeScreenShare = await a.evaluate(() => fixture.screen);
  if (evidence.nativeScreenShare.passed) await expect.poll(() => b.evaluate(() => window.received("screen_share")), { timeout: 20_000 }).toBe(true);
  phase = "signature-boundary";
  const invalid = await page();
  assert.equal(await invalid.evaluate(async token => { try { await window.join(token); return false; } catch { return true; } }, await token("outsider", "workspace-epoch-0", "not-the-server-secret-that-would-be-accepted")), true);
  evidence.invalidSignatureRejected = true;
  phase = "room-epoch-revocation";
  // Self-hosted LiveKit has no application token revocation list. A future Flux
  // call service must own room creation, rotate epochs, and retire old rooms.
  await service.deleteRoom("workspace-epoch-0");
  for (const client of [a, b]) await expect.poll(() => client.evaluate(() => fixture.state)).toBe("disconnected");
  await service.createRoom({ name: "workspace-epoch-1", maxParticipants: 4 });
  assert.ok(JSON.parse(Buffer.from(oldToken.split(".")[1], "base64url").toString()).exp > Date.now() / 1000, "The old token must still be unexpired to prove epoch revocation");
  const stale = await page();
  assert.equal(await stale.evaluate(async token => { try { await window.join(token); return false; } catch { return true; } }, oldToken), true);
  assert.equal((await service.listRooms(["workspace-epoch-0"])).length, 0);
  const permitted = await page(); await permitted.evaluate(token => window.join(token), await token("still-authorized-member", "workspace-epoch-1"));
  assert.equal((await service.listParticipants("workspace-epoch-1")).length, 1);
  evidence.epochRevocationRejectedUnexpiredToken = true;
  await writeFile("/artifacts/evidence.json", JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log("Local LiveKit feasibility passed:", JSON.stringify(evidence));
} catch (error) {
  let message = error instanceof Error ? error.message : "Unknown failure";
  for (const token of tokens) message = message.replaceAll(token, "<fixture-token>");
  await writeFile("/artifacts/failure.json", JSON.stringify({ phase, message, evidence }, null, 2), { mode: 0o600 });
  console.error(`LiveKit fixture failed at ${phase}: ${message}`); process.exitCode = 1;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
