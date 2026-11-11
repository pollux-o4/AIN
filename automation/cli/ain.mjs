#!/usr/bin/env node
// AIN 에이전트 CLI 진입점 · 사용법은 USAGE · AGENT-001
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AGENT_TOKEN_FILE, DEFAULT_RUNTIME_URL } from "../contracts/runtime.mjs";
import { AinClient, CliError } from "./client.mjs";
import { commands } from "./commands.mjs";

export const USAGE = `ain <명령> [인자] · 출력 JSON(download는 TXT)
  list                                   작업 목록
  show <id> [--text]                     상태·가능한 동작 (--text: 본문 포함)
  history <id>                           작성·수정 과정
  new --idea <글감> [--mode m] [--level l] [--source t | --source-file f]   초안 요청(AI 비용)
  wait <id> [--timeout 초]               진행 종료까지 대기 후 본문 포함 요약
  feedback <id> <수정 내용>              수정 요청(AI 비용)
  pause|resume|complete-requirements|satisfy|authorize-publication <id>
  download <id> [--revision n]           TXT 출력
  delete <id>                            목록에서 삭제(원고 보존)`;

export async function main(argv, io) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries(
      ["idea", "mode", "level", "source", "source-file", "revision", "timeout", "interval"]
        .map((name) => [name, { type: "string" }])
        .concat([["text", { type: "boolean" }]]),
    ),
    strict: false,
  });
  const [name, ...args] = positionals;
  const command = commands[name];
  if (!command) return { code: name ? 2 : 0, out: USAGE };
  const client = await io.client();
  const result = await command(client, args, values, io);
  return { code: 0, out: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const io = {
    readFile,
    sleep: delay,
    client: async () => {
      const path = join(
        process.env.AIN_RUNTIME_DIR ?? resolve(".local/ai-runtime"),
        AGENT_TOKEN_FILE,
      );
      const token = await readFile(path, "utf8").catch(() => {
        throw new CliError(
          `에이전트 토큰이 없습니다: ${path} · \`mise run editorial\`로 서비스를 한 번 시작해 주세요.`,
        );
      });
      return new AinClient({
        baseUrl: process.env.AIN_URL ?? DEFAULT_RUNTIME_URL,
        token: token.trim(),
      });
    },
  };
  try {
    const { code, out } = await main(process.argv.slice(2), io);
    (code ? process.stderr : process.stdout).write(`${out}\n`);
    process.exitCode = code;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    process.stderr.write(`${JSON.stringify({ error: error.message, status: error.status })}\n`);
    process.exitCode = 1;
  }
}
