import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { frame } from "../../../automation/paseo/prompts/frame.mjs";
import { fixtureReply, idea } from "./fixture.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const go = promisify(execFile);

function reply(stage, ids = []) {
  return fixtureReply(
    frame({ id: stage, role: "illustrator", task: "합성 시험", example: {}, data: { candidates: ids.map((id) => ({ id })) } }),
  );
}

function seedReplies() {
  return Object.fromEntries([
    ...["diagnose", "topic", "audience", "value", "research", "outline", "draft", "review"].map(
      (stage) => [stage, reply(stage)],
    ),
    ["figure_plan", reply("figure_plan")],
    ["figure_compose", reply("figure_compose", ["f1", "f2"])],
    ...["f1", "f2"].map((id) => [`figure/${id}`, reply("figure", [id])]),
  ]);
}

export async function start(config) {
  const binary = join(config.root, "ain-go-perf");
  await go("go", ["-C", join(repo, "backend"), "build", "-o", binary, "./tools/perffixture"]);
  const { stdout: goVersion } = await go("go", ["version"]);
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  const calls = new Map();
  let sequence = 0;
  let diagnostic = "";
  child.stderr.setEncoding("utf8").on("data", (text) => {
    diagnostic = (diagnostic + text).slice(-2048);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      child.kill("SIGTERM");
      return;
    }
    const next = calls.get(message.id);
    if (!next) return;
    calls.delete(message.id);
    if (message.error) next.reject(new Error(message.error));
    else next.resolve(message.value);
  });
  const closed = once(child, "close");
  closed.then(
    ([status]) => {
      for (const { reject } of calls.values())
        reject(new Error(diagnostic.trim() || `Go fixture exited (${status ?? "signal"})`));
      calls.clear();
    },
    (error) => {
      for (const { reject } of calls.values()) reject(error);
      calls.clear();
    },
  );

  function command(operation, argument) {
    if (child.exitCode !== null || child.killed) throw new Error("Go fixture is not running");
    const id = ++sequence;
    const answer = new Promise((resolve, reject) => calls.set(id, { resolve, reject }));
    child.stdin.write(JSON.stringify({ id, operation, argument }) + "\n");
    return answer;
  }

  let stopping;
  function stop() {
    stopping ??= (async () => {
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        if (child.exitCode === null && !child.killed) await command("stop");
      } finally {
        child.stdin.end();
        await closed.catch(() => {});
        clearTimeout(deadline);
        lines.close();
      }
    })();
    return stopping;
  }

  try {
    const ready = new Promise((resolve, reject) => calls.set(0, { resolve, reject }));
    child.stdin.write(
      JSON.stringify({
        ...config,
        idea,
        assets: join(repo, ".local", "editorial-web"),
        replies: seedReplies(),
      }) + "\n",
    );
    const { url } = await ready;
    return {
      url,
      pid: child.pid,
      runtime: "go",
      diagnostics: { logLevel: "error", go: goVersion.trim(), workers: 4, paseo: "synthetic" },
      counts: () => command("counts"),
      traces: () => command("traces"),
      clean: () => command("clean"),
      seedAndRecover: (id) => command("seedAndRecover", id),
      stop,
    };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
