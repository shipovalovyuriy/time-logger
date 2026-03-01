import React, { useCallback, useEffect, useMemo, useState } from 'react';
import storage from '../utils/storage';
import { normalizeBearerToken, fetchApprovalQuick, putTimesheetConfirm } from '../utils/api';
import './ApprovalScreen.css';

const toMonthLabel = (date) =>
  date
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/\s?г\.$/i, '');

const statusLabel = (status) => {
  const val = Number(status);
  if (val === 1) return 'Подтверждено';
  if (val === -1) return 'Отклонено';
  return 'Ожидание';
};

const statusClass = (status) => {
  const val = Number(status);
  if (val === 1) return 'approved';
  if (val === -1) return 'rejected';
  return 'pending';
};

const toCleanString = (value) => {
  const text = String(value || '').trim();
  return text.length > 0 ? text : '';
};

const getMemberName = (member) => {
  const directName =
    toCleanString(member?.member_name) ||
    toCleanString(member?.full_name) ||
    toCleanString(member?.name);

  if (directName) {
    return directName;
  }

  const parts = [
    toCleanString(member?.lastName),
    toCleanString(member?.firstName),
    toCleanString(member?.surName)
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  const snakeCaseParts = [
    toCleanString(member?.last_name),
    toCleanString(member?.first_name),
    toCleanString(member?.sur_name)
  ].filter(Boolean);

  if (snakeCaseParts.length > 0) {
    return snakeCaseParts.join(' ');
  }

  return 'Без имени';
};

const getMemberCompany = (member) =>
  toCleanString(member?.company_name) ||
  toCleanString(member?.short_company_name) ||
  toCleanString(member?.company) ||
  '';

const getMemberAvatar = (member) =>
  toCleanString(member?.avatar_url) ||
  toCleanString(member?.avatar) ||
  toCleanString(member?.profile_image_url) ||
  '';

const getInitials = (displayName) => {
  const normalized = toCleanString(displayName);
  if (!normalized) return '??';
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
};

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
};

const formatHours = (value) => {
  const num = toFiniteNumber(value, 0);
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(1).replace(/\.0$/, '');
};

const getActivityLabel = (entry) =>
  toCleanString(entry?.activity_type_code) ||
  toCleanString(entry?.activity_type_name) ||
  'Тип';

const getMemberActivityEntries = (member) => {
  const rawEntries = Array.isArray(member?.entries) ? member.entries : [];

  const entries = rawEntries
    .map((entry) => ({
      label: getActivityLabel(entry),
      hours: toFiniteNumber(entry?.hours, 0),
      bucket: Number(entry?.bucket) === 2 ? 2 : 1
    }))
    .filter((entry) => entry.hours > 0);

  entries.sort((a, b) => b.hours - a.hours);
  return entries;
};

