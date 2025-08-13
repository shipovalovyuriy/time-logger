import React, { useState, useEffect } from 'react';
import './LoginForm.css';
import storage from '../utils/storage';

const LoginForm = ({ onLoginSuccess }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Check if localStorage is available
    const storageInfo = storage.getInfo();
    console.log('LoginForm: Storage info:', storageInfo);
    
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
      console.log('Attempting login with:', { login, password });
      
      const response = await fetch('https://test.newpulse.pkz.icdc.io/auth-service/api/v1/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ login, pass: password })
      });

      console.log('Login response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Login response data:', data);
        
        // Try to save token to localStorage using utility
        // Use 'message' field from API response as the token
        const tokenValue = `Bearer ${data.message || data.token || data.accessToken || data.authToken}`;
        console.log('Saving token to localStorage:', tokenValue);
        
        const saveSuccess = storage.setItem('token', tokenValue);
        
        if (saveSuccess) {
          // Verify it was saved
          const savedToken = storage.getItem('token');
          console.log('Verified saved token:', savedToken);
          
          if (savedToken) {
            console.log('Token successfully saved to localStorage');
            
            // Also save user info if available
            if (data.userId || data.member_id) {
              storage.setItem('userId', data.userId || data.member_id);
            }
            
            onLoginSuccess();
          } else {
            console.error('Failed to save token to localStorage');
            setError('Ошибка сохранения токена в браузере. Проверьте настройки браузера.');
          }
        } else {
          console.error('Storage utility failed to save token');
          setError('Ошибка сохранения в браузере. Проверьте настройки браузера.');
        }
      } else {
        const errorData = await response.text();
        console.error('Login failed:', response.status, errorData);
        setError(`Ошибка входа: ${response.status} - ${errorData}`);
      }
    } catch (error) {
      console.error('Network error:', error);
      setError(`Ошибка сети: ${error.message}`);
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
          
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          
          <button 
            type="submit" 
            className={`login-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="spinner"></div>
            ) : (
              'Войти'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
