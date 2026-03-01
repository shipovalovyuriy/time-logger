import React from 'react';
import { WORK_BUCKET, OVER_BUCKET, DAY_CAPACITY_HOURS } from '../utils/constants';
import { safeIntegerHours } from '../utils/percentUtils';

const HoursForm = ({
  isHoursEntryEditing,
  hoursDraftEntry,
  hoursActivityTypesFull,
  hoursProjectOptions,
  hoursIsSaving,
  hoursIsLoading,
  isSelectedProjectApproved,
  hasNoHoursActivities,
  hasNoHoursProjects,
  hasInvalidHours,
  hasMissingProject,
  hasMissingActivity,
  hasMissingComment,
  isDayCapExceeded,
  isHoursDateValid,
  onDraftChange,
  onCancelEditing
}) => (
  <div className="hours-form">
    <div className="hours-form__header">
      <div className="hours-form__title">
        {isHoursEntryEditing ? 'Редактировать worklog' : 'Добавить новый worklog'}
      </div>
      {isHoursEntryEditing && (
        <button
          type="button"
          className="secondary-button"
          onClick={onCancelEditing}
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
            onDraftChange({ activity_type_id: Number(event.target.value) || 0 })
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
            onDraftChange({ project_id: Number(event.target.value) || 0 })
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
            onDraftChange({ hours: safeIntegerHours(event.target.value) })
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
            onDraftChange({
              bucket: Number(event.target.value) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET
            })
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
            onDraftChange({ comment: event.target.value })
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
);

export default React.memo(HoursForm);
