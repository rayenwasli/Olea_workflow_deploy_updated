# scan-react-node

Conversion complète du projet **Angular + Spring Boot** vers **React + Node.js** avec Docker.

## Services Docker
- **mysql** : MySQL 5.7 (DB: `scan`)
- **backend** : Node.js (Express + Sequelize + JWT + Multer + Socket.IO) sur `:8080`
- **frontend** : React (Vite build servi par Nginx) sur `:4200`

## Démarrage

```bash
docker compose up --build
```

- Frontend: http://localhost:4200
- Backend: http://localhost:8080

## Compte admin (seed)
- **admin@olea.tn**
- **Admin@1234**

## Notes
- API base: `/api`
- Uploads: `/uploads/bordereaux` et `/uploads/chat`
- Websocket Socket.IO: `/ws`
