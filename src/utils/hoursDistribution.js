import { DAY_CAPACITY_HOURS, MAX_TOTAL_PERCENT, SEGMENT_STEP } from './constants';
import { startOfDay, addDays, formatDateKey, isWeekend } from './dateUtils';
import { clampPercent, snapToSegmentPercent, sumPercentMap, normalizeProjectPercents } from './percentUtils';

export const roundByLargestRemainder = (items, targetTotal) => {
  const roundedTarget = Math.max(0, Math.round(targetTotal));
  const baseMap = {};
  let baseTotal = 0;

  const fractions = items.map(({ key, raw }) => {
    const sanitized = Math.max(0, Number.isFinite(raw) ? raw : 0);
    const floorValue = Math.floor(sanitized);
    baseMap[key] = floorValue;
    baseTotal += floorValue;
    return {
      key,
      fraction: sanitized - floorValue
    };
  });

  let remainder = roundedTarget - baseTotal;

  if (remainder > 0) {
    const positive = [...fractions].sort(
      (left, right) => right.fraction - left.fraction || left.key - right.key
    );
    for (let index = 0; index < positive.length && remainder > 0; index += 1) {
      baseMap[positive[index].key] += 1;
      remainder -= 1;
      if (index === positive.length - 1 && remainder > 0) {
        index = -1;
      }
    }
  } else if (remainder < 0) {
    const negative = [...fractions].sort(
      (left, right) => left.fraction - right.fraction || right.key - left.key
    );
    for (let index = 0; index < negative.length && remainder < 0; index += 1) {
      const itemKey = negative[index].key;
      if ((baseMap[itemKey] || 0) <= 0) {
        continue;
      }
      baseMap[itemKey] -= 1;
      remainder += 1;
      if (index === negative.length - 1 && remainder < 0) {
        index = -1;
      }
    }
  }

  return baseMap;
};

export const buildWorkingDays = (rangeStart, rangeEnd) => {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  const days = [];
  let cursor = start;

  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) {
      days.push({
        date: new Date(cursor),
        dayKey: formatDateKey(cursor),
        capacityHours: DAY_CAPACITY_HOURS
      });
    }
    cursor = addDays(cursor, 1);
  }

  return days;
};

export const buildProjectHoursFromPercents = (projects, percentByProject, capacityHours) => {
  const safeCapacity = Math.max(0, Math.round(capacityHours));

  if (safeCapacity <= 0) {
    return projects.map((project) => ({
      projectId: project.id,
      hours: 0
    }));
  }

  const rawValues = projects.map((project) => ({
    key: project.id,
    raw: (safeCapacity * clampPercent(percentByProject[project.id] || 0)) / MAX_TOTAL_PERCENT
  }));
  const targetTotalHours = Math.round(rawValues.reduce((sum, item) => sum + item.raw, 0));
  const roundedHoursByProject = roundByLargestRemainder(rawValues, targetTotalHours);

  return projects.map((project) => ({
    projectId: project.id,
    hours: Math.max(0, roundedHoursByProject[project.id] || 0)
  }));
};

export const distributeHoursAcrossDays = (projectHours, workingDays) => {
  const dayRemaining = workingDays.map((day) => day.capacityHours);
  const result = {};

  const queue = [...projectHours]
    .map((item) => ({ ...item, hours: Math.max(0, Math.round(item.hours)) }))
    .sort((left, right) => right.hours - left.hours || left.projectId - right.projectId);

  queue.forEach((project) => {
    const byDay = {};
    workingDays.forEach((day) => {
      byDay[day.dayKey] = 0;
    });

    for (let hour = 0; hour < project.hours; hour += 1) {
      let bestDayIndex = -1;
      let bestRemaining = -1;

      for (let index = 0; index < workingDays.length; index += 1) {
        if (dayRemaining[index] > bestRemaining) {
          bestRemaining = dayRemaining[index];
          bestDayIndex = index;
        }
      }

      if (bestDayIndex < 0 || bestRemaining <= 0) {
        break;
      }

      const dayKey = workingDays[bestDayIndex].dayKey;
      byDay[dayKey] += 1;
      dayRemaining[bestDayIndex] -= 1;
    }

    result[project.projectId] = byDay;
  });

  return result;
};

