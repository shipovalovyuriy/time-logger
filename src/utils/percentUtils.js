import { MAX_TOTAL_PERCENT, SEGMENT_STEP, PROJECT_COLORS } from './constants';

export const clampPercent = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

export const snapToSegmentPercent = (value) => {
  const normalized = clampPercent(value);
  return Math.round(normalized / SEGMENT_STEP) * SEGMENT_STEP;
};

export const sumPercentMap = (map) =>
  Object.values(map).reduce((sum, value) => sum + (Number(value) || 0), 0);

export const getProjectColor = (index) => PROJECT_COLORS[index % PROJECT_COLORS.length];

export const normalizeProjectPercents = (projects, rawByProjectId) => {
  const normalized = {};

  projects.forEach((project) => {
    normalized[project.id] = snapToSegmentPercent(rawByProjectId[project.id] || 0);
  });

  let total = sumPercentMap(normalized);

  if (total > MAX_TOTAL_PERCENT) {
    const sortedIds = [...projects]
      .sort(
        (left, right) =>
          (normalized[right.id] || 0) - (normalized[left.id] || 0) ||
          left.id - right.id
      )
      .map((project) => project.id);

    while (total > MAX_TOTAL_PERCENT) {
      let adjusted = false;
      for (let index = 0; index < sortedIds.length && total > MAX_TOTAL_PERCENT; index += 1) {
        const projectId = sortedIds[index];
        if ((normalized[projectId] || 0) <= 0) {
          continue;
        }
        normalized[projectId] -= SEGMENT_STEP;
        total -= SEGMENT_STEP;
        adjusted = true;
      }
      if (!adjusted) break;
    }
  }

  return normalized;
};

export const isEqualByKeys = (leftMap, rightMap, keys) =>
  keys.every((key) => Number(leftMap[key] || 0) === Number(rightMap[key] || 0));

export const safeIntegerHours = (value) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw));
};

export const bucketLabel = (bucket) => (Number(bucket) === 2 ? 'Over' : 'Work');

export const toPositiveInt = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.trunc(number);
};