const ApprovalScreen = ({ onBack }) => {
  const telegramWebApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  const approvalListRef = React.useRef(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [projects, setProjects] = useState([]);
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const monthDate = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const monthLabel = useMemo(() => toMonthLabel(monthDate), [monthDate]);

  const getAuthToken = useCallback(() => {
    return normalizeBearerToken(storage.getItem('token'));
  }, []);

  const ensureAuthToken = useCallback(async () => {
    const token = getAuthToken();
    if (!token) throw new Error('Не удалось авторизоваться. Выполните вход в приложении.');
    return token;
  }, [getAuthToken]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await ensureAuthToken();
      const data = await fetchApprovalQuick(token, year, month);
      setProjects(data);
    } catch (err) {
      setError(err.message || 'Не удалось загрузить данные.');
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
  }, [ensureAuthToken, year, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!telegramWebApp) return undefined;
    telegramWebApp.expand?.();
    telegramWebApp.disableVerticalSwipes?.();
    return () => {
      telegramWebApp.enableVerticalSwipes?.();
    };
  }, [telegramWebApp]);

  useEffect(() => {
    if (!telegramWebApp) return undefined;
    const listElement = approvalListRef.current;
    if (!listElement) return undefined;

    let ticking = false;
    const keepExpanded = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        telegramWebApp.expand?.();
        ticking = false;
      });
    };

    listElement.addEventListener('scroll', keepExpanded, { passive: true });
    return () => {
      listElement.removeEventListener('scroll', keepExpanded);
    };
  }, [telegramWebApp, projects.length]);

  const changeMonth = (delta) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) { newMonth = 1; newYear += 1; }
    if (newMonth < 1) { newMonth = 12; newYear -= 1; }
    setMonth(newMonth);
    setYear(newYear);
    setExpandedProjects(new Set());
  };

  const toggleProject = (projectId) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  const confirmMember = useCallback(async (projectId, memberId, confirmStatus) => {
    setIsSaving(true);
    setError(null);
    try {
      const token = await ensureAuthToken();
      await putTimesheetConfirm(token, {
        project_id: projectId,
        member_id: memberId,
        year,
        month,
        confirm_status: confirmStatus
      });
      await loadData();
    } catch (err) {
      setError(err.message || 'Не удалось выполнить действие.');
    } finally {
      setIsSaving(false);
    }
  }, [ensureAuthToken, loadData, year, month]);

  const confirmAllInProject = useCallback(async (projectId, confirmStatus) => {
    const project = projects.find((p) => p.project_id === projectId);
    if (!project?.members?.length) return;

    setIsSaving(true);
    setError(null);
    try {
      const token = await ensureAuthToken();
      for (const member of project.members) {
        const currentStatus = Number(member.confirm_status || 0);
        if (currentStatus === confirmStatus) continue;
        await putTimesheetConfirm(token, {
          project_id: projectId,
          member_id: member.member_id,
          year,
          month,
          confirm_status: confirmStatus
        });
      }
      await loadData();
    } catch (err) {
      setError(err.message || 'Не удалось выполнить массовое действие.');
    } finally {
      setIsSaving(false);
    }
  }, [ensureAuthToken, loadData, projects, year, month]);

  return (
    <div className="approval-screen">
      {isSaving && (
        <div className="approval-saving-overlay">
          <div className="approval-saving-overlay__content">
            <div className="approval-saving-spinner" />
            <span>Сохраняем...</span>
          </div>
        </div>
      )}

      <div className="approval-screen__header">
        <span className="approval-screen__title">Апрув часов</span>
        <button type="button" className="approval-screen__back" onClick={onBack}>
          Назад
        </button>
      </div>

      <div className="approval-month-nav">
        <button
          type="button"
          className="approval-month-nav__btn"
          onClick={() => changeMonth(-1)}
          disabled={isLoading || isSaving}
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <span className="approval-month-nav__label">{monthLabel}</span>
        <button
          type="button"
          className="approval-month-nav__btn"
          onClick={() => changeMonth(1)}
          disabled={isLoading || isSaving}
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>

      {error && (
        <div className="approval-error" role="alert">
          <span>{error}</span>
          <button type="button" className="approval-error__retry" onClick={loadData}>
            Обновить
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="loading-container">
          <div className="spinner" aria-hidden="true" />
          <p>Загружаем данные…</p>
        </div>
      ) : (
        <div className="approval-list" ref={approvalListRef}>
          {projects.length === 0 && !error ? (
            <div className="approval-empty">Нет проектов для апрува за выбранный месяц.</div>
          ) : (
            projects.map((project) => {
              const projectId = Number(project.project_id);
              const isOpen = expandedProjects.has(projectId);
              const members = Array.isArray(project.members) ? project.members : [];
              const pendingCount = Number(project.pendingCount ?? 0) || members.filter((m) => Number(m.confirm_status || 0) === 0).length;
              const approvedCount = Number(project.approvedCount ?? 0) || members.filter((m) => Number(m.confirm_status || 0) === 1).length;
              const rejectedCount = Number(project.rejectedCount ?? 0) || members.filter((m) => Number(m.confirm_status || 0) === -1).length;
              const managerName = toCleanString(project.manager_name);
              const directionName = toCleanString(project.direction);

              return (
                <div key={projectId} className="approval-project">
                  <div
                    className="approval-project__header"
                    onClick={() => toggleProject(projectId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProject(projectId); } }}
                    aria-expanded={isOpen}
                  >
                    <div className="approval-project__identity">
                      <span className="approval-project__name">
                        {project.project_name || `Проект ${projectId}`}
                      </span>
                      <div className="approval-project__meta">
                        {directionName && (
                          <span className="approval-project__meta-item">{directionName}</span>
                        )}
                        {managerName && (
                          <span className="approval-project__meta-item">PM: {managerName}</span>
                        )}
                      </div>
                    </div>
                    <div className="approval-project__summary">
                      <span className="approval-project__counter approval-project__counter--total">
                        {members.length}
                      </span>
                      {pendingCount > 0 && (
                        <span className="approval-project__counter approval-project__counter--pending">
                          {pendingCount}
                        </span>
                      )}
                      {approvedCount > 0 && (
                        <span className="approval-project__counter approval-project__counter--approved">
                          {approvedCount}
                        </span>
                      )}
                      {rejectedCount > 0 && (
                        <span className="approval-project__counter approval-project__counter--rejected">
                          {rejectedCount}
                        </span>
                      )}
                      <span className={`approval-project__toggle ${isOpen ? 'open' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="approval-project__body">
                      <div className="approval-project__bulk">
                        <button
                          type="button"
                          className="approval-bulk-btn approval-bulk-btn--reject"
                          onClick={() => confirmAllInProject(projectId, -1)}
                          disabled={isSaving || isLoading || members.length === 0}
                        >
                          Отклонить всех
                        </button>
                        <button
                          type="button"
                          className="approval-bulk-btn approval-bulk-btn--approve"
                          onClick={() => confirmAllInProject(projectId, 1)}
                          disabled={isSaving || isLoading || members.length === 0}
                        >
                          Подтвердить всех
                        </button>
                      </div>

                      {members.length === 0 ? (
                        <div className="approval-empty">Нет сотрудников.</div>
                      ) : (
                        members.map((member, memberIndex) => {
                          const mid = Number(member.member_id) || memberIndex;
                          const cStatus = Number(member.confirm_status || 0);
                          const sClass = statusClass(cStatus);
                          const memberName = getMemberName(member);
                          const memberCompany = getMemberCompany(member);
                          const memberAvatar = getMemberAvatar(member);
                          const memberInitials = getInitials(memberName);
                          const activityEntries = getMemberActivityEntries(member);
                          const visibleEntries = activityEntries.slice(0, 4);
                          const hiddenActivitiesCount = Math.max(0, activityEntries.length - visibleEntries.length);
                          const workHours = toFiniteNumber(member.work_hour, 0);
                          const overHours = toFiniteNumber(member.over_hour, 0);
                          const plannedHours = toFiniteNumber(member.planned_hour, 0);
                          const utilization = toFiniteNumber(member.utilization, NaN);

                          return (
                            <div key={`${projectId}-${mid}-${memberIndex}`} className="approval-member">
                              <div className="approval-member__top">
                                <div className="approval-member__identity">
                                  <div className="approval-member__avatar" aria-hidden="true">
                                    {memberAvatar ? (
                                      <img src={memberAvatar} alt="" />
                                    ) : (
                                      <span>{memberInitials}</span>
                                    )}
                                  </div>
                                  <div className="approval-member__info">
                                    <span className="approval-member__name">
                                      {memberName}
                                    </span>
                                    {memberCompany && (
                                      <span className="approval-member__company">{memberCompany}</span>
                                    )}
                                  </div>
                                </div>
                                <span className={`approval-status approval-status--${sClass}`}>
                                  {statusLabel(cStatus)}
                                </span>
                              </div>

                              <div className="approval-member__quick">
                                <span className="approval-quick-chip">
                                  <b>План:</b> {formatHours(plannedHours)} ч
                                </span>
                                <span className="approval-quick-chip">
                                  <b>Факт:</b> {formatHours(workHours)} ч
                                </span>
                                <span className="approval-quick-chip">
                                  <b>Overtime:</b> {formatHours(overHours)} ч
                                </span>
                                <span className="approval-quick-chip">
                                  <b>Утилизация:</b> {Number.isFinite(utilization) ? `${formatHours(utilization)}%` : '—'}
                                </span>
                              </div>

                              {visibleEntries.length > 0 && (
                                <div className="approval-member__activities">
                                  {visibleEntries.map((entry, entryIndex) => (
                                    <span
                                      key={`${projectId}-${mid}-activity-${entry.label}-${entryIndex}`}
                                      className={`approval-activity-chip ${
                                        entry.bucket === 2 ? 'approval-activity-chip--over' : 'approval-activity-chip--work'
                                      }`}
                                    >
                                      {entry.label} · {formatHours(entry.hours)}
                                    </span>
                                  ))}
                                  {hiddenActivitiesCount > 0 && (
                                    <span className="approval-activity-chip approval-activity-chip--more">
                                      +{hiddenActivitiesCount}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="approval-member__actions">
                                <button
                                  type="button"
                                  className="approval-action-btn approval-action-btn--reject"
                                  onClick={() => confirmMember(projectId, mid, -1)}
                                  disabled={isSaving || isLoading || cStatus === -1}
                                  aria-label="Отклонить"
                                  title="Отклонить"
                                >
                                  ✕
                                </button>
                                <button
                                  type="button"
                                  className="approval-action-btn approval-action-btn--approve"
                                  onClick={() => confirmMember(projectId, mid, 1)}
                                  disabled={isSaving || isLoading || cStatus === 1}
                                  aria-label="Подтвердить"
                                  title="Подтвердить"
                                >
                                  ✓
                                </button>
                                {cStatus !== 0 && (
                                  <button
                                    type="button"
                                    className="approval-action-btn approval-action-btn--reset"
                                    onClick={() => confirmMember(projectId, mid, 0)}
                                    disabled={isSaving || isLoading}
                                    aria-label="Сбросить статус"
                                    title="Сбросить статус"
                                  >
                                    ↺
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default ApprovalScreen;
