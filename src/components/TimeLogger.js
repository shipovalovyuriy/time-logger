import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import storage from '../utils/storage';
import {
  API_BASE,
  MAX_TOTAL_PERCENT,
  SEGMENT_STEP,
  WORK_BUCKET,
  OVER_BUCKET,
  DOUBLE_TAP_THRESHOLD_MS,
  REWARD_ANIMATION_MS,
  DEFAULT_ACTIVITY_TYPES
} from '../utils/constants';
import {
  startOfDay,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  formatDateKey,
  formatShortDate,
  formatMonthKey,
  toMonthLabel,
  getSegmentKey,
  isSegmentSummaryComplete,
  isSegmentElapsed,
  countPendingElapsedSegments,
  buildMonthSegments,
  resolveActiveSegmentIndex
} from '../utils/dateUtils';
import {
  clampPercent,
  snapToSegmentPercent,
  sumPercentMap,
  getProjectColor,
  isEqualByKeys,
  safeIntegerHours,
  bucketLabel,
  toPositiveInt
} from '../utils/percentUtils';
import {
  buildProjectFactsPayload,
  buildSegmentDataEntry
} from '../utils/hoursDistribution';
import {
  normalizeBearerToken,
  requestJson,
  getTelegramUserId,
  fetchSessionMemberId,
  fetchSessionTimesheetMode,
  resolveMemberId,
  fetchProjects,
  fetchActivityTypes,
  fetchRangeLite,
  fetchWeeklyActivityDistribution,
  fetchProjectsShort,
  fetchActivityTypesFull,
  fetchTimeEntriesDay,
  putTimeEntriesDay
} from '../utils/api';
import Stepper from './Stepper';
import SegmentBar from './SegmentBar';
import ProjectSlider from './ProjectSlider';
import SummaryTotal from './SummaryTotal';
import CarryoverBanner from './CarryoverBanner';
import HoursSummary from './HoursSummary';
import HoursForm from './HoursForm';
import WorklogList from './WorklogList';
import './TimeLogger.css';

