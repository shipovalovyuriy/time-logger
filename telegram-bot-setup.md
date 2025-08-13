# 🚀 Telegram Mini App Setup Guide

## 📱 Что такое Telegram Mini App?

Telegram Mini App - это веб-приложение, которое работает внутри Telegram и предоставляет нативную интеграцию с платформой.

## 🔧 Настройка Telegram Bot

### 1. Создание бота
1. Напишите [@BotFather](https://t.me/botfather) в Telegram
2. Отправьте команду `/newbot`
3. Следуйте инструкциям для создания бота
4. Сохраните полученный токен бота

### 2. Настройка Mini App
1. Отправьте команду `/newapp` боту @BotFather
2. Выберите созданного бота
3. Укажите название приложения
4. Загрузите иконку (512x512px)
5. Добавьте краткое описание
6. Укажите URL вашего приложения

### 3. Получение Web App URL
После настройки вы получите URL вида:
```
https://t.me/your_bot_name/app
```

## 🌐 Деплой приложения

### Вариант 1: Vercel (Рекомендуется)
```bash
# Установка Vercel CLI
npm i -g vercel

# Деплой
vercel --prod
```

### Вариант 2: Netlify
```bash
# Установка Netlify CLI
npm i -g netlify-cli

# Деплой
netlify deploy --prod
```

### Вариант 3: GitHub Pages
```bash
# Добавьте в package.json
"homepage": "https://yourusername.github.io/your-repo-name"

# Деплой
npm run deploy
```

## 🔐 Настройка аутентификации

### 1. В Telegram Bot
Добавьте команду для авторизации:
```javascript
// В вашем боте
bot.command('start', (ctx) => {
  const keyboard = {
    inline_keyboard: [[
      { text: 'Открыть приложение', web_app: { url: 'YOUR_APP_URL' } }
    ]]
  };
  
  ctx.reply('Добро пожаловать!', { reply_markup: keyboard });
});
```

### 2. В приложении
Приложение автоматически получает данные пользователя через `window.Telegram.WebApp.initDataUnsafe.user`.

## 📱 Особенности Mini App

### ✅ Преимущества:
- **Нативная интеграция** с Telegram
- **Автоматическая авторизация** пользователя
- **Доступ к контактам** и чатам
- **Push-уведомления** через бота
- **Платежи** через Telegram Payments

### 🔧 API методы:
```javascript
// Инициализация
window.Telegram.WebApp.ready();

// Установка темы
window.Telegram.WebApp.setThemeParams({
  bg_color: '#667eea',
  text_color: '#ffffff'
});

// Уведомления
window.Telegram.WebApp.showAlert('Сообщение');
window.Telegram.WebApp.showConfirm('Вопрос?');

// Отправка данных в бот
window.Telegram.WebApp.sendData(JSON.stringify(data));
```

## 🎨 Кастомизация

### Цвета и темы:
```javascript
// Автоматическое определение темы
if (window.Telegram.WebApp.colorScheme === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
}

// Установка цветов
window.Telegram.WebApp.setHeaderColor('#667eea');
window.Telegram.WebApp.setBackgroundColor('#667eea');
```

### Адаптивность:
```css
/* Поддержка safe-area для iPhone */
.App {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 
           env(safe-area-inset-bottom) env(safe-area-inset-left);
}

/* Отключение масштабирования */
<meta name="viewport" content="width=device-width, initial-scale=1.0, 
      maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

## 🚀 Тестирование

### 1. Локальное тестирование:
```bash
npm start
# Откройте в браузере и проверьте console.log
```

### 2. Тестирование в Telegram:
1. Задеплойте приложение
2. Отправьте команду `/start` вашему боту
3. Нажмите кнопку "Открыть приложение"
4. Проверьте работу всех функций

## 📋 Чек-лист готовности

- [ ] Бот создан и настроен
- [ ] Mini App зарегистрирован
- [ ] Приложение задеплоено
- [ ] URL добавлен в бота
- [ ] Тестирование пройдено
- [ ] Обработка ошибок настроена
- [ ] Адаптивность проверена

## 🆘 Решение проблем

### Проблема: Приложение не открывается
**Решение:** Проверьте URL в настройках бота и доступность сайта

### Проблема: Не работает авторизация
**Решение:** Убедитесь, что `window.Telegram.WebApp.initData` доступен

### Проблема: Плохо выглядит на мобильных
**Решение:** Проверьте viewport и safe-area CSS

## 📚 Полезные ссылки

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Web App](https://core.telegram.org/bots/webapps)
- [Mini App Guidelines](https://core.telegram.org/bots/webapps#mini-apps)
- [Telegram Payments](https://core.telegram.org/bots/payments)

---

**🎉 Поздравляем! Ваше приложение готово для Telegram Mini App!**
