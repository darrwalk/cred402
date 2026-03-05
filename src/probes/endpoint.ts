import http from 'http';
import https from 'https';

export interface ProbeResult {
  reachable: boolean;
  latencyMs: number;
}

export async function probeEndpoint(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { reachable: false, latencyMs: 0 };
  }

  const start = Date.now();
  const lib = url.startsWith('https://') ? https : http;

  return new Promise<ProbeResult>((resolve) => {
    const req = lib.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
      const latencyMs = Date.now() - start;
      const reachable = res.statusCode !== undefined && res.statusCode < 500;
      res.resume();
      resolve({ reachable, latencyMs });
    });

    req.on('error', () => {
      resolve({ reachable: false, latencyMs: Date.now() - start });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, latencyMs: timeoutMs });
    });

    req.end();
  });
}