const makeHoursPayloadLine = (line) => ({
  hours: safeIntegerHours(line?.hours),
  bucket: Number(line?.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET,
  activity_type_id: Number(line?.activity_type_id) || 0,
  comment: line?.comment ? String(line.comment) : undefined
});

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
  const [carryoverSummaryByKey, setCarryoverSummaryByKey] = useState({});
  const [isCarryoverSummaryLoaded, setIsCarryoverSummaryLoaded] = useState(false);
  const [ignoreCarryoverAutoOpen, setIgnoreCarryoverAutoOpen] = useState(false);

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
  const previousTotalsRef = useRef({ project: 0, activity: 0 });

  /* ── derived month / segment values ── */
  const currentMonthStart = useMemo(() => startOfMonth(todayStart), [todayStart]);
  const currentMonthKey = useMemo(() => formatMonthKey(currentMonthStart), [currentMonthStart]);
  const currentMonthLabel = useMemo(() => toMonthLabel(currentMonthStart), [currentMonthStart]);
  const carryoverMonthStart = useMemo(() => startOfMonth(addMonths(currentMonthStart, -1)), [currentMonthStart]);
  const carryoverMonthEnd = useMemo(() => endOfMonth(carryoverMonthStart), [carryoverMonthStart]);
  const carryoverMonthKey = useMemo(() => formatMonthKey(carryoverMonthStart), [carryoverMonthStart]);
  const carryoverMonthLabel = useMemo(() => toMonthLabel(carryoverMonthStart), [carryoverMonthStart]);

  const monthStart = useMemo(() => startOfMonth(activeDate), [activeDate]);
  const monthEnd = useMemo(() => endOfMonth(activeDate), [activeDate]);
  const monthKey = useMemo(() => formatMonthKey(monthStart), [monthStart]);
  const currentMonthSegments = useMemo(() => buildMonthSegments(currentMonthStart), [currentMonthStart]);
  const monthSegments = useMemo(() => buildMonthSegments(monthStart), [monthStart]);
  const carryoverMonthSegments = useMemo(() => buildMonthSegments(carryoverMonthStart), [carryoverMonthStart]);
  const activeSegmentIndex = useMemo(() => resolveActiveSegmentIndex(monthSegments, activeDate), [activeDate, monthSegments]);
  const latestElapsedSegment = useMemo(() => {
    for (let index = monthSegments.length - 1; index >= 0; index -= 1) {
      if (isSegmentElapsed(monthSegments[index], todayStart)) return monthSegments[index];
    }
    return null;
  }, [monthSegments, todayStart]);
  const activeSegment = monthSegments[activeSegmentIndex] || monthSegments[0] || null;
  const activeSegmentIsElapsed = isSegmentElapsed(activeSegment, todayStart);
  const activeSegmentPendingRelease = !activeSegmentIsElapsed;
  const isViewingCurrentMonth = monthKey === currentMonthKey;
  const isViewingCarryoverMonth = monthKey === carryoverMonthKey;
  const weekStart = activeSegment?.weekStart || monthStart;
  const weekEnd = activeSegment?.weekEnd || monthEnd;
  const weekKey = useMemo(() => getSegmentKey(weekStart, weekEnd), [weekEnd, weekStart]);
  const activeSegmentIsLocked = Boolean(segmentDataByKey[weekKey]?.isLocked);

  const projectTotalPercent = useMemo(() => sumPercentMap(projectPercentById), [projectPercentById]);
  const activityTotalPercent = useMemo(() => sumPercentMap(activityPercentByCode), [activityPercentByCode]);

  const projectKeys = useMemo(() => projects.map((p) => String(p.id)), [projects]);
  const activityKeys = useMemo(() => activityTypes.map((t) => t.code), [activityTypes]);

  const hoursMinDate = useMemo(() => formatDateKey(currentMonthStart), [currentMonthStart]);
  const hoursMaxDate = useMemo(() => formatDateKey(todayStart), [todayStart]);
  const hoursMonthPrefix = useMemo(() => String(hoursMinDate).slice(0, 7), [hoursMinDate]);

  const hoursProjectOptions = useMemo(() => {
    const merged = new Map();
    hoursProjectsShort.forEach((project) => {
      if (!project?.id) return;
      merged.set(project.id, { project_id: project.id, project_name: project.name || `Проект ${project.id}`, order: project.order || 0 });
    });
    if (hoursDayEntries?.projects && Array.isArray(hoursDayEntries.projects)) {
      hoursDayEntries.projects.forEach((project) => {
        const projectId = Number(project?.project_id);
        if (!Number.isFinite(projectId) || projectId <= 0 || merged.has(projectId)) return;
        merged.set(projectId, { project_id: projectId, project_name: project?.project_name || `Проект ${projectId}`, order: merged.size });
      });
    }
    return [...merged.values()].sort((l, r) => l.order - r.order);
  }, [hoursDayEntries?.projects, hoursProjectsShort]);

  /* ── hours-mode side-effects ── */
  useEffect(() => {
    if (timesheetMode !== 2) return;
    setHoursDraftEntry((prev) => ({
      ...prev,
      project_id: prev.project_id > 0 ? prev.project_id : hoursProjectOptions[0]?.project_id || 0,
      activity_type_id: prev.activity_type_id > 0 ? prev.activity_type_id : hoursActivityTypesFull[0]?.id || 0
    }));
  }, [hoursActivityTypesFull, hoursProjectOptions, timesheetMode]);

  useEffect(() => {
    if (timesheetMode !== 2) return;
    setHoursEditingEntry(null);
    setHoursDraftEntry((prev) => ({ ...prev, hours: 0, comment: '' }));
    setHoursNotice(null);
  }, [hoursSelectedDate, timesheetMode]);

  useEffect(() => {
    if (timesheetMode !== 2) return undefined;
    const handleFocusIn = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest('.hours-summary, .hours-form')) return;
      window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 180);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [timesheetMode]);

  /* ── computed flags ── */
  const isProjectComplete = projectTotalPercent === MAX_TOTAL_PERCENT;
  const isActivityComplete = activityTotalPercent === MAX_TOTAL_PERCENT;
  const isPeriodComplete = isProjectComplete && isActivityComplete;
  const canGoToStep2 = activeSegmentIsElapsed && !isLoading && !error && projects.length > 0 && isProjectComplete;

  const isDirty = useMemo(() => {
    if (!projectKeys.length && !activityKeys.length) return false;
    const projectChanged = projectKeys.length > 0 && !isEqualByKeys(projectPercentById, initialProjectPercentById, projectKeys);
    const activityChanged = activityKeys.length > 0 && !isEqualByKeys(activityPercentByCode, initialActivityPercentByCode, activityKeys);
    return projectChanged || activityChanged;
  }, [activityKeys, activityPercentByCode, initialActivityPercentByCode, initialProjectPercentById, projectKeys, projectPercentById]);

  const activityRows = useMemo(
    () => activityTypes.map((type, index) => ({ id: type.code, name: type.name_ru, color: getProjectColor(index + 3), percent: activityPercentByCode[type.code] || 0 })),
    [activityPercentByCode, activityTypes]
  );

  const projectRows = useMemo(
    () => projects.map((project) => ({ ...project, percent: projectPercentById[project.id] || 0 })),
    [projectPercentById, projects]
  );

  const carryoverPendingSegments = useMemo(
    () =>
      carryoverMonthSegments.filter((seg) => {
        const sk = getSegmentKey(seg.weekStart, seg.weekEnd);
        const summary = carryoverSummaryByKey[sk];
        if (summary?.isLocked) return false;
        return !isSegmentSummaryComplete(summary);
      }),
    [carryoverMonthSegments, carryoverSummaryByKey]
  );
  const carryoverPendingSegmentsCount = carryoverPendingSegments.length;
  const activeMonthPendingSegmentsCount = useMemo(() => countPendingElapsedSegments(monthSegments, segmentSummaryByKey, todayStart), [monthSegments, segmentSummaryByKey, todayStart]);
  const carryoverPendingSegmentsForButtonCount = useMemo(() => {
    if (isViewingCarryoverMonth) return 0;
    return countPendingElapsedSegments(carryoverMonthSegments, carryoverSummaryByKey, todayStart);
  }, [carryoverMonthSegments, carryoverSummaryByKey, isViewingCarryoverMonth, todayStart]);
  const hasUrgentPendingSegments = activeMonthPendingSegmentsCount + carryoverPendingSegmentsForButtonCount > 0;
  const shouldShowCarryoverBanner = isCarryoverSummaryLoaded && carryoverPendingSegmentsCount > 0 && (isViewingCurrentMonth || isViewingCarryoverMonth);
  const shouldAutoOpenCarryoverMonth = shouldShowCarryoverBanner && isViewingCurrentMonth && !isSegmentElapsed(currentMonthSegments[0], todayStart);
  const carryoverMonthLabelLower = carryoverMonthLabel.toLowerCase();
  const carryoverMonthName = carryoverMonthLabelLower.split(' ')[0] || carryoverMonthLabelLower;
  const currentMonthLabelLower = currentMonthLabel.toLowerCase();
  const carryoverSegmentWord =
    carryoverPendingSegmentsCount % 10 === 1 && carryoverPendingSegmentsCount % 100 !== 11
      ? 'отрезок'
      : carryoverPendingSegmentsCount % 10 >= 2 && carryoverPendingSegmentsCount % 10 <= 4 && (carryoverPendingSegmentsCount % 100 < 10 || carryoverPendingSegmentsCount % 100 >= 20)
      ? 'отрезка'
      : 'отрезков';

  /* ── auto-corrections ── */
  useEffect(() => { if (activeDate.getTime() > todayStart.getTime()) setActiveDate(todayStart); }, [activeDate, todayStart]);
  useEffect(() => { if (!carryoverPendingSegmentsCount) setIgnoreCarryoverAutoOpen(false); }, [carryoverPendingSegmentsCount]);

  useEffect(() => {
    if (timesheetMode === 2 || isLoading || ignoreCarryoverAutoOpen || !shouldAutoOpenCarryoverMonth) return;
    const firstPendingSegment = carryoverPendingSegments[0];
    if (!firstPendingSegment) return;
    const currentKey = formatDateKey(startOfDay(activeDate));
    const targetKey = formatDateKey(startOfDay(firstPendingSegment.weekStart));
    if (currentKey === targetKey) return;
    setActiveDate(startOfDay(firstPendingSegment.weekStart));
  }, [activeDate, carryoverPendingSegments, ignoreCarryoverAutoOpen, isLoading, shouldAutoOpenCarryoverMonth, timesheetMode]);

  useEffect(() => {
    if (!latestElapsedSegment || activeSegmentIsElapsed || activeSegment?.id === latestElapsedSegment.id) return;
    setActiveDate(startOfDay(latestElapsedSegment.weekStart));
  }, [activeSegment?.id, activeSegmentIsElapsed, latestElapsedSegment]);

  /* ── reward animation ── */
  useEffect(() => {
    const prev = previousTotalsRef.current;
    let nextRewardScope = null;
    if (prev.project !== MAX_TOTAL_PERCENT && projectTotalPercent === MAX_TOTAL_PERCENT && !isLoading) nextRewardScope = 'project';
    if (prev.activity !== MAX_TOTAL_PERCENT && activityTotalPercent === MAX_TOTAL_PERCENT && !isLoading) nextRewardScope = 'activity';
    previousTotalsRef.current = { project: projectTotalPercent, activity: activityTotalPercent };
    if (nextRewardScope) setRewardScope(nextRewardScope);
  }, [activityTotalPercent, isLoading, projectTotalPercent]);

  useEffect(() => {
    if (!rewardScope) return undefined;
    if (rewardTimerRef.current) window.clearTimeout(rewardTimerRef.current);
    rewardTimerRef.current = window.setTimeout(() => { setRewardScope(null); rewardTimerRef.current = null; }, REWARD_ANIMATION_MS);
    return () => { if (rewardTimerRef.current) { window.clearTimeout(rewardTimerRef.current); rewardTimerRef.current = null; } };
  }, [rewardScope]);

  useEffect(() => () => { if (closeAfterSubmitTimerRef.current) { window.clearTimeout(closeAfterSubmitTimerRef.current); closeAfterSubmitTimerRef.current = null; } }, []);

  /* ── pointer painting ── */
  useEffect(() => {
    const stopPainting = () => { paintRef.current.active = false; paintRef.current.scope = null; paintRef.current.key = null; paintRef.current.pointerId = undefined; };
    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);
    return () => { window.removeEventListener('pointerup', stopPainting); window.removeEventListener('pointercancel', stopPainting); };
  }, []);

  /* ── telegram swipes ── */
  useEffect(() => {
    if (!telegramWebApp) return undefined;
    telegramWebApp.expand();
    if (timesheetMode === 2) { telegramWebApp.enableVerticalSwipes?.(); return undefined; }
    if (isSubmitted) telegramWebApp.enableVerticalSwipes?.(); else telegramWebApp.disableVerticalSwipes?.();
    return () => { telegramWebApp.enableVerticalSwipes?.(); };
  }, [isSubmitted, telegramWebApp, timesheetMode]);

  useEffect(() => {
    if (!telegramWebApp) return undefined;
    return () => { telegramWebApp.MainButton.hide(); telegramWebApp.BackButton.hide(); };
  }, [telegramWebApp]);

  /* ── auth helpers ── */
  const ensureMemberId = useCallback(async (authToken) => {
    if (memberId) return memberId;
    const resolved = await resolveMemberId(authToken);
    if (resolved) { setMemberId(resolved); return resolved; }
    return null;
  }, [memberId]);

  const silentTelegramLogin = useCallback(async () => {
    const initData = String(telegramWebApp?.initData || '').trim();
    if (!initData) return null;
    try {
      const payload = await requestJson(`${API_BASE}/auth-service/api/v1/telegram/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ init_data: initData }) }, 'Не удалось авторизоваться через Telegram');
      const result = payload && typeof payload === 'object' && !Array.isArray(payload) && 'result' in payload ? payload.result : payload;
      const tokenFromPayload = payload?.message || payload?.token || result?.message || result?.token || '';
      const bearerToken = normalizeBearerToken(tokenFromPayload);
      if (!bearerToken) return null;
      storage.setItem('token', bearerToken);
      const memberFromPayload = toPositiveInt(payload?.id || payload?.value?.id || payload?.member_id || result?.id || result?.value?.id || result?.member_id);
      let resolvedMemberId = memberFromPayload;
      if (!resolvedMemberId) resolvedMemberId = await fetchSessionMemberId(bearerToken);
      if (resolvedMemberId) { storage.setItem('userId', String(resolvedMemberId)); setMemberId(resolvedMemberId); }
      return bearerToken;
    } catch { return null; }
  }, [telegramWebApp]);

  const ensureAuthToken = useCallback(async () => {
    const existingToken = normalizeBearerToken(storage.getItem('token'));
    if (existingToken) return existingToken;
    return silentTelegramLogin();
  }, [silentTelegramLogin]);

  const resolveActiveSession = useCallback(async () => {
    let authToken = await ensureAuthToken();
    if (!authToken) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const resolvedMemberID = await ensureMemberId(authToken);
        if (resolvedMemberID) return { token: authToken, memberId: resolvedMemberID };
      } catch (err) {
        if (err?.isAuthError && attempt === 0) { const renewed = await silentTelegramLogin(); if (renewed) { authToken = renewed; continue; } }
        throw err;
      }
      if (attempt === 0) { const renewed = await silentTelegramLogin(); if (renewed) { authToken = renewed; continue; } }
    }
    return null;
  }, [ensureAuthToken, ensureMemberId, silentTelegramLogin]);

  const runWithAuthRetry = useCallback(async (runner) => {
    let session = await resolveActiveSession();
    if (!session?.token || !session?.memberId) throw new Error('Не удалось авторизоваться. Выполните вход в приложении.');
    let authToken = session.token;
    let resolvedMemberId = session.memberId;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await runner(authToken, resolvedMemberId); } catch (err) {
        if (err?.isAuthError && attempt === 0) {
          const renewed = await silentTelegramLogin();
          if (renewed) { authToken = renewed; const mid = await ensureMemberId(renewed); if (mid) { resolvedMemberId = mid; continue; } throw new Error('Не удалось определить пользователя в текущей сессии.'); }
        }
        throw err;
      }
    }
    throw new Error('Не удалось выполнить запрос.');
  }, [ensureMemberId, resolveActiveSession, silentTelegramLogin]);

  /* ── hours catalog / day loading ── */
  const loadHoursCatalog = useCallback(async () => {
    setHoursIsCatalogLoading(true); setHoursError(null); setHoursNotice(null);
    try {
      const [projectsShort, actTypes] = await runWithAuthRetry((token, mid) => Promise.all([fetchProjectsShort(token, mid), fetchActivityTypesFull(token)]));
      setHoursProjectsShort(projectsShort); setHoursActivityTypesFull(actTypes);
    } catch (e) { setHoursError(e.message || 'Не удалось загрузить справочники для учета часов.'); setHoursProjectsShort([]); setHoursActivityTypesFull([]); } finally { setHoursIsCatalogLoading(false); }
  }, [runWithAuthRetry]);

  const loadHoursDayEntries = useCallback(async (spentOnKey) => {
    if (!spentOnKey) return;
    setHoursIsDayLoading(true); setHoursError(null);
    try {
      const payload = await runWithAuthRetry((token, mid) => fetchTimeEntriesDay(token, mid, spentOnKey));
      setHoursDayEntries(payload);
    } catch (e) { setHoursError(e.message || 'Не удалось загрузить worklogs за выбранный день.'); setHoursDayEntries(null); } finally { setHoursIsDayLoading(false); }
  }, [runWithAuthRetry]);

  useEffect(() => {
    if (timesheetMode !== 2) return;
    setHoursActiveTab('add'); setHoursSelectedDate(formatDateKey(todayStart)); setHoursEditingEntry(null); setHoursDayEntries(null);
    setHoursDraftEntry({ project_id: 0, activity_type_id: 0, bucket: WORK_BUCKET, hours: 0, comment: '' });
    setHoursError(null); setHoursNotice(null);
  }, [timesheetMode, todayStart]);

  useEffect(() => { if (timesheetMode !== 2) return; loadHoursCatalog(); }, [loadHoursCatalog, timesheetMode]);
  useEffect(() => { if (timesheetMode !== 2) return; loadHoursDayEntries(hoursSelectedDate); }, [hoursSelectedDate, loadHoursDayEntries, timesheetMode]);

  /* ── segment data apply ── */
  const applySegmentData = useCallback((entry) => {
    if (!entry) return;
    setProjectPercentById(entry.projectPercents); setInitialProjectPercentById(entry.projectPercents);
    setActivityPercentByCode(entry.activityPercents); setInitialActivityPercentByCode(entry.activityPercents);
  }, []);

  /* ── main month data loader ── */
  const loadMonthData = useCallback(async () => {
    let session = null;
    try { session = await resolveActiveSession(); } catch (e) { setIsCarryoverSummaryLoaded(false); setError(e.message || 'Не удалось авторизоваться.'); return; }
    if (!session?.token || !session?.memberId) { setIsCarryoverSummaryLoaded(false); setError('Не удалось авторизоваться.'); return; }
    let authToken = session.token;
    let resolvedMemberId = session.memberId;

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setIsLoading(true); setIsCarryoverSummaryLoaded(false); setError(null);

    try {
      const resolvedMode = await fetchSessionTimesheetMode(authToken);
      if (loadRequestRef.current !== requestId) return;
      if (resolvedMode) setTimesheetMode(resolvedMode);
      if (resolvedMode === 2) {
        setIsLoading(false); setProjects([]); setActivityTypes(DEFAULT_ACTIVITY_TYPES);
        setProjectPercentById({}); setInitialProjectPercentById({}); setActivityPercentByCode({}); setInitialActivityPercentByCode({});
        setSegmentDataByKey({}); setSegmentSummaryByKey({}); setCarryoverSummaryByKey({}); setIsCarryoverSummaryLoaded(false); setError(null);
        return;
      }
    } catch { if (loadRequestRef.current !== requestId) return; }

    const runLoad = async (token, currentMemberID) => {
      const fetchedActivityTypes = await fetchActivityTypes(token);
      const loadMonthSnapshot = async (targetMonthStart, targetMonthEnd) => {
        const targetSegments = buildMonthSegments(targetMonthStart);
        const monthProjects = await fetchProjects(token, currentMemberID, targetMonthStart, targetMonthEnd);
        const projectIds = monthProjects.map((p) => p.id);
        const segmentPayloads = await Promise.all(
          targetSegments.map(async (seg) => {
            const [rangeRows, weeklyWorkload] = await Promise.all([
              fetchRangeLite(token, currentMemberID, projectIds, seg.weekStart, seg.weekEnd),
              fetchWeeklyActivityDistribution(token, currentMemberID, seg.weekStart, seg.weekEnd)
            ]);
            const segKey = getSegmentKey(seg.weekStart, seg.weekEnd);
            const entry = buildSegmentDataEntry({ projects: monthProjects, activityTypes: fetchedActivityTypes, rangeRows, weeklyDistribution: weeklyWorkload.activityDistribution, isLocked: weeklyWorkload.isLocked, rangeStart: seg.weekStart, rangeEnd: seg.weekEnd });
            return { segmentKey: segKey, entry };
          })
        );
        const nextSegDataByKey = {}; const nextSummByKey = {};
        segmentPayloads.forEach((item) => {
          nextSegDataByKey[item.segmentKey] = item.entry;
          nextSummByKey[item.segmentKey] = {
            projectTotal: item.entry.projectTotal,
            activityTotal: item.entry.activityTotal,
            isLocked: Boolean(item.entry.isLocked)
          };
        });
        return { projects: monthProjects, segmentDataByKey: nextSegDataByKey, summaryByKey: nextSummByKey };
      };

      const activeMonthSnap = await loadMonthSnapshot(monthStart, monthEnd);
      const nextCarryoverSummary = monthKey === carryoverMonthKey ? activeMonthSnap.summaryByKey : (await loadMonthSnapshot(carryoverMonthStart, carryoverMonthEnd)).summaryByKey;
      if (loadRequestRef.current !== requestId) return;

      setProjects(activeMonthSnap.projects); setActivityTypes(fetchedActivityTypes);
      setSegmentDataByKey(activeMonthSnap.segmentDataByKey); setSegmentSummaryByKey(activeMonthSnap.summaryByKey);
      setCarryoverSummaryByKey(nextCarryoverSummary); setIsCarryoverSummaryLoaded(true);

      const activeEntry = activeMonthSnap.segmentDataByKey[weekKey];
      if (activeEntry) { applySegmentData(activeEntry); } else {
        const emptyP = {}; activeMonthSnap.projects.forEach((p) => { emptyP[p.id] = 0; });
        const emptyA = {}; fetchedActivityTypes.forEach((t) => { emptyA[t.code] = 0; });
        applySegmentData({ projectPercents: emptyP, activityPercents: emptyA });
      }
      setIsSubmitted(false); setStep(1); previousWeekKeyRef.current = weekKey;
    };

    let loadError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { await runLoad(authToken, resolvedMemberId); loadError = null; break; } catch (err) {
        if (loadRequestRef.current !== requestId) return;
        if (err?.status === 409) {
          setTimesheetMode(2); setIsLoading(false); setProjects([]); setActivityTypes(DEFAULT_ACTIVITY_TYPES);
          setProjectPercentById({}); setInitialProjectPercentById({}); setActivityPercentByCode({}); setInitialActivityPercentByCode({});
          setSegmentDataByKey({}); setSegmentSummaryByKey({}); setCarryoverSummaryByKey({}); setIsCarryoverSummaryLoaded(false); setError(null); return;
        }
        if (err?.isAuthError && attempt === 0) {
          const renewed = await silentTelegramLogin();
          if (renewed) { authToken = renewed; const mid = await ensureMemberId(renewed); if (mid) { resolvedMemberId = mid; continue; } loadError = new Error('Не удалось определить пользователя.'); break; }
        }
        loadError = err; break;
      }
    }

    if (loadError) {
      if (loadRequestRef.current !== requestId) return;
      setError(loadError.message || 'Не удалось загрузить weekly данные'); setProjects([]); setActivityTypes(DEFAULT_ACTIVITY_TYPES);
      setProjectPercentById({}); setInitialProjectPercentById({}); setActivityPercentByCode({}); setInitialActivityPercentByCode({});
      setSegmentDataByKey({}); setSegmentSummaryByKey({}); setCarryoverSummaryByKey({}); setIsCarryoverSummaryLoaded(false);
    }
    if (loadRequestRef.current === requestId) setIsLoading(false);
  }, [applySegmentData, carryoverMonthEnd, carryoverMonthKey, carryoverMonthStart, ensureMemberId, monthEnd, monthKey, monthStart, resolveActiveSession, silentTelegramLogin, weekKey]);

  useEffect(() => { loadMonthData(); }, [loadMonthData]);

  useEffect(() => {
    if (previousWeekKeyRef.current === weekKey) return;
    previousWeekKeyRef.current = weekKey;
    const nextEntry = segmentDataByKey[weekKey];
    if (!nextEntry) return;
    applySegmentData(nextEntry); setIsSubmitted(false); setStep(1);
  }, [applySegmentData, segmentDataByKey, weekKey]);

  /* ── percent interaction ── */
  const updatePercentValue = useCallback((scope, key, nextValue) => {
    const snapped = snapToSegmentPercent(nextValue);
    const applyUpdate = (setter) => {
      setter((prev) => {
        const sk = String(key); const current = prev[sk] || 0;
        if (snapped === current) return prev;
        const totalWithoutCurrent = Object.entries(prev).reduce((sum, [k, v]) => k === sk ? sum : sum + (Number(v) || 0), 0);
        if (snapped > current && totalWithoutCurrent + snapped > MAX_TOTAL_PERCENT) return prev;
        return { ...prev, [sk]: snapped };
      });
    };
    if (scope === 'project') applyUpdate(setProjectPercentById); else applyUpdate(setActivityPercentByCode);
    setIsSubmitted(false);
  }, []);

  const setRowToAvailableMax = useCallback((scope, key) => {
    const applyMax = (setter) => {
      setter((prev) => {
        const sk = String(key);
        const totalWithoutCurrent = Object.entries(prev).reduce((sum, [k, v]) => k === sk ? sum : sum + (Number(v) || 0), 0);
        const maxAllowed = Math.max(0, Math.min(MAX_TOTAL_PERCENT, Math.floor(Math.max(0, MAX_TOTAL_PERCENT - totalWithoutCurrent) / SEGMENT_STEP) * SEGMENT_STEP));
        if ((prev[sk] || 0) === maxAllowed) return prev;
        return { ...prev, [sk]: maxAllowed };
      });
    };
    if (scope === 'project') applyMax(setProjectPercentById); else applyMax(setActivityPercentByCode);
    setIsSubmitted(false);
  }, []);

  const resolvePercentFromPointer = useCallback((event) => {
    const track = event.currentTarget;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const offsetX = Math.min(width, Math.max(0, event.clientX - rect.left));
    return clampPercent(Math.round((offsetX / width * MAX_TOTAL_PERCENT) / SEGMENT_STEP) * SEGMENT_STEP);
  }, []);

  const handleTrackPointerDown = useCallback((scope, key, event) => {
    if (activeSegmentPendingRelease || activeSegmentIsLocked || isLoading || isSaving) return;
    if (event.pointerType === 'mouse') event.preventDefault();
    const rowKey = `${scope}:${String(key)}`;
    const now = Date.now();
    const isDoubleTap = tapRef.current.rowKey === rowKey && now - tapRef.current.at <= DOUBLE_TAP_THRESHOLD_MS;
    tapRef.current = { rowKey, at: now };
    if (isDoubleTap) { paintRef.current.active = false; paintRef.current.scope = null; paintRef.current.key = null; paintRef.current.pointerId = undefined; setRowToAvailableMax(scope, key); return; }
    const nextPercent = resolvePercentFromPointer(event);
    paintRef.current.active = true; paintRef.current.scope = scope; paintRef.current.key = String(key); paintRef.current.pointerId = event.pointerId;
    if (event.pointerType === 'mouse') { try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* noop */ } }
    updatePercentValue(scope, key, nextPercent);
  }, [activeSegmentPendingRelease, activeSegmentIsLocked, isLoading, isSaving, resolvePercentFromPointer, setRowToAvailableMax, updatePercentValue]);

  const handleTrackPointerMove = useCallback((scope, key, event) => {
    if (activeSegmentPendingRelease || activeSegmentIsLocked) return;
    if (!paintRef.current.active) return;
    if (paintRef.current.scope !== scope || paintRef.current.key !== String(key)) return;
    if (paintRef.current.pointerId !== undefined && paintRef.current.pointerId !== event.pointerId) return;
    updatePercentValue(scope, key, resolvePercentFromPointer(event));
  }, [activeSegmentPendingRelease, activeSegmentIsLocked, resolvePercentFromPointer, updatePercentValue]);

  const handleTrackPointerEnd = useCallback((event) => {
    if (paintRef.current.pointerId !== undefined) { try { event.currentTarget?.releasePointerCapture?.(paintRef.current.pointerId); } catch { /* noop */ } }
    paintRef.current.active = false; paintRef.current.scope = null; paintRef.current.key = null; paintRef.current.pointerId = undefined;
  }, []);

  /* ── navigation ── */
  const confirmRangeSwitch = useCallback(() => {
    if (!isDirty || isSaving) return true;
    return window.confirm('Есть несохраненные изменения. Перейти на другой отрезок без сохранения?');
  }, [isDirty, isSaving]);

  const openCurrentMonth = useCallback(() => { if (!confirmRangeSwitch()) return; setIgnoreCarryoverAutoOpen(true); setActiveDate(startOfDay(currentMonthStart)); }, [confirmRangeSwitch, currentMonthStart]);
  const openCarryoverMonth = useCallback(() => { if (!confirmRangeSwitch()) return; const first = carryoverPendingSegments[0]; setIgnoreCarryoverAutoOpen(false); setActiveDate(startOfDay(first?.weekStart || carryoverMonthStart)); }, [carryoverMonthStart, carryoverPendingSegments, confirmRangeSwitch]);

  const selectSegment = useCallback((segment) => {
    if (!segment || !isSegmentElapsed(segment, todayStart) || segment.id === activeSegment?.id || !confirmRangeSwitch()) return;
    setActiveDate(startOfDay(segment.weekStart));
  }, [activeSegment?.id, confirmRangeSwitch, todayStart]);

  /* ── submit ── */
  const handleSubmit = useCallback(async () => {
    let session = null;
    try { session = await resolveActiveSession(); } catch (e) { setError(e.message || 'Не удалось авторизоваться.'); return; }
    if (!session?.token || !session?.memberId) { setError('Не удалось авторизоваться.'); return; }
    let authToken = session.token; let resolvedMemberId = session.memberId;
    if (!isPeriodComplete) { setError('Оба шага должны быть заполнены ровно до 100%.'); return; }
    if (activeSegmentPendingRelease) { setError('Отрезок еще не завершен.'); return; }
    if (activeSegmentIsLocked) { setError('Отрезок подтвержден в Pulse и недоступен для редактирования.'); return; }

    setIsSaving(true); setError(null);
    try {
      const projectFacts = buildProjectFactsPayload(resolvedMemberId, projects, projectPercentById, weekStart, weekEnd);
      const actDist = activityTypes.map((t) => ({ activity_type: t.code, percent: clampPercent(activityPercentByCode[t.code] || 0) })).filter((i) => i.percent > 0);
      if (actDist.reduce((s, i) => s + i.percent, 0) !== MAX_TOTAL_PERCENT) throw new Error('Распределение активностей должно быть равно 100%');

      const runSave = (token, mid) => requestJson(`${API_BASE}/project-service/api/v1/timesheet/weekly-workload`, {
        method: 'PUT', headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: mid, week_start: formatDateKey(weekStart), week_end: formatDateKey(weekEnd), project_facts: projectFacts, activity_distribution: actDist })
      }, 'Не удалось сохранить weekly распределение');

      let submitError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { await runSave(authToken, resolvedMemberId); submitError = null; break; } catch (err) {
          if (err?.isAuthError && attempt === 0) { const renewed = await silentTelegramLogin(); if (renewed) { authToken = renewed; const mid = await ensureMemberId(renewed); if (mid) { resolvedMemberId = mid; continue; } submitError = new Error('Не удалось определить пользователя.'); break; } }
          submitError = err; break;
        }
      }
      if (submitError) throw submitError;

      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(JSON.stringify({
          type: 'quickutilization', member_id: resolvedMemberId, telegram_id: getTelegramUserId(),
          week_start: formatDateKey(weekStart), week_end: formatDateKey(weekEnd),
          project_total: projectTotalPercent, activity_total: activityTotalPercent,
          projects: projects.map((p) => ({ project_id: p.id, percent: projectPercentById[p.id] || 0 })),
          activity_distribution: activityTypes.map((t) => ({ activity_type: t.code, percent: activityPercentByCode[t.code] || 0 }))
        }));
      }

      setSegmentDataByKey((prev) => ({ ...prev, [weekKey]: { projectPercents: { ...projectPercentById }, activityPercents: { ...activityPercentByCode }, projectTotal: projectTotalPercent, activityTotal: activityTotalPercent, isLocked: false } }));
      setSegmentSummaryByKey((prev) => ({
        ...prev,
        [weekKey]: { projectTotal: projectTotalPercent, activityTotal: activityTotalPercent, isLocked: false }
      }));
      if (isViewingCarryoverMonth) {
        setCarryoverSummaryByKey((prev) => ({
          ...prev,
          [weekKey]: { projectTotal: projectTotalPercent, activityTotal: activityTotalPercent, isLocked: false }
        }));
      }
      setInitialProjectPercentById({ ...projectPercentById }); setInitialActivityPercentByCode({ ...activityPercentByCode }); setIsSubmitted(true);
      if (window.Telegram?.WebApp) { if (closeAfterSubmitTimerRef.current) window.clearTimeout(closeAfterSubmitTimerRef.current); closeAfterSubmitTimerRef.current = window.setTimeout(() => { window.Telegram?.WebApp?.close?.(); closeAfterSubmitTimerRef.current = null; }, 420); }
    } catch (e) { setError(e.message || 'Ошибка сохранения'); setIsSubmitted(false); } finally { setIsSaving(false); }
  }, [activityPercentByCode, activityTotalPercent, activeSegmentPendingRelease, activeSegmentIsLocked, activityTypes, isPeriodComplete, isViewingCarryoverMonth, projectPercentById, projectTotalPercent, projects, weekEnd, weekStart, weekKey, resolveActiveSession, ensureMemberId, silentTelegramLogin]);

  /* ── telegram buttons ── */
  useEffect(() => {
    if (!telegramWebApp) return undefined;
    if (timesheetMode === 2) { telegramWebApp.MainButton.hide(); telegramWebApp.BackButton.hide(); return undefined; }

    const onMainButtonClick = () => { if (step === 1) { if (canGoToStep2) setStep(2); } else if (step === 2) handleSubmit(); };
    const onBackButtonClick = () => { if (step === 2 && !isSaving) setStep(1); };

    const syncButtons = () => {
      const mainButton = telegramWebApp.MainButton; const backButton = telegramWebApp.BackButton;
      const themeParams = telegramWebApp.themeParams || {};
      const isLightTheme = (telegramWebApp.colorScheme || document.documentElement.dataset.tgColorScheme || 'light') === 'light';
      const regularBtnParams = { color: themeParams.button_color || '#2ea6ff', text_color: themeParams.button_text_color || '#ffffff' };
      const urgentBtnParams = isLightTheme ? { color: '#F85149', text_color: '#ffffff' } : { color: '#ff6b6b', text_color: '#ffffff' };
      const activeBtnParams = hasUrgentPendingSegments ? urgentBtnParams : regularBtnParams;
      const disabledBtnParams = isLightTheme ? { color: '#d3d8e1', text_color: '#7a8493' } : { color: '#4b5563', text_color: '#d1d5db' };
      const resolve = (en) => ({ ...(en ? activeBtnParams : disabledBtnParams), is_active: en, is_visible: true });
      const applyMain = (en, text) => { mainButton.setParams({ ...resolve(en), text }); if (en) mainButton.enable?.(); else mainButton.disable?.(); };

      if (step === 1) { applyMain(canGoToStep2, 'К шагу 2'); mainButton.show(); backButton.hide(); return; }
      const canSave = !activeSegmentPendingRelease && !activeSegmentIsLocked && !isSaving && !isLoading && !error && isPeriodComplete && projects.length > 0;
      applyMain(canSave, isSaving ? 'Сохраняем...' : isSubmitted ? 'Сохранено' : 'Сохранить');
      mainButton.show(); backButton.show();
    };

    syncButtons();
    telegramWebApp.onEvent('mainButtonClicked', onMainButtonClick);
    telegramWebApp.onEvent('backButtonClicked', onBackButtonClick);
    return () => { telegramWebApp.offEvent('mainButtonClicked', onMainButtonClick); telegramWebApp.offEvent('backButtonClicked', onBackButtonClick); };
  }, [activeSegmentPendingRelease, activeSegmentIsLocked, canGoToStep2, error, handleSubmit, hasUrgentPendingSegments, isLoading, isPeriodComplete, isSaving, isSubmitted, projects.length, step, timesheetMode, telegramWebApp]);

  /* ── hours-mode handlers ── */
  const hoursIsLoading = hoursIsCatalogLoading || hoursIsDayLoading;
  const hoursWorklogsCount = hoursDayEntries?.projects?.reduce((acc, p) => acc + (Array.isArray(p?.entries) ? p.entries.length : 0), 0) ?? 0;

  const hoursConfirmStatusByProjectId = useMemo(() => {
    const raw = hoursDayEntries?.confirm_status_by_project_id; const map = {};
    if (!raw || typeof raw !== 'object') return map;
    Object.entries(raw).forEach(([pid, statusRaw]) => { const id = Number(pid); const s = Number(statusRaw); if (Number.isFinite(id) && id > 0 && Number.isFinite(s)) map[id] = s; });
    return map;
  }, [hoursDayEntries?.confirm_status_by_project_id]);

  const isHoursEntryEditing = Boolean(hoursEditingEntry);
  const hoursOriginalEntry = useMemo(() => {
    if (!hoursEditingEntry) return null;
    const project = hoursDayEntries?.projects?.find((i) => Number(i?.project_id) === Number(hoursEditingEntry.project_id));
    const entry = project?.entries?.find((i) => Number(i?.id) === Number(hoursEditingEntry.entry_id));
    if (!entry) return null;
    return { hours: safeIntegerHours(entry?.hours), bucket: Number(entry?.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET };
  }, [hoursDayEntries?.projects, hoursEditingEntry]);

  const hoursBaseWork = Number(hoursDayEntries?.work_hour || 0);
  const hoursBaseOver = Number(hoursDayEntries?.over_hour || 0);
  const hoursBaseTotal = hoursBaseWork + hoursBaseOver;
  const safeDraftHours = Number.isInteger(hoursDraftEntry.hours) && hoursDraftEntry.hours > 0 ? hoursDraftEntry.hours : 0;
  const trimmedDraftComment = String(hoursDraftEntry.comment || '').trim();
  const originalHours = hoursOriginalEntry?.hours ?? 0;
  const originalBucket = hoursOriginalEntry?.bucket ?? WORK_BUCKET;
  const previewWork = hoursBaseWork - (originalBucket === WORK_BUCKET ? originalHours : 0) + (hoursDraftEntry.bucket === WORK_BUCKET ? safeDraftHours : 0);
  const previewOver = hoursBaseOver - (originalBucket === OVER_BUCKET ? originalHours : 0) + (hoursDraftEntry.bucket === OVER_BUCKET ? safeDraftHours : 0);
  const previewTotal = previewWork + previewOver;
  const hasInvalidHours = !Number.isInteger(hoursDraftEntry.hours) || hoursDraftEntry.hours < 0;
  const hasMissingProject = safeDraftHours > 0 && hoursDraftEntry.project_id <= 0;
  const hasMissingActivity = safeDraftHours > 0 && hoursDraftEntry.activity_type_id <= 0;
  const hasMissingComment = safeDraftHours > 0 && trimmedDraftComment.length === 0;
  const hasNoHoursProjects = hoursProjectOptions.length === 0;
  const hasNoHoursActivities = hoursActivityTypesFull.length === 0;
  const isHoursDateValid = hoursSelectedDate >= hoursMinDate && hoursSelectedDate <= hoursMaxDate && hoursSelectedDate.startsWith(hoursMonthPrefix);
  const isDayCapExceeded = previewTotal > 8;
  const selectedProjectConfirmStatus = hoursConfirmStatusByProjectId[hoursDraftEntry.project_id] || 0;
  const isSelectedProjectApproved = selectedProjectConfirmStatus === 1;
  const isHoursSaveDisabled = !isHoursDateValid || hoursIsLoading || hoursIsSaving || isSelectedProjectApproved || hasInvalidHours || hasMissingProject || hasMissingActivity || hasMissingComment || hasNoHoursProjects || hasNoHoursActivities || isDayCapExceeded || safeDraftHours <= 0;

  const cancelHoursEditing = () => { setHoursEditingEntry(null); setHoursDraftEntry((prev) => ({ ...prev, hours: 0, comment: '' })); setHoursNotice(null); };

  const startHoursEditEntry = (projectId, entry) => {
    setHoursEditingEntry({ project_id: projectId, entry_id: entry.id });
    setHoursDraftEntry({ project_id: projectId, activity_type_id: Number(entry?.activity_type_id) || 0, bucket: Number(entry?.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET, hours: safeIntegerHours(entry?.hours), comment: String(entry?.comment || '') });
    setHoursActiveTab('add'); setHoursNotice(null);
  };

  const handleHoursSave = async () => {
    if (isHoursSaveDisabled) return;
    const projectId = hoursEditingEntry?.project_id || hoursDraftEntry.project_id;
    if (projectId <= 0) { setHoursError('Выберите проект.'); return; }
    const project = hoursDayEntries?.projects?.find((i) => Number(i?.project_id) === Number(projectId));
    const existingEntries = Array.isArray(project?.entries) ? project.entries : [];
    let payloadEntries = existingEntries.map((e) => makeHoursPayloadLine(e));
    if (hoursEditingEntry) {
      payloadEntries = existingEntries.map((e) => Number(e?.id) === Number(hoursEditingEntry.entry_id) ? { hours: safeDraftHours, bucket: Number(hoursDraftEntry.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET, activity_type_id: Number(hoursDraftEntry.activity_type_id) || 0, comment: trimmedDraftComment } : makeHoursPayloadLine(e));
    } else { payloadEntries.push({ hours: safeDraftHours, bucket: Number(hoursDraftEntry.bucket) === OVER_BUCKET ? OVER_BUCKET : WORK_BUCKET, activity_type_id: Number(hoursDraftEntry.activity_type_id) || 0, comment: trimmedDraftComment }); }
    setHoursIsSaving(true); setHoursError(null); setHoursNotice(null);
    try {
      await runWithAuthRetry((token, mid) => putTimeEntriesDay(token, { member_id: mid, project_id: projectId, spent_on: hoursSelectedDate, entries: payloadEntries }));
      setHoursNotice(hoursEditingEntry ? 'Worklog обновлён' : 'Worklog добавлен'); setHoursEditingEntry(null); setHoursDraftEntry((prev) => ({ ...prev, hours: 0, comment: '' })); loadHoursDayEntries(hoursSelectedDate);
    } catch (e) { setHoursError(e.message || 'Не удалось сохранить worklog.'); } finally { setHoursIsSaving(false); }
  };

  const handleHoursDelete = async (projectId, entryId) => {
    if (!projectId || !entryId || hoursIsSaving || hoursIsLoading) return;
    if ((hoursConfirmStatusByProjectId[projectId] || 0) === 1) return;
    const project = hoursDayEntries?.projects?.find((i) => Number(i?.project_id) === Number(projectId));
    const entries = Array.isArray(project?.entries) ? project.entries : [];
    const target = entries.find((i) => Number(i?.id) === Number(entryId));
    if (!target) return;
    const ok = window.confirm(`Удалить worklog?\n\n${target.activity_type_name} • ${bucketLabel(target.bucket)} • ${target.hours} ч`);
    if (!ok) return;
    const payloadEntries = entries.filter((i) => Number(i?.id) !== Number(entryId)).map((e) => makeHoursPayloadLine(e));
    setHoursIsSaving(true); setHoursError(null); setHoursNotice(null);
    try {
      await runWithAuthRetry((token, mid) => putTimeEntriesDay(token, { member_id: mid, project_id: projectId, spent_on: hoursSelectedDate, entries: payloadEntries }));
      if (hoursEditingEntry?.project_id === projectId && hoursEditingEntry?.entry_id === entryId) cancelHoursEditing();
      setHoursNotice('Worklog удалён'); loadHoursDayEntries(hoursSelectedDate);
    } catch (e) { setHoursError(e.message || 'Не удалось удалить worklog.'); } finally { setHoursIsSaving(false); }
  };

  const handleDraftChange = useCallback((patch) => {
    setHoursDraftEntry((prev) => ({ ...prev, ...patch }));
  }, []);

  /* ── render: hours mode ── */
  if (timesheetMode === 2) {
    return (
      <div className={`time-logger hours-mode ${isTelegramWebApp ? 'telegram-mode' : ''}`}>
        <HoursSummary
          hoursSelectedDate={hoursSelectedDate} hoursMinDate={hoursMinDate} hoursMaxDate={hoursMaxDate}
          hoursIsLoading={hoursIsLoading} hoursIsSaving={hoursIsSaving}
          hoursBaseWork={hoursBaseWork} hoursBaseOver={hoursBaseOver} hoursBaseTotal={hoursBaseTotal}
          safeDraftHours={safeDraftHours} previewWork={previewWork} previewOver={previewOver} previewTotal={previewTotal}
          isSelectedProjectApproved={isSelectedProjectApproved} hoursDraftProjectId={hoursDraftEntry.project_id}
          hoursNotice={hoursNotice} hoursError={hoursError}
          onDateChange={setHoursSelectedDate}
        />

        <div className="hours-tabs" role="tablist" aria-label="Табы учета часов">
          <button type="button" className={`hours-tab ${hoursActiveTab === 'add' ? 'active' : ''}`} role="tab" aria-selected={hoursActiveTab === 'add'} onClick={() => setHoursActiveTab('add')} disabled={hoursIsLoading || hoursIsSaving}>Добавить</button>
          <button type="button" className={`hours-tab ${hoursActiveTab === 'worklogs' ? 'active' : ''}`} role="tab" aria-selected={hoursActiveTab === 'worklogs'} onClick={() => { if (isHoursEntryEditing) { window.alert('Сначала сохраните или отмените редактирование worklog.'); return; } setHoursActiveTab('worklogs'); }} disabled={hoursIsLoading || hoursIsSaving}>
            Worklogs <span className="hours-badge">{hoursIsDayLoading ? '—' : hoursWorklogsCount}</span>
          </button>
        </div>

        <section className="panel panel--list">
          <div className="segments-list hours-scroll">
            {hoursActiveTab === 'add' ? (
              <HoursForm
                isHoursEntryEditing={isHoursEntryEditing} hoursDraftEntry={hoursDraftEntry}
                hoursActivityTypesFull={hoursActivityTypesFull} hoursProjectOptions={hoursProjectOptions}
                hoursIsSaving={hoursIsSaving} hoursIsLoading={hoursIsLoading}
                isSelectedProjectApproved={isSelectedProjectApproved}
                hasNoHoursActivities={hasNoHoursActivities} hasNoHoursProjects={hasNoHoursProjects}
                hasInvalidHours={hasInvalidHours} hasMissingProject={hasMissingProject}
                hasMissingActivity={hasMissingActivity} hasMissingComment={hasMissingComment}
                isDayCapExceeded={isDayCapExceeded} isHoursDateValid={isHoursDateValid}
                onDraftChange={handleDraftChange} onCancelEditing={cancelHoursEditing}
              />
            ) : (
              <WorklogList
                hoursDayEntries={hoursDayEntries} hoursSelectedDate={hoursSelectedDate}
                hoursConfirmStatusByProjectId={hoursConfirmStatusByProjectId}
                hoursIsLoading={hoursIsLoading} hoursIsSaving={hoursIsSaving}
                onEditEntry={startHoursEditEntry} onDeleteEntry={handleHoursDelete}
                onSwitchToAdd={() => setHoursActiveTab('add')}
              />
            )}
          </div>

          <div className={`actions-row ${hoursActiveTab === 'worklogs' || (hoursActiveTab === 'add' && !isHoursEntryEditing) ? 'actions-row--single' : ''}`}>
            {hoursActiveTab === 'add' ? (
              <>
                {isHoursEntryEditing && <button type="button" className="secondary-button" onClick={cancelHoursEditing} disabled={hoursIsSaving || hoursIsLoading}>Отмена</button>}
                <button type="button" className="primary-button" onClick={handleHoursSave} disabled={isHoursSaveDisabled}>{hoursIsSaving ? 'Сохраняем...' : 'Сохранить'}</button>
              </>
            ) : (
              <button type="button" className="primary-button" onClick={() => setHoursActiveTab('add')} disabled={hoursIsSaving || hoursIsLoading}>Добавить</button>
            )}
          </div>
        </section>
      </div>
    );
  }

  /* ── render: percent mode ── */
  const renderedRows = step === 1 ? projectRows : activityRows;
  const currentScope = step === 1 ? 'project' : 'activity';
  const currentTotal = step === 1 ? projectTotalPercent : activityTotalPercent;
  const isCurrentComplete = currentTotal === MAX_TOTAL_PERCENT;
  const isCurrentRewardActive = rewardScope === currentScope;
  const baseStepHint = step === 1
    ? 'Шаг 1. Проведи пальцем по полосе инициативы, чтобы закрасить процент. Двойной тап по полосе — максимум.'
    : 'Шаг 2. Так же проведи пальцем по полосе активности. Двойной тап по полосе — максимум.';

  let infoText = baseStepHint;
  let infoTone = 'neutral';
  let showInfoRetry = false;
  if (error) { infoText = error; infoTone = 'danger'; showInfoRetry = true; }
  else if (activeSegmentPendingRelease) { const nextDay = activeSegment ? addDays(activeSegment.weekEnd, 1) : null; infoText = nextDay ? `Отрезок станет доступен с ${formatShortDate(nextDay)}.` : 'Отрезок станет доступен после окончания периода.'; infoTone = 'info'; }
  else if (activeSegmentIsLocked) { infoText = 'Отрезок подтвержден в Pulse и доступен только для просмотра.'; infoTone = 'info'; }
  else if (isSaving) { infoText = 'Сохраняем отрезок...'; infoTone = 'info'; }
  else if (isLoading) { infoText = 'Загружаем данные отрезков...'; infoTone = 'info'; }
  else if (isSubmitted) { infoText = 'Отрезок успешно сохранен'; infoTone = 'success'; }

  const infoToneIconMap = { neutral: 'ℹ️', info: 'ℹ️', warning: '⚠️', success: '✅', danger: '⛔' };
  const infoToneIcon = infoToneIconMap[infoTone] || infoToneIconMap.neutral;

  return (
    <div className={`time-logger ${isTelegramWebApp ? 'telegram-mode' : ''}`}>
      <Stepper step={step} isProjectComplete={isProjectComplete} isActivityComplete={isActivityComplete} canGoToStep2={canGoToStep2} onSetStep={setStep} />

      {shouldShowCarryoverBanner && (
        <CarryoverBanner
          carryoverPendingSegmentsCount={carryoverPendingSegmentsCount} carryoverSegmentWord={carryoverSegmentWord}
          carryoverMonthLabelLower={carryoverMonthLabelLower} currentMonthLabelLower={currentMonthLabelLower}
          isViewingCarryoverMonth={isViewingCarryoverMonth} isLoading={isLoading} isSaving={isSaving}
          onOpenCarryoverMonth={openCarryoverMonth} onOpenCurrentMonth={openCurrentMonth} carryoverMonthName={carryoverMonthName}
        />
      )}

      <SegmentBar monthSegments={monthSegments} activeSegment={activeSegment} segmentSummaryByKey={segmentSummaryByKey} todayStart={todayStart} isLoading={isLoading} isSaving={isSaving} onSelectSegment={selectSegment} />

      <SummaryTotal step={step} currentTotal={currentTotal} isCurrentComplete={isCurrentComplete} isCurrentRewardActive={isCurrentRewardActive} />

      <div className={`step-description step-description--${infoTone}`}>
        <span className="step-description__main">
          <span className="step-description__icon" aria-hidden="true">{infoToneIcon}</span>
          <span className="step-description__text">{infoText}</span>
        </span>
        {showInfoRetry && <button type="button" className="step-description__retry" onClick={loadMonthData}>Обновить</button>}
      </div>

      <section className="panel panel--list">
        {renderedRows.length > 0 ? (
          <ProjectSlider rows={renderedRows} activeSegmentIsLocked={activeSegmentIsLocked} currentScope={currentScope} onPointerDown={handleTrackPointerDown} onPointerMove={handleTrackPointerMove} onPointerEnd={handleTrackPointerEnd} />
        ) : (
          <div className="no-projects">
            <p>{step === 1 ? 'Нет активных инициатив в выбранном отрезке' : 'Нет активных типов активностей'}</p>
          </div>
        )}

        {!isTelegramWebApp && (
          <div className="actions-row">
            {step === 2 ? (
              <button type="button" className="secondary-button" onClick={() => setStep(1)} disabled={isSaving}>Назад</button>
            ) : (
              <button type="button" className="secondary-button" onClick={() => loadMonthData()} disabled={isSaving || isLoading}>Обновить</button>
            )}
            {step === 1 ? (
              <button type="button" className="primary-button" onClick={() => setStep(2)} disabled={!canGoToStep2}>К шагу 2</button>
            ) : (
              <button type="button" className={`primary-button ${isSubmitted ? 'submitted' : ''}`} onClick={handleSubmit} disabled={activeSegmentPendingRelease || activeSegmentIsLocked || isSaving || !isPeriodComplete || projects.length === 0}>
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
