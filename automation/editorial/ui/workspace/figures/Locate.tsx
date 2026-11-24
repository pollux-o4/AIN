import { Icon } from "../../shared/Icon";

type LocateProps = { id: string; onLocate: (id: string) => void };

// 본문 속 그 자리로 이동 · 도크의 모든 그림 단계가 같은 단추를 쓴다
export function LocateButton({
  id,
  onLocate,
  className = "quiet",
}: LocateProps & { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => onLocate(id)}>
      <Icon name="eye" /> 본문에서 보기
    </button>
  );
}

// 그림이 놓일 앵커 문장과 이동 단추 · 단추를 인용문 글줄 밖에 둔다
export function AnchorQuote({ text, ...locate }: LocateProps & { text: string }) {
  return (
    <blockquote className="figure-anchor">
      <q>{text}</q>
      <LocateButton {...locate} />
    </blockquote>
  );
}
