/**
 * Runs an async function over a list a few items at a time: faster than one by one, without
 * opening thousands of files at once. Results keep the order of the input.
 */
export async function mapInChunks<T, R>(
  items: readonly T[],
  chunkSize: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    results.push(...(await Promise.all(chunk.map(task))));
  }
  return results;
}