export const buildProjectFactsPayload = (memberId, projects, percentByProject, rangeStart, rangeEnd) => {
  const workingDays = buildWorkingDays(rangeStart, rangeEnd);
  const totalCapacity = workingDays.reduce((sum, day) => sum + day.capacityHours, 0);
  const projectHours = buildProjectHoursFromPercents(projects, percentByProject, totalCapacity);
  const distributed = distributeHoursAcrossDays(projectHours, workingDays);
  const items = [];

  projects.forEach((project) => {
    workingDays.forEach((day) => {
      items.push({
        member_id: memberId,
        project_id: project.id,
        work_day: day.dayKey,
        work_hour: Math.max(0, distributed[project.id]?.[day.dayKey] || 0)
      });
    });
  });

  return items;
};

export const buildProjectPrefill = (projects, rangeRows, rangeStart, rangeEnd) => {
  const workingDays = buildWorkingDays(rangeStart, rangeEnd);
  const totalCapacity = workingDays.reduce((sum, day) => sum + day.capacityHours, 0);
  const startKey = formatDateKey(rangeStart);
  const endKey = formatDateKey(rangeEnd);
  const allowedProjects = new Set(projects.map((project) => project.id));
  const workHoursByProject = {};

  rangeRows.forEach((row) => {
    const projectId = Number(row?.project_id);
    if (!Number.isFinite(projectId) || !allowedProjects.has(projectId)) {
      return;
    }

    const day = row?.work_day ? startOfDay(new Date(row.work_day)) : null;
    if (!day || Number.isNaN(day.getTime())) {
      return;
    }
    const dayKey = formatDateKey(day);
    if (dayKey < startKey || dayKey > endKey) {
      return;
    }

    const workHour = Number(row?.work_hour ?? 0);
    if (!Number.isFinite(workHour) || workHour <= 0) {
      return;
    }

    workHoursByProject[projectId] = (workHoursByProject[projectId] || 0) + workHour;
  });

  const rawByProjectId = {};
  let totalRaw = 0;

  projects.forEach((project) => {
    const projectHours = workHoursByProject[project.id] || 0;
    const rawPercent = totalCapacity > 0 ? (projectHours / totalCapacity) * 100 : 0;
    rawByProjectId[project.id] = rawPercent;
    totalRaw += rawPercent;
  });

  if (totalRaw > MAX_TOTAL_PERCENT) {
    const normalizationFactor = MAX_TOTAL_PERCENT / totalRaw;
    projects.forEach((project) => {
      rawByProjectId[project.id] = rawByProjectId[project.id] * normalizationFactor;
    });
  }

  return normalizeProjectPercents(projects, rawByProjectId);
};

export const buildActivityPrefill = (activityTypes, weeklyDistribution) => {
  const percentByType = {};

  weeklyDistribution.forEach((item) => {
    if (!item?.activity_type) return;
    percentByType[item.activity_type] = clampPercent(Number(item.percent) || 0);
  });

  const rawByCode = {};
  activityTypes.forEach((type) => {
    rawByCode[type.code] = percentByType[type.code] || 0;
  });

  const normalized = {};
  activityTypes.forEach((type) => {
    normalized[type.code] = snapToSegmentPercent(rawByCode[type.code] || 0);
  });

  let total = sumPercentMap(normalized);
  if (total > MAX_TOTAL_PERCENT) {
    const sortedCodes = [...activityTypes]
      .sort(
        (left, right) =>
          (normalized[right.code] || 0) - (normalized[left.code] || 0) ||
          left.code.localeCompare(right.code)
      )
      .map((item) => item.code);

    while (total > MAX_TOTAL_PERCENT) {
      let adjusted = false;
      for (let index = 0; index < sortedCodes.length && total > MAX_TOTAL_PERCENT; index += 1) {
        const code = sortedCodes[index];
        if ((normalized[code] || 0) <= 0) {
          continue;
        }
        normalized[code] -= SEGMENT_STEP;
        total -= SEGMENT_STEP;
        adjusted = true;
      }
      if (!adjusted) break;
    }
  }

  return normalized;
};

export const buildSegmentDataEntry = ({
  projects,
  activityTypes,
  rangeRows,
  weeklyDistribution,
  isLocked,
  rangeStart,
  rangeEnd
}) => {
  const projectPercents = buildProjectPrefill(projects, rangeRows, rangeStart, rangeEnd);
  const activityPercents = buildActivityPrefill(activityTypes, weeklyDistribution);
  const projectTotal = sumPercentMap(projectPercents);
  const activityTotal = sumPercentMap(activityPercents);

  return {
    projectPercents,
    activityPercents,
    projectTotal,
    activityTotal,
    isLocked: Boolean(isLocked)
  };
};
