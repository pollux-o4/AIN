import { constants, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { canonical, legacyDefault, root } from "./settings.mjs";

const legacyScript = /\/automation\/(?:runtime\/(?:server|start)|editorial\/start)\.mjs$/;

export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  try {
    const path = `/proc/${pid}`;
    const proc = readFileSync(join(path, "stat"), "utf8");
    const fields = proc.slice(proc.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || !/^\d+$/.test(fields[19] ?? "")) return null;
    const executable = statSync(join(path, "exe"), { bigint: true });
    return {
      pid,
      ticks: fields[19],
      image: `${executable.dev}:${executable.ino}`,
      cwd: readlinkSync(join(path, "cwd")),
      argv: readFileSync(join(path, "cmdline"), "utf8").split("\0").slice(0, -1),
    };
  } catch {
    return null;
  }
}

export function imageOf(path) {
  const file = statSync(path, { bigint: true });
  return `${file.dev}:${file.ino}`;
}

export function matchesProcess(record) {
  const found = processIdentity(record?.pid);
  return Boolean(
    found &&
      found.ticks === record.ticks &&
      found.image === record.image &&
      found.cwd === root &&
      found.argv[0] === record.binary &&
      Array.isArray(record.args) &&
      record.args.length === found.argv.length - 1 &&
      record.args.every((arg, index) => found.argv[index + 1] === arg) &&
      record.args[record.args.indexOf("-data") + 1] === record.data &&
      record.args[record.args.indexOf("-listen") + 1] === record.listen,
  );
}

export function readProcess(cfg) {
  let record;
  try {
    const file = lstatSync(cfg.pidFile);
    if (!file.isFile() || (file.mode & 0o077) !== 0)
      throw Error("프로세스 기록의 권한 또는 파일 형식이 올바르지 않습니다.");
    record = JSON.parse(
      readFileSync(cfg.pidFile, {
        encoding: "utf8",
        flag: constants.O_RDONLY | constants.O_NOFOLLOW,
      }),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return matchesProcess(record) ? record : null;
}

export function legacyWriter(data) {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const proc = `/proc/${pid}`;
      const args = readFileSync(join(proc, "cmdline"), "utf8").split("\0").slice(0, -1);
      if (!/^node(?:js)?$/.test(basename(args[0] ?? ""))) continue;
      const cwd = readlinkSync(join(proc, "cwd"));
      const script = args
        .slice(1)
        .map((arg) => resolve(cwd, arg))
        .find((arg) => legacyScript.test(arg));
      if (!script) continue;
      let env = [];
      try {
        env = readFileSync(join(proc, "environ"), "utf8").split("\0");
      } catch {
        // The default path is still known for this recognized writer.
      }
      const custom = env
        .find((item) => item.startsWith("AIN_DATA_DIR="))
        ?.slice("AIN_DATA_DIR=".length);
      const owner = dirname(dirname(dirname(script)));
      if (canonical(custom || legacyDefault(owner), cwd) === data) return pid;
    } catch {
      // The process stopped or belongs to an inaccessible user.
    }
  }
  return null;
}

export function ownsListener(record) {
  if (!matchesProcess(record)) return false;
  try {
    const port = Number(record.listen.split(":").at(-1));
    const target = `0100007F:${port.toString(16).padStart(4, "0").toUpperCase()}`;
    const inodes = new Set(
      readFileSync("/proc/net/tcp", "utf8")
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((line) => line[1] === target && line[3] === "0A")
        .map((line) => `socket:[${line[9]}]`),
    );
    const path = `/proc/${record.pid}/fd`;
    return readdirSync(path).some((fd) => {
      try {
        return inodes.has(readlinkSync(join(path, fd)));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
