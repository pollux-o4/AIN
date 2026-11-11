export function streamActivity(res, service, id) {
  let stop = () => {},
    closed = false,
    blocked = false,
    pending;
  const send = (frame) => {
    if (closed) return;
    if (blocked) {
      pending = frame;
      return;
    }
    blocked = !res.write(frame);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    stop();
  };
  const heartbeat = setInterval(() => {
    if (!blocked) send(": keepalive\n\n");
  }, 15000);
  res.on("close", close);
  res.on("drain", () => {
    blocked = false;
    if (pending) {
      const frame = pending;
      pending = null;
      send(frame);
    }
  });
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    stop = service.observeActivity(id, (snapshot) => {
      send(`event: activity\ndata: ${JSON.stringify(snapshot)}\n\n`);
    });
    if (closed) stop();
    else res.flushHeaders();
  } catch (error) {
    close();
    throw error;
  }
}
