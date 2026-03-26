# SCAN Platform - Deployment Guide

## 📦 What You're Getting

A fully upgraded, production-ready SCAN platform with:
- ✅ Fixed chat system (real-time messaging)
- ✅ Professional UI redesign (responsive, modern)
- ✅ Enhanced dashboard (PDF export, filters)
- ✅ Production Docker setup (security, health checks)
- ✅ Complete documentation

---

## 🚀 Deployment Steps

### 1. Extract the Archive
```bash
unzip scan-react-node-upgraded.zip
cd scan-react-node
```

### 2. Configure Environment
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your values
nano .env  # or use your preferred editor
```

**Required Environment Variables:**
```env
# Database password (change this!)
DB_ROOT_PASSWORD=your_secure_password_here

# JWT secret for authentication (generate with: openssl rand -base64 32)
JWT_SECRET=your_generated_secret_here

# CORS origins (comma-separated)
CORS_ORIGINS=http://localhost:4200

# Frontend API URL (for Docker, use backend service name)
VITE_API_URL=http://backend:8080
```

### 3. Build & Start Services
```bash
# Build images and start all services
docker compose up --build

# Or run in background
docker compose up --build -d
```

### 4. Verify Services
```bash
# Check all services are running
docker compose ps

# Check health
curl http://localhost:8080/health

# View logs
docker compose logs -f
```

### 5. Access Application
- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:8080
- **MySQL**: localhost:3306

---

## 🔑 Default Credentials

**Development Only** - Change immediately in production!

```
Email: admin@olea.tn
Password: Admin@1234
```

---

## 📋 Service Details

### Frontend (Nginx)
- **Port**: 4200 (mapped to 80 in container)
- **Health Check**: http://localhost:4200/index.html
- **Features**: 
  - SPA routing
  - Static asset caching
  - Gzip compression
  - Security headers

### Backend (Node.js)
- **Port**: 8080
- **Health Check**: http://localhost:8080/health
- **Features**:
  - Express API
  - Socket.IO WebSocket
  - File uploads
  - JWT authentication

### Database (MySQL)
- **Port**: 3306
- **Database**: scan
- **User**: root
- **Health Check**: mysqladmin ping
- **Features**:
  - Persistent volume
  - Automatic initialization
  - Backup-ready

---

## 🔐 Security Checklist

### Before Production Deployment

- [ ] **Change Default Password**
  ```sql
  UPDATE users SET password_hash = bcrypt('YourNewPassword') WHERE email = 'admin@olea.tn';
  ```

- [ ] **Generate Strong JWT Secret**
  ```bash
  openssl rand -base64 32
  # Update JWT_SECRET in .env
  ```

- [ ] **Set Strong Database Password**
  ```bash
  # Update DB_ROOT_PASSWORD in .env
  ```

- [ ] **Configure CORS Origins**
  ```bash
  # Update CORS_ORIGINS in .env to your domain
  CORS_ORIGINS=https://yourdomain.com
  ```

- [ ] **Enable HTTPS/SSL**
  - Use reverse proxy (nginx, Apache)
  - Install SSL certificate (Let's Encrypt)
  - Redirect HTTP to HTTPS

- [ ] **Setup Backups**
  ```bash
  # Backup MySQL
  docker compose exec mysql mysqldump -u root -p scan > backup.sql
  
  # Backup uploads
  tar -czf uploads-backup.tar.gz uploads/
  ```

- [ ] **Configure Monitoring**
  - Set up log aggregation
  - Configure alerts
  - Monitor resource usage

- [ ] **Setup Email Notifications**
  - Configure SMTP
  - Test email delivery
  - Setup notification templates

---

## 🛠️ Common Operations

### View Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql

# Last 100 lines
docker compose logs --tail=100
```

### Restart Services
```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart backend
docker compose restart frontend
docker compose restart mysql
```

### Stop Services
```bash
# Stop all (keep data)
docker compose stop

# Stop and remove containers (keep data)
docker compose down

# Stop and remove everything (delete data!)
docker compose down -v
```

### Database Operations
```bash
# Access MySQL shell
docker compose exec mysql mysql -u root -p scan

# Backup database
docker compose exec mysql mysqldump -u root -p scan > backup.sql

# Restore database
docker compose exec -T mysql mysql -u root -p scan < backup.sql

# View database size
docker compose exec mysql mysql -u root -p -e "SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb FROM information_schema.tables WHERE table_schema = 'scan';"
```

### File Operations
```bash
# View uploads
docker compose exec backend ls -la /app/uploads/

# Clear uploads
docker compose exec backend rm -rf /app/uploads/*

# Backup uploads
tar -czf uploads-backup.tar.gz uploads/

# Restore uploads
tar -xzf uploads-backup.tar.gz
```

---

## 📊 Monitoring & Maintenance

### Health Checks
```bash
# Frontend health
curl http://localhost:4200/index.html

# Backend health
curl http://localhost:8080/health

# Database health
docker compose exec mysql mysqladmin ping
```

### Resource Usage
```bash
# View container stats
docker stats

# View disk usage
docker system df

# View logs size
du -sh /var/lib/docker/containers/*/
```

### Performance Tuning
```bash
# Increase MySQL memory
# Edit docker-compose.yml:
# mysql:
#   environment:
#     MYSQL_MAX_CONNECTIONS: 1000

# Increase backend memory
# Edit docker-compose.yml:
# backend:
#   mem_limit: 1g

# Rebuild and restart
docker compose up --build -d
```

---

## 🐛 Troubleshooting

