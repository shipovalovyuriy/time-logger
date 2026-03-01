import { MAX_TOTAL_PERCENT } from './constants';

export const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const endOfDay = (date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

export const startOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);

export const endOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0, 0, 0, 0, 0);

export const addDays = (date, days) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);

export const addMonths = (date, months) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1, 0, 0, 0, 0);

export const differenceInCalendarDays = (left, right) => {
  const oneDay = 24 * 60 * 60 * 1000;
  const normalizedLeft = startOfDay(left).getTime();
  const normalizedRight = startOfDay(right).getTime();
  return Math.round((normalizedLeft - normalizedRight) / oneDay);
};

export const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

export const formatLegacyDate = (date) =>
  `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;

export const formatDateKey = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

export const formatUiDateKey = (value) => {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) {
    return String(value || '');
  }
  return `${day}.${month}.${year}`;
};

export const formatShortDate = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
};

export const formatMonthKey = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
};

export const toMonthLabel = (date) =>
  date
    .toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric'
    })
    .replace(/\s?г\.$/i, '');

export const formatSegmentLabel = (start, end) =>
  `${formatShortDate(start)} - ${formatShortDate(end)}`;

export const getSegmentKey = (start, end) => `${formatDateKey(start)}_${formatDateKey(end)}`;

export const isSegmentSummaryComplete = (summary) =>
  Boolean(summary) &&
  Number(summary.projectTotal) === MAX_TOTAL_PERCENT &&
  Number(summary.activityTotal) === MAX_TOTAL_PERCENT;

export const isSegmentElapsed = (segment, todayStart) =>
  Boolean(segment) && segment.weekEnd.getTime() < todayStart.getTime();

export const countPendingElapsedSegments = (segments, summaryByKey, todayStart) =>
  segments.reduce((count, segment) => {
    if (!isSegmentElapsed(segment, todayStart)) {
      return count;
    }

    const summaryKey = getSegmentKey(segment.weekStart, segment.weekEnd);
    return isSegmentSummaryComplete(summaryByKey?.[summaryKey]) ? count : count + 1;
  }, 0);

export const buildMonthSegments = (monthDate) => {
  const monthStart = startOfDay(startOfMonth(monthDate));
  const monthEnd = startOfDay(endOfMonth(monthDate));
  const totalDays = differenceInCalendarDays(monthEnd, monthStart) + 1;

  return Array.from({ length: 4 }).map((_, index) => {
    const startOffset = Math.floor((totalDays * index) / 4);
    const nextOffset = Math.floor((totalDays * (index + 1)) / 4);
    const segmentStart = addDays(monthStart, startOffset);
    const segmentEnd = addDays(monthStart, Math.max(startOffset, nextOffset - 1));

    return {
      id: formatDateKey(segmentStart),
      index: index + 1,
      weekStart: segmentStart,
      weekEnd: segmentEnd,
      label: formatSegmentLabel(segmentStart, segmentEnd)
    };
  });
};

export const resolveActiveSegmentIndex = (segments, activeDate) => {
  const activeKey = formatDateKey(activeDate);

  const foundIndex = segments.findIndex((segment) => {
    const startKey = formatDateKey(segment.weekStart);
    const endKey = formatDateKey(segment.weekEnd);
    return activeKey >= startKey && activeKey <= endKey;
  });

  return foundIndex >= 0 ? foundIndex : 0;
};

export const toLocalIso = (date, isEnd = false) => {
  const normalized = isEnd ? endOfDay(date) : startOfDay(date);
  const shifted = new Date(normalized.getTime() - normalized.getTimezoneOffset() * 60 * 1000);
  return shifted.toISOString();
};
