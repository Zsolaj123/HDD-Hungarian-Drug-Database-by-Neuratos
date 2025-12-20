/**
 * Creates a throttled version of a function that only executes
 * at most once every `limit` milliseconds.
 */
export function throttle<T extends (...args: unknown[]) => void>(
	fn: T,
	limit: number
): (...args: Parameters<T>) => void {
	let inThrottle = false;

	return (...args: Parameters<T>) => {
		if (!inThrottle) {
			fn(...args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
}
