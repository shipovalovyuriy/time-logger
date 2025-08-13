import React, { useState, useEffect, useRef, useCallback } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import storage from '../utils/storage';
import './TimeLogger.css';

const TimeLogger = () => {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timesheetData, setTimesheetData] = useState([]); // Store full timesheet data
  const [startDragAngle, setStartDragAngle] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [hoursPerProject, setHoursPerProject] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [hintHidden, setHintHidden] = useState(false); // Track if hint should be hidden

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const centerXRef = useRef(0);
  const centerYRef = useRef(0);
  const radiusRef = useRef(0);
  const maxHours = 8; // Maximum total hours per day

  // Canvas drawing constants
  const BASE_STROKE = 26;
  const SEGMENT_STROKE = 30;

  // Calculate total hours
  const sumHours = useCallback(() => {
    return Math.round(Object.values(hoursPerProject).reduce((sum, hours) => sum + Math.max(0, hours || 0), 0));
  }, [hoursPerProject]);

  // Check if total hours exceed limit
  const totalHours = sumHours();

  // Fixed set of highly contrasting colors for projects
  const getProjectColor = (projectId) => {
    const colors = [
      '#FF0000', // Яркий красный
      '#00FF00', // Яркий зеленый
      '#0000FF', // Яркий синий
      '#FFFF00', // Яркий желтый
      '#FF00FF', // Яркий пурпурный
      '#00FFFF', // Яркий циан
      '#FF8000', // Яркий оранжевый
      '#8000FF', // Яркий фиолетовый
      '#FF0080', // Яркий розовый
      '#80FF00', // Яркий лаймовый
      '#0080FF', // Яркий голубой
      '#FF4000', // Яркий красно-оранжевый
      '#4000FF', // Яркий сине-фиолетовый
      '#FF8040', // Яркий персиковый
      '#8040FF', // Яркий лавандовый
      '#FF4080'  // Яркий малиновый
    ];
    
    // Use project ID to consistently assign the same color to the same project
    return colors[projectId % colors.length];
  };

  // Fetch timesheet data
  const fetchTimesheet = useCallback(async () => {
    try {
      console.log('TimeLogger: Starting to fetch timesheet...');
      
      // Get token from localStorage
      const authToken = storage.getItem('token');
      console.log('TimeLogger: Auth token from localStorage:', authToken ? 'FOUND' : 'NOT FOUND');
      
      if (!authToken) {
        console.error('TimeLogger: No auth token found in localStorage');
        setError('Токен авторизации не найден. Пожалуйста, войдите в систему.');
        return;
      }

      // Get user ID from localStorage or use default
      const userId = storage.getItem('userId') || '3227';
      console.log('TimeLogger: Using user ID:', userId);

      // Calculate month start and end based on selected date
      const monthStart = `${selectedDate.getDate()}.${selectedDate.getMonth() + 1}.${selectedDate.getFullYear()}`;
      const monthEnd = `${new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()}.${selectedDate.getMonth() + 1}.${selectedDate.getFullYear()}`;
      
      console.log('TimeLogger: Fetching with params:', { monthStart, monthEnd });

      const response = await fetch(
        `https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/list?member_id=${userId}&month_start=${monthStart}&month_end=${monthEnd}`,
        {
          method: 'GET',
          headers: {
            'Authorization': authToken,
            'Content-Type': 'application/json',
          }
        }
      );

      console.log('TimeLogger: API response status:', response.status);

      if (response.status === 401 || response.status === 403) {
        console.error('TimeLogger: Authentication failed, clearing token');
        storage.removeItem('token');
        setError('Сессия истекла. Пожалуйста, войдите в систему снова.');
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('TimeLogger: API response data:', data);

      // Store full timesheet data
      const timesheetData = data.result || data;
      setTimesheetData(timesheetData);

      // Parse the response and extract unique active projects
      const uniqueProjects = [];
      const seenProjects = new Set();

      if (timesheetData && Array.isArray(timesheetData)) {
        timesheetData.forEach(item => {
          if (item.project && item.is_active) {
            const projectKey = `${item.project.id}_${item.project.project_name}`;
            if (!seenProjects.has(projectKey) && item.project.project_status === 'Активный') {
              seenProjects.add(projectKey);
              uniqueProjects.push({
                id: item.project.id,
                name: item.project.project_name,
                company: item.project.customer_short_name || 'Неизвестная компания',
                status: item.project.project_status,
                direction: item.project.direction || 'Не указано',
                color: getProjectColor(item.project.id),
                // Additional project info
                startDate: item.project.start_at,
                deadlineDate: item.project.deadline_at,
                factDeadlineDate: item.project.fact_deadline_at,
                projectLevel: item.project.project_level,
                projectType: item.project.project_type,
                healthStatus: item.project.project_health_status,
                contractNum: item.project.contract_num,
                sysProjectId: item.project.sys_project_id
              });
            }
          }
        });
      }

      console.log('TimeLogger: Parsed unique projects:', uniqueProjects);
      console.log('TimeLogger: Total projects found:', uniqueProjects.length);
      setProjects(uniqueProjects);
      setError(null);
    } catch (error) {
      console.error('TimeLogger: Error fetching timesheet:', error);
      setError(`Ошибка загрузки проектов: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  // Load projects on component mount
  useEffect(() => {
    fetchTimesheet();
  }, [fetchTimesheet]);

  // Get work hours for selected project and date
  const getWorkHoursForProjectAndDate = useCallback((projectId, date) => {
    if (!timesheetData || !Array.isArray(timesheetData)) return 0;
    
    const dateString = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    
    const matchingEntry = timesheetData.find(item => 
      item.project?.id === projectId && 
      item.work_day && 
      item.work_day.split('T')[0] === dateString
    );
    
    return matchingEntry?.work_hour || 0;
  }, [timesheetData]);

  // Initialize hours per project when projects change
  useEffect(() => {
    if (projects.length > 0) {
      const initialHours = {};
      let totalLoadedHours = 0;
      
      projects.forEach(project => {
        const workHours = Math.max(0, Math.round(getWorkHoursForProjectAndDate(project.id, selectedDate))); // Round to whole numbers
        // Ensure we don't exceed the 8-hour limit
        const remainingHours = maxHours - totalLoadedHours;
        const allowedHours = Math.min(workHours, remainingHours);
        
        initialHours[project.id] = Math.max(0, Math.round(allowedHours)); // Round to whole numbers
        totalLoadedHours += allowedHours;
      });
      
      setHoursPerProject(initialHours);
      
      // Set first project as active
      setActiveId(projects[0].id);
    }
  }, [projects, selectedDate, getWorkHoursForProjectAndDate, maxHours]);

  // Animate segment filling when hours change
  const animateSegmentFill = useCallback((projectId, fromHours, toHours) => {
    if (fromHours === toHours) return;
    
    const duration = 200; // Animation duration in ms - made even faster
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      
      const currentHours = fromHours + (toHours - fromHours) * easeOutQuart;
      
      // Update hours temporarily for animation
      setHoursPerProject(prev => ({
        ...prev,
        [projectId]: currentHours
      }));
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Ensure final value is exact
        setHoursPerProject(prev => ({
          ...prev,
          [projectId]: toHours
        }));
      }
    };
    
    requestAnimationFrame(animate);
  }, []);

  // Draw circle function
  const drawCircle = useCallback(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw base circle
    ctx.beginPath();
    ctx.arc(centerXRef.current, centerYRef.current, radiusRef.current, 0, Math.PI * 2);
    ctx.strokeStyle = '#dfe6e9';
    ctx.lineWidth = BASE_STROKE;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw project segments with animation
    const ordered = [...projects].sort((a, b) => a.id - b.id);
    let start = -Math.PI / 2;
    
    ordered.forEach(p => {
      const hrs = Math.max(0, hoursPerProject[p.id] || 0); // Ensure no negative values
      if (!hrs) return;
      
      const ang = (hrs / maxHours) * 2 * Math.PI;
      
      // Create gradient for smooth color transition
      const gradient = ctx.createLinearGradient(
        centerXRef.current + Math.cos(start) * radiusRef.current,
        centerYRef.current + Math.sin(start) * radiusRef.current,
        centerXRef.current + Math.cos(start + ang) * radiusRef.current,
        centerYRef.current + Math.sin(start + ang) * radiusRef.current
      );
      
      // Add multiple color stops for smooth transition
      gradient.addColorStop(0, p.color);
      gradient.addColorStop(0.5, p.color + 'CC'); // Slightly transparent
      gradient.addColorStop(1, p.color);
      
      ctx.beginPath();
      ctx.arc(centerXRef.current, centerYRef.current, radiusRef.current, start, start + ang);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = SEGMENT_STROKE;
      ctx.lineCap = 'round';
      
      // Add shadow for depth
      ctx.shadowColor = p.color + '40';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      ctx.stroke();
      
      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      start += ang;
    });
  }, [hoursPerProject, projects, maxHours]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const maxStroke = Math.max(BASE_STROKE, SEGMENT_STROKE);
      centerXRef.current = canvas.width / 2;
      centerYRef.current = canvas.height / 2;
      radiusRef.current = Math.max(10, canvas.width / 2 - (maxStroke / 2) - 6);
      drawCircle();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [drawCircle]);

  // Update canvas when projects change
  useEffect(() => {
    if (projects.length > 0) {
      drawCircle();
    }
  }, [projects, drawCircle]);

  // Get angle from mouse/touch event
  const getAngleFromEvent = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left - rect.width / 2;
    const y = (e.clientY || e.touches[0].clientY) - rect.top - rect.height / 2;
    
    // Ensure we have valid coordinates
    if (Math.abs(x) < 0.1 && Math.abs(y) < 0.1) return 0;
    
    return Math.atan2(y, x);
  }, []);

  // Handle drag start
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    setStartDragAngle(getAngleFromEvent(e));
    setHintHidden(true); // Hide hint on drag start
  }, [getAngleFromEvent]);

  const handleMove = useCallback((e) => {
    if (!dragging || !activeId) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left - rect.width / 2;
    const y = (e.clientY || e.touches[0].clientY) - rect.top - rect.height / 2;
    
    const angle = Math.atan2(y, x);
    
    // Normalize angles to prevent jumps across 180° boundary
    let normalizedStartAngle = startDragAngle;
    let normalizedCurrentAngle = angle;
    
    // Handle angle wrapping around the circle
    if (Math.abs(angle - startDragAngle) > Math.PI) {
      if (angle > startDragAngle) {
        normalizedCurrentAngle = angle - 2 * Math.PI;
      } else {
        normalizedCurrentAngle = angle + 2 * Math.PI;
      }
    }
    
    const deltaAngle = normalizedCurrentAngle - normalizedStartAngle;
    
    if (Math.abs(deltaAngle) > 0.05) {
      // Convert angle to hours: positive delta = increase, negative = decrease
      const hoursToAdd = Math.round(deltaAngle / (Math.PI / 4)) * 0.5;
      
      if (hoursToAdd !== 0) {
        const currentProjectHours = hoursPerProject[activeId] || 0;
        const newProjectHours = currentProjectHours + hoursToAdd;
        
        // Don't allow negative hours for individual projects
        if (newProjectHours < 0) {
          return;
        }
        
        // If decreasing hours, just do it immediately
        if (hoursToAdd < 0) {
          const newHours = Math.max(0, newProjectHours);
          animateSegmentFill(activeId, currentProjectHours, newHours);
          setStartDragAngle(angle);
          return;
        }
        
        // If increasing hours, check total limit
        const currentTotal = Object.values(hoursPerProject).reduce((sum, h) => sum + (h || 0), 0);
        const wouldExceedLimit = currentTotal - currentProjectHours + newProjectHours > maxHours;
        
        if (wouldExceedLimit) {
          // Calculate max allowed hours
          const maxAllowedHours = maxHours - (currentTotal - currentProjectHours);
          const actualHoursToAdd = Math.max(0, Math.min(hoursToAdd, maxAllowedHours - currentProjectHours));
          
          if (actualHoursToAdd > 0) {
            const finalHours = Math.max(0, currentProjectHours + actualHoursToAdd);
            animateSegmentFill(activeId, currentProjectHours, finalHours);
          }
        } else {
          const finalHours = Math.max(0, newProjectHours);
          animateSegmentFill(activeId, currentProjectHours, finalHours);
        }
        
        setStartDragAngle(angle);
      }
    }
  }, [dragging, activeId, startDragAngle, hoursPerProject, maxHours, animateSegmentFill]);

  const handleEnd = useCallback(() => {
    setDragging(false);
    setHintHidden(false); // Show hint on drag end
  }, []);

  const handleSubmit = useCallback(async () => {
    // Add bounce animation
    setIsAnimating(true);
    
    // Change icon to checkmark
    setIsSubmitted(true);
    
    console.log('Button clicked - setting isSubmitted to true');
    
    const payload = { 
      activeId, 
      hoursPerProject, 
      total: sumHours(), 
      capacity: maxHours,
      date: selectedDate.toISOString().split('T')[0] // Format as YYYY-MM-DD
    };
    
    console.log('Submit payload:', payload);
    
    // Get auth token
    const authToken = storage.getItem('token');
    const userId = storage.getItem('userId') || '3227';
    
    if (authToken) {
      try {
        // Send data for each project with hours
        const promises = Object.entries(hoursPerProject).map(async ([projectId, hours]) => {
          // Send all projects, including those with 0 hours
          const projectPayload = {
            member_id: parseInt(userId),
            project_id: parseInt(projectId),
            work_day: selectedDate.toISOString(),
            work_hour: Math.round(hours) // Round hours to whole numbers before sending
          };
          
          console.log(`Sending data for project ${projectId}:`, projectPayload);
          
          const response = await fetch('https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/perday', {
            method: 'PUT',
            headers: {
              'Authorization': authToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(projectPayload)
          });
          
          if (response.ok) {
            console.log(`Successfully sent data for project ${projectId}`);
            return { projectId, success: true };
          } else {
            console.error(`Failed to send data for project ${projectId}:`, response.status);
            return { projectId, success: false, status: response.status };
          }
        });
        
        const results = await Promise.all(promises);
        console.log('All API requests completed:', results);
        
        // Check if Telegram WebApp is available
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.sendData(JSON.stringify(payload));
        }
        
      } catch (error) {
        console.error('Error sending data to API:', error);
      }
    } else {
      console.error('No auth token available');
    }
    
    // Don't reset animation - let it stay as checkmark until hours change
    // The button will only reset when hoursPerProject changes
  }, [activeId, hoursPerProject, sumHours, maxHours, selectedDate]);

  // Track previous hours to detect changes
  const prevHoursRef = useRef({});

  // Reset button state when hours change
  useEffect(() => {
    if (isSubmitted && Object.keys(prevHoursRef.current).length > 0) {
      // Check if hours actually changed
      const currentHours = JSON.stringify(hoursPerProject);
      const prevHours = JSON.stringify(prevHoursRef.current);
      
      if (currentHours !== prevHours) {
        console.log('Hours changed - resetting button state');
        setIsAnimating(false);
        setIsSubmitted(false);
      }
    }
    
    // Update previous hours reference
    prevHoursRef.current = { ...hoursPerProject };
  }, [hoursPerProject, isSubmitted]);

  // Add event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', handleDragStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', handleDragStart, { passive: false });
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      canvas.removeEventListener('mousedown', handleDragStart);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      canvas.removeEventListener('touchstart', handleDragStart);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [handleDragStart, handleMove, handleEnd]);

  // Initialize Telegram WebApp
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.expand();
    }
  }, []);

  return (
    <>
      <div className="date-picker-container">
        <DatePicker
          selected={selectedDate}
          onChange={(date) => {
            setSelectedDate(date);
            // Recalculate hours for new date
            if (projects.length > 0) {
              const newHours = {};
              let totalLoadedHours = 0;
              
              projects.forEach(project => {
                const workHours = Math.max(0, Math.round(getWorkHoursForProjectAndDate(project.id, date))); // Round to whole numbers
                // Ensure we don't exceed the 8-hour limit
                const remainingHours = maxHours - totalLoadedHours;
                const allowedHours = Math.min(workHours, remainingHours);
                
                newHours[project.id] = Math.max(0, Math.round(allowedHours)); // Round to whole numbers
                totalLoadedHours += allowedHours;
              });
              
              setHoursPerProject(newHours);
            }
          }}
          dateFormat="dd.MM.yyyy"
          maxDate={new Date()}
          className="date-picker-input"
          placeholderText="Выберите дату"
          showYearDropdown={true}
          showMonthDropdown={true}
          dropdownMode="select"
          openToDate={selectedDate}
        />
      </div>

      {isLoading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Загрузка проектов...</p>
        </div>
      )}

      {error && (
        <div className="error-container">
          <p>{error}</p>
          <button onClick={fetchTimesheet} className="retry-button">
            Попробовать снова
          </button>
        </div>
      )}

      {!isLoading && !error && projects.length > 0 && (
        <>
          <div className="summary-title">Итоги по проектам</div>
          <div className="summary-total">
            <span className="total-label">Всего часов:</span>
            <span className={`total-hours ${totalHours >= maxHours ? 'limit-reached' : ''}`}>
              {Math.round(totalHours)}/{maxHours}
            </span>
          </div>
          <div className="summary-list">
            {projects.map(p => (
              <div
                key={p.id}
                className={`row ${activeId === p.id ? 'active' : ''}`}
                onClick={() => setActiveId(p.id)}
              >
                <div className="dot" style={{ backgroundColor: p.color }}></div>
                <div className="name">{p.name}</div>
                <div className="hrs">
                  <span className="hours">{Math.round(hoursPerProject[p.id] || 0)}</span>
                  <span className="unit">ч</span>
                </div>
              </div>
            ))}
          </div>
          <div className="circle-container">
            <canvas ref={canvasRef} />
            <div 
              className={`center-button ${isAnimating ? 'bounce' : ''} ${isSubmitted ? 'submitted' : ''}`}
              onClick={handleSubmit}
              title={isSubmitted ? "Часы залогированы!" : "Внести часы"}
            >
              {isSubmitted ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" stroke="#ffffff" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" stroke="#ffffff" />
                </svg>
              )}
            </div>
            
            {/* Hours indicator inside circle under button */}
            <div className="hours-indicator">
              {Math.round(hoursPerProject[activeId] || 0)} ч
            </div>
          </div>
          
          {/* Drag hint for users */}
          <div className={`drag-hint ${hintHidden ? 'hidden' : ''}`}>
            <div className="hint-text">Водите пальцем по/против часовой стрелки</div>
            <div className="hint-arrows">
              <div className="arrow arrow-left">↻</div>
              <div className="arrow arrow-right">↺</div>
            </div>
          </div>
        </>
      )}

      {!isLoading && !error && projects.length === 0 && (
        <div className="no-projects">
          <p>Нет доступных проектов</p>
        </div>
      )}
    </>
  );
};

export default TimeLogger;
