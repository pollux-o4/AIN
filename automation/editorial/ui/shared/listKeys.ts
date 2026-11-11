// 같은 내용의 중복 항목도 서버 순서 내 출현 횟수로 구분한다.
export function withOccurrenceKeys<T>(items: readonly T[]) {
  const counts = new Map<string, number>();
  return items.map((value) => {
    const identity = JSON.stringify(value);
    const occurrence = counts.get(identity) ?? 0;
    counts.set(identity, occurrence + 1);
    return { value, key: `${identity}:${occurrence}` };
  });
}
