import React, { useState, useEffect } from 'react';
import './App.css';
import TimeLogger from './components/TimeLogger';
import LoginForm from './components/LoginForm';
import ApprovalScreen from './components/ApprovalScreen';
import storage from './utils/storage';

const API_BASE = 'https://test.newpulse.pkz.icdc.io';

const toBearerToken = (token) => {
  const raw = String(token || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase().startsWith('bearer ')) {
    return raw;
  }
  return `Bearer ${raw}`;
};

const toPositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
};

const APPROVAL_ROLE_IDS = new Set([2, 3, 4]);
const APPROVAL_ROLE_NAMES = new Set([
  'admin',
  'pm',
  'project_manager',
  'project manager',
  'админ',
  'менеджер проекта',
  'руководитель направления',
  'рн',
  'head_of_direction',
  'head of direction'
]);

const normalizeRoleName = (value) => String(value || '').trim().toLowerCase();

const extractMemberId = (payload) => {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload) && 'result' in payload
      ? payload.result
      : payload;

  const candidates = [
    payload?.id,
    payload?.member_id,
    payload?.user_id,
    payload?.value?.id,
    payload?.result?.id,
    payload?.result?.value?.id,
    result?.id,
    result?.member_id,
    result?.user_id,
    result?.value?.id
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const parsed = toPositiveInt(candidates[index]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const extractRoleCandidates = (payload) => {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload) && 'result' in payload
      ? payload.result
      : payload;

  const candidates = [];
  const roleArrays = [result?.roles, payload?.roles];

  roleArrays.forEach((value) => {
    if (Array.isArray(value)) {
      candidates.push(...value);
    }
  });

  if (result?.role) candidates.push(result.role);
  if (payload?.role) candidates.push(payload.role);

  const roleIdCandidates = [result?.role_id, payload?.role_id, result?._role, payload?._role];
  roleIdCandidates.forEach((value) => {
    const roleId = toPositiveInt(value);
    if (roleId) candidates.push(roleId);
  });

  return candidates;
};

const hasApprovalAccess = (payload) => {
  const roles = extractRoleCandidates(payload);
  if (!roles.length) return false;

  return roles.some((role) => {
    const roleId =
      typeof role === 'number'
        ? toPositiveInt(role)
        : toPositiveInt(role?.id) || toPositiveInt(role?.role_id) || toPositiveInt(role?._role);

    if (roleId && APPROVAL_ROLE_IDS.has(roleId)) {
      return true;
    }

    const roleName =
      typeof role === 'string'
        ? role
        : role?.name || role?.code || role?.role || role?.title || '';

    return APPROVAL_ROLE_NAMES.has(normalizeRoleName(roleName));
  });
};

const fetchSessionAccess = async (authToken) => {
  const token = toBearerToken(authToken);
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/auth-service/api/v1/check`, {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    return {
      token,
      memberId: extractMemberId(payload),
      canApprove: hasApprovalAccess(payload)
    };
  } catch {
    return null;
  }
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(false);
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(true);
  const [canApprove, setCanApprove] = useState(false);
  const [activeScreen, setActiveScreen] = useState('timelogger');

  useEffect(() => {
    let isMounted = true;

    const telegramLogin = async (telegramWebApp) => {
      const initData = String(telegramWebApp?.initData || '').trim();
      if (!initData) {
        return null;
      }

      try {
        const response = await fetch(`${API_BASE}/auth-service/api/v1/telegram/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            init_data: initData
          })
        });

        if (!response.ok) {
          return null;
        }

        const payload = await response.json().catch(() => null);
        const rawToken = payload?.message || payload?.token || payload?.result?.message || '';
        const bearerToken = toBearerToken(rawToken);
        if (!bearerToken) {
          return null;
        }

        const memberId = extractMemberId(payload);
        return {
          token: bearerToken,
          memberId
        };
      } catch {
        return null;
      }
    };

    const bootstrapAuth = async () => {
      const storedToken = storage.getItem('token');
      if (storedToken) {
        const validSession = await fetchSessionAccess(storedToken);
        if (validSession) {
          storage.setItem('token', validSession.token);
          if (validSession.memberId) {
            storage.setItem('userId', String(validSession.memberId));
          }

          if (isMounted) {
            setIsAuthenticated(true);
            setCanApprove(Boolean(validSession.canApprove));
            setIsAuthBootstrapping(false);
          }
          return;
        }

        storage.removeItem('token');
        storage.removeItem('userId');
      }

      const telegramWebApp = window.Telegram?.WebApp;
      if (telegramWebApp) {
        const telegramSession = await telegramLogin(telegramWebApp);
        if (telegramSession?.token) {
          storage.setItem('token', telegramSession.token);
          if (telegramSession.memberId) {
            storage.setItem('userId', String(telegramSession.memberId));
          }

          const recheckedSession = await fetchSessionAccess(telegramSession.token);
          if (recheckedSession?.memberId) {
            storage.setItem('userId', String(recheckedSession.memberId));
          }

          if (isMounted) {
            setCanApprove(Boolean(recheckedSession?.canApprove));
          }

          if (isMounted) {
            setIsAuthenticated(true);
            setIsAuthBootstrapping(false);
          }
          return;
        }
      }

      if (isMounted) {
        setIsAuthBootstrapping(false);
      }
    };

    bootstrapAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const root = document.documentElement;
    const visualViewport = window.visualViewport;

    const toPositiveHeight = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
      }
      return parsed;
    };

    const resolveViewportHeight = (webApp) => {
      const candidates = [
        toPositiveHeight(webApp?.viewportHeight),
        toPositiveHeight(visualViewport?.height),
        toPositiveHeight(window.innerHeight)
      ].filter((value) => value !== null);

      if (!candidates.length) {
        return 0;
      }

      return Math.round(Math.min(...candidates));
    };

    const resolveKeyboardInset = () => {
      if (!visualViewport) {
        return 0;
      }

      const inset = window.innerHeight - (visualViewport.height + visualViewport.offsetTop);
      if (!Number.isFinite(inset) || inset <= 0) {
        return 0;
      }

      return Math.round(inset);
    };

    const applyViewportVars = (webApp) => {
      const height = resolveViewportHeight(webApp);
      if (height > 0) {
        root.style.setProperty('--tg-viewport-height', `${height}px`);
      }

      const keyboardInset = resolveKeyboardInset();
      root.style.setProperty('--app-keyboard-inset', `${keyboardInset}px`);
      root.dataset.keyboardOpen = keyboardInset > 0 ? 'true' : 'false';
    };

    const applyFallbackViewport = () => applyViewportVars(null);

    if (!tg) {
      setIsTelegramWebApp(false);
      applyFallbackViewport();
      window.addEventListener('resize', applyFallbackViewport);
      visualViewport?.addEventListener('resize', applyFallbackViewport);
      visualViewport?.addEventListener('scroll', applyFallbackViewport);

      return () => {
        window.removeEventListener('resize', applyFallbackViewport);
        visualViewport?.removeEventListener('resize', applyFallbackViewport);
        visualViewport?.removeEventListener('scroll', applyFallbackViewport);
        root.dataset.keyboardOpen = 'false';
      };
    }

    setIsTelegramWebApp(true);

    const applyTheme = () => {
      const theme = tg.themeParams || {};
      const colorScheme = tg.colorScheme || 'light';
      const isLight = colorScheme === 'light';
      const defaults = isLight
        ? {
            bgColor: '#f3f6fb',
            secondaryBgColor: '#ffffff',
            textColor: '#0f172a',
            hintColor: '#5f6b7c',
            linkColor: '#0a84ff',
            buttonColor: '#2ea6ff',
            buttonTextColor: '#ffffff',
            destructiveColor: '#d83b3b'
          }
        : {
            bgColor: '#0f172a',
            secondaryBgColor: '#17233a',
            textColor: '#ffffff',
            hintColor: '#b6c2d9',
            linkColor: '#5ac8fa',
            buttonColor: '#2ea6ff',
            buttonTextColor: '#ffffff',
            destructiveColor: '#ff6b6b'
          };

      root.style.setProperty('--tg-bg-color', theme.bg_color || defaults.bgColor);
      root.style.setProperty(
        '--tg-secondary-bg-color',
        theme.secondary_bg_color || defaults.secondaryBgColor
      );
      root.style.setProperty('--tg-text-color', theme.text_color || defaults.textColor);
      root.style.setProperty('--tg-hint-color', theme.hint_color || defaults.hintColor);
      root.style.setProperty('--tg-link-color', theme.link_color || defaults.linkColor);
      root.style.setProperty('--tg-button-color', theme.button_color || defaults.buttonColor);
      root.style.setProperty(
        '--tg-button-text-color',
        theme.button_text_color || defaults.buttonTextColor
      );
      root.style.setProperty(
        '--tg-destructive-color',
        theme.destructive_text_color || defaults.destructiveColor
      );
      root.dataset.tgColorScheme = colorScheme;
    };

    const applyViewport = () => {
      applyViewportVars(tg);
    };

    try {
      tg.ready();
      tg.expand();
    } catch (error) {
      console.warn('Telegram WebApp init warning:', error);
    }

    applyTheme();
    applyViewport();

    try {
      if (tg.themeParams?.bg_color) {
        tg.setBackgroundColor(tg.themeParams.bg_color);
      }
      if (tg.themeParams?.secondary_bg_color) {
        tg.setHeaderColor(tg.themeParams.secondary_bg_color);
      }
    } catch (error) {
      console.warn('Telegram WebApp color warning:', error);
    }

    tg.onEvent('themeChanged', applyTheme);
    tg.onEvent('viewportChanged', applyViewport);
    window.addEventListener('resize', applyViewport);
    visualViewport?.addEventListener('resize', applyViewport);
    visualViewport?.addEventListener('scroll', applyViewport);

    return () => {
      tg.offEvent('themeChanged', applyTheme);
      tg.offEvent('viewportChanged', applyViewport);
      window.removeEventListener('resize', applyViewport);
      visualViewport?.removeEventListener('resize', applyViewport);
      visualViewport?.removeEventListener('scroll', applyViewport);
      root.dataset.keyboardOpen = 'false';
    };
  }, []);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsAuthBootstrapping(false);
    setCanApprove(false);

    const syncSessionAccess = async () => {
      const session = await fetchSessionAccess(storage.getItem('token'));
      if (!session) return;

      storage.setItem('token', session.token);
      if (session.memberId) {
        storage.setItem('userId', String(session.memberId));
      }
      setCanApprove(Boolean(session.canApprove));
    };

    void syncSessionAccess();
  };

  const handleLogout = () => {
    storage.removeItem('token');
    storage.removeItem('userId');
    setIsAuthenticated(false);
    setActiveScreen('timelogger');
    setCanApprove(false);
  };

  return (
    <div className={`App ${isTelegramWebApp ? 'telegram-app' : ''}`}>
      {isAuthBootstrapping ? (
        <div className="auth-bootstrap">
          <div className="auth-bootstrap__spinner" aria-hidden="true" />
        </div>
      ) : isAuthenticated ? (
        <>
          <div className="app-toolbar">
            {canApprove && (
              <button
                type="button"
                className="approval-toggle-button"
                onClick={() => setActiveScreen(activeScreen === 'approval' ? 'timelogger' : 'approval')}
                aria-label={activeScreen === 'approval' ? 'Вернуться к таймшиту' : 'Апрув часов'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {activeScreen === 'approval' ? (
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12,8 12,12 16,14" />
                    </>
                  ) : (
                    <>
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </>
                  )}
                </svg>
              </button>
            )}
            <button type="button" className="logout-button" onClick={handleLogout} aria-label="Выйти">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16,17 21,12 16,7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
          {activeScreen === 'approval' ? (
            <ApprovalScreen onBack={() => setActiveScreen('timelogger')} />
          ) : (
            <TimeLogger />
          )}
        </>
      ) : (
        <LoginForm onLoginSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}

export default App;
