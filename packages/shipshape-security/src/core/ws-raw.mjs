import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export function websocketProbe({ wsUrl, path, cookieHeader, originHeader, payload, textPayload, timeoutMs = 1500 }) {
  return new Promise((resolve) => {
    const url = new URL(path, wsUrl);
    const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80));
    const host = url.hostname;
    const socket = url.protocol === 'wss:' ? tls.connect({ host, port, servername: host }) : net.createConnection({ host, port });
    const key = crypto.randomBytes(16).toString('base64');
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    let closed = false;
    let closeCode = null;
    let dataAfterPayload = false;
    let sentPayload = false;
    const timer = setTimeout(() => done(), timeoutMs);

    function done(extra = {}) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ upgraded, closeCode, dataAfterPayload, status: upgraded ? 101 : 0, ...extra });
    }

    socket.on('connect', () => {
      const headers = [
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
      ];
      if (cookieHeader) headers.push(`Cookie: ${cookieHeader}`);
      if (originHeader) headers.push(`Origin: ${originHeader}`);
      socket.write(`${headers.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const text = buffer.toString('latin1');
        if (!text.includes('\r\n\r\n')) return;
        const status = Number(text.match(/^HTTP\/1\.1 (\d+)/)?.[1] || 0);
        if (status !== 101) return done({ status });
        upgraded = true;
        buffer = buffer.subarray(text.indexOf('\r\n\r\n') + 4);
      } else {
        dataAfterPayload = true;
      }
      if (upgraded && !sentPayload && (payload || textPayload) && buffer.length > 0) {
        sentPayload = true;
        if (payload) socket.write(encodeClientFrame(payload, 0x2));
        if (textPayload) socket.write(encodeClientFrame(Buffer.from(textPayload), 0x1));
      }
      const close = parseCloseCode(buffer);
      if (close) {
        closeCode = close;
        done({ status: 101 });
      }
    });
    socket.on('error', (error) => done({ error: error.message }));
    socket.on('close', () => done({ status: upgraded ? 101 : 0 }));
  });
}

function parseCloseCode(buffer) {
  let index = 0;
  while (index + 2 <= buffer.length) {
    const opcode = buffer[index] & 0x0f;
    let length = buffer[index + 1] & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (index + 4 > buffer.length) return null;
      length = buffer.readUInt16BE(index + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (index + 10 > buffer.length) return null;
      const longLength = buffer.readBigUInt64BE(index + 2);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      length = Number(longLength);
      headerLength = 10;
    }
    const frameEnd = index + headerLength + length;
    if (frameEnd > buffer.length) return null;
    if (opcode === 8) {
      if (length < 2) return 1005;
      const code = buffer.readUInt16BE(index + headerLength);
      return code >= 1000 && code <= 4999 ? code : null;
    }
    index = frameEnd;
  }
  return null;
}

function encodeClientFrame(payload, opcode) {
  const data = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const masked = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index++) masked[index] = data[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}
