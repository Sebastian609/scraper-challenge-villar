export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  };

  const active = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: active }, () => worker()));

  return results;
}
