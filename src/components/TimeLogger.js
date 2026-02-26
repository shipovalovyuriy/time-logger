import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import storage from '../utils/storage';
import './TimeLogger.css';

const API_BASE = 'https://test.newpulse.pkz.icdc.io';
const MAX_TOTAL_PERCENT = 100;
const SEGMENT_STEP = 10;
const DAY_CAPACITY_HOURS = 8;
const WORK_BUCKET = 1;
const OVER_BUCKET = 2;
const DOUBLE_TAP_THRESHOLD_MS = 320;
const REWARD_ANIMATION_MS = 1100;

const PROJECT_COLORS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#818cf8',
  '#f472b6',
  '#2dd4bf',
  '#f97316',
  '#a3e635',
  '#e879f9'
];

const DEFAULT_ACTIVITY_TYPES = [
  { code: 'delivery', name_ru: 'Разработка' },
  { code: 'meetings_coordination', name_ru: 'Встречи и согласования' },
  { code: 'support_incidents', name_ru: 'Саппорт и инциденты' },
  { code: 'improvement_tech_debt', name_ru: 'Улучшения и техдолг' },
  { code: 'internal_processes', name_ru: 'Внутренние процессы' },
  { code: 'presales_commercial', name_ru: 'Пресейл и коммерция' },
  { code: 'research_discovery', name_ru: 'Исследования' },
  { code: 'blocked_waiting', name_ru: 'Ожидание и блокеры' }
];

const clampPercent = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const snapToSegmentPercent = (value) => {
  const normalized = clampPercent(value);
  return Math.round(normalized / SEGMENT_STEP) * SEGMENT_STEP;
};

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const startOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);

const endOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0, 0, 0, 0, 0);

const addDays = (date, days) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);

const differenceInCalendarDays = (left, right) => {
  const oneDay = 24 * 60 * 60 * 1000;
  const normalizedLeft = startOfDay(left).getTime();
  const normalizedRight = startOfDay(right).getTime();
  return Math.round((normalizedLeft - normalizedRight) / oneDay);
};

const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const formatLegacyDate = (date) =>
  `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;

const formatDateKey = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const formatUiDateKey = (value) => {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) {
    return String(value || '');
  }
  return `${day}.${month}.${year}`;
};

const formatShortDate = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
};

const formatSegmentLabel = (start, end) =>
  `${formatShortDate(start)} - ${formatShortDate(end)}`;

const getSegmentKey = (start, end) => `${formatDateKey(start)}_${formatDateKey(end)}`;

const buildMonthSegments = (monthDate) => {
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

const isSegmentElapsed = (segment, todayStart) =>
  Boolean(segment) && segment.weekEnd.getTime() < todayStart.getTime();

const resolveActiveSegmentIndex = (segments, activeDate) => {
  const activeKey = formatDateKey(activeDate);

  const foundIndex = segments.findIndex((segment) => {
    const startKey = formatDateKey(segment.weekStart);
    const endKey = formatDateKey(segment.weekEnd);
    return activeKey >= startKey && activeKey <= endKey;
  });

  return foundIndex >= 0 ? foundIndex : 0;
};

const toLocalIso = (date, isEnd = false) => {
  const normalized = isEnd ? endOfDay(date) : startOfDay(date);
  const shifted = new Date(normalized.getTime() - normalized.getTimezoneOffset() * 60 * 1000);
  return shifted.toISOString();
};

const sumPercentMap = (map) =>
  Object.values(map).reduce((sum, value) => sum + (Number(value) || 0), 0);

const getProjectColor = (index) => PROJECT_COLORS[index % PROJECT_COLORS.length];

const safeIntegerHours = (value) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw));
};

const bucketLabel = (bucket) => (Number(bucket) === OVER_BUCKET ? 'Over' : 'Work');

const extractResult = (payload) => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'result' in payload) {
    return payload.result;
  }
  return payload;
};

const getErrorMessageFromPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  return (
    payload.message ||
    payload.error ||
    payload?.data?.message ||
    payload?.result?.message ||
    ''
  );
};

const normalizeBearerToken = (tokenValue) => {
  const raw = String(tokenValue || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.toLowerCase().startsWith('bearer ')) {
    return raw;
  }
  return `Bearer ${raw}`;
};

const createAuthExpiredError = (statusCode) => {
  const error = new Error('Сессия истекла. Пожалуйста, войдите снова.');
  error.status = statusCode;
  error.code = 'AUTH_EXPIRED';
  error.isAuthError = true;
  return error;
};

const requestJson = async (url, options, fallbackMessage) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);

  if (response.status === 401 || response.status === 403) {
    storage.removeItem('token');
    throw createAuthExpiredError(response.status);
  }

  if (!response.ok) {
    const apiMessage = getErrorMessageFromPayload(payload);
    const error = new Error(apiMessage || `${fallbackMessage} (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return payload;
};

