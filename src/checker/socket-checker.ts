import net from 'node:net';
import { APP_CONFIG } from '../config';
import type { CheckResult, ProxyProtocol } from '../types';

export interface CheckTarget {
  id: string;
  ip: string;
  port: number;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
}

export class SocketChecker {
  /**
   * Check a single proxy endpoint using native TCP socket handshake
   */
  async check(proxy: CheckTarget): Promise<CheckResult> {
    if (proxy.protocol === 'socks5') {
      return this.checkSocks5(proxy);
    }
    if (proxy.protocol === 'socks4') {
      return this.checkSocks4(proxy);
    }
    return this.checkHttp(proxy);
  }

  /**
   * Level 2 SOCKS5 Full Outbound Tunneling Verification (RFC 1928 & RFC 1929 Auth)
   */
  private checkSocks5(proxy: CheckTarget): Promise<CheckResult> {
    const start = performance.now();

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isFinished = false;
      // Steps: 1 = Greeting, 2 = Auth (RFC 1929), 3 = Connect
      let step = 1;

      const timer = setTimeout(() => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks5',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: 'Connection timeout',
        });
      }, APP_CONFIG.TIMEOUT_MS);

      const cleanup = (res: CheckResult) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(res);
      };

      socket.setTimeout(APP_CONFIG.TIMEOUT_MS);

      socket.connect(proxy.port, proxy.ip, () => {
        if (proxy.username && proxy.password) {
          // Version 5, 2 methods: 0x00 (NO AUTH), 0x02 (USER/PASS)
          socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
        } else {
          // Version 5, 1 method: 0x00 (NO AUTH)
          socket.write(Buffer.from([0x05, 0x01, 0x00]));
        }
      });

      socket.on('data', (data) => {
        if (step === 1) {
          // Verify Step 1 SOCKS5 Greeting Response: [0x05, selectedMethod]
          if (data.length >= 2 && data[0] === 0x05) {
            const selectedMethod = data[1];

            if (selectedMethod === 0x00) {
              // No Auth accepted -> Step 3: Send CONNECT to 1.1.1.1:80
              step = 3;
              socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x50]));
            } else if (selectedMethod === 0x02 && proxy.username && proxy.password) {
              // Server requests Username/Password (RFC 1929)
              step = 2;
              const uBuf = Buffer.from(proxy.username, 'utf8');
              const pBuf = Buffer.from(proxy.password, 'utf8');
              const authPacket = Buffer.concat([
                Buffer.from([0x01, uBuf.length]),
                uBuf,
                Buffer.from([pBuf.length]),
                pBuf,
              ]);
              socket.write(authPacket);
            } else {
              const errMsg = selectedMethod === 0xff
                ? 'SOCKS5 Authentication Required (No acceptable auth method or missing credentials)'
                : `Unsupported SOCKS5 auth method selected: 0x${selectedMethod?.toString(16)}`;
              cleanup({
                id: proxy.id,
                ip: proxy.ip,
                port: proxy.port,
                protocol: 'socks5',
                username: proxy.username,
                password: proxy.password,
                isAlive: false,
                latencyMs: Math.round(performance.now() - start),
                error: errMsg,
              });
            }
          } else {
            cleanup({
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: 'socks5',
              username: proxy.username,
              password: proxy.password,
              isAlive: false,
              latencyMs: Math.round(performance.now() - start),
              error: `Invalid SOCKS5 greeting response: ${data.toString('hex')}`,
            });
          }
        } else if (step === 2) {
          // Step 2: RFC 1929 Auth Response: [0x01, status] (0x00 = success)
          if (data.length >= 2 && data[0] === 0x01 && data[1] === 0x00) {
            step = 3;
            // Auth OK -> Send CONNECT to 1.1.1.1:80
            socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x50]));
          } else {
            cleanup({
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: 'socks5',
              username: proxy.username,
              password: proxy.password,
              isAlive: false,
              latencyMs: Math.round(performance.now() - start),
              error: `SOCKS5 Authentication Failed (status ${data.length >= 2 ? data[1] : 'unknown'})`,
            });
          }
        } else if (step === 3) {
          // Step 3: Response [0x05, 0x00, ...] -> 0x00 is SUCCESS (Tunnel Established!)
          const latencyMs = Math.round(performance.now() - start);
          if (data.length >= 2 && data[0] === 0x05 && data[1] === 0x00) {
            cleanup({
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: 'socks5',
              username: proxy.username,
              password: proxy.password,
              isAlive: true,
              latencyMs,
              anonymity: 'elite',
            });
          } else {
            cleanup({
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: 'socks5',
              username: proxy.username,
              password: proxy.password,
              isAlive: false,
              latencyMs,
              error: `Tunnel connect rejected: code ${data[1]}`,
            });
          }
        }
      });

      socket.on('timeout', () => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks5',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: 'Timeout reached',
        });
      });

      socket.on('error', (err) => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks5',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: err.message,
        });
      });
    });
  }

  /**
   * Native SOCKS4 Protocol Handshake
   */
  private checkSocks4(proxy: CheckTarget): Promise<CheckResult> {
    const start = performance.now();

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isFinished = false;

      const timer = setTimeout(() => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks4',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: 'Connection timeout',
        });
      }, APP_CONFIG.TIMEOUT_MS);

      const cleanup = (res: CheckResult) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(res);
      };

      socket.setTimeout(APP_CONFIG.TIMEOUT_MS);

      socket.connect(proxy.port, proxy.ip, () => {
        // Send SOCKS4 Connect Request to 1.1.1.1:80: [0x04, 0x01, portHigh, portLow, ip0, ip1, ip2, ip3, ...userid, 0x00]
        const userBuf = proxy.username ? Buffer.from(proxy.username, 'utf8') : Buffer.alloc(0);
        const req = Buffer.concat([
          Buffer.from([0x04, 0x01, 0x00, 0x50, 0x01, 0x01, 0x01, 0x01]),
          userBuf,
          Buffer.from([0x00]),
        ]);
        socket.write(req);
      });

      socket.on('data', (data) => {
        const latencyMs = Math.round(performance.now() - start);

        // SOCKS4 Response: [0x00, 0x5A] (0x5A = 90: Request granted)
        if (data.length >= 2 && data[1] === 0x5a) {
          cleanup({
            id: proxy.id,
            ip: proxy.ip,
            port: proxy.port,
            protocol: 'socks4',
            username: proxy.username,
            password: proxy.password,
            isAlive: true,
            latencyMs,
            anonymity: 'anonymous',
          });
        } else {
          cleanup({
            id: proxy.id,
            ip: proxy.ip,
            port: proxy.port,
            protocol: 'socks4',
            username: proxy.username,
            password: proxy.password,
            isAlive: false,
            latencyMs,
            error: `Invalid SOCKS4 response: ${data.toString('hex')}`,
          });
        }
      });

      socket.on('timeout', () => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks4',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: 'Timeout reached',
        });
      });

      socket.on('error', (err) => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks4',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: err.message,
        });
      });
    });
  }

  /**
   * Native HTTP/HTTPS Proxy Handshake & Request
   */
  private checkHttp(proxy: CheckTarget): Promise<CheckResult> {
    const start = performance.now();

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isFinished = false;

      const timer = setTimeout(() => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'http',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: 'Connection timeout',
        });
      }, APP_CONFIG.TIMEOUT_MS);

      const cleanup = (res: CheckResult) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(res);
      };

      socket.setTimeout(APP_CONFIG.TIMEOUT_MS);

      socket.connect(proxy.port, proxy.ip, () => {
        // Send HTTP GET request via Proxy
        const authHeader = proxy.username && proxy.password
          ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`
          : '';
        socket.write(`GET http://cloudflare.com/cdn-cgi/trace HTTP/1.1\r\nHost: cloudflare.com\r\n${authHeader}Connection: close\r\n\r\n`);
      });

      socket.on('data', (data) => {
        const latencyMs = Math.round(performance.now() - start);
        const str = data.toString();

        const is200 = str.includes('200 OK') || str.includes('HTTP/1.1 200') || str.includes('HTTP/1.0 200');
        const hasTraceIp = str.includes('ip=');
        const is407 = str.includes('407 Proxy Authentication Required') || str.includes(' 407 ');
        const isBlockedOrError = is407 || str.includes(' 403 ') || str.includes(' 502 ') || str.includes(' 503 ') || str.includes(' 504 ');

        if (!isBlockedOrError && (is200 || hasTraceIp)) {
          let egressIp: string | undefined;
          const match = str.match(/ip=([^\r\n]+)/);
          if (match) egressIp = match[1]?.trim();

          cleanup({
            id: proxy.id,
            ip: proxy.ip,
            port: proxy.port,
            protocol: 'http',
            username: proxy.username,
            password: proxy.password,
            isAlive: true,
            latencyMs,
            egressIp,
            anonymity: egressIp === proxy.ip ? 'elite' : 'anonymous',
          });
        } else {
          let errorMsg = 'Invalid HTTP proxy response';
          if (is407) {
            errorMsg = proxy.username
              ? '407 Proxy Authentication Required (Invalid credentials)'
              : '407 Proxy Authentication Required (Credentials not provided)';
          } else if (str.includes(' 403 ')) {
            errorMsg = '403 Forbidden';
          } else if (str.includes(' 502 ')) {
            errorMsg = '502 Bad Gateway';
          } else if (str.includes(' 504 ')) {
            errorMsg = '504 Gateway Timeout';
          }

          cleanup({
            id: proxy.id,
            ip: proxy.ip,
            port: proxy.port,
            protocol: 'http',
            username: proxy.username,
            password: proxy.password,
            isAlive: false,
            latencyMs,
            error: errorMsg,
          });
        }
      });

      socket.on('timeout', () => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'http',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: 'Timeout reached',
        });
      });

      socket.on('error', (err) => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'http',
          username: proxy.username,
          password: proxy.password,
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: err.message,
        });
      });
    });
  }
}

export const socketChecker = new SocketChecker();
