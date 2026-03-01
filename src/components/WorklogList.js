import React from 'react';
import { formatUiDateKey } from '../utils/dateUtils';
import { getProjectColor, bucketLabel } from '../utils/percentUtils';

const WorklogList = ({
  hoursDayEntries,
  hoursSelectedDate,
  hoursConfirmStatusByProjectId,
  hoursIsLoading,
  hoursIsSaving,
  onEditEntry,
  onDeleteEntry,
  onSwitchToAdd
}) => {
  const projectHoursLabel = (project) => {
    const workHour = Number(project?.work_hour || 0);
    const overHour = Number(project?.over_hour || 0);
    const parts = [];
    if (workHour > 0) parts.push(`Work ${workHour} ч`);
    if (overHour > 0) parts.push(`Over ${overHour} ч`);
    if (!parts.length) parts.push('0 ч');
    return parts.join(' • ');
  };

  if (hoursIsLoading) {
    return (
      <div className="loading-container">
        <div className="spinner" aria-hidden="true" />
        <p>Загружаем worklogs…</p>
      </div>
    );
  }

  if (!hoursDayEntries?.projects?.length) {
    return (
      <div className="no-projects">
        <p>За выбранную дату записей пока нет.</p>
        <button
          type="button"
          className="primary-button"
          onClick={onSwitchToAdd}
          disabled={hoursIsSaving || hoursIsLoading}
        >
          Добавить worklog
        </button>
      </div>
    );
  }

  return (
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
                {project.entries.map((entry) => {
                  const isEntryLocked = isApproved || hoursIsSaving || hoursIsLoading;

                  return (
                    <div
                      key={entry.id}
                      className={`hours-entry-row ${isEntryLocked ? 'is-locked' : 'is-editable'}`}
                      onClick={() => {
                        if (!isEntryLocked) {
                          onEditEntry(projectId, entry);
                        }
                      }}
                      role="button"
                      tabIndex={isEntryLocked ? -1 : 0}
                      onKeyDown={(event) => {
                        if (isEntryLocked) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onEditEntry(projectId, entry);
                        }
                      }}
                      aria-label={`Редактировать запись: ${entry.activity_type_name}, ${bucketLabel(entry.bucket)}, ${entry.hours} ч`}
                    >
                      <div className="hours-entry-row__text">
                        {entry.activity_type_name} • {bucketLabel(entry.bucket)} • {entry.hours} ч
                      </div>
                      <div className="project-actions">
                        <button
                          type="button"
                          className="clear-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteEntry(projectId, entry.id);
                          }}
                          disabled={isEntryLocked}
                          aria-label="Удалить"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="hours-empty">Нет строк</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(WorklogList);
