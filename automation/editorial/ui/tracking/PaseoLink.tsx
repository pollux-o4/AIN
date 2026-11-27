export function PaseoLink({ url }: { url?: string }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      Paseo에서 AI 실행 보기
    </a>
  ) : (
    <p className="hint">Paseo에서 AI 실행 상태를 확인해 주세요.</p>
  );
}
