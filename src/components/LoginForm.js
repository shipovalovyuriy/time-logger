import React, { useState, useEffect } from 'react';
import './LoginForm.css';
import storage from '../utils/storage';

const API_BASE = 'https://test.newpulse.pkz.icdc.io';

const toBearerToken = (token) => {
  const raw = String(token || '').trim();
  if (!raw) {
    return '';
  }
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

const LoginForm = ({ onLoginSuccess }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const storageInfo = storage.getInfo();
    if (!storageInfo.available) {
      setError('localStorage недоступен в вашем браузере. Приложение не может работать.');
    }
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'login') {
      setLogin(value);
    } else if (name === 'password') {
      setPassword(value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/auth-service/api/v1/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ login, pass: password })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const apiMessage = getErrorMessageFromPayload(payload);
        setError(apiMessage || `Ошибка входа: ${response.status}`);
        return;
      }

      const rawToken = payload?.message || payload?.token || payload?.accessToken || payload?.authToken;
      const tokenValue = toBearerToken(rawToken);
      if (!tokenValue) {
        setError('Сервер не вернул токен авторизации.');
        return;
      }

      if (!storage.setItem('token', tokenValue)) {
        setError('Ошибка сохранения токена в браузере. Проверьте настройки браузера.');
        return;
      }

      const memberId = extractMemberId(payload);
      if (memberId) {
        storage.setItem('userId', String(memberId));
      }

      const telegramWebApp = window.Telegram?.WebApp;
      const initData = String(telegramWebApp?.initData || '').trim();
      if (telegramWebApp && initData) {
        const linkResponse = await fetch(`${API_BASE}/auth-service/api/v1/telegram/link`, {
          method: 'POST',
          headers: {
            Authorization: tokenValue,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            init_data: initData
          })
        });

        if (!linkResponse.ok) {
          const linkPayload = await linkResponse.json().catch(() => null);
          const linkMessage = getErrorMessageFromPayload(linkPayload);

          storage.removeItem('token');
          storage.removeItem('userId');
          setError(linkMessage || 'Не удалось привязать Telegram аккаунт. Попробуйте снова.');
          return;
        }
      }

      onLoginSuccess();
    } catch (requestError) {
      setError(`Ошибка сети: ${requestError.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h2>Вход в систему</h2>
          <p>Введите ваши учетные данные для доступа к логгеру</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label htmlFor="login">Логин</label>
            <input
              type="text"
              id="login"
              name="login"
              value={login}
              onChange={handleInputChange}
              placeholder="Введите логин"
              required
              disabled={isLoading}
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Пароль</label>
            <input
              type="password"
              id="password"
              name="password"
              value={password}
              onChange={handleInputChange}
              placeholder="Введите пароль"
              required
              disabled={isLoading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            className={`login-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? <div className="login-spinner" /> : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
