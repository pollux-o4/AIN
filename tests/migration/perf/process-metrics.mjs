import { readdir, readFile } from "node:fs/promises";

async function children(pid) {
  try {
    const tasks = await readdir(`/proc/${pid}/task`);
    const files = await Promise.all(
      tasks.map((task) => readFile(`/proc/${pid}/task/${task}/children`, "utf8").catch(() => "")),
    );
    return [...new Set(files.flatMap((file) => file.match(/\d+/g) ?? []).map(Number))];
  } catch {
    return [];
  }
}

async function processMetrics(pid, group, role) {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const smaps = await readFile(`/proc/${pid}/smaps_rollup`, "utf8").catch(() => "");
    const kb = (source, field) => {
      const result = source.match(new RegExp(`^${field}:\\s+(\\d+) kB`, "m"));
      return result ? Number(result[1]) : null;
    };
    return { pid, group, role, rssKiB: kb(status, "VmRSS"), pssKiB: kb(smaps, "Pss") };
  } catch {
    return null;
  }
}

export async function memorySnapshot(pid, runtime, extraRoots = []) {
  const visited = new Set();
  async function sample(pid, group, role, childRole) {
    if (visited.has(pid)) return [];
    visited.add(pid);
    const own = await processMetrics(pid, group, role);
    const descendants = await Promise.all(
      (await children(pid)).map((child) => sample(child, group, childRole, childRole)),
    );
    return [...(own ? [own] : []), ...descendants.flat()];
  }
  const groups = ["ain", "paseo", "agy"];
  const extra = await Promise.all(
    extraRoots.map(({ pid, group }) => sample(pid, group, group, group)),
  );
  const processes = [
    ...(await sample(pid, "ain", "ain", runtime === "node+n8n" ? "n8n" : "ain-child")),
    ...extra.flat(),
  ];
  function total(rows, field) {
    return rows.length && rows.every((row) => row[field] !== null)
      ? rows.reduce((sum, row) => sum + row[field], 0)
      : null;
  }
  const totals = (rows) => ({ rssKiB: total(rows, "rssKiB"), pssKiB: total(rows, "pssKiB") });
  return {
    processes,
    total: totals(processes),
    groups: Object.fromEntries(
      groups.map((group) => [group, totals(processes.filter((row) => row.group === group))]),
    ),
  };
}
