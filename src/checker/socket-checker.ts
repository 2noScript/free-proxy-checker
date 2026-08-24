import net from 'node:net';
import { APP_CONFIG } from '../config';
import type { CheckResult, ProxyProtocol } from '../types';

export class SocketChecker {
  /**
   * Check a single proxy endpoint using native TCP socket handshake
   */
  async check(proxy: { id: string; ip: string; port: number; protocol: ProxyProtocol }): Promise<CheckResult> {
    if (proxy.protocol === 'socks5') {
      return this.checkSocks5(proxy);
    }
    if (proxy.protocol === 'socks4') {
      return this.checkSocks4(proxy);
    }
    return this.checkHttp(proxy);
  }

  /**
   * Level 2 SOCKS5 Full Outbound Tunneling Verification (RFC 1928)
   */
  private checkSocks5(proxy: { id: string; ip: string; port: number; protocol: ProxyProtocol }): Promise<CheckResult> {
    const start = performance.now();

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isFinished = false;
      let step = 1;

      // Hard timeout timer covering both TCP Connect and Data exchange
      const timer = setTimeout(() => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'socks5',
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
        // Step 1: Send SOCKS5 Greeting (Version 5, 1 auth method: No Auth 0x00)
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      socket.on('data', (data) => {
        if (step === 1) {
          // Verify Step 1 SOCKS5 Greeting Response: [0x05, 0x00]
          if (data.length >= 2 && data[0] === 0x05 && data[1] === 0x00) {
            step = 2;
            // Step 2: Send SOCKS5 CONNECT to 1.1.1.1:80 [0x05, 0x01, 0x00, 0x01, 1, 1, 1, 1, 0x00, 0x50]
            socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x50]));
          } else {
            cleanup({
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: 'socks5',
              isAlive: false,
              latencyMs: Math.round(performance.now() - start),
              error: `Invalid SOCKS5 greeting: ${data.toString('hex')}`,
            });
          }
        } else if (step === 2) {
          // Step 2: Response [0x05, 0x00, ...] -> 0x00 is SUCCESS (Tunnel Established!)
          const latencyMs = Math.round(performance.now() - start);
          if (data.length >= 2 && data[0] === 0x05 && data[1] === 0x00) {
            cleanup({
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: 'socks5',
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
  private checkSocks4(proxy: { id: string; ip: string; port: number; protocol: ProxyProtocol }): Promise<CheckResult> {
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
        // Send SOCKS4 Connect Request to 1.1.1.1:80: [0x04, 0x01, portHigh, portLow, ip0, ip1, ip2, ip3, 0x00]
        socket.write(Buffer.from([0x04, 0x01, 0x00, 0x50, 0x01, 0x01, 0x01, 0x01, 0x00]));
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
  private checkHttp(proxy: { id: string; ip: string; port: number; protocol: ProxyProtocol }): Promise<CheckResult> {
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
        socket.write(`GET http://cloudflare.com/cdn-cgi/trace HTTP/1.1\r\nHost: cloudflare.com\r\nConnection: close\r\n\r\n`);
      });

      socket.on('data', (data) => {
        const latencyMs = Math.round(performance.now() - start);
        const str = data.toString();

        if (str.startsWith('HTTP/1.') || str.includes('200 OK') || str.includes('ip=')) {
          let egressIp: string | undefined;
          const match = str.match(/ip=([^\r\n]+)/);
          if (match) egressIp = match[1]?.trim();

          cleanup({
            id: proxy.id,
            ip: proxy.ip,
            port: proxy.port,
            protocol: 'http',
            isAlive: true,
            latencyMs,
            egressIp,
            anonymity: egressIp === proxy.ip ? 'elite' : 'anonymous',
          });
        } else {
          cleanup({
            id: proxy.id,
            ip: proxy.ip,
            port: proxy.port,
            protocol: 'http',
            isAlive: false,
            latencyMs,
            error: 'Invalid HTTP proxy response',
          });
        }
      });

      socket.on('timeout', () => {
        cleanup({
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: 'http',
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
          isAlive: false,
          latencyMs: Math.round(performance.now() - start),
          error: err.message,
        });
      });
    });
  }
}

export const socketChecker = new SocketChecker();