const normalizeProjectPercents = (projects, rawByProjectId) => {
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

const buildWorkingDays = (rangeStart, rangeEnd) => {
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

const roundByLargestRemainder = (items, targetTotal) => {
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

const buildProjectHoursFromPercents = (projects, percentByProject, capacityHours) => {
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

const distributeHoursAcrossDays = (projectHours, workingDays) => {
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

const buildProjectFactsPayload = (memberId, projects, percentByProject, rangeStart, rangeEnd) => {
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

const buildProjectPrefill = (projects, rangeRows, rangeStart, rangeEnd) => {
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

const buildActivityPrefill = (activityTypes, weeklyDistribution) => {
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

const buildSegmentDataEntry = ({
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

const isEqualByKeys = (leftMap, rightMap, keys) =>
  keys.every((key) => Number(leftMap[key] || 0) === Number(rightMap[key] || 0));

const toPositiveInt = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.trunc(number);
};

const getTelegramUserId = () => {
  const userId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
};

const fetchSessionMemberId = async (authToken) => {
  const payload = await requestJson(
    `${API_BASE}/auth-service/api/v1/check`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось получить данные текущей сессии'
  );

  const result = extractResult(payload);
  const candidates = [
    payload?.id,
    payload?.member_id,
    payload?.user_id,
    result?.id,
    result?.member_id,
    result?.user_id
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const parsed = toPositiveInt(candidates[index]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const extractTimesheetMode = (payload) => {
  const result = extractResult(payload);
  const candidates = [
    payload?.timesheet_mode,
    payload?.timesheetMode,
    result?.timesheet_mode,
    result?.timesheetMode
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const parsed = toPositiveInt(candidates[index]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const fetchSessionTimesheetMode = async (authToken) => {
  const payload = await requestJson(
    `${API_BASE}/auth-service/api/v1/check`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось получить данные текущей сессии'
  );

  return extractTimesheetMode(payload);
};

const resolveMemberId = async (authToken) => {
  const fromStorage = toPositiveInt(storage.getItem('userId'));
  if (fromStorage) {
    return fromStorage;
  }

  const fromSession = await fetchSessionMemberId(authToken);
  if (fromSession) {
    storage.setItem('userId', String(fromSession));
    return fromSession;
  }

  return null;
};

const fetchProjects = async (authToken, memberId, monthStart, monthEnd) => {
  const monthStartQuery = formatLegacyDate(monthStart);
  const monthEndQuery = formatLegacyDate(monthEnd);

  const payload = await requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/list?member_id=${memberId}&month_start=${monthStartQuery}&month_end=${monthEndQuery}`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось загрузить проекты'
  );

  const rows = Array.isArray(extractResult(payload))
    ? extractResult(payload)
    : Array.isArray(payload)
    ? payload
    : [];

  const seen = new Set();
  const parsed = [];

  rows.forEach((item) => {
    const sourceProject = item?.project || {};
    const projectId = Number(sourceProject?.id || item?.project_id);
    if (!Number.isFinite(projectId) || seen.has(projectId)) {
      return;
    }

    const isActive = item?.is_active !== false;
    const projectStatus = sourceProject?.project_status;
    if (!isActive) return;
    if (projectStatus && projectStatus !== 'Активный') return;

    seen.add(projectId);
    parsed.push({
      id: projectId,
      name:
        sourceProject?.project_name ||
        item?.project_name ||
        item?.project?.project_name ||
        `Проект ${projectId}`
    });
  });

  return parsed.map((project, index) => ({
    ...project,
    color: getProjectColor(index)
  }));
};

const fetchActivityTypes = async (authToken) => {
  try {
    const payload = await requestJson(
      `${API_BASE}/directory-service/api/v1/timesheet/activity-types?only_active=true`,
      {
        method: 'GET',
        headers: {
          Authorization: authToken,
          'Content-Type': 'application/json'
        }
      },
      'Не удалось загрузить типы активностей'
    );

    const rows = Array.isArray(extractResult(payload))
      ? extractResult(payload)
      : Array.isArray(payload)
      ? payload
      : [];

    const parsed = rows
      .filter((item) => item?.code)
      .sort((left, right) => {
        const leftOrder = Number(left?.sort_order || 0);
        const rightOrder = Number(right?.sort_order || 0);
        return leftOrder - rightOrder;
      })
      .map((item) => ({
        code: String(item.code),
        name_ru: item?.name_ru || String(item.code)
      }));

    return parsed.length > 0 ? parsed : DEFAULT_ACTIVITY_TYPES;
  } catch (error) {
    return DEFAULT_ACTIVITY_TYPES;
  }
};

const fetchRangeLite = async (authToken, memberId, projectIds, rangeStart, rangeEnd) => {
  if (!projectIds.length) {
    return [];
  }

  const payload = await requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/list/range-lite`,
    {
      method: 'POST',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        member_ids: [memberId],
        project_ids: projectIds,
        date_from: toLocalIso(rangeStart, false),
        date_to: toLocalIso(rangeEnd, true)
      })
    },
    'Не удалось загрузить факт отрезка'
  );

  return Array.isArray(extractResult(payload))
    ? extractResult(payload)
    : Array.isArray(payload)
    ? payload
    : [];
};

const fetchWeeklyActivityDistribution = async (authToken, memberId, rangeStart, rangeEnd) => {
  const payload = await requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/weekly-workload?member_id=${memberId}&week_start=${formatDateKey(
      rangeStart
    )}&week_end=${formatDateKey(rangeEnd)}`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось загрузить weekly распределение'
  );

  const result = extractResult(payload);
  if (!result || typeof result !== 'object') {
    return {
      activityDistribution: [],
      isLocked: false
    };
  }

  return {
    activityDistribution: Array.isArray(result?.activity_distribution)
      ? result.activity_distribution
      : [],
    isLocked: Boolean(result?.is_locked)
  };
};

const fetchProjectsShort = async (authToken, memberId) => {
  const payload = await requestJson(
    `${API_BASE}/project-service/api/v1/project/list/short?member_id=${memberId}`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось загрузить проекты'
  );

  const rows = Array.isArray(extractResult(payload))
    ? extractResult(payload)
    : Array.isArray(payload)
    ? payload
    : [];

  const seen = new Set();
  const parsed = [];

  rows.forEach((item, index) => {
    const projectId = Number(item?.id);
    if (!Number.isFinite(projectId) || projectId <= 0 || seen.has(projectId)) {
      return;
    }
    seen.add(projectId);

    parsed.push({
      id: projectId,
      name: item?.project_name || `Проект ${projectId}`,
      order: index
    });
  });

  return parsed;
};

const fetchActivityTypesFull = async (authToken) => {
  const payload = await requestJson(
    `${API_BASE}/directory-service/api/v1/timesheet/activity-types?only_active=true`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось загрузить типы активностей'
  );

  const rows = Array.isArray(extractResult(payload))
    ? extractResult(payload)
    : Array.isArray(payload)
    ? payload
    : [];

  const parsed = rows
    .filter((item) => Number(item?.id) > 0)
    .sort((left, right) => {
      const leftOrder = Number(left?.sort_order || 0);
      const rightOrder = Number(right?.sort_order || 0);
      return leftOrder - rightOrder;
    })
    .map((item) => ({
      id: Number(item.id),
      code: String(item.code || ''),
      name_ru: item?.name_ru || String(item.code || item.id),
      sort_order: Number(item?.sort_order || 0)
    }));

  if (parsed.length === 0) {
    throw new Error('Нет доступных типов активностей для логирования.');
  }

  return parsed;
};

const fetchTimeEntriesDay = async (authToken, memberId, spentOn) => {
  const payload = await requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/time-entries/day?member_id=${memberId}&spent_on=${spentOn}`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось загрузить worklogs'
  );

  const result = extractResult(payload);
  if (!result || typeof result !== 'object') {
    return {
      member_id: memberId,
      spent_on: spentOn,
      work_hour: 0,
      over_hour: 0,
      total_hour: 0,
      confirm_status_by_project_id: {},
      projects: []
    };
  }

  return {
    member_id: Number(result?.member_id || memberId),
    spent_on: String(result?.spent_on || spentOn),
    work_hour: Number(result?.work_hour || 0),
    over_hour: Number(result?.over_hour || 0),
    total_hour: Number(result?.total_hour || 0),
    confirm_status_by_project_id:
      result?.confirm_status_by_project_id && typeof result.confirm_status_by_project_id === 'object'
        ? result.confirm_status_by_project_id
        : {},
    projects: Array.isArray(result?.projects) ? result.projects : []
  };
};

const putTimeEntriesDay = async (authToken, body) =>
  requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/time-entries/day`,
    {
      method: 'PUT',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    'Не удалось сохранить worklog'
  );

const TimeLogger = () => {
  const telegramWebApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  const isTelegramWebApp = Boolean(telegramWebApp);

  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const [activeDate, setActiveDate] = useState(() => startOfDay(new Date()));
  const [step, setStep] = useState(1);
  const [timesheetMode, setTimesheetMode] = useState(null);

  const [projects, setProjects] = useState([]);
  const [activityTypes, setActivityTypes] = useState(DEFAULT_ACTIVITY_TYPES);
  const [projectPercentById, setProjectPercentById] = useState({});
  const [activityPercentByCode, setActivityPercentByCode] = useState({});
  const [initialProjectPercentById, setInitialProjectPercentById] = useState({});
  const [initialActivityPercentByCode, setInitialActivityPercentByCode] = useState({});
  const [segmentSummaryByKey, setSegmentSummaryByKey] = useState({});
  const [segmentDataByKey, setSegmentDataByKey] = useState({});

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [memberId, setMemberId] = useState(() => toPositiveInt(storage.getItem('userId')));
  const [rewardScope, setRewardScope] = useState(null);

  const [hoursActiveTab, setHoursActiveTab] = useState('add');
  const [hoursSelectedDate, setHoursSelectedDate] = useState(() =>
    formatDateKey(startOfDay(new Date()))
  );
  const [hoursProjectsShort, setHoursProjectsShort] = useState([]);
  const [hoursActivityTypesFull, setHoursActivityTypesFull] = useState([]);
  const [hoursDayEntries, setHoursDayEntries] = useState(null);
  const [hoursDraftEntry, setHoursDraftEntry] = useState(() => ({
    project_id: 0,
    activity_type_id: 0,
    bucket: WORK_BUCKET,
    hours: 0,
    comment: ''
  }));
  const [hoursEditingEntry, setHoursEditingEntry] = useState(null);
  const [hoursIsCatalogLoading, setHoursIsCatalogLoading] = useState(false);
  const [hoursIsDayLoading, setHoursIsDayLoading] = useState(false);
  const [hoursIsSaving, setHoursIsSaving] = useState(false);
  const [hoursError, setHoursError] = useState(null);
  const [hoursNotice, setHoursNotice] = useState(null);

  const paintRef = useRef({ active: false, scope: null, key: null });
  const tapRef = useRef({ rowKey: '', at: 0 });
  const loadRequestRef = useRef(0);
  const previousWeekKeyRef = useRef(null);
  const rewardTimerRef = useRef(null);
  const closeAfterSubmitTimerRef = useRef(null);
  const previousTotalsRef = useRef({
    project: 0,
    activity: 0
  });

  const monthStart = useMemo(() => startOfMonth(todayStart), [todayStart]);
  const monthEnd = useMemo(() => endOfMonth(todayStart), [todayStart]);
  const monthSegments = useMemo(() => buildMonthSegments(monthStart), [monthStart]);
  const activeSegmentIndex = useMemo(
    () => resolveActiveSegmentIndex(monthSegments, activeDate),
    [activeDate, monthSegments]
  );
  const latestElapsedSegment = useMemo(() => {
    for (let index = monthSegments.length - 1; index >= 0; index -= 1) {
      if (isSegmentElapsed(monthSegments[index], todayStart)) {
        return monthSegments[index];
      }
    }
    return null;
  }, [monthSegments, todayStart]);
  const activeSegment = monthSegments[activeSegmentIndex] || monthSegments[0] || null;
  const activeSegmentIsElapsed = isSegmentElapsed(activeSegment, todayStart);
  const activeSegmentPendingRelease = !activeSegmentIsElapsed;
  const weekStart = activeSegment?.weekStart || monthStart;
  const weekEnd = activeSegment?.weekEnd || monthEnd;
  const weekKey = useMemo(() => getSegmentKey(weekStart, weekEnd), [weekEnd, weekStart]);
  const activeSegmentIsLocked = Boolean(segmentDataByKey[weekKey]?.isLocked);

  const projectTotalPercent = useMemo(
    () => sumPercentMap(projectPercentById),
    [projectPercentById]
  );
  const activityTotalPercent = useMemo(
    () => sumPercentMap(activityPercentByCode),
    [activityPercentByCode]
  );

  const projectKeys = useMemo(
    () => projects.map((project) => String(project.id)),
    [projects]
  );
  const activityKeys = useMemo(
    () => activityTypes.map((type) => type.code),
    [activityTypes]
  );

  const hoursMinDate = useMemo(() => formatDateKey(monthStart), [monthStart]);
  const hoursMaxDate = useMemo(() => formatDateKey(todayStart), [todayStart]);
  const hoursMonthPrefix = useMemo(() => String(hoursMinDate).slice(0, 7), [hoursMinDate]);

  const hoursProjectOptions = useMemo(() => {
    const merged = new Map();

    hoursProjectsShort.forEach((project) => {
      if (!project?.id) return;
      merged.set(project.id, {
        project_id: project.id,
        project_name: project.name || `Проект ${project.id}`,
        order: project.order || 0
      });
    });

    if (hoursDayEntries?.projects && Array.isArray(hoursDayEntries.projects)) {
      hoursDayEntries.projects.forEach((project) => {
        const projectId = Number(project?.project_id);
        if (!Number.isFinite(projectId) || projectId <= 0 || merged.has(projectId)) {
          return;
        }

        merged.set(projectId, {
          project_id: projectId,
          project_name: project?.project_name || `Проект ${projectId}`,
          order: merged.size
        });
      });
    }

    return [...merged.values()].sort((left, right) => left.order - right.order);
  }, [hoursDayEntries?.projects, hoursProjectsShort]);

  useEffect(() => {
    if (timesheetMode !== 2) {
      return;
    }

    setHoursDraftEntry((prev) => ({
      ...prev,
      project_id: prev.project_id > 0 ? prev.project_id : hoursProjectOptions[0]?.project_id || 0,
      activity_type_id:
        prev.activity_type_id > 0 ? prev.activity_type_id : hoursActivityTypesFull[0]?.id || 0
    }));
  }, [hoursActivityTypesFull, hoursProjectOptions, timesheetMode]);

  useEffect(() => {
    if (timesheetMode !== 2) {
      return;
    }

    setHoursEditingEntry(null);
    setHoursDraftEntry((prev) => ({
      ...prev,
      hours: 0,
      comment: ''
    }));
    setHoursNotice(null);
  }, [hoursSelectedDate, timesheetMode]);

  useEffect(() => {
    if (timesheetMode !== 2) {
      return undefined;
    }

    const handleFocusIn = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!target.closest('.hours-summary, .hours-form')) {
        return;
      }

      window.setTimeout(() => {
        target.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth'
        });
      }, 180);
    };

    document.addEventListener('focusin', handleFocusIn);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [timesheetMode]);

  const isProjectComplete = projectTotalPercent === MAX_TOTAL_PERCENT;
  const isActivityComplete = activityTotalPercent === MAX_TOTAL_PERCENT;
  const isPeriodComplete = isProjectComplete && isActivityComplete;
  const canGoToStep2 =
    activeSegmentIsElapsed && !isLoading && !error && projects.length > 0 && isProjectComplete;

  const isDirty = useMemo(() => {
    if (!projectKeys.length && !activityKeys.length) {
      return false;
    }

    const projectChanged =
      projectKeys.length > 0 &&
      !isEqualByKeys(projectPercentById, initialProjectPercentById, projectKeys);
    const activityChanged =
      activityKeys.length > 0 &&
      !isEqualByKeys(activityPercentByCode, initialActivityPercentByCode, activityKeys);

    return projectChanged || activityChanged;
  }, [
    activityKeys,
    activityPercentByCode,
    initialActivityPercentByCode,
    initialProjectPercentById,
    projectKeys,
    projectPercentById
  ]);

  const activityRows = useMemo(
    () =>
      activityTypes.map((type, index) => ({
        id: type.code,
        name: type.name_ru,
        color: getProjectColor(index + 3),
        percent: activityPercentByCode[type.code] || 0
      })),
    [activityPercentByCode, activityTypes]
  );

  const projectRows = useMemo(
    () =>
      projects.map((project) => ({
        ...project,
        percent: projectPercentById[project.id] || 0
      })),
    [projectPercentById, projects]
  );

  useEffect(() => {
    const isAnotherMonth =
      activeDate.getFullYear() !== todayStart.getFullYear() ||
      activeDate.getMonth() !== todayStart.getMonth();

    if (activeDate.getTime() > todayStart.getTime() || isAnotherMonth) {
      setActiveDate(todayStart);
    }
  }, [activeDate, todayStart]);

  useEffect(() => {
    if (!latestElapsedSegment) {
      return;
    }
    if (activeSegmentIsElapsed) {
      return;
    }
    if (activeSegment?.id === latestElapsedSegment.id) {
      return;
    }

    setActiveDate(startOfDay(latestElapsedSegment.weekStart));
  }, [activeSegment?.id, activeSegmentIsElapsed, latestElapsedSegment]);

  useEffect(() => {
    const previousTotals = previousTotalsRef.current;
    let nextRewardScope = null;

    if (
      previousTotals.project !== MAX_TOTAL_PERCENT &&
      projectTotalPercent === MAX_TOTAL_PERCENT &&
      !isLoading
    ) {
      nextRewardScope = 'project';
    }

    if (
      previousTotals.activity !== MAX_TOTAL_PERCENT &&
      activityTotalPercent === MAX_TOTAL_PERCENT &&
      !isLoading
    ) {
      nextRewardScope = 'activity';
    }

    previousTotalsRef.current = {
      project: projectTotalPercent,
      activity: activityTotalPercent
    };

    if (nextRewardScope) {
      setRewardScope(nextRewardScope);
    }
  }, [activityTotalPercent, isLoading, projectTotalPercent]);

  useEffect(() => {
    if (!rewardScope) {
      return undefined;
    }

    if (rewardTimerRef.current) {
      window.clearTimeout(rewardTimerRef.current);
    }

    rewardTimerRef.current = window.setTimeout(() => {
      setRewardScope(null);
      rewardTimerRef.current = null;
    }, REWARD_ANIMATION_MS);

    return () => {
      if (rewardTimerRef.current) {
        window.clearTimeout(rewardTimerRef.current);
        rewardTimerRef.current = null;
      }
    };
  }, [rewardScope]);

  useEffect(
    () => () => {
      if (closeAfterSubmitTimerRef.current) {
        window.clearTimeout(closeAfterSubmitTimerRef.current);
        closeAfterSubmitTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    const stopPainting = () => {
      paintRef.current.active = false;
      paintRef.current.scope = null;
      paintRef.current.key = null;
      paintRef.current.pointerId = undefined;
    };

    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);

    return () => {
      window.removeEventListener('pointerup', stopPainting);
      window.removeEventListener('pointercancel', stopPainting);
    };
  }, []);

  useEffect(() => {
    if (!telegramWebApp) {
      return undefined;
    }

    telegramWebApp.expand();
    if (timesheetMode === 2) {
      telegramWebApp.enableVerticalSwipes?.();
      return undefined;
    }
    if (isSubmitted) {
      telegramWebApp.enableVerticalSwipes?.();
    } else {
      telegramWebApp.disableVerticalSwipes?.();
    }

    return () => {
      telegramWebApp.enableVerticalSwipes?.();
    };
  }, [isSubmitted, telegramWebApp, timesheetMode]);

  useEffect(() => {
    if (!telegramWebApp) {
      return undefined;
    }

    return () => {
      telegramWebApp.MainButton.hide();
      telegramWebApp.BackButton.hide();
    };
  }, [telegramWebApp]);

  const ensureMemberId = useCallback(
    async (authToken) => {
      if (memberId) {
        return memberId;
      }

      const resolved = await resolveMemberId(authToken);
      if (resolved) {
        setMemberId(resolved);
        return resolved;
      }

      return null;
    },
    [memberId]
  );

  const silentTelegramLogin = useCallback(async () => {
    const initData = String(telegramWebApp?.initData || '').trim();
    if (!initData) {
      return null;
    }

    try {
      const payload = await requestJson(
        `${API_BASE}/auth-service/api/v1/telegram/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            init_data: initData
          })
        },
        'Не удалось авторизоваться через Telegram'
      );

      const result = extractResult(payload);
      const tokenFromPayload =
        payload?.message ||
        payload?.token ||
        result?.message ||
        result?.token ||
        '';
      const bearerToken = normalizeBearerToken(tokenFromPayload);
      if (!bearerToken) {
        return null;
      }

      storage.setItem('token', bearerToken);

      const memberFromPayload = toPositiveInt(
        payload?.id ||
          payload?.value?.id ||
          payload?.member_id ||
          result?.id ||
          result?.value?.id ||
          result?.member_id
      );

      let resolvedMemberId = memberFromPayload;
      if (!resolvedMemberId) {
        resolvedMemberId = await fetchSessionMemberId(bearerToken);
      }

      if (resolvedMemberId) {
        storage.setItem('userId', String(resolvedMemberId));
        setMemberId(resolvedMemberId);
      }

      return bearerToken;
    } catch {
      return null;
    }
  }, [telegramWebApp]);

  const ensureAuthToken = useCallback(async () => {
    const existingToken = normalizeBearerToken(storage.getItem('token'));
    if (existingToken) {
      return existingToken;
    }

    return silentTelegramLogin();
  }, [silentTelegramLogin]);

  const resolveActiveSession = useCallback(async () => {
    let authToken = await ensureAuthToken();
    if (!authToken) {
      return null;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const resolvedMemberID = await ensureMemberId(authToken);
        if (resolvedMemberID) {
          return {
            token: authToken,
            memberId: resolvedMemberID
          };
        }
      } catch (error) {
        if (error?.isAuthError && attempt === 0) {
          const renewedToken = await silentTelegramLogin();
          if (renewedToken) {
            authToken = renewedToken;
            continue;
          }
        }
        throw error;
      }

      if (attempt === 0) {
        const renewedToken = await silentTelegramLogin();
        if (renewedToken) {
          authToken = renewedToken;
          continue;
        }
      }
    }

    return null;
  }, [ensureAuthToken, ensureMemberId, silentTelegramLogin]);

  const runWithAuthRetry = useCallback(
    async (runner) => {
      let session = null;
      try {
        session = await resolveActiveSession();
      } catch (sessionError) {
        throw sessionError;
      }

      if (!session?.token || !session?.memberId) {
        throw new Error('Не удалось авторизоваться. Выполните вход в приложении.');
      }

      let authToken = session.token;
      let resolvedMemberId = session.memberId;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await runner(authToken, resolvedMemberId);
        } catch (error) {
          if (error?.isAuthError && attempt === 0) {
            const renewedToken = await silentTelegramLogin();
            if (renewedToken) {
              authToken = renewedToken;
              const renewedMemberID = await ensureMemberId(renewedToken);
              if (renewedMemberID) {
                resolvedMemberId = renewedMemberID;
                continue;
              }
              throw new Error('Не удалось определить пользователя в текущей сессии.');
            }
          }
          throw error;
        }
      }

      throw new Error('Не удалось выполнить запрос.');
    },
    [ensureMemberId, resolveActiveSession, silentTelegramLogin]
  );

  const loadHoursCatalog = useCallback(async () => {
    setHoursIsCatalogLoading(true);
    setHoursError(null);
    setHoursNotice(null);

    try {
      const [projectsShort, activityTypesFull] = await runWithAuthRetry((token, currentMemberID) =>
        Promise.all([
          fetchProjectsShort(token, currentMemberID),
          fetchActivityTypesFull(token)
        ])
      );

      setHoursProjectsShort(projectsShort);
      setHoursActivityTypesFull(activityTypesFull);
    } catch (loadError) {
      setHoursError(loadError.message || 'Не удалось загрузить справочники для учета часов.');
      setHoursProjectsShort([]);
      setHoursActivityTypesFull([]);
    } finally {
      setHoursIsCatalogLoading(false);
    }
  }, [runWithAuthRetry]);

  const loadHoursDayEntries = useCallback(
    async (spentOnKey) => {
      if (!spentOnKey) {
        return;
      }

      setHoursIsDayLoading(true);
      setHoursError(null);

      try {
        const payload = await runWithAuthRetry((token, currentMemberID) =>
          fetchTimeEntriesDay(token, currentMemberID, spentOnKey)
        );

        setHoursDayEntries(payload);
      } catch (loadError) {
        setHoursError(loadError.message || 'Не удалось загрузить worklogs за выбранный день.');
        setHoursDayEntries(null);
      } finally {
        setHoursIsDayLoading(false);
      }
    },
    [runWithAuthRetry]
  );

  useEffect(() => {
    if (timesheetMode !== 2) {
      return;
    }

    setHoursActiveTab('add');
    setHoursSelectedDate(formatDateKey(todayStart));
    setHoursEditingEntry(null);
    setHoursDayEntries(null);
    setHoursDraftEntry({
      project_id: 0,
      activity_type_id: 0,
      bucket: WORK_BUCKET,
      hours: 0,
      comment: ''
    });
    setHoursError(null);
    setHoursNotice(null);
  }, [timesheetMode, todayStart]);

  useEffect(() => {
    if (timesheetMode !== 2) {
      return;
    }

    loadHoursCatalog();
  }, [loadHoursCatalog, timesheetMode]);

  useEffect(() => {
    if (timesheetMode !== 2) {
      return;
    }

    loadHoursDayEntries(hoursSelectedDate);
  }, [hoursSelectedDate, loadHoursDayEntries, timesheetMode]);

  const applySegmentData = useCallback((segmentEntry) => {
    if (!segmentEntry) return;

    setProjectPercentById(segmentEntry.projectPercents);
    setInitialProjectPercentById(segmentEntry.projectPercents);
    setActivityPercentByCode(segmentEntry.activityPercents);
    setInitialActivityPercentByCode(segmentEntry.activityPercents);
  }, []);

  const loadMonthData = useCallback(async () => {
    let session = null;
    try {
      session = await resolveActiveSession();
    } catch (sessionError) {
      setError(sessionError.message || 'Не удалось авторизоваться. Выполните вход в приложении.');
      return;
    }

    if (!session?.token || !session?.memberId) {
      setError('Не удалось авторизоваться. Выполните вход в приложении.');
      return;
    }
    let authToken = session.token;
    let resolvedMemberId = session.memberId;

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    setIsLoading(true);
    setError(null);

    try {
      const resolvedMode = await fetchSessionTimesheetMode(authToken);
      if (loadRequestRef.current !== requestId) {
        return;
      }
      if (resolvedMode) {
        setTimesheetMode(resolvedMode);
      }
      if (resolvedMode === 2) {
        setIsLoading(false);
        setProjects([]);
        setActivityTypes(DEFAULT_ACTIVITY_TYPES);
        setProjectPercentById({});
        setInitialProjectPercentById({});
        setActivityPercentByCode({});
        setInitialActivityPercentByCode({});
        setSegmentDataByKey({});
        setSegmentSummaryByKey({});
        setError(null);
        return;
      }
    } catch (modeError) {
      if (loadRequestRef.current !== requestId) {
        return;
      }
      // ignore: old tokens may not contain timesheet_mode
    }

    const runLoad = async (token, currentMemberID) => {
      const [fetchedProjects, fetchedActivityTypes] = await Promise.all([
        fetchProjects(token, currentMemberID, monthStart, monthEnd),
        fetchActivityTypes(token)
      ]);

      const projectIds = fetchedProjects.map((project) => project.id);
      const segmentPayloads = await Promise.all(
        monthSegments.map(async (segment) => {
          const [rangeRows, weeklyWorkload] = await Promise.all([
            fetchRangeLite(
              token,
              currentMemberID,
              projectIds,
              segment.weekStart,
              segment.weekEnd
            ),
            fetchWeeklyActivityDistribution(
              token,
              currentMemberID,
              segment.weekStart,
              segment.weekEnd
            )
          ]);

          const segmentKey = getSegmentKey(segment.weekStart, segment.weekEnd);
          const entry = buildSegmentDataEntry({
            projects: fetchedProjects,
            activityTypes: fetchedActivityTypes,
            rangeRows,
            weeklyDistribution: weeklyWorkload.activityDistribution,
            isLocked: weeklyWorkload.isLocked,
            rangeStart: segment.weekStart,
            rangeEnd: segment.weekEnd
          });

          return {
            segmentKey,
            entry
          };
        })
      );

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const nextSegmentDataByKey = {};
      const nextSummaryByKey = {};
      segmentPayloads.forEach((item) => {
        nextSegmentDataByKey[item.segmentKey] = item.entry;
        nextSummaryByKey[item.segmentKey] = {
          projectTotal: item.entry.projectTotal,
          activityTotal: item.entry.activityTotal
        };
      });

      setProjects(fetchedProjects);
      setActivityTypes(fetchedActivityTypes);
      setSegmentDataByKey(nextSegmentDataByKey);
      setSegmentSummaryByKey(nextSummaryByKey);

      const activeEntry = nextSegmentDataByKey[weekKey];
      if (activeEntry) {
        applySegmentData(activeEntry);
      } else {
        const emptyProjectPercents = {};
        fetchedProjects.forEach((project) => {
          emptyProjectPercents[project.id] = 0;
        });
        const emptyActivityPercents = {};
        fetchedActivityTypes.forEach((type) => {
          emptyActivityPercents[type.code] = 0;
        });

        applySegmentData({
          projectPercents: emptyProjectPercents,
          activityPercents: emptyActivityPercents
        });
      }

      setIsSubmitted(false);
      setStep(1);
      previousWeekKeyRef.current = weekKey;
    };

    let loadError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await runLoad(authToken, resolvedMemberId);
        loadError = null;
        break;
      } catch (error) {
        if (loadRequestRef.current !== requestId) {
          return;
        }

        if (error?.status === 409) {
          setTimesheetMode(2);
          setIsLoading(false);
          setProjects([]);
          setActivityTypes(DEFAULT_ACTIVITY_TYPES);
          setProjectPercentById({});
          setInitialProjectPercentById({});
          setActivityPercentByCode({});
          setInitialActivityPercentByCode({});
          setSegmentDataByKey({});
          setSegmentSummaryByKey({});
          setError(null);
          return;
        }

        if (error?.isAuthError && attempt === 0) {
          const renewedToken = await silentTelegramLogin();
          if (renewedToken) {
            authToken = renewedToken;
            const renewedMemberID = await ensureMemberId(renewedToken);
            if (renewedMemberID) {
              resolvedMemberId = renewedMemberID;
              continue;
            }
            loadError = new Error('Не удалось определить пользователя в текущей сессии.');
            break;
          }
        }

        loadError = error;
        break;
      }
    }

    if (loadError) {
      if (loadRequestRef.current !== requestId) {
        return;
      }
      setError(loadError.message || 'Не удалось загрузить weekly данные');
      setProjects([]);
      setActivityTypes(DEFAULT_ACTIVITY_TYPES);
      setProjectPercentById({});
      setInitialProjectPercentById({});
      setActivityPercentByCode({});
      setInitialActivityPercentByCode({});
      setSegmentDataByKey({});
      setSegmentSummaryByKey({});
    }

    if (loadRequestRef.current === requestId) {
      setIsLoading(false);
    }
  }, [
    applySegmentData,
    resolveActiveSession,
    ensureMemberId,
    silentTelegramLogin,
    monthEnd,
    monthSegments,
    monthStart,
    weekKey
  ]);

  useEffect(() => {
    loadMonthData();
  }, [loadMonthData]);

  useEffect(() => {
    if (previousWeekKeyRef.current === weekKey) {
      return;
    }

    previousWeekKeyRef.current = weekKey;

    const nextEntry = segmentDataByKey[weekKey];
    if (!nextEntry) {
      return;
    }

    applySegmentData(nextEntry);
    setIsSubmitted(false);
    setStep(1);
  }, [applySegmentData, segmentDataByKey, weekKey]);

  const updatePercentValue = useCallback((scope, key, nextValue) => {
    const snapped = snapToSegmentPercent(nextValue);

    const applyUpdate = (setter) => {
      setter((prev) => {
        const stringKey = String(key);
        const current = prev[stringKey] || 0;
        if (snapped === current) {
          return prev;
        }

        const totalWithoutCurrent = Object.entries(prev).reduce((sum, [entryKey, value]) => {
          if (entryKey === stringKey) return sum;
          return sum + (Number(value) || 0);
        }, 0);

        if (snapped > current && totalWithoutCurrent + snapped > MAX_TOTAL_PERCENT) {
          return prev;
        }

        return {
          ...prev,
          [stringKey]: snapped
        };
      });
    };

    if (scope === 'project') {
      applyUpdate(setProjectPercentById);
    } else {
      applyUpdate(setActivityPercentByCode);
    }

    setIsSubmitted(false);
  }, []);

  const setRowToAvailableMax = useCallback((scope, key) => {
    const applyMax = (setter) => {
      setter((prev) => {
        const stringKey = String(key);
        const totalWithoutCurrent = Object.entries(prev).reduce((sum, [entryKey, value]) => {
          if (entryKey === stringKey) return sum;
          return sum + (Number(value) || 0);
        }, 0);

        const maxAllowedRaw = Math.max(0, MAX_TOTAL_PERCENT - totalWithoutCurrent);
        const maxAllowed = Math.max(
          0,
          Math.min(
            MAX_TOTAL_PERCENT,
            Math.floor(maxAllowedRaw / SEGMENT_STEP) * SEGMENT_STEP
          )
        );

        if ((prev[stringKey] || 0) === maxAllowed) {
          return prev;
        }

        return {
          ...prev,
          [stringKey]: maxAllowed
        };
      });
    };

    if (scope === 'project') {
      applyMax(setProjectPercentById);
    } else {
      applyMax(setActivityPercentByCode);
    }

    setIsSubmitted(false);
  }, []);

  const resolvePercentFromPointer = useCallback((event) => {
    const track = event.currentTarget;
    if (!track) {
      return 0;
    }

    const rect = track.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const offsetX = Math.min(width, Math.max(0, event.clientX - rect.left));
    const ratio = offsetX / width;
    const snapped = Math.round((ratio * MAX_TOTAL_PERCENT) / SEGMENT_STEP) * SEGMENT_STEP;

    return clampPercent(snapped);
  }, []);

  const handleTrackPointerDown = useCallback(
    (scope, key, event) => {
      if (activeSegmentPendingRelease || activeSegmentIsLocked || isLoading || isSaving) {
        return;
      }

      if (event.pointerType === 'mouse') {
        event.preventDefault();
      }

      const rowKey = `${scope}:${String(key)}`;
      const now = Date.now();
      const isDoubleTap =
        tapRef.current.rowKey === rowKey &&
        now - tapRef.current.at <= DOUBLE_TAP_THRESHOLD_MS;
      tapRef.current = {
        rowKey,
        at: now
      };

      if (isDoubleTap) {
        paintRef.current.active = false;
        paintRef.current.scope = null;
        paintRef.current.key = null;
        paintRef.current.pointerId = undefined;
        setRowToAvailableMax(scope, key);
        return;
      }

      const nextPercent = resolvePercentFromPointer(event);
      paintRef.current.active = true;
      paintRef.current.scope = scope;
      paintRef.current.key = String(key);
      paintRef.current.pointerId = event.pointerId;

      if (event.pointerType === 'mouse') {
        try {
          event.currentTarget?.setPointerCapture?.(event.pointerId);
        } catch {
          /* noop */
        }
      }

      updatePercentValue(scope, key, nextPercent);
    },
    [
      activeSegmentPendingRelease,
      activeSegmentIsLocked,
      isLoading,
      isSaving,
      resolvePercentFromPointer,
      setRowToAvailableMax,
      updatePercentValue
    ]
  );

  const handleTrackPointerMove = useCallback(
    (scope, key, event) => {
      if (activeSegmentPendingRelease || activeSegmentIsLocked) {
        return;
      }
      if (!paintRef.current.active) {
        return;
      }
      if (paintRef.current.scope !== scope || paintRef.current.key !== String(key)) {
        return;
      }
      if (
        paintRef.current.pointerId !== undefined &&
        paintRef.current.pointerId !== event.pointerId
      ) {
        return;
      }

      const nextPercent = resolvePercentFromPointer(event);
      updatePercentValue(scope, key, nextPercent);
    },
    [
      activeSegmentPendingRelease,
      activeSegmentIsLocked,
      resolvePercentFromPointer,
      updatePercentValue
    ]
  );

  const handleTrackPointerEnd = useCallback((event) => {
    if (paintRef.current.pointerId !== undefined) {
      try {
        event.currentTarget?.releasePointerCapture?.(paintRef.current.pointerId);
      } catch {
        /* noop */
      }
    }

    paintRef.current.active = false;
    paintRef.current.scope = null;
    paintRef.current.key = null;
    paintRef.current.pointerId = undefined;
  }, []);

  const confirmRangeSwitch = useCallback(() => {
    if (!isDirty || isSaving) {
      return true;
    }
    return window.confirm(
      'Есть несохраненные изменения. Перейти на другой отрезок без сохранения?'
    );
  }, [isDirty, isSaving]);

  const selectSegment = useCallback(
    (segment) => {
      if (!segment) return;
      if (!isSegmentElapsed(segment, todayStart)) return;
      if (segment.id === activeSegment?.id) return;
      if (!confirmRangeSwitch()) return;

      setActiveDate(startOfDay(segment.weekStart));
    },
    [activeSegment?.id, confirmRangeSwitch, todayStart]
  );

  const handleSubmit = useCallback(async () => {
    let session = null;
    try {
      session = await resolveActiveSession();
    } catch (sessionError) {
      setError(sessionError.message || 'Не удалось авторизоваться. Выполните вход в приложении.');
      return;
    }

    if (!session?.token || !session?.memberId) {
      setError('Не удалось авторизоваться. Выполните вход в приложении.');
      return;
    }
    let authToken = session.token;
    let resolvedMemberId = session.memberId;

    if (!isPeriodComplete) {
      setError('Оба шага должны быть заполнены ровно до 100%.');
      return;
    }
    if (activeSegmentPendingRelease) {
      setError('Отрезок еще не завершен. Сохранение станет доступно после окончания отрезка.');
      return;
    }
    if (activeSegmentIsLocked) {
      setError('Отрезок подтвержден в Pulse и недоступен для редактирования.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const projectFacts = buildProjectFactsPayload(
        resolvedMemberId,
        projects,
        projectPercentById,
        weekStart,
        weekEnd
      );

      const activityDistribution = activityTypes
        .map((type) => ({
          activity_type: type.code,
          percent: clampPercent(activityPercentByCode[type.code] || 0)
        }))
        .filter((item) => item.percent > 0);

      const activityPercentSum = activityDistribution.reduce(
        (sum, item) => sum + item.percent,
        0
      );
      if (activityPercentSum !== MAX_TOTAL_PERCENT) {
        throw new Error('Распределение активностей должно быть равно 100%');
      }

      const runSave = (token, memberID) =>
        requestJson(
          `${API_BASE}/project-service/api/v1/timesheet/weekly-workload`,
          {
            method: 'PUT',
            headers: {
              Authorization: token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              member_id: memberID,
              week_start: formatDateKey(weekStart),
              week_end: formatDateKey(weekEnd),
              project_facts: projectFacts,
              activity_distribution: activityDistribution
            })
          },
          'Не удалось сохранить weekly распределение'
        );

      let submitError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await runSave(authToken, resolvedMemberId);
          submitError = null;
          break;
        } catch (error) {
          if (error?.isAuthError && attempt === 0) {
            const renewedToken = await silentTelegramLogin();
            if (renewedToken) {
              authToken = renewedToken;
              const renewedMemberID = await ensureMemberId(renewedToken);
              if (renewedMemberID) {
                resolvedMemberId = renewedMemberID;
                continue;
              }
              submitError = new Error('Не удалось определить пользователя в текущей сессии.');
              break;
            }
          }
          submitError = error;
          break;
        }
      }

      if (submitError) {
        throw submitError;
      }

      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(
          JSON.stringify({
            type: 'quickutilization',
            member_id: resolvedMemberId,
            telegram_id: getTelegramUserId(),
            week_start: formatDateKey(weekStart),
            week_end: formatDateKey(weekEnd),
            project_total: projectTotalPercent,
            activity_total: activityTotalPercent,
            projects: projects.map((project) => ({
              project_id: project.id,
              percent: projectPercentById[project.id] || 0
            })),
            activity_distribution: activityTypes.map((type) => ({
              activity_type: type.code,
              percent: activityPercentByCode[type.code] || 0
            }))
          })
        );
      }

      setSegmentDataByKey((prev) => ({
        ...prev,
        [weekKey]: {
          projectPercents: { ...projectPercentById },
          activityPercents: { ...activityPercentByCode },
          projectTotal: projectTotalPercent,
          activityTotal: activityTotalPercent,
          isLocked: false
        }
      }));
      setSegmentSummaryByKey((prev) => ({
        ...prev,
        [weekKey]: {
          projectTotal: projectTotalPercent,
          activityTotal: activityTotalPercent
        }
      }));

      setInitialProjectPercentById({ ...projectPercentById });
      setInitialActivityPercentByCode({ ...activityPercentByCode });
      setIsSubmitted(true);

      if (window.Telegram?.WebApp) {
        if (closeAfterSubmitTimerRef.current) {
          window.clearTimeout(closeAfterSubmitTimerRef.current);
        }
        closeAfterSubmitTimerRef.current = window.setTimeout(() => {
          window.Telegram?.WebApp?.close?.();
          closeAfterSubmitTimerRef.current = null;
        }, 420);
      }
    } catch (submitError) {
      setError(submitError.message || 'Ошибка сохранения weekly распределения');
      setIsSubmitted(false);
    } finally {
      setIsSaving(false);
    }
  }, [
    activityPercentByCode,
    activityTotalPercent,
    activeSegmentPendingRelease,
    activeSegmentIsLocked,
    activityTypes,
    isPeriodComplete,
    projectPercentById,
    projectTotalPercent,
    projects,
    weekEnd,
    weekStart,
    weekKey,
    resolveActiveSession,
    ensureMemberId,
    silentTelegramLogin
  ]);

  useEffect(() => {
    if (!telegramWebApp) {
      return undefined;
    }
    if (timesheetMode === 2) {
      telegramWebApp.MainButton.hide();
      telegramWebApp.BackButton.hide();
      return undefined;
    }

    const onMainButtonClick = () => {
      if (step === 1) {
        if (canGoToStep2) {
          setStep(2);
        }
        return;
      }

      if (step === 2) {
        handleSubmit();
      }
    };

    const onBackButtonClick = () => {
      if (step === 2 && !isSaving) {
        setStep(1);
      }
    };

    const syncButtons = () => {
      const mainButton = telegramWebApp.MainButton;
      const backButton = telegramWebApp.BackButton;
      const themeParams = telegramWebApp.themeParams || {};
      const isLightTheme =
        (telegramWebApp.colorScheme ||
          document.documentElement.dataset.tgColorScheme ||
          'light') === 'light';
      const activeButtonParams = {
        color: themeParams.button_color || '#2ea6ff',
        text_color: themeParams.button_text_color || '#ffffff'
      };
      const disabledButtonParams = isLightTheme
        ? {
            color: '#d3d8e1',
            text_color: '#7a8493'
          }
        : {
            color: '#4b5563',
            text_color: '#d1d5db'
          };

      const resolveButtonPalette = (isEnabled) => ({
        ...(isEnabled ? activeButtonParams : disabledButtonParams),
        is_active: isEnabled,
        is_visible: true
      });

      const applyMainButtonState = (isEnabled, text) => {
        mainButton.setParams({
          ...resolveButtonPalette(isEnabled),
          text
        });

        if (isEnabled) {
          mainButton.enable?.();
        } else {
          mainButton.disable?.();
        }
      };

      if (step === 1) {
        const canProceed = canGoToStep2;
        applyMainButtonState(canProceed, 'К шагу 2');
        mainButton.show();
        backButton.hide();
        return;
      }

      const canSave =
        !activeSegmentPendingRelease &&
        !activeSegmentIsLocked &&
        !isSaving &&
        !isLoading &&
        !error &&
        isPeriodComplete &&
        projects.length > 0;
      applyMainButtonState(
        canSave,
        isSaving ? 'Сохраняем...' : isSubmitted ? 'Сохранено' : 'Сохранить'
      );
      mainButton.show();
      backButton.show();
    };

    syncButtons();
    telegramWebApp.onEvent('mainButtonClicked', onMainButtonClick);
    telegramWebApp.onEvent('backButtonClicked', onBackButtonClick);

    return () => {
      telegramWebApp.offEvent('mainButtonClicked', onMainButtonClick);
      telegramWebApp.offEvent('backButtonClicked', onBackButtonClick);
    };
  }, [
    activeSegmentPendingRelease,
    activeSegmentIsLocked,
    canGoToStep2,
    error,
    handleSubmit,
    isLoading,
    isPeriodComplete,
    isSaving,
    isSubmitted,
    projects.length,
    step,
    timesheetMode,
    telegramWebApp
  ]);

  const renderedRows = step === 1 ? projectRows : activityRows;
  const currentScope = step === 1 ? 'project' : 'activity';
  const currentTotal = step === 1 ? projectTotalPercent : activityTotalPercent;
  const isCurrentComplete = currentTotal === MAX_TOTAL_PERCENT;
  const isCurrentRewardActive = rewardScope === currentScope;
  const baseStepHint =
    step === 1
      ? 'Шаг 1. Проведи пальцем по полосе инициативы, чтобы закрасить процент. Двойной тап по полосе — максимум.'
      : 'Шаг 2. Так же проведи пальцем по полосе активности. Двойной тап по полосе — максимум.';

  let infoText = baseStepHint;
  let infoTone = 'neutral';
  let showInfoRetry = false;

  if (error) {
    infoText = error;
    infoTone = 'danger';
    showInfoRetry = true;
  } else if (activeSegmentPendingRelease) {
    const nextDay = activeSegment ? addDays(activeSegment.weekEnd, 1) : null;
    infoText = nextDay
      ? `Отрезок станет доступен с ${formatShortDate(nextDay)}.`
      : 'Отрезок станет доступен после окончания периода.';
    infoTone = 'info';
  } else if (activeSegmentIsLocked) {
    infoText = 'Отрезок подтвержден в Pulse и доступен только для просмотра.';
    infoTone = 'info';
  } else if (isSaving) {
    infoText = 'Сохраняем отрезок...';
    infoTone = 'info';
  } else if (isLoading) {
    infoText = 'Загружаем данные отрезков...';
    infoTone = 'info';
  } else if (isSubmitted) {
    infoText = 'Отрезок успешно сохранен';
    infoTone = 'success';
  }

  const hoursIsLoading = hoursIsCatalogLoading || hoursIsDayLoading;
  const hoursWorklogsCount =
    hoursDayEntries?.projects?.reduce(
      (acc, project) => acc + (Array.isArray(project?.entries) ? project.entries.length : 0),
      0
    ) ?? 0;

  const hoursConfirmStatusByProjectId = useMemo(() => {
    const raw = hoursDayEntries?.confirm_status_by_project_id;
    const map = {};
    if (!raw || typeof raw !== 'object') {
      return map;
    }

    Object.entries(raw).forEach(([projectIdRaw, statusRaw]) => {
      const projectId = Number(projectIdRaw);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        return;
      }

      const status = Number(statusRaw);
      if (!Number.isFinite(status)) {
        return;
      }

      map[projectId] = status;
    });

    return map;
  }, [hoursDayEntries?.confirm_status_by_project_id]);

  const isHoursEntryEditing = Boolean(hoursEditingEntry);

  const hoursOriginalEntry = useMemo(() => {
    if (!hoursEditingEntry) {
      return null;
    }

    const project = hoursDayEntries?.projects?.find(
      (item) => Number(item?.project_id) === Number(hoursEditingEntry.project_id)
    );
    const entry = project?.entries?.find(
      (item) => Number(item?.id) === Number(hoursEditingEntry.entry_id)
    );

    if (!entry) {
      return null;
    }

    return {
      hours: safeIntegerHours(entry?.hours),
      bucket: Number(entry?.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET
    };
  }, [hoursDayEntries?.projects, hoursEditingEntry]);

  const hoursBaseWork = Number(hoursDayEntries?.work_hour || 0);
  const hoursBaseOver = Number(hoursDayEntries?.over_hour || 0);
  const hoursBaseTotal = hoursBaseWork + hoursBaseOver;

  const safeDraftHours =
    Number.isInteger(hoursDraftEntry.hours) && hoursDraftEntry.hours > 0 ? hoursDraftEntry.hours : 0;
  const trimmedDraftComment = String(hoursDraftEntry.comment || '').trim();

  const originalHours = hoursOriginalEntry?.hours ?? 0;
  const originalBucket = hoursOriginalEntry?.bucket ?? WORK_BUCKET;

  const previewWork =
    hoursBaseWork -
    (originalBucket === WORK_BUCKET ? originalHours : 0) +
    (hoursDraftEntry.bucket === WORK_BUCKET ? safeDraftHours : 0);
  const previewOver =
    hoursBaseOver -
    (originalBucket === OVER_BUCKET ? originalHours : 0) +
    (hoursDraftEntry.bucket === OVER_BUCKET ? safeDraftHours : 0);
  const previewTotal = previewWork + previewOver;

  const hasInvalidHours = !Number.isInteger(hoursDraftEntry.hours) || hoursDraftEntry.hours < 0;
  const hasMissingProject = safeDraftHours > 0 && hoursDraftEntry.project_id <= 0;
  const hasMissingActivity = safeDraftHours > 0 && hoursDraftEntry.activity_type_id <= 0;
  const hasMissingComment = safeDraftHours > 0 && trimmedDraftComment.length === 0;
  const hasNoHoursProjects = hoursProjectOptions.length === 0;
  const hasNoHoursActivities = hoursActivityTypesFull.length === 0;

  const isHoursDateValid =
    hoursSelectedDate >= hoursMinDate &&
    hoursSelectedDate <= hoursMaxDate &&
    hoursSelectedDate.startsWith(hoursMonthPrefix);

  const isDayCapExceeded = previewTotal > DAY_CAPACITY_HOURS;
  const selectedProjectConfirmStatus = hoursConfirmStatusByProjectId[hoursDraftEntry.project_id] || 0;
  const isSelectedProjectApproved = selectedProjectConfirmStatus === 1;

  const isHoursSaveDisabled =
    !isHoursDateValid ||
    hoursIsLoading ||
    hoursIsSaving ||
    isSelectedProjectApproved ||
    hasInvalidHours ||
    hasMissingProject ||
    hasMissingActivity ||
    hasMissingComment ||
    hasNoHoursProjects ||
    hasNoHoursActivities ||
    isDayCapExceeded ||
    safeDraftHours <= 0;

  const cancelHoursEditing = () => {
    setHoursEditingEntry(null);
    setHoursDraftEntry((prev) => ({
      ...prev,
      hours: 0,
      comment: ''
    }));
    setHoursNotice(null);
  };

  const startHoursEditEntry = (projectId, entry) => {
    setHoursEditingEntry({
      project_id: projectId,
      entry_id: entry.id
    });
    setHoursDraftEntry({
      project_id: projectId,
      activity_type_id: Number(entry?.activity_type_id) || 0,
      bucket: Number(entry?.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET,
      hours: safeIntegerHours(entry?.hours),
      comment: String(entry?.comment || '')
    });
    setHoursActiveTab('add');
    setHoursNotice(null);
  };

  const makeHoursPayloadLine = (line) => ({
    hours: safeIntegerHours(line?.hours),
    bucket: Number(line?.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET,
    activity_type_id: Number(line?.activity_type_id) || 0,
    comment: line?.comment ? String(line.comment) : undefined
  });

  const handleHoursSave = async () => {
    if (isHoursSaveDisabled) {
      return;
    }

    const projectId = hoursEditingEntry?.project_id || hoursDraftEntry.project_id;
    if (projectId <= 0) {
      setHoursError('Выберите проект для логирования.');
      return;
    }

    const project = hoursDayEntries?.projects?.find((item) => Number(item?.project_id) === Number(projectId));
    const existingEntries = Array.isArray(project?.entries) ? project.entries : [];

    const nextComment = trimmedDraftComment;

    let payloadEntries = existingEntries.map((entry) => makeHoursPayloadLine(entry));

    if (hoursEditingEntry) {
      payloadEntries = existingEntries.map((entry) =>
        Number(entry?.id) === Number(hoursEditingEntry.entry_id)
          ? {
              hours: safeDraftHours,
              bucket: Number(hoursDraftEntry.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET,
              activity_type_id: Number(hoursDraftEntry.activity_type_id) || 0,
              comment: nextComment
            }
          : makeHoursPayloadLine(entry)
      );
    } else {
      payloadEntries.push({
        hours: safeDraftHours,
        bucket: Number(hoursDraftEntry.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET,
        activity_type_id: Number(hoursDraftEntry.activity_type_id) || 0,
        comment: nextComment
      });
    }

    setHoursIsSaving(true);
    setHoursError(null);
    setHoursNotice(null);

    try {
      await runWithAuthRetry((token, currentMemberID) =>
        putTimeEntriesDay(token, {
          member_id: currentMemberID,
          project_id: projectId,
          spent_on: hoursSelectedDate,
          entries: payloadEntries
        })
      );

      setHoursNotice(hoursEditingEntry ? 'Worklog обновлён' : 'Worklog добавлен');
      setHoursEditingEntry(null);
      setHoursDraftEntry((prev) => ({
        ...prev,
        hours: 0,
        comment: ''
      }));
      loadHoursDayEntries(hoursSelectedDate);
    } catch (saveError) {
      setHoursError(saveError.message || 'Не удалось сохранить worklog.');
    } finally {
      setHoursIsSaving(false);
    }
  };

  const handleHoursDelete = async (projectId, entryId) => {
    if (!projectId || !entryId || hoursIsSaving || hoursIsLoading) {
      return;
    }

    if ((hoursConfirmStatusByProjectId[projectId] || 0) === 1) {
      return;
    }

    const project = hoursDayEntries?.projects?.find((item) => Number(item?.project_id) === Number(projectId));
    const entries = Array.isArray(project?.entries) ? project.entries : [];
    const target = entries.find((item) => Number(item?.id) === Number(entryId));

    if (!target) {
      return;
    }

    const ok = window.confirm(
      `Удалить worklog?\n\n${target.activity_type_name} • ${bucketLabel(target.bucket)} • ${target.hours} ч`
    );
    if (!ok) {
      return;
    }

    const payloadEntries = entries
      .filter((item) => Number(item?.id) !== Number(entryId))
      .map((entry) => makeHoursPayloadLine(entry));

    setHoursIsSaving(true);
    setHoursError(null);
    setHoursNotice(null);

    try {
      await runWithAuthRetry((token, currentMemberID) =>
        putTimeEntriesDay(token, {
          member_id: currentMemberID,
          project_id: projectId,
          spent_on: hoursSelectedDate,
          entries: payloadEntries
        })
      );

      if (
        hoursEditingEntry?.project_id === projectId &&
        hoursEditingEntry?.entry_id === entryId
      ) {
        cancelHoursEditing();
      }

      setHoursNotice('Worklog удалён');
      loadHoursDayEntries(hoursSelectedDate);
    } catch (deleteError) {
      setHoursError(deleteError.message || 'Не удалось удалить worklog.');
    } finally {
      setHoursIsSaving(false);
    }
  };

  const projectHoursLabel = (project) => {
    const workHour = Number(project?.work_hour || 0);
    const overHour = Number(project?.over_hour || 0);
    const parts = [];
    if (workHour > 0) parts.push(`Work ${workHour} ч`);
    if (overHour > 0) parts.push(`Over ${overHour} ч`);
    if (!parts.length) parts.push('0 ч');
    return parts.join(' • ');
  };

  if (timesheetMode === 2) {
    return (
      <div className={`time-logger hours-mode ${isTelegramWebApp ? 'telegram-mode' : ''}`}>
        <div className="panel hours-summary">
          <div className="hours-summary__top">
            <div className="hours-input-group">
              <label htmlFor="hours-date">Дата</label>
              <input
                id="hours-date"
                type="date"
                value={hoursSelectedDate}
                min={hoursMinDate}
                max={hoursMaxDate}
                onChange={(event) => setHoursSelectedDate(event.target.value)}
                disabled={hoursIsLoading || hoursIsSaving}
              />
            </div>

            <div className="hours-summary__metrics" aria-label="Итоги дня">
              <div className="hours-metric">
                <span className="hours-metric__label">Work</span>
                <span className="hours-metric__value">{hoursBaseWork} ч</span>
              </div>
              <div className="hours-metric">
                <span className="hours-metric__label">Over</span>
                <span className="hours-metric__value">{hoursBaseOver} ч</span>
              </div>
              <div className="hours-metric">
                <span className="hours-metric__label">Total</span>
                <span className="hours-metric__value">{hoursBaseTotal} ч</span>
              </div>
            </div>
          </div>

          {safeDraftHours > 0 && (
            <div className="hours-summary__preview">
              После сохранения: Work {previewWork} ч • Over {previewOver} ч • Total {previewTotal} ч
            </div>
          )}

          {isSelectedProjectApproved && hoursDraftEntry.project_id > 0 && (
            <div className="hours-lock-banner" role="status">
              <span className="hours-lock-banner__icon" aria-hidden="true">
                🔒
              </span>
              <span>
                Таймшит по проекту подтверждён — изменения заблокированы.
              </span>
            </div>
          )}

          {hoursNotice && (
            <div className="hours-notice hours-notice--success" role="status">
              {hoursNotice}
            </div>
          )}

          {hoursError && (
            <div className="hours-notice hours-notice--danger" role="alert">
              <span>{hoursError}</span>
              <button
                type="button"
                className="retry-button"
                onClick={() => {
                  loadHoursCatalog();
                  loadHoursDayEntries(hoursSelectedDate);
                }}
                disabled={hoursIsLoading || hoursIsSaving}
              >
                Обновить
              </button>
            </div>
          )}
        </div>

        <div className="hours-tabs" role="tablist" aria-label="Табы учета часов">
          <button
            type="button"
            className={`hours-tab ${hoursActiveTab === 'add' ? 'active' : ''}`}
            role="tab"
            aria-selected={hoursActiveTab === 'add'}
            onClick={() => setHoursActiveTab('add')}
            disabled={hoursIsLoading || hoursIsSaving}
          >
            Добавить
          </button>
          <button
            type="button"
            className={`hours-tab ${hoursActiveTab === 'worklogs' ? 'active' : ''}`}
            role="tab"
            aria-selected={hoursActiveTab === 'worklogs'}
            onClick={() => {
              if (isHoursEntryEditing) {
                window.alert('Сначала сохраните или отмените редактирование worklog.');
                return;
              }
              setHoursActiveTab('worklogs');
            }}
            disabled={hoursIsLoading || hoursIsSaving}
          >
            Worklogs <span className="hours-badge">{hoursIsDayLoading ? '—' : hoursWorklogsCount}</span>
          </button>
        </div>

        <section className="panel panel--list">
          <div className="segments-list hours-scroll">
            {hoursActiveTab === 'add' ? (
              <div className="hours-form">
                <div className="hours-form__header">
                  <div className="hours-form__title">
                    {isHoursEntryEditing ? 'Редактировать worklog' : 'Добавить новый worklog'}
                  </div>
                  {isHoursEntryEditing && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={cancelHoursEditing}
                      disabled={hoursIsSaving || hoursIsLoading}
                    >
                      Отмена
                    </button>
                  )}
                </div>

                <div className="hours-form__grid">
                  <div className="hours-input-group">
                    <label htmlFor="hours-activity">Тип активности</label>
                    <select
                      id="hours-activity"
                      value={hoursDraftEntry.activity_type_id ? String(hoursDraftEntry.activity_type_id) : ''}
                      onChange={(event) =>
                        setHoursDraftEntry((prev) => ({
                          ...prev,
                          activity_type_id: Number(event.target.value) || 0
                        }))
                      }
                      disabled={hoursIsSaving || hoursIsLoading || isSelectedProjectApproved || hasNoHoursActivities}
                    >
                      <option value="">Выберите активность</option>
                      {hoursActivityTypesFull.map((type) => (
                        <option key={type.id} value={String(type.id)}>
                          {type.name_ru}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hours-input-group">
                    <label htmlFor="hours-project">Проект</label>
                    <select
                      id="hours-project"
                      value={hoursDraftEntry.project_id ? String(hoursDraftEntry.project_id) : ''}
                      onChange={(event) =>
                        setHoursDraftEntry((prev) => ({
                          ...prev,
                          project_id: Number(event.target.value) || 0
                        }))
                      }
                      disabled={hoursIsSaving || hoursIsLoading || hasNoHoursProjects || isHoursEntryEditing}
                    >
                      <option value="">Выберите проект</option>
                      {hoursProjectOptions.map((project) => (
                        <option key={project.project_id} value={String(project.project_id)}>
                          {project.project_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hours-input-group">
                    <label htmlFor="hours-hours">Часы</label>
                    <input
                      id="hours-hours"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={String(hoursDraftEntry.hours)}
                      onChange={(event) =>
                        setHoursDraftEntry((prev) => ({
                          ...prev,
                          hours: safeIntegerHours(event.target.value)
                        }))
                      }
                      disabled={hoursIsSaving || hoursIsLoading || isSelectedProjectApproved}
                    />
                  </div>

                  <div className="hours-input-group">
                    <label htmlFor="hours-bucket">Тип часов</label>
                    <select
                      id="hours-bucket"
                      value={String(hoursDraftEntry.bucket)}
                      onChange={(event) =>
                        setHoursDraftEntry((prev) => ({
                          ...prev,
                          bucket: Number(event.target.value) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET
                        }))
                      }
                      disabled={hoursIsSaving || hoursIsLoading || isSelectedProjectApproved}
                    >
                      <option value={String(WORK_BUCKET)}>Work</option>
                      <option value={String(OVER_BUCKET)}>Over</option>
                    </select>
                  </div>

                  <div className="hours-input-group hours-input-group--full">
                    <label htmlFor="hours-comment">Что делали</label>
                    <textarea
                      id="hours-comment"
                      rows={3}
                      value={hoursDraftEntry.comment}
                      onChange={(event) =>
                        setHoursDraftEntry((prev) => ({
                          ...prev,
                          comment: event.target.value
                        }))
                      }
                      placeholder="Коротко опишите, что делали"
                      disabled={hoursIsSaving || hoursIsLoading || isSelectedProjectApproved}
                    />
                  </div>
                </div>

                {(hasInvalidHours || hasMissingProject || hasMissingActivity || hasMissingComment || isDayCapExceeded) && (
                  <div className="hours-form__errors" role="alert">
                    {hasInvalidHours && <div>Часы должны быть целым числом (0+).</div>}
                    {hasMissingProject && <div>Выберите проект.</div>}
                    {hasMissingActivity && <div>Выберите тип активности.</div>}
                    {hasMissingComment && <div>Опишите, что делали.</div>}
                    {isDayCapExceeded && <div>Нельзя сохранить больше {DAY_CAPACITY_HOURS} часов за день.</div>}
                  </div>
                )}

                {!isHoursDateValid && (
                  <div className="hours-form__hint hours-form__hint--danger">
                    Можно логировать только даты текущего месяца (до сегодня).
                  </div>
                )}
              </div>
            ) : hoursIsLoading ? (
              <div className="loading-container">
                <div className="spinner" aria-hidden="true" />
                <p>Загружаем worklogs…</p>
              </div>
            ) : hoursDayEntries?.projects?.length ? (
              <div className="hours-worklogs">
                <div className="hours-worklogs__title">
                  Записи за {formatUiDateKey(hoursSelectedDate)}
                </div>

                {hoursDayEntries.projects.map((project, index) => {
                  const projectId = Number(project?.project_id || 0);
                  const isApproved = (hoursConfirmStatusByProjectId[projectId] || 0) === 1;
                  const projectColor = getProjectColor(index);

                  return (
                    <div key={projectId || index} className="hours-project">
                      {isApproved && (
                        <div className="hours-lock-banner hours-lock-banner--compact">
                          <span className="hours-lock-banner__icon" aria-hidden="true">
                            🔒
                          </span>
                          <span>Подтверждено: редактирование заблокировано</span>
                        </div>
                      )}

                      <div className="project-card__header">
                        <div className="project-label">
                          <span className="project-dot" style={{ backgroundColor: projectColor }} />
                          <span className="project-name">{project?.project_name || `Проект ${projectId}`}</span>
                        </div>
                        <div className="project-actions">
                          <span className="project-percent">{projectHoursLabel(project)}</span>
                        </div>
                      </div>

                      {Array.isArray(project?.entries) && project.entries.length ? (
                        <div className="hours-entries">
                          {project.entries.map((entry) => (
                            <div key={entry.id} className="hours-entry-row">
                              <div className="hours-entry-row__text">
                                {entry.activity_type_name} • {bucketLabel(entry.bucket)} • {entry.hours} ч
                              </div>
                              <div className="project-actions">
                                <button
                                  type="button"
                                  className="clear-button"
                                  onClick={() => startHoursEditEntry(projectId, entry)}
                                  disabled={isApproved || hoursIsSaving || hoursIsLoading}
                                  aria-label="Редактировать"
                                >
                                  ✎
                                </button>
                                <button
                                  type="button"
                                  className="clear-button"
                                  onClick={() => handleHoursDelete(projectId, entry.id)}
                                  disabled={isApproved || hoursIsSaving || hoursIsLoading}
                                  aria-label="Удалить"
                                >
                                  🗑
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="hours-empty">Нет строк</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="no-projects">
                <p>За выбранную дату записей пока нет.</p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setHoursActiveTab('add')}
                  disabled={hoursIsSaving || hoursIsLoading}
                >
                  Добавить worklog
                </button>
              </div>
            )}
          </div>

          <div className="actions-row">
            {hoursActiveTab === 'add' ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (isHoursEntryEditing) {
                      cancelHoursEditing();
                      return;
                    }
                    loadHoursDayEntries(hoursSelectedDate);
                  }}
                  disabled={hoursIsSaving || hoursIsLoading}
                >
                  {isHoursEntryEditing ? 'Отмена' : 'Обновить'}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleHoursSave}
                  disabled={isHoursSaveDisabled}
                >
                  {hoursIsSaving ? 'Сохраняем...' : 'Сохранить'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setHoursActiveTab('add')}
                  disabled={hoursIsSaving || hoursIsLoading}
                >
                  Добавить
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => loadHoursDayEntries(hoursSelectedDate)}
                  disabled={hoursIsSaving || hoursIsLoading}
                >
                  Обновить
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`time-logger ${isTelegramWebApp ? 'telegram-mode' : ''}`}>
      <div className="stepper" role="group" aria-label="Шаги заполнения">
        <button
          type="button"
          className={`stepper__node ${step === 1 ? 'active' : step > 1 && isProjectComplete ? 'done' : ''}`}
          onClick={() => setStep(1)}
          aria-current={step === 1 ? 'step' : undefined}
        >
          <span className="stepper__text">Инициативы</span>
        </button>
        <div className={`stepper__line ${step === 2 || isProjectComplete ? 'active' : ''}`} aria-hidden="true" />
        <button
          type="button"
          className={`stepper__node ${step === 2 ? 'active' : isActivityComplete ? 'done' : ''}`}
          onClick={() => {
            if (canGoToStep2) setStep(2);
          }}
          disabled={!canGoToStep2 && step !== 2}
          aria-current={step === 2 ? 'step' : undefined}
        >
          <span className="stepper__text">Активности</span>
        </button>
      </div>

      <div className="segments-bar" role="tablist" aria-label="Недельные отрезки">
        {monthSegments.map((segment) => {
          const isPendingRelease = !isSegmentElapsed(segment, todayStart);
          const isActive = activeSegment?.id === segment.id;
          const summaryKey = `${formatDateKey(segment.weekStart)}_${formatDateKey(segment.weekEnd)}`;
          const summary = segmentSummaryByKey[summaryKey];
          const isDone =
            (summary?.projectTotal || 0) === MAX_TOTAL_PERCENT &&
            (summary?.activityTotal || 0) === MAX_TOTAL_PERCENT;

          return (
            <button
              key={segment.id}
              type="button"
              className={`segment-chip ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => selectSegment(segment)}
              disabled={isPendingRelease || isLoading || isSaving}
            >
              <span className="segment-chip__label">{segment.label}</span>
              <span className="segment-chip__meta">
                {summary ? `${summary.projectTotal}% / ${summary.activityTotal}%` : '-- / --'}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`summary-total ${isCurrentComplete ? 'complete' : ''} ${isCurrentRewardActive ? 'reward' : ''}`}>
        <span className="total-label">{step === 1 ? 'Инициативы' : 'Активности'}</span>
        <span className={`total-hours ${isCurrentComplete ? 'complete' : ''}`}>
          {currentTotal}% из {MAX_TOTAL_PERCENT}%
          <span className={`total-check ${isCurrentComplete ? 'visible' : ''}`} aria-hidden={!isCurrentComplete}>
            ✓
          </span>
        </span>
      </div>

      <div className={`step-description step-description--${infoTone}`}>
        <span className="step-description__text">{infoText}</span>
        {showInfoRetry && (
          <button type="button" className="step-description__retry" onClick={loadMonthData}>
            Обновить
          </button>
        )}
      </div>

      <section className="panel panel--list">
          {renderedRows.length > 0 ? (
            <div className="segments-list">
              {renderedRows.map((row) => {
                const rowPercent = row.percent || 0;

                return (
                  <div key={row.id} className="project-card">
                    <div
                      className={`segment-strip ${activeSegmentIsLocked ? 'locked' : ''}`}
                      role="slider"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={rowPercent}
                      aria-disabled={activeSegmentIsLocked}
                      style={{
                        borderColor: `${row.color}88`,
                        backgroundColor: `${row.color}22`
                      }}
                      onPointerDown={(event) => handleTrackPointerDown(currentScope, row.id, event)}
                      onPointerMove={(event) => handleTrackPointerMove(currentScope, row.id, event)}
                      onPointerUp={handleTrackPointerEnd}
                      onPointerCancel={handleTrackPointerEnd}
                      onLostPointerCapture={handleTrackPointerEnd}
                      aria-valuetext={`${rowPercent}%`}
                    >
                      <div
                        className="segment-strip__fill"
                        style={{
                          width: `${rowPercent}%`,
                          background: `linear-gradient(90deg, ${row.color} 0%, ${row.color}CC 100%)`
                        }}
                        aria-hidden="true"
                      />

                      <div className="segment-strip__content">
                        <div className="project-label">
                          <span className="project-dot" style={{ backgroundColor: row.color }} />
                          <span className="project-name">{row.name}</span>
                        </div>

                        <div className="project-actions">
                          <span className="project-percent">{rowPercent}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="no-projects">
              <p>
                {step === 1
                  ? 'Нет активных инициатив в выбранном отрезке'
                  : 'Нет активных типов активностей'}
              </p>
            </div>
          )}

          {!isTelegramWebApp && (
            <div className="actions-row">
              {step === 2 ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setStep(1)}
                  disabled={isSaving}
                >
                  Назад
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => loadMonthData()}
                  disabled={isSaving || isLoading}
                >
                  Обновить
                </button>
              )}

              {step === 1 ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setStep(2)}
                  disabled={!canGoToStep2}
                >
                  К шагу 2
                </button>
              ) : (
                <button
                  type="button"
                  className={`primary-button ${isSubmitted ? 'submitted' : ''}`}
                  onClick={handleSubmit}
                  disabled={
                    activeSegmentPendingRelease ||
                    activeSegmentIsLocked ||
                    isSaving ||
                    !isPeriodComplete ||
                    projects.length === 0
                  }
                >
                  {isSaving ? 'Сохраняем...' : isSubmitted ? 'Сохранено' : 'Сохранить'}
                </button>
              )}
            </div>
          )}

      </section>
    </div>
  );
};

export default TimeLogger;
