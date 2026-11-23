import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function clientAddress(request, path, key, now = Date.now()) {
  const proof = request.headers['x-flux-client'];
  if (key && typeof proof === 'string') {
    const [timestamp, address, signature, extra] = proof.split(',');
    if (extra === undefined && /^\d{13}$/.test(timestamp) && isIP(address ?? '') &&
        /^[a-f0-9]{64}$/.test(signature ?? '') && Math.abs(now - Number(timestamp)) <= 60_000) {
      const expected = createHmac('sha256', key)
        .update(`${timestamp},${address},${request.method},${path}`).digest();
      if (timingSafeEqual(Buffer.from(signature, 'hex'), expected)) return address;
    }
  }

  // Render's ingress appends its caller. Earlier entries may come from the caller.
  const forwarded = request.headers['x-forwarded-for'];
  const nearest = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
  return nearest && isIP(nearest) ? nearest : request.socket.remoteAddress;
}
