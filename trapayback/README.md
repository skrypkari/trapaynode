# Payment System Backend

Современная платежная система с поддержкой множественных шлюзов и аутентификацией.

## 🚀 Функциональность

### Основные возможности
- **JWT аутентификация** для админов и магазинов
- **Множественные платежные шлюзы**: Plisio (криптоплатежи), Rapyd (фиатные платежи), Noda (банковские переводы)
- **Защищенные роуты** с middleware
- **PostgreSQL** с Prisma ORM
- **TypeScript** для типобезопасности
- **Rate limiting** и безопасность
- **Валидация входных данных**
- **Telegram бот** для уведомлений
- **Система логирования** всех операций
- **Автоматическая конвертация валют** с 3% наценкой

### Платежные шлюзы
- **Plisio** (ID: 0001) - Криптоплатежи (BTC, ETH, USDT и др.)
- **Rapyd** (ID: 0010) - Фиатные платежи (карты, банки)
- **Noda** (ID: 1000) - Банковские переводы (Open Banking)
- **CoinToPay** (ID: 0100) - В разработке

### Система уведомлений
- **Telegram бот** с автоматической верификацией
- **Webhook уведомления** для магазинов
- **Email уведомления** (планируется)

## 📋 Быстрый старт

### 1. Установка зависимостей
```bash
npm install
```

### 2. Настройка базы данных
```bash
# Скопировать файл окружения
cp .env.example .env

# Отредактировать .env с вашими настройками
# Применить схему к базе данных
npm run db:push
```

### 3. Запуск сервера
```bash
# Разработка
npm run dev

# Продакшн
npm run build
npm start
```

## 🔧 Переменные окружения

```env
# База данных
DATABASE_URL="postgresql://username:password@localhost:5432/payment_system"

# JWT
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="24h"

# Админ
ADMIN_USERNAME="admin"
ADMIN_PASSWORD_HASH="$2a$12$..."

# Сервер
PORT=3000
NODE_ENV="development"
BASE_URL="http://localhost:3000"

# Платежные шлюзы
PLISIO_API_KEY="your-plisio-secret-api-key"
RAPYD_API_URL="https://sandboxapi.rapyd.net"
RAPYD_ACCESS_KEY="your-rapyd-access-key"
RAPYD_SECRET_KEY="your-rapyd-secret-key"
NODA_API_URL="https://api.noda.live"
NODA_API_KEY="your-noda-api-key"

# Telegram бот
TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
TELEGRAM_BOT_USERNAME="trapay_bot"
```

## 📡 API Endpoints

### Аутентификация
- `POST /api/auth/login` - Вход в систему
- `GET /api/auth/me` - Информация о пользователе
- `POST /api/auth/logout` - Выход из системы

### Публичные платежи
- `POST /api/payments/create` - Создание платежа (публичный API)
- `GET /api/payments/:id/status` - Статус платежа
- `GET /api/payments/:id` - Информация о платеже

### Магазины (требует аутентификации)
- `GET /api/shop/profile` - Профиль магазина
- `PUT /api/shop/profile` - Обновление профиля
- `PUT /api/shop/wallets` - Обновление кошельков
- `POST /api/shop/payments` - Создание платежа
- `GET /api/shop/payments` - Список платежей
- `GET /api/shop/statistics` - Статистика
- `GET /api/shop/payouts` - Выплаты
- `POST /api/shop/webhook/test` - Тест webhook

### Админ панель (требует админ права)
- `GET /api/admin/statistics` - Системная статистика
- `GET /api/admin/users` - Управление пользователями
- `GET /api/admin/payments` - Все платежи
- `GET /api/admin/payouts` - Управление выплатами
- `POST /api/admin/payout` - Создание выплаты
- `GET /api/admin/logs/stats` - Статистика логов
- `POST /api/admin/logs/clean` - Очистка старых логов

### Настройки
- `GET /api/shop/settings` - Настройки магазина
- `POST /api/shop/settings/password` - Смена пароля
- `PUT /api/shop/settings/notifications` - Настройки уведомлений
- `PUT /api/shop/settings/telegram` - Настройки Telegram
- `PUT /api/shop/settings/webhook` - Настройки webhook

### Webhook endpoints
- `POST /api/webhooks/gateway/plisio` - Webhook от Plisio
- `POST /api/webhooks/gateway/rapyd` - Webhook от Rapyd
- `POST /api/webhooks/gateway/noda` - Webhook от Noda

### Telegram бот (только для админов)
- `GET /api/telegram/status` - Статус бота
- `GET /api/telegram/users` - Пользователи Telegram
- `POST /api/telegram/broadcast` - Рассылка сообщений
- `POST /api/telegram/test` - Тест уведомлений

### Валюты
- `GET /api/currency/rates` - Курсы валют
- `POST /api/currency/convert` - Конвертация валют
- `GET /api/currency/status` - Статус сервиса курсов (админ)
- `POST /api/currency/update` - Обновление курсов (админ)

### Шлюзы
- `GET /api/gateways/all` - Все доступные шлюзы
- `GET /api/gateways/active` - Активные шлюзы
- `GET /api/shop/gateways` - Шлюзы магазина

