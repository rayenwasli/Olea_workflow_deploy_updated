# SCAN Platform - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Docker & Docker Compose installed
- 2GB RAM available
- Port 4200 and 8080 available

### Step 1: Setup Environment
```bash
cd scan-react-node
cp .env.example .env
```

### Step 2: Generate Secure Secrets (Optional but Recommended)
```bash
# Generate a strong JWT secret
openssl rand -base64 32

# Update .env with the generated value
# DB_ROOT_PASSWORD=your_secure_password
# JWT_SECRET=your_generated_secret
```

### Step 3: Build & Run
```bash
docker compose up --build
```

Wait for all services to start (2-3 minutes on first run).

### Step 4: Access the Application
- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:8080
- **MySQL**: localhost:3306

### Step 5: Login
```
Email: admin@olea.tn
Password: Admin@1234
```

---

## 📋 What's Included

### ✅ Features
- **Dashboard**: KPIs, charts, PDF export
- **Chat**: Real-time messaging with file uploads
- **Workflow**: Bordeaux management with status tracking
- **Admin**: User, client, and assignment management
- **Responsive**: Works on mobile, tablet, desktop

### ✅ Tech Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express + Socket.IO
- **Database**: MySQL 8.0
- **Deployment**: Docker + Nginx

---

## 🔧 Common Commands

### View Logs
```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql
```

### Stop Services
```bash
docker compose down
```

### Restart Services
```bash
docker compose restart
```

### Reset Database
```bash
docker compose down -v
docker compose up --build
```

### Access MySQL
```bash
docker compose exec mysql mysql -u root -p scan
```

---

## 🐛 Troubleshooting

### Chat Not Working
1. Check browser console for errors
2. Verify WebSocket connection: `curl http://localhost:8080/health`
3. Check backend logs: `docker compose logs backend`

### Dashboard Slow
1. Check database: `docker compose logs mysql`
2. Verify MySQL is healthy: `docker compose ps`
3. Try restarting: `docker compose restart mysql`

### Upload Fails
1. Check upload directory: `docker compose exec backend ls -la /app/uploads`
2. Verify permissions: `docker compose exec backend chmod 755 /app/uploads/*`

### Build Fails
1. Clear cache: `docker compose down -v`
2. Rebuild: `docker compose up --build`
3. Check disk space: `df -h`

---

## 📊 Dashboard Features

### KPI Cards
- Total Bordereaux
- Backlog Count
- Priority Items
- Average Cycle Time

### Charts
- Distribution by Status (Funnel)
- Created vs Finalized (Trend)
- Time per Status (Performance)

### Filters
- Date Range (From/To)
- Granularity (Day/Week)
- Real-time Reload

### Export
- **PDF Export**: Professional report with all data
- Includes filters and generation date
- Multi-page support

---

## 💬 Chat Features

### Real-Time Messaging
- Instant message delivery
- File uploads
- Connection status indicator
- Auto-reconnect on disconnect

### User List
- All platform users
- Active conversation indicator
- Quick user selection

### Message History
- Full conversation history
- Timestamp on each message
- File download links

---

## 🔐 Security

### Default Credentials (Development Only)
```
Email: admin@olea.tn
Password: Admin@1234
```

### Production Checklist
- [ ] Change default password
- [ ] Set strong JWT_SECRET
- [ ] Configure CORS_ORIGINS
- [ ] Enable HTTPS/SSL
- [ ] Set up backups
- [ ] Configure monitoring

---

## 📱 Responsive Design

### Mobile (< 640px)
- Single column layout
- Touch-friendly buttons
- Optimized spacing

### Tablet (640px - 1024px)
- 2-column grids
- Adjusted font sizes
- Sidebar navigation

### Desktop (> 1024px)
- Full 3-4 column layouts
- Optimal readability
- Advanced features

---

## 🎯 Next Steps

1. **Explore the Dashboard**
   - View KPIs and trends
   - Export reports to PDF
   - Analyze performance

2. **Test Chat**
   - Send messages to other users
   - Upload files
   - Test reconnection

3. **Manage Bordereaux**
   - Create new items
   - Transition through workflow
   - Track status

4. **Admin Functions**
   - Manage users
   - Configure clients
   - View assignments

---

## 📞 Support

### Logs
```bash
# All services
docker compose logs

# Specific service
docker compose logs backend
docker compose logs frontend
docker compose logs mysql
```

### Health Check
```bash
curl http://localhost:8080/health
```

### Database Check
```bash
docker compose exec mysql mysqladmin ping
```

---

## 🎓 Learning Resources

### Frontend
- React: https://react.dev
- TypeScript: https://www.typescriptlang.org
- Tailwind CSS: https://tailwindcss.com

### Backend
- Express: https://expressjs.com
- Socket.IO: https://socket.io
- Sequelize: https://sequelize.org

### DevOps
- Docker: https://docs.docker.com
- Docker Compose: https://docs.docker.com/compose
- Nginx: https://nginx.org

---

## 📝 Notes

- First build takes 2-3 minutes
- Database initializes automatically
- Default seed data is loaded on startup
- All uploads are stored in `./uploads` directory
- Logs are available via `docker compose logs`

---

**Ready to go! Start with `docker compose up --build` 🚀**
