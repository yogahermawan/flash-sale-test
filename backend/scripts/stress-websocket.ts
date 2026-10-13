import WebSocket from 'ws';
export async function waitForFinal(
  baseUrl: string,
  attemptId: string,
  userId: string,
): Promise<{ outcome: string; orderId?: string }> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let done = false;
    const timer = setTimeout(
      () => finish(new Error('Final status timeout')),
      30_000,
    );
    function finish(
      error?: Error,
      value?: { outcome: string; orderId?: string },
    ) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(retry);
      socket?.close();
      if (error) reject(error);
      else resolve(value!);
    }
    function connect() {
      if (done) return;
      const url = new URL(`/api/purchases/${attemptId}/events`, baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('userId', userId);
      socket = new WebSocket(url);
      socket.on('message', (raw) => {
        try {
          const result = JSON.parse(raw.toString());
          if (result.attemptId !== attemptId)
            return finish(new Error('Wrong attempt'));
          if (result.outcome !== 'processing') finish(undefined, result);
        } catch (error) {
          finish(error as Error);
        }
      });
      socket.on('error', () => socket.close());
      socket.on('close', (code) => {
        if (done) return;
        if (code === 1008) return finish(new Error('Attempt unavailable'));
        retry = setTimeout(connect, 500);
      });
    }
    connect();
  });
}