## 🏗️ Структура проекта

```
src/
├── config/          # Конфигурация приложения
│   ├── config.ts    # Основная конфигурация
│   └── database.ts  # Настройка Prisma
├── controllers/     # Контроллеры API
│   ├── adminController.ts
│   ├── authController.ts
│   ├── paymentController.ts
│   ├── shopController.ts
│   ├── telegramController.ts
│   └── webhookController.ts
├── middleware/      # Middleware функции
│   ├── auth.ts      # JWT аутентификация
│   ├── errorHandler.ts
│   └── validation.ts # Joi валидация
├── routes/          # Определение роутов
├── services/        # Бизнес-логика
│   ├── gateways/    # Сервисы платежных шлюзов
│   │   ├── plisioService.ts
│   │   ├── rapydService.ts
│   │   └── nodaService.ts
│   ├── adminService.ts
│   ├── authService.ts
│   ├── currencyService.ts
│   ├── loggerService.ts
│   ├── paymentService.ts
│   ├── shopService.ts
│   ├── telegramBotService.ts
│   └── webhookService.ts
├── types/           # TypeScript типы
├── app.ts           # Настройка Express
└── server.ts        # Точка входа
```

## 💳 Создание платежа

### Публичный API
```bash
curl -X POST http://localhost:3000/api/payments/create \
  -H "Content-Type: application/json" \
  -d '{
    "public_key": "pk_your_public_key",
    "gateway": "0001",
    "amount": 100,
    "currency": "USD",
    "source_currency": "BTC"
  }'
```

### Ответ
```json
{
  "success": true,
  "result": {
    "id": "payment_id",
    "gateway_payment_id": "gateway_id",
    "payment_url": "https://tesoft.uk/payment?id=payment_id",
    "status": "PENDING"
  }
}
```

## 🔗 Webhook интеграция

### Настройка webhook URL
```bash
curl -X PUT http://localhost:3000/api/shop/settings/webhook \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://yoursite.com/webhook",
    "webhookEvents": ["payment.success", "payment.failed"]
  }'
```

### Формат webhook уведомления
```json
{
  "event": "payment.success",
  "payment": {
    "id": "payment_id",
    "order_id": "merchant_order_id",
    "gateway": "plisio",
    "amount": 100,
    "currency": "USD",
    "status": "paid",
    "customer_email": "user@example.com",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

## 🤖 Telegram бот

### Команды бота
- `/start` - Начать работу с ботом
- `/status` - Проверить статус подключения
- `/disconnect` - Отключиться от уведомлений

### Подключение к боту
1. Найти бота по username (указан в `TELEGRAM_BOT_USERNAME`)
2. Отправить `/start`
3. Отправить username магазина
4. Отправить API ключ (публичный или секретный)

## 📊 Система логирования

Все операции логируются в папку `logs/`:
- `white_domain_requests_YYYY-MM-DD.log` - Запросы к белым доменам
- `white_domain_responses_YYYY-MM-DD.log` - Ответы от белых доменов
- `webhooks_received_YYYY-MM-DD.log` - Входящие webhook
- `webhooks_processed_YYYY-MM-DD.log` - Обработанные webhook
- `shop_webhooks_sent_YYYY-MM-DD.log` - Отправленные webhook магазинам
- `payments_created_YYYY-MM-DD.log` - Созданные платежи

## 🔄 Конвертация валют

Система автоматически получает курсы валют от CoinGecko каждый час и применяет 3% наценку:

```bash
# Конвертация валют
curl -X POST http://localhost:3000/api/currency/convert \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "fromCurrency": "USD",
    "toCurrency": "USDT"
  }'
```

## 🛡️ Безопасность

- **Rate limiting**: 100 запросов в 15 минут
- **Auth rate limiting**: 5 попыток входа в 15 минут
- **JWT токены** с автоматическим истечением
- **Blacklist токенов** при выходе
- **Валидация всех входных данных**
- **CORS защита**
- **Helmet.js** для HTTP заголовков

## 🚀 Развертывание

### Docker (рекомендуется)
```bash
# Создать образ
docker build -t payment-system .

# Запустить контейнер
docker run -p 3000:3000 --env-file .env payment-system
```

### PM2
```bash
# Установить PM2
npm install -g pm2

# Собрать проект
npm run build

# Запустить с PM2
pm2 start dist/server.js --name payment-system
```

## 📈 Мониторинг

### Проверка здоровья системы
```bash
curl http://localhost:3000/api/health
```

### Статистика логов (админ)
```bash
curl -H "Authorization: Bearer admin_token" \
  http://localhost:3000/api/admin/logs/stats
```

## 🔧 Команды разработки

```bash
# Разработка с hot reload
npm run dev

# Сборка проекта
npm run build

# Запуск продакшн версии
npm start

# Работа с базой данных
npm run db:generate  # Генерация Prisma клиента
npm run db:push      # Применение схемы
npm run db:migrate   # Создание миграции
npm run db:studio    # Prisma Studio
```

## 📝 Лицензия

MIT License - см. файл LICENSE для деталей.

## 🤝 Поддержка

Для вопросов и поддержки обращайтесь к команде разработки.