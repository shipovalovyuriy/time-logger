import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import storage from '../utils/storage';
import './TimeLogger.css';

const MAX_TOTAL_PERCENT = 100;
const SEGMENTS_COUNT = 10;
const SEGMENT_STEP = 10;

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

const getProjectColor = (projectId) => PROJECT_COLORS[projectId % PROJECT_COLORS.length];

const clampPercent = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const snapToSegmentPercent = (value) => {
  const normalized = clampPercent(value);
  return Math.round(normalized / SEGMENT_STEP) * SEGMENT_STEP;
};

const formatLegacyDate = (date) => `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;

const getMonthBounds = (date) => ({
  start: new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1, 0, 0, 0)),
  end: new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 0, 0, 0, 0))
});

const getMonthKey = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}.${month}.01`;
};

const TimeLogger = () => {
  const telegramWebApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  const isTelegramWebApp = Boolean(telegramWebApp);

  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [step, setStep] = useState(1);
  const [projects, setProjects] = useState([]);
  const [percentByProject, setPercentByProject] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showLimitHint, setShowLimitHint] = useState(false);

  const paintRef = useRef({ active: false, projectId: null });

  const totalPercent = useMemo(
    () => Object.values(percentByProject).reduce((sum, value) => sum + (value || 0), 0),
    [percentByProject]
  );

  const setProjectPercent = useCallback((projectId, nextValue) => {
    const snapped = snapToSegmentPercent(nextValue);

    setPercentByProject((prev) => {
      const current = prev[projectId] || 0;
      if (snapped === current) {
        return prev;
      }

      const totalWithoutCurrent = Object.entries(prev).reduce((sum, [id, percent]) => {
        return Number(id) === projectId ? sum : sum + (percent || 0);
      }, 0);

      if (snapped > current && totalWithoutCurrent + snapped > MAX_TOTAL_PERCENT) {
        setShowLimitHint(true);
        return prev;
      }

      return {
        ...prev,
        [projectId]: snapped
      };
    });

    setIsSubmitted(false);
  }, []);

  const fetchProjects = useCallback(async (authToken, userId, monthDate) => {
    const { start, end } = getMonthBounds(monthDate);
    const monthStart = formatLegacyDate(start);
    const monthEnd = formatLegacyDate(end);

    const response = await fetch(
      `https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/list?member_id=${userId}&month_start=${monthStart}&month_end=${monthEnd}`,
      {
        method: 'GET',
        headers: {
          Authorization: authToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status === 401 || response.status === 403) {
      storage.removeItem('token');
      throw new Error('Сессия истекла. Пожалуйста, войдите в систему снова.');
    }

    if (!response.ok) {
      throw new Error(`Ошибка загрузки проектов (${response.status})`);
    }

    const raw = await response.json();
    const timesheetData = Array.isArray(raw?.result) ? raw.result : Array.isArray(raw) ? raw : [];

    const seen = new Set();
    const parsedProjects = [];

    timesheetData.forEach((item) => {
      if (!item?.project || !item?.is_active) {
        return;
      }

      if (item.project.project_status !== 'Активный') {
        return;
      }

      const projectId = Number(item.project.id);
      if (!Number.isFinite(projectId)) {
        return;
      }

      if (seen.has(projectId)) {
        return;
      }

      seen.add(projectId);
      parsedProjects.push({
        id: projectId,
        name: item.project.project_name || `Проект ${projectId}`,
        color: getProjectColor(projectId)
      });
    });

    return parsedProjects;
  }, []);

  const fetchMonthPrefill = useCallback(async (authToken, userId, monthDate) => {
    const year = monthDate.getFullYear();
    const monthKey = getMonthKey(monthDate);

    const response = await fetch(
      `https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/permonth/member?member_id=${userId}&year=${year}&version=2`,
      {
        method: 'GET',
        headers: {
          Authorization: authToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      return {};
    }

    const payload = await response.json();
    const rows = Array.isArray(payload?.result) ? payload.result : Array.isArray(payload) ? payload : [];

    const result = {};

    rows.forEach((item) => {
      const projectId = Number(item?.project_id);
      if (!Number.isFinite(projectId)) {
        return;
      }

      const monthValue = item?.[monthKey];
      if (!monthValue || typeof monthValue !== 'object') {
        return;
      }

      const plannedHour = Number(monthValue.planned_hour || 0);
      const capacityHours = Number(monthValue.capacity_hours || 0);
      if (!Number.isFinite(plannedHour) || !Number.isFinite(capacityHours) || capacityHours <= 0) {
        result[projectId] = 0;
        return;
      }

      result[projectId] = snapToSegmentPercent((plannedHour / capacityHours) * 100);
    });

    return result;
  }, []);

  const loadMonthData = useCallback(async () => {
    const authToken = storage.getItem('token');
    const userId = storage.getItem('userId') || '3227';

    if (!authToken) {
      setError('Токен авторизации не найден. Пожалуйста, войдите в систему.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [fetchedProjects, fetchedPrefill] = await Promise.all([
        fetchProjects(authToken, userId, selectedMonth),
        fetchMonthPrefill(authToken, userId, selectedMonth)
      ]);

      setProjects(fetchedProjects);
      setPercentByProject(() => {
        const next = {};
        fetchedProjects.forEach((project) => {
          next[project.id] = fetchedPrefill[project.id] || 0;
        });
        return next;
      });
      setIsSubmitted(false);
    } catch (fetchError) {
      setError(fetchError.message || 'Не удалось загрузить данные месяца');
      setProjects([]);
      setPercentByProject({});
    } finally {
      setIsLoading(false);
    }
  }, [fetchMonthPrefill, fetchProjects, selectedMonth]);

  useEffect(() => {
    loadMonthData();
  }, [loadMonthData]);

  useEffect(() => {
    if (!showLimitHint) {
      return;
    }

    const timer = setTimeout(() => setShowLimitHint(false), 1400);
    return () => clearTimeout(timer);
  }, [showLimitHint]);

  useEffect(() => {
    const stopPainting = () => {
      paintRef.current.active = false;
      paintRef.current.projectId = null;
    };

    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);

    return () => {
      window.removeEventListener('pointerup', stopPainting);
      window.removeEventListener('pointercancel', stopPainting);
    };
  }, []);

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.expand();
    }
  }, []);

  useEffect(() => {
    if (!telegramWebApp) {
      return undefined;
    }

    return () => {
      telegramWebApp.MainButton.hide();
      telegramWebApp.BackButton.hide();
    };
  }, [telegramWebApp]);

  const handleSegmentPointerDown = useCallback(
    (projectId, segmentIndex, event) => {
      event.preventDefault();
      paintRef.current.active = true;
      paintRef.current.projectId = projectId;
      setProjectPercent(projectId, (segmentIndex + 1) * SEGMENT_STEP);
    },
    [setProjectPercent]
  );

  const handleSegmentPointerEnter = useCallback(
    (projectId, segmentIndex) => {
      if (!paintRef.current.active || paintRef.current.projectId !== projectId) {
        return;
      }

      setProjectPercent(projectId, (segmentIndex + 1) * SEGMENT_STEP);
    },
    [setProjectPercent]
  );

  const handleSubmit = useCallback(async () => {
    const authToken = storage.getItem('token');
    const userId = Number(storage.getItem('userId') || '3227');

    if (!authToken) {
      setError('Токен авторизации не найден. Пожалуйста, войдите в систему.');
      return;
    }

    if (totalPercent > MAX_TOTAL_PERCENT) {
      setError('Сумма процентов больше 100%. Уменьшите значения и повторите.');
      return;
    }

    const { start, end } = getMonthBounds(selectedMonth);

    setIsSaving(true);
    setError(null);

    try {
      const requests = projects.map(async (project) => {
        const utilization = percentByProject[project.id] || 0;

        const response = await fetch('https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/planned/range', {
          method: 'POST',
          headers: {
            Authorization: authToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            project_id: project.id,
            member_id: userId,
            date_from: start.toISOString(),
            date_to: end.toISOString(),
            utilization,
            include_days_off: false
          })
        });

        if (!response.ok) {
          throw new Error(`Не удалось сохранить проект ${project.name} (${response.status})`);
        }
      });

      await Promise.all(requests);

      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(
          JSON.stringify({
            type: 'quickmonthutilization',
            month: `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`,
            total: totalPercent,
            projects: projects.map((project) => ({
              project_id: project.id,
              percent: percentByProject[project.id] || 0
            }))
          })
        );
      }

      setIsSubmitted(true);
    } catch (submitError) {
      setError(submitError.message || 'Ошибка сохранения процентов');
      setIsSubmitted(false);
    } finally {
      setIsSaving(false);
    }
  }, [percentByProject, projects, selectedMonth, totalPercent]);

  useEffect(() => {
    if (!telegramWebApp) {
      return undefined;
    }

    const handleMainButtonClick = () => {
      if (step === 1 && !isLoading && projects.length > 0) {
        setStep(2);
        return;
      }
      if (step === 2) {
        handleSubmit();
      }
    };

    const handleBackButtonClick = () => {
      if (step === 2 && !isSaving) {
        setStep(1);
      }
    };

    const syncTelegramButtons = () => {
      const mainButton = telegramWebApp.MainButton;
      const backButton = telegramWebApp.BackButton;

      const baseParams = {
        color: telegramWebApp.themeParams?.button_color,
        text_color: telegramWebApp.themeParams?.button_text_color
      };

      if (step === 1) {
        const canGoToStep2 = !isLoading && projects.length > 0;
        if (canGoToStep2) {
          mainButton.setParams({
            ...baseParams,
            text: 'К шагу 2',
            is_active: true,
            is_visible: true
          });
          mainButton.show();
        } else {
          mainButton.hide();
        }
        backButton.hide();
        return;
      }

      const canSubmit = !isSaving && projects.length > 0 && totalPercent <= MAX_TOTAL_PERCENT;
      mainButton.setParams({
        ...baseParams,
        text: isSaving ? 'Сохраняем...' : isSubmitted ? 'Сохранено' : 'Сохранить проценты',
        is_active: canSubmit,
        is_visible: true
      });
      mainButton.show();

      if (step === 2) {
        backButton.show();
      } else {
        backButton.hide();
      }
    };

    syncTelegramButtons();

    telegramWebApp.onEvent('mainButtonClicked', handleMainButtonClick);
    telegramWebApp.onEvent('backButtonClicked', handleBackButtonClick);

    return () => {
      telegramWebApp.offEvent('mainButtonClicked', handleMainButtonClick);
      telegramWebApp.offEvent('backButtonClicked', handleBackButtonClick);
    };
  }, [handleSubmit, isLoading, isSaving, isSubmitted, projects.length, step, telegramWebApp, totalPercent]);

  return (
    <div className={`time-logger ${isTelegramWebApp ? 'telegram-mode' : ''}`}>
      <div className="stepper">
        <div className={`stepper__item ${step >= 1 ? 'active' : ''}`}>1. Месяц</div>
        <div className={`stepper__item ${step >= 2 ? 'active' : ''}`}>2. Проценты</div>
      </div>

      <section className="panel">
        <h2 className="panel__title">Шаг 1. Выберите месяц</h2>
        <DatePicker
          selected={selectedMonth}
          onChange={(date) => {
            if (!date) return;
            setSelectedMonth(date);
            setStep(1);
          }}
          dateFormat="MM.yyyy"
          showMonthYearPicker
          className="date-picker-input"
          placeholderText="Выберите месяц"
        />

        {!isTelegramWebApp && (
          <button
            type="button"
            className="primary-button"
            onClick={() => setStep(2)}
            disabled={isLoading || projects.length === 0}
          >
            К шагу 2
          </button>
        )}
        {isTelegramWebApp && <div className="telegram-actions-hint">Действия доступны через кнопку Telegram снизу</div>}
      </section>

      {isLoading && (
        <div className="loading-container">
          <div className="spinner" />
          <p>Загрузка данных месяца...</p>
        </div>
      )}

      {error && (
        <div className="error-container">
          <p>{error}</p>
          <button type="button" className="retry-button" onClick={loadMonthData}>
            Обновить
          </button>
        </div>
      )}

      {!isLoading && !error && step === 2 && (
        <section className="panel panel--list">
          <div className="summary-total">
            <span className="total-label">Сумма:</span>
            <span className={`total-hours ${totalPercent > MAX_TOTAL_PERCENT ? 'limit-reached' : ''}`}>
              {totalPercent}% / {MAX_TOTAL_PERCENT}%
            </span>
          </div>

          {showLimitHint && <div className="limit-hint">Нельзя закрасить больше 100% суммарно</div>}

          <div className="segments-list">
            {projects.map((project) => {
              const projectPercent = percentByProject[project.id] || 0;
              const filledSegments = Math.round(projectPercent / SEGMENT_STEP);

              return (
                <div key={project.id} className="project-card">
                  <div className="project-card__header">
                    <div className="project-label">
                      <span className="project-dot" style={{ backgroundColor: project.color }} />
                      <span className="project-name">{project.name}</span>
                    </div>
                    <div className="project-actions">
                      <span className="project-percent">{projectPercent}%</span>
                      <button
                        type="button"
                        className="clear-button"
                        onClick={() => setProjectPercent(project.id, 0)}
                        aria-label={`Сбросить ${project.name} до 0 процентов`}
                      >
                        0%
                      </button>
                    </div>
                  </div>

                  <div className="segment-strip" role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={projectPercent}>
                    {Array.from({ length: SEGMENTS_COUNT }).map((_, index) => {
                      const isFilled = index < filledSegments;
                      return (
                        <button
                          key={`${project.id}_${index}`}
                          type="button"
                          className={`segment-cell ${isFilled ? 'filled' : ''}`}
                          onPointerDown={(event) => handleSegmentPointerDown(project.id, index, event)}
                          onPointerEnter={() => handleSegmentPointerEnter(project.id, index)}
                          aria-label={`${project.name}: ${((index + 1) * SEGMENT_STEP)} процентов`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {!isTelegramWebApp && (
            <div className="actions-row">
              <button type="button" className="secondary-button" onClick={() => setStep(1)} disabled={isSaving}>
                Назад
              </button>
              <button
                type="button"
                className={`primary-button ${isSubmitted ? 'submitted' : ''}`}
                onClick={handleSubmit}
                disabled={isSaving || projects.length === 0 || totalPercent > MAX_TOTAL_PERCENT}
              >
                {isSaving ? 'Сохраняем...' : isSubmitted ? 'Сохранено' : 'Сохранить проценты'}
              </button>
            </div>
          )}
          {isTelegramWebApp && <div className="telegram-actions-hint">Назад и сохранение управляются кнопками Telegram</div>}
        </section>
      )}

      {!isLoading && !error && step === 2 && projects.length === 0 && (
        <div className="no-projects">
          <p>Нет активных проектов в выбранном месяце</p>
        </div>
      )}
    </div>
  );
};

export default TimeLogger;
