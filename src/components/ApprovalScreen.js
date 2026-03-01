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

const ApprovalScreen = ({ onBack }) => {
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
      setExpandedProjects((prev) => {
        if (prev.size === 0 && data.length > 0) {
          return new Set([data[0]?.project_id]);
        }
        return prev;
      });
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
        <div className="approval-list">
          {projects.length === 0 && !error ? (
            <div className="approval-empty">Нет проектов для апрува за выбранный месяц.</div>
          ) : (
            projects.map((project) => {
              const projectId = Number(project.project_id);
              const isOpen = expandedProjects.has(projectId);
              const members = Array.isArray(project.members) ? project.members : [];

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
                    <span className="approval-project__name">
                      {project.project_name || `Проект ${projectId}`}
                    </span>
                    <span className={`approval-project__toggle ${isOpen ? 'open' : ''}`}>
                      ▼
                    </span>
                  </div>

                  {isOpen && (
                    <div className="approval-project__body">
                      <div className="approval-project__bulk">
                        <button
                          type="button"
                          className="approval-bulk-btn approval-bulk-btn--approve"
                          onClick={() => confirmAllInProject(projectId, 1)}
                          disabled={isSaving || isLoading || members.length === 0}
                        >
                          Подтвердить всех
                        </button>
                        <button
                          type="button"
                          className="approval-bulk-btn approval-bulk-btn--reject"
                          onClick={() => confirmAllInProject(projectId, -1)}
                          disabled={isSaving || isLoading || members.length === 0}
                        >
                          Отклонить всех
                        </button>
                      </div>

                      {members.length === 0 ? (
                        <div className="approval-empty">Нет сотрудников.</div>
                      ) : (
                        members.map((member) => {
                          const mid = Number(member.member_id);
                          const cStatus = Number(member.confirm_status || 0);
                          const sClass = statusClass(cStatus);

                          return (
                            <div key={mid} className="approval-member">
                              <div className="approval-member__top">
                                <div className="approval-member__info">
                                  <span className="approval-member__name">
                                    {member.member_name || member.full_name || `Сотрудник ${mid}`}
                                  </span>
                                  {member.company_name && (
                                    <span className="approval-member__company">{member.company_name}</span>
                                  )}
                                </div>
                                <span className={`approval-status approval-status--${sClass}`}>
                                  {statusLabel(cStatus)}
                                </span>
                              </div>

                              <div className="approval-member__metrics">
                                <div className="approval-mini-metric">
                                  <span className="approval-mini-metric__label">Work</span>
                                  <span className="approval-mini-metric__value">{member.work_hour ?? 0}</span>
                                </div>
                                <div className="approval-mini-metric">
                                  <span className="approval-mini-metric__label">Over</span>
                                  <span className="approval-mini-metric__value">{member.over_hour ?? 0}</span>
                                </div>
                                <div className="approval-mini-metric">
                                  <span className="approval-mini-metric__label">Plan</span>
                                  <span className="approval-mini-metric__value">{member.planned_hour ?? 0}</span>
                                </div>
                                <div className="approval-mini-metric">
                                  <span className="approval-mini-metric__label">Util %</span>
                                  <span className="approval-mini-metric__value">
                                    {member.utilization != null ? `${member.utilization}%` : '—'}
                                  </span>
                                </div>
                              </div>

                              <div className="approval-member__actions">
                                <button
                                  type="button"
                                  className="approval-action-btn approval-action-btn--approve"
                                  onClick={() => confirmMember(projectId, mid, 1)}
                                  disabled={isSaving || isLoading || cStatus === 1}
                                >
                                  Подтвердить
                                </button>
                                <button
                                  type="button"
                                  className="approval-action-btn approval-action-btn--reject"
                                  onClick={() => confirmMember(projectId, mid, -1)}
                                  disabled={isSaving || isLoading || cStatus === -1}
                                >
                                  Отклонить
                                </button>
                                {cStatus !== 0 && (
                                  <button
                                    type="button"
                                    className="approval-action-btn approval-action-btn--reset"
                                    onClick={() => confirmMember(projectId, mid, 0)}
                                    disabled={isSaving || isLoading}
                                  >
                                    Сбросить
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
