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
    return Object.values(hoursPerProject).reduce((sum, hours) => sum + Math.max(0, hours || 0), 0);
  }, [hoursPerProject]);

  // Check if total hours exceed limit
  const totalHours = sumHours();

  // Add hours with limit checking
  const addHours = useCallback((projectId, hours) => {
    setHoursPerProject(prev => {
      const currentHours = Math.max(0, prev[projectId] || 0); // Ensure no negative values
      const newHours = Math.max(0, Math.round(currentHours + hours)); // Round to whole numbers
      
      // Check if adding these hours would exceed the total limit
      const currentTotal = Object.values(prev).reduce((sum, h) => sum + Math.max(0, h), 0) - currentHours;
      const wouldExceedLimit = currentTotal + newHours > maxHours;
      
      if (wouldExceedLimit) {
        // Calculate how many hours can be added without exceeding limit
        const maxAllowedHours = maxHours - currentTotal;
        const actualHoursToAdd = Math.max(0, Math.round(maxAllowedHours)); // Round to whole numbers
        
        console.log(`Cannot add ${hours} hours. Maximum allowed: ${actualHoursToAdd}`);
        return {
          ...prev,
          [projectId]: Math.max(0, currentHours + actualHoursToAdd)
        };
      }
      
      return {
        ...prev,
        [projectId]: newHours
      };
    });
  }, [maxHours]);

  // Generate random color for projects
  const getRandomColor = () => {
    const colors = [
      '#FF6B6B', // Яркий красный
      '#4ECDC4', // Яркий бирюзовый
      '#45B7D1', // Яркий синий
      '#96CEB4', // Яркий зеленый
      '#FFEAA7', // Яркий желтый
      '#DDA0DD', // Яркий фиолетовый
      '#98D8C8', // Яркий мятный
      '#F7DC6F', // Яркий золотой
      '#BB8FCE', // Яркий лавандовый
      '#85C1E9', // Яркий голубой
      '#FF9F43', // Яркий оранжевый
      '#00D2D3', // Яркий циан
      '#FF6B9D', // Яркий розовый
      '#4ECDC4', // Яркий изумрудный
      '#A8E6CF', // Яркий салатовый
      '#FFB3BA'  // Яркий коралловый
    ];
    return colors[Math.floor(Math.random() * colors.length)];
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
                color: getRandomColor(),
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

    // Draw project segments
    const ordered = [...projects].sort((a, b) => a.id - b.id);
    let start = -Math.PI / 2;
    
    ordered.forEach(p => {
      const hrs = Math.max(0, hoursPerProject[p.id] || 0); // Ensure no negative values
      if (!hrs) return;
      
      const ang = (hrs / maxHours) * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(centerXRef.current, centerYRef.current, radiusRef.current, start, start + ang);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = SEGMENT_STROKE;
      ctx.lineCap = 'round';
      ctx.stroke();
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
    return Math.atan2(y, x);
  }, []);

  // Handle drag start
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    setStartDragAngle(getAngleFromEvent(e));
  }, [getAngleFromEvent]);

  const handleMove = useCallback((e) => {
    if (!dragging || !activeId) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left - rect.width / 2;
    const y = (e.clientY || e.touches[0].clientY) - rect.top - rect.height / 2;
    
    const angle = Math.atan2(y, x);
    const deltaAngle = angle - startDragAngle;
    
    if (Math.abs(deltaAngle) > 0.1) {
      const hoursToAdd = Math.floor(deltaAngle / (Math.PI / 4)) * 0.5;
      
      if (hoursToAdd !== 0) {
        addHours(activeId, hoursToAdd);
        setStartDragAngle(angle);
      }
    }
  }, [dragging, activeId, startDragAngle, addHours]);

  const handleEnd = useCallback(() => {
    setDragging(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    // Add bounce animation
    setIsAnimating(true);
    
    // Change icon to checkmark
    setIsSubmitted(true);
    
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
          if (hours > 0) {
            const projectPayload = {
              member_id: parseInt(userId),
              project_id: parseInt(projectId),
              work_day: selectedDate.toISOString(),
              work_hour: hours
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
          }
          return { projectId, success: true, skipped: true };
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
    
    // Reset animation after 2 seconds
    setTimeout(() => {
      setIsAnimating(false);
      setIsSubmitted(false);
    }, 2000);
  }, [activeId, hoursPerProject, sumHours, maxHours, selectedDate]);

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
      <header>Выставление часов</header>
      
      <div className="date-picker-container">
        <label htmlFor="date-picker">Дата:</label>
        <DatePicker
          id="date-picker"
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
          locale="ru"
          maxDate={new Date()}
          className="date-picker-input"
          placeholderText="Выберите дату"
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
              {totalHours}/{maxHours}
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
                  <span className="hours">{hoursPerProject[p.id] || 0}</span>
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
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </div>
          </div>
          <div className="hours">{(hoursPerProject[activeId] || 0)} ч</div>
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
