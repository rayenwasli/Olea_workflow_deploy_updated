const { Sequelize } = require('sequelize');

function env(name, fallback) {
  return process.env[name] ?? fallback;
}

const sequelize = new Sequelize(
  env('DB_NAME', 'scan'),
  env('DB_USER', 'root'),
  env('DB_PASSWORD', ''),
  {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '3306')),
    dialect: 'mysql',
    logging: false,
    timezone: '+00:00',
    dialectOptions: {
      // Fix: allow storing emojis, smart quotes, Arabic, etc. (MySQL 5.7 default is often latin1)
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    },
    define: {
      underscored: true,
      freezeTableName: true,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    },
  }
);

module.exports = { sequelize };
