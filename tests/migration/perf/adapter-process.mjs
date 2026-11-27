let adapter;
const options = {
  start: async ({ path, config }) => {
    if (adapter) throw new Error("Adapter already started");
    const { start } = await import(path);
    adapter = await start(config);
    const { url, pid, runtime, diagnostics, extraRoots } = adapter;
    return { url, pid, runtime, diagnostics, extraRoots };
  },
  counts: () => adapter.counts(),
  traces: () => adapter.traces(),
  clean: () => adapter.clean(),
  seedAndRecover: (id) => adapter.seedAndRecover(id),
  stop: () => adapter?.stop(),
};
process.once("disconnect", () => {
  void options.stop();
});
process.on("message", async ({ id, operation, argument }) => {
  try {
    const value = await options[operation](argument);
    process.send({ id, value }, () => {
      if (operation === "stop") process.disconnect();
    });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
