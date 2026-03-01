import storage from './storage';
import { API_BASE, DEFAULT_ACTIVITY_TYPES } from './constants';
import { formatLegacyDate, formatDateKey, toLocalIso } from './dateUtils';
import { getProjectColor, toPositiveInt } from './percentUtils';

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

export const normalizeBearerToken = (tokenValue) => {
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

export const requestJson = async (url, options, fallbackMessage) => {
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

export const getTelegramUserId = () => {
  const userId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
};

export const fetchSessionMemberId = async (authToken) => {
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

export const extractTimesheetMode = (payload) => {
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

export const fetchSessionTimesheetMode = async (authToken) => {
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

export const fetchSessionRoles = async (authToken) => {
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
  const roles = result?.roles || payload?.roles || [];
  return Array.isArray(roles) ? roles : [];
};

export const resolveMemberId = async (authToken) => {
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

export const fetchProjects = async (authToken, memberId, monthStart, monthEnd) => {
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

export const fetchActivityTypes = async (authToken) => {
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

export const fetchRangeLite = async (authToken, memberId, projectIds, rangeStart, rangeEnd) => {
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

export const fetchWeeklyActivityDistribution = async (authToken, memberId, rangeStart, rangeEnd) => {
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

export const fetchProjectsShort = async (authToken, memberId) => {
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

export const fetchActivityTypesFull = async (authToken) => {
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

export const fetchTimeEntriesDay = async (authToken, memberId, spentOn) => {
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

export const putTimeEntriesDay = async (authToken, body) =>
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

export const fetchApprovalQuick = async (authToken, year, month) => {
  const payload = await requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/approval/quick?year=${year}&month=${month}`,
    {
      method: 'GET',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    },
    'Не удалось загрузить данные для апрува'
  );

  const result = extractResult(payload);
  return Array.isArray(result) ? result : Array.isArray(payload) ? payload : [];
};

export const putTimesheetConfirm = async (authToken, body) =>
  requestJson(
    `${API_BASE}/project-service/api/v1/timesheet/confirm`,
    {
      method: 'PUT',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    'Не удалось подтвердить/отклонить таймшит'
  );
