let adapter;
let starting;
let stopping;
const options = {
  start: async ({ path, config }) => {
    if (starting || stopping) throw new Error("Adapter already started or stopping");
    starting = import(path).then(({ start }) => start(config));
    adapter = await starting;
    const { url, pid, runtime, diagnostics, extraRoots } = adapter;
    return { url, pid, runtime, diagnostics, extraRoots };
  },
  counts: () => adapter.counts(),
  traces: () => adapter.traces(),
  clean: () => adapter.clean(),
  seedAndRecover: (id) => adapter.seedAndRecover(id),
  stop: () => {
    stopping ??= (async () => {
      const active = adapter ?? (await starting?.catch(() => null));
      await active?.stop();
    })();
    return stopping;
  },
};
process.once("disconnect", () => {
  void options.stop().catch(() => {});
});
process.on("message", async ({ id, operation, argument }) => {
  try {
    const value = await options[operation](argument);
    if (!process.connected) return;
    process.send({ id, value }, () => {
      if (operation === "stop" && process.connected) process.disconnect();
    });
  } catch (error) {
    if (process.connected) process.send({ id, error: error.message });
  }
});
