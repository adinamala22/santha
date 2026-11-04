/** One bar per star level, 5 first, scaled to the most common level. */
export function RatingBars({ distribution, label }: { distribution: readonly number[]; label: (stars: number, count: number) => string }) {
  const most = Math.max(0, ...distribution);
  return (
    <ul className="mt-4 max-w-md space-y-2" data-testid="rating-bars">
      {[5, 4, 3, 2, 1].map((stars) => {
        const n = distribution[stars - 1] ?? 0;
        return (
          <li key={stars} className="flex items-center gap-3 text-sm text-slate" aria-label={label(stars, n)}>
            <span aria-hidden="true" className="w-8 shrink-0">
              {stars} ★
            </span>
            <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-indigo-100">
              <span className="block h-full rounded-full bg-marigold" style={{ width: `${most ? (n / most) * 100 : 0}%` }} />
            </span>
            <span aria-hidden="true" className="w-8 shrink-0 text-right">
              {n}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