### Chat Not Working
```bash
# Check WebSocket connection
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:8080/ws

# Check backend logs
docker compose logs backend | grep -i websocket

# Verify Socket.IO is running
curl http://localhost:8080/socket.io/?EIO=4&transport=polling
```

### Dashboard Slow
```bash
# Check database performance
docker compose exec mysql mysql -u root -p -e "SHOW PROCESSLIST;"

# Check slow queries
docker compose exec mysql mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log';"

# Restart database
docker compose restart mysql
```

### Upload Fails
```bash
# Check upload directory
docker compose exec backend ls -la /app/uploads/

# Check permissions
docker compose exec backend stat /app/uploads/

# Fix permissions
docker compose exec backend chmod 755 /app/uploads/*
```

### Build Fails
```bash
# Clear Docker cache
docker compose down -v
docker system prune -a

# Rebuild
docker compose up --build

# Check disk space
df -h
```

### High Memory Usage
```bash
# Check container memory
docker stats

# Reduce memory limits in docker-compose.yml
# Restart services
docker compose restart

# Monitor memory
watch -n 1 'docker stats --no-stream'
```

---

## 📈 Scaling & Performance

### Horizontal Scaling
```bash
# Run multiple backend instances
docker compose up --scale backend=3

# Use load balancer (nginx, HAProxy)
# Configure in reverse proxy
```

### Database Optimization
```bash
# Add indexes
docker compose exec mysql mysql -u root -p scan < optimize.sql

# Analyze tables
docker compose exec mysql mysql -u root -p -e "ANALYZE TABLE bordereaux, chat_messages;"

# Optimize tables
docker compose exec mysql mysql -u root -p -e "OPTIMIZE TABLE bordereaux, chat_messages;"
```

### Caching
```bash
# Add Redis for caching
# Update docker-compose.yml
# Configure backend to use Redis
```

---

## 🔄 Updates & Upgrades

### Update Dependencies
```bash
# Backend
docker compose exec backend npm update

# Frontend
docker compose exec frontend npm update

# Rebuild
docker compose up --build
```

### Update Docker Images
```bash
# Pull latest images
docker compose pull

# Rebuild
docker compose up --build

# Restart
docker compose restart
```

### Database Migrations
```bash
# Backup first
docker compose exec mysql mysqldump -u root -p scan > backup.sql

# Run migrations
docker compose exec backend npm run migrate

# Verify
docker compose logs backend
```

---

## 📞 Support & Debugging

### Enable Debug Logging
```bash
# Backend
docker compose exec backend NODE_DEBUG=* npm start

# Frontend
# Set VITE_DEBUG=true in .env

# MySQL
docker compose exec mysql mysql -u root -p -e "SET GLOBAL log_queries_not_using_indexes=ON;"
```

### Collect Diagnostics
```bash
# System info
docker version
docker compose version

# Service status
docker compose ps

# Logs
docker compose logs > logs.txt

# Resource usage
docker stats --no-stream > stats.txt

# Database info
docker compose exec mysql mysql -u root -p -e "SHOW STATUS;" > db-status.txt
```

### Report Issues
When reporting issues, include:
1. Docker version: `docker --version`
2. Docker Compose version: `docker compose --version`
3. OS and architecture: `uname -a`
4. Logs: `docker compose logs`
5. Error messages
6. Steps to reproduce

---

## 🎓 Learning Resources

### Documentation
- [Docker Documentation](https://docs.docker.com)
- [Docker Compose Documentation](https://docs.docker.com/compose)
- [Express.js Guide](https://expressjs.com)
- [React Documentation](https://react.dev)
- [MySQL Documentation](https://dev.mysql.com/doc)

### Tutorials
- [Docker Tutorial](https://www.docker.com/101-tutorial)
- [Node.js Best Practices](https://nodejs.org/en/docs/guides)
- [React Hooks Guide](https://react.dev/reference/react/hooks)
- [MySQL Performance Tuning](https://dev.mysql.com/doc/refman/8.0/en/optimization.html)

---

## 📝 Maintenance Schedule

### Daily
- [ ] Monitor logs for errors
- [ ] Check health endpoints
- [ ] Monitor disk usage

### Weekly
- [ ] Review performance metrics
- [ ] Check for security updates
- [ ] Test backups

### Monthly
- [ ] Update dependencies
- [ ] Analyze database performance
- [ ] Review access logs
- [ ] Test disaster recovery

### Quarterly
- [ ] Security audit
- [ ] Performance optimization
- [ ] Capacity planning
- [ ] Documentation review

---

## 🎯 Next Steps

1. **Deploy**: Follow the deployment steps above
2. **Configure**: Update environment variables
3. **Test**: Verify all features work
4. **Secure**: Complete security checklist
5. **Monitor**: Setup monitoring and alerts
6. **Backup**: Configure automated backups
7. **Document**: Document your setup
8. **Train**: Train your team

---

## ✅ Deployment Checklist

- [ ] Extract archive
- [ ] Copy .env.example to .env
- [ ] Update environment variables
- [ ] Run `docker compose up --build`
- [ ] Verify services are running
- [ ] Access frontend at http://localhost:4200
- [ ] Login with default credentials
- [ ] Test chat functionality
- [ ] Test dashboard and PDF export
- [ ] Change default password
- [ ] Configure backups
- [ ] Setup monitoring
- [ ] Document configuration
- [ ] Train team members

---

**Your SCAN platform is ready for deployment! 🚀**

For questions or issues, refer to the troubleshooting section or check the logs with `docker compose logs`.
