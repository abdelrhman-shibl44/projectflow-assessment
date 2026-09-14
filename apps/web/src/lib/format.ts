const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | Date): string {
  return DATE_FORMATTER.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return DATE_TIME_FORMATTER.format(new Date(value));
}

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** "5 minutes ago"-style labels; falls back to the absolute date for older items. */
export function formatRelativeTime(value: string | Date): string {
  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (Math.abs(diffMinutes) < 1) {
    return 'just now';
  }
  if (Math.abs(diffMinutes) < 60) {
    return RELATIVE_FORMATTER.format(diffMinutes, 'minute');
  }
  if (Math.abs(diffMinutes) < 24 * 60) {
    return RELATIVE_FORMATTER.format(Math.round(diffMinutes / 60), 'hour');
  }
  if (Math.abs(diffMinutes) < 30 * 24 * 60) {
    return RELATIVE_FORMATTER.format(Math.round(diffMinutes / (24 * 60)), 'day');
  }
  return formatDate(value);
}

/** Two-letter initials used by the avatar components. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
