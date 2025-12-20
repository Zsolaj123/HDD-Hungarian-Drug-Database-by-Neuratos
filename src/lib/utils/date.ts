/**
 * Date Utilities - Patient Workflow Canvas
 *
 * Day.js wrapper functions for consistent date handling.
 */
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isTomorrow from 'dayjs/plugin/isTomorrow';
import isYesterday from 'dayjs/plugin/isYesterday';
import relativeTime from 'dayjs/plugin/relativeTime';

// Extend dayjs with plugins
dayjs.extend(isToday);
dayjs.extend(isTomorrow);
dayjs.extend(isYesterday);
dayjs.extend(relativeTime);

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Format a date for display in the timeline.
 * Shows "Today", "Yesterday", or date format.
 */
export function formatTimelineDate(date: Date): string {
	const d = dayjs(date);

	if (d.isToday()) return 'Today';
	if (d.isYesterday()) return 'Yesterday';
	if (d.isTomorrow()) return 'Tomorrow';

	// If within the last 7 days, show day name
	const daysAgo = dayjs().diff(d, 'day');
	if (daysAgo > 0 && daysAgo < 7) {
		return d.format('dddd');
	}

	// Otherwise show full date
	return d.format('MMM D, YYYY');
}

/**
 * Format a date for day group headers.
 */
export function formatDayGroupDate(date: Date): string {
	const d = dayjs(date);

	if (d.isToday()) return 'Today';
	if (d.isYesterday()) return 'Yesterday';

	return d.format('ddd, MMM D');
}

/**
 * Format time for display.
 */
export function formatTime(date: Date): string {
	return dayjs(date).format('HH:mm');
}

/**
 * Format date and time together.
 */
export function formatDateTime(date: Date): string {
	return dayjs(date).format('MMM D, YYYY HH:mm');
}

/**
 * Get relative time string (e.g., "2 hours ago").
 */
export function getRelativeTime(date: Date): string {
	return dayjs(date).fromNow();
}

// ============================================================================
// Date Comparison
// ============================================================================

/**
 * Check if a date is today.
 */
export function isDateToday(date: Date): boolean {
	return dayjs(date).isToday();
}

/**
 * Check if a date is in the past.
 */
export function isDatePast(date: Date): boolean {
	return dayjs(date).isBefore(dayjs(), 'day');
}

/**
 * Check if a date is in the future.
 */
export function isDateFuture(date: Date): boolean {
	return dayjs(date).isAfter(dayjs(), 'day');
}

/**
 * Get the start of day for a date.
 */
export function startOfDay(date: Date): Date {
	return dayjs(date).startOf('day').toDate();
}

/**
 * Get the end of day for a date.
 */
export function endOfDay(date: Date): Date {
	return dayjs(date).endOf('day').toDate();
}

// ============================================================================
// Date Keys
// ============================================================================

/**
 * Get a date key string for grouping (YYYY-MM-DD format).
 */
export function getDateKey(date: Date): string {
	return dayjs(date).format('YYYY-MM-DD');
}

/**
 * Parse a date key back to a Date object.
 */
export function parseDateKey(dateKey: string): Date {
	return dayjs(dateKey, 'YYYY-MM-DD').toDate();
}

// ============================================================================
// Date Ranges
// ============================================================================

/**
 * Get today's date range (start and end).
 */
export function getTodayRange(): { start: Date; end: Date } {
	return {
		start: dayjs().startOf('day').toDate(),
		end: dayjs().endOf('day').toDate()
	};
}

/**
 * Get a date range for the past N days.
 */
export function getPastDaysRange(days: number): { start: Date; end: Date } {
	return {
		start: dayjs().subtract(days, 'day').startOf('day').toDate(),
		end: dayjs().endOf('day').toDate()
	};
}

// Re-export dayjs for advanced usage
export { dayjs };
