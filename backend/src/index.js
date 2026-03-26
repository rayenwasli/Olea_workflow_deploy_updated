require('dotenv').config();
require('express-async-errors');

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { sequelize } = require('./models');
const { seed } = require('./seed');
const { authMiddleware, requireRole } = require('./middleware/auth');
const { loadUser } = require('./middleware/loadUser');

const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const assureursRouter = require('./routes/assureurs');
const bordereauxRouter = require('./routes/bordereaux');
const bordereauChatRouter = require('./routes/bordereauChat');
const adminUsersRouter = require('./routes/adminUsers');
const adminClientsRouter = require('./routes/adminClients');
const adminAssureursRouter = require('./routes/adminAssureurs');
const adminAssignmentsRouter = require('./routes/adminAssignments');
const adminUndoRequestsRouter = require('./routes/adminUndoRequests');
const adminDashboardRouter = require('./routes/adminDashboard');
const adminMiscRouter = require('./routes/adminMisc');
const adminAlertsRouter = require('./routes/adminAlerts');
const adminDocumentTypesRouter = require('./routes/adminDocumentTypes');
const { chatRouter } = require('./routes/chat');
const notificationsRouter = require('./routes/notifications');

const { initSocket } = require('./socket');
const { startBordereauAlertScheduler } = require('./utils/alertScheduler');

const PORT = Number(process.env.PORT || '8080');

function parseOrigins() {
  const raw = process.env.CORS_ORIGINS || '*';
  if (raw.trim() === '*') return '*';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function connectWithRetry(maxRetries = 20) {
  let lastErr = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await sequelize.authenticate();
      return;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function ensureUtf8mb4() {
  // This project targets MySQL 5.7 where the default charset is often latin1.
  // Chat filenames/messages can contain emojis or smart quotes (e.g. “Capture d’écran”),
  // which would fail with: "Incorrect string value ... for column 'content'".
  // Best-effort: convert DB + tables to utf8mb4.
  const enabled = String(process.env.DB_FORCE_UTF8MB4 ?? 'true').toLowerCase() === 'true';
  if (!enabled) return;

  const dbName = process.env.DB_NAME || 'scan';
  try {
    await sequelize.query(`ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[utf8mb4] Unable to ALTER DATABASE (continuing):', e?.message || e);
  }

  try {
    const qi = sequelize.getQueryInterface();
    const tables = await qi.showAllTables();
    const names = (Array.isArray(tables) ? tables : [])
      .map((t) => (typeof t === 'string' ? t : t?.tableName || t?.name))
      .filter(Boolean);

    if (names.length === 0) return;

    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    for (const t of names) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    }
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[utf8mb4] Unable to CONVERT tables (continuing):', e?.message || e);
    try {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    } catch {
      // ignore
    }
  }
}


async function ensureResponsableClientProdSchema() {
  const enabled = String(process.env.DB_AUTO_PATCH_SCHEMA ?? 'true').toLowerCase() === 'true';
  if (!enabled) return;

  const roleNames = ['ADMIN','RESPONSABLE_CLIENT','RESPONSABLE_CLIENT_PROD','COURSIER','BUREAU_ORDRE','COORDINATEUR','VERIFICATEUR','SCANNER'];
  const roleEnum = roleNames.map((r) => `\'${r}\'`).join(',');
  try {
    await sequelize.query(`ALTER TABLE roles MODIFY COLUMN name ENUM(${roleEnum}) NOT NULL;`);
  } catch (e) {
    console.warn('[schema] Unable to patch roles enum (continuing):', e?.message || e);
  }
  try {
    await sequelize.query(`ALTER TABLE bordereau_status_history MODIFY COLUMN changed_by_role ENUM(${roleEnum}) NOT NULL;`);
  } catch (e) {
    console.warn('[schema] Unable to patch changed_by_role enum (continuing):', e?.message || e);
  }
}

async function ensureBordereauReturnToClientSchema() {
  const enabled = String(process.env.DB_AUTO_PATCH_SCHEMA ?? 'true').toLowerCase() === 'true';
  if (!enabled) return;

  // 1) Ensure ENUM values include the return-to-client statuses
  try {
    const { BordereauStatus } = require('./utils/constants');
    const statuses = Object.values(BordereauStatus);
    const stEnum = statuses.map((s) => `\'${s}\'`).join(',');
    try {
      await sequelize.query(`ALTER TABLE bordereaux MODIFY COLUMN current_status ENUM(${stEnum}) NOT NULL;`);
    } catch (e) {
      console.warn('[schema] Unable to patch bordereaux.current_status enum (continuing):', e?.message || e);
    }
    try {
      await sequelize.query(`ALTER TABLE bordereau_status_history MODIFY COLUMN to_status ENUM(${stEnum}) NOT NULL;`);
    } catch (e) {
      console.warn('[schema] Unable to patch bordereau_status_history.to_status enum (continuing):', e?.message || e);
    }
    try {
      await sequelize.query(`ALTER TABLE bordereau_status_history MODIFY COLUMN from_status ENUM(${stEnum}) NULL;`);
    } catch (e) {
      console.warn('[schema] Unable to patch bordereau_status_history.from_status enum (continuing):', e?.message || e);
    }
  } catch (e) {
    console.warn('[schema] Unable to resolve BordereauStatus enum (continuing):', e?.message || e);
  }

  // 2) Ensure bordereaux.base_reference exists (used to avoid accumulating scanner suffixes)
  try {
    const qi = sequelize.getQueryInterface();
    const { DataTypes } = require('sequelize');
    let desc;
    try {
      desc = await qi.describeTable('bordereaux');
    } catch {
      // table will be created by sequelize.sync on first run
      return;
    }

    if (!desc.base_reference) {
      await qi.addColumn('bordereaux', 'base_reference', { type: DataTypes.STRING(255), allowNull: true });
    }

    // Backfill for existing rows
    try {
      await sequelize.query("UPDATE bordereaux SET base_reference = reference WHERE base_reference IS NULL OR base_reference = '';");
    } catch {
      // ignore
    }
  } catch (e) {
    console.warn('[schema] Unable to patch base_reference (continuing):', e?.message || e);
  }
}

async function ensureResponsableClientProdTrackingSchema() {
  const enabled = String(process.env.DB_AUTO_PATCH_SCHEMA ?? 'true').toLowerCase() === 'true';
  if (!enabled) return;

  try {
    const qi = sequelize.getQueryInterface();
    const { DataTypes } = require('sequelize');

    let desc;
    try {
      desc = await qi.describeTable('bordereau_deposit_info');
    } catch {
      return;
    }

    const columns = [
      ['matricule', { type: DataTypes.STRING(255), allowNull: true }],
      ['nom_prenom_prestataire', { type: DataTypes.STRING(255), allowNull: true }],
      ['nature_demande', { type: DataTypes.STRING(255), allowNull: true }],
      ['documents_envoyes', { type: DataTypes.STRING(1000), allowNull: true }],
      ['date_adhesion_effet', { type: DataTypes.DATE, allowNull: true }],
      ['date_reception_client', { type: DataTypes.DATE, allowNull: true }],
      ['date_envoi_assureur_decharge', { type: DataTypes.DATE, allowNull: true }],
      ['execution', { type: DataTypes.STRING(20), allowNull: true }],
      ['date_execution', { type: DataTypes.DATE, allowNull: true }],
      ['remarque', { type: DataTypes.STRING(1000), allowNull: true }],
    ];

    for (const [name, def] of columns) {
      if (!desc[name]) {
        try {
          await qi.addColumn('bordereau_deposit_info', name, def);
        } catch (e) {
          console.warn(`[schema] Unable to add bordereau_deposit_info.${name} (continuing):`, e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('[schema] Unable to patch Responsable Client Prod tracking schema (continuing):', e?.message || e);
  }
}

async function ensureChatSchema() {
  // Ensure chat_messages has delivery/read receipt columns even on existing DBs
  const enabled = String(process.env.DB_AUTO_PATCH_SCHEMA ?? 'true').toLowerCase() === 'true';
  if (!enabled) return;

  try {
    const qi = sequelize.getQueryInterface();
    const { DataTypes } = require('sequelize');

    let desc;
    try {
      desc = await qi.describeTable('chat_messages');
    } catch {
      // Table doesn't exist yet (first run). It will be created by sequelize.sync.
      return;
    }

    let addedDelivered = false;
    let addedSeen = false;

    if (!desc.delivered_at) {
      await qi.addColumn('chat_messages', 'delivered_at', { type: DataTypes.DATE, allowNull: true });
      addedDelivered = true;
    }
    if (!desc.seen_at) {
      await qi.addColumn('chat_messages', 'seen_at', { type: DataTypes.DATE, allowNull: true });
      addedSeen = true;
    }

    // Backfill existing rows so old conversations don't show as "unread" forever.
    if (addedDelivered) {
      try {
        await sequelize.query('UPDATE chat_messages SET delivered_at = sent_at WHERE delivered_at IS NULL;');
      } catch {
        // ignore
      }
    }
    if (addedSeen) {
      try {
        await sequelize.query('UPDATE chat_messages SET seen_at = sent_at WHERE seen_at IS NULL;');
      } catch {
        // ignore
      }
    }

    // Helpful index for unread counts
    try {
      await qi.addIndex('chat_messages', ['recipient_id', 'seen_at'], { name: 'idx_chat_recipient_seen' });
    } catch {
      // ignore if already exists
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[schema] Unable to patch chat schema (continuing):', e?.message || e);
  }
}


async function main() {
  await connectWithRetry();

  // Make sure we can store all Unicode characters (emojis, accents, Arabic, etc.)
  await ensureUtf8mb4();

  if (String(process.env.SYNC_DB || 'true').toLowerCase() === 'true') {
    const syncAlter = String(process.env.SYNC_DB_ALTER || "false").toLowerCase() === "true";
    await sequelize.sync(syncAlter ? { alter: true } : undefined);
  }

  await ensureResponsableClientProdSchema();

  // Add return-to-client statuses + base_reference column on existing DBs
  await ensureBordereauReturnToClientSchema();

  // Allow duplicate initial bordereau references. The bureau d'ordre can create
  // multiple bordereaux for the same client with the same base name until they
  // are renamed later in the workflow.
  try {
    const dialect = sequelize.getDialect();
    if (dialect === 'mysql' || dialect === 'mariadb') {
      try { await sequelize.query('ALTER TABLE bordereaux DROP INDEX reference'); } catch {}
      try { await sequelize.query('ALTER TABLE bordereaux DROP INDEX bordereaux_reference'); } catch {}
    }
  } catch (e) {
    console.warn('[schema] Unable to relax bordereau reference uniqueness (continuing):', e?.message || e);
  }

  // Patch schema for document types management on existing DBs
  try {
    const qi = sequelize.getQueryInterface();
    const { DataTypes } = require('sequelize');
    try {
      await qi.createTable('document_type_catalog', {
        id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
        enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: true },
      });
    } catch {}
    try {
      await qi.createTable('user_role_allowed_document_types', {
        id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
        user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        role_name: { type: DataTypes.ENUM('RESPONSABLE_CLIENT','RESPONSABLE_CLIENT_PROD'), allowNull: false },
        type_document: { type: DataTypes.STRING(255), allowNull: false },
      });
    } catch {}
    try { await qi.addIndex('user_role_allowed_document_types', ['user_id', 'role_name', 'type_document'], { unique: true, name: 'uniq_user_role_allowed_document_type' }); } catch {}
    try { await qi.addIndex('user_role_allowed_document_types', ['role_name'], { name: 'idx_user_role_allowed_role' }); } catch {}
    try {
      await qi.createTable('role_allowed_document_types', {
        id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
        role_name: { type: DataTypes.ENUM('RESPONSABLE_CLIENT','RESPONSABLE_CLIENT_PROD'), allowNull: false },
        type_document: { type: DataTypes.STRING(255), allowNull: false },
      });
    } catch {}
    try { await qi.addIndex('role_allowed_document_types', ['role_name', 'type_document'], { unique: true, name: 'uniq_role_allowed_document_type' }); } catch {}
    try { await qi.addIndex('role_allowed_document_types', ['role_name'], { name: 'idx_role_allowed_role' }); } catch {}
    try {
      const [legacyRows] = await sequelize.query('SELECT user_id, type_document FROM user_allowed_document_types');
      if (Array.isArray(legacyRows) && legacyRows.length) {
        for (const row of legacyRows) {
          const typeDocument = String(row.type_document || '').trim();
          if (!typeDocument) continue;
          try { await sequelize.query('INSERT IGNORE INTO document_type_catalog (name, enabled, created_at) VALUES (?, 1, NOW())', { replacements: [typeDocument] }); } catch {}
          try { await sequelize.query("INSERT IGNORE INTO user_role_allowed_document_types (user_id, role_name, type_document) VALUES (?, 'RESPONSABLE_CLIENT_PROD', ?)", { replacements: [Number(row.user_id) || 0, typeDocument] }); } catch {}
          try { await sequelize.query("INSERT IGNORE INTO role_allowed_document_types (role_name, type_document) VALUES ('RESPONSABLE_CLIENT_PROD', ?)", { replacements: [typeDocument] }); } catch {}
        }
      }
    } catch {}
    try {
      const [rows] = await sequelize.query('SELECT DISTINCT role_name, type_document FROM user_role_allowed_document_types');
      if (Array.isArray(rows) && rows.length) {
        for (const row of rows) {
          const roleName = String(row.role_name || '').trim();
          const typeDocument = String(row.type_document || '').trim();
          if (!roleName || !typeDocument) continue;
          try { await sequelize.query('INSERT IGNORE INTO document_type_catalog (name, enabled, created_at) VALUES (?, 1, NOW())', { replacements: [typeDocument] }); } catch {}
          try { await sequelize.query('INSERT IGNORE INTO role_allowed_document_types (role_name, type_document) VALUES (?, ?)', { replacements: [roleName, typeDocument] }); } catch {}
        }
      }
    } catch {}
    try {
      await sequelize.query(`
        UPDATE bordereaux b
        JOIN bordereau_deposit_info di ON di.bordereau_id = b.id
        SET b.document_type = di.type_document
        WHERE di.type_document IS NOT NULL
          AND di.type_document <> ''
          AND di.type_document <> 'MULTI'
          AND (b.document_type IS NULL OR b.document_type = '')
      `);
    } catch {}
    try {
      await sequelize.query(`
        UPDATE bordereaux b
        JOIN (
          SELECT di.bordereau_id, MIN(ddt.type_document) AS type_document, COUNT(DISTINCT ddt.type_document) AS type_count
          FROM bordereau_deposit_info di
          JOIN bordereau_deposit_document_types ddt ON ddt.deposit_info_id = di.id
          WHERE ddt.type_document IS NOT NULL AND ddt.type_document <> ''
          GROUP BY di.bordereau_id
        ) x ON x.bordereau_id = b.id
        SET b.document_type = x.type_document
        WHERE x.type_count = 1
          AND (b.document_type IS NULL OR b.document_type = '' OR b.document_type = 'MULTI')
      `);
    } catch {}
  } catch (e) {
    console.warn('[schema] Unable to patch document type schema (continuing):', e?.message || e);
  }

  await ensureResponsableClientProdTrackingSchema();

  // Patch schema for chat read receipts on existing DBs
  await ensureChatSchema();

  await seed();

  const app = express();
  const origins = parseOrigins();

  app.use(helmet());
  app.use(morgan('dev'));
  app.use(cors({
    origin: origins === '*' ? '*' : origins,
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));

  // Static uploads (same URLs as Spring)
  const bordDir = process.env.BORDEREAU_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'bordereaux');
  const chatDir = process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'chat');
  const bonRemiseDir = process.env.BON_REMISE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'bon-remise');
  app.use('/uploads/bordereaux', express.static(bordDir));
  app.use('/uploads/chat', express.static(chatDir));
  app.use('/uploads/bon-remise', express.static(bonRemiseDir));

  // Public auth
  app.use('/api/auth', authRouter);

  // Protected API
  app.use('/api', authMiddleware(), loadUser);

  app.use('/api/clients', clientsRouter);
  app.use('/api/assureurs', assureursRouter);
  app.use('/api/bordereaux', bordereauChatRouter);
  app.use('/api/bordereaux', bordereauxRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/notifications', notificationsRouter);
  app.get('/api/document-types/options', async (req, res) => {
    const { DocumentTypeCatalog } = require('./models');
    const rows = await DocumentTypeCatalog.findAll({ where: { enabled: true }, order: [['name', 'ASC']] });
    res.json(rows.map((r) => r.name));
  });

  // Admin
  app.use('/api/admin', requireRole('ROLE_ADMIN'));
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/admin/clients', adminClientsRouter);
  app.use('/api/admin/assureurs', adminAssureursRouter);
  app.use('/api/admin/assignments', adminAssignmentsRouter);
  app.use('/api/admin/undo-requests', adminUndoRequestsRouter);
  app.use('/api/admin/dashboard', adminDashboardRouter);
  app.use('/api/admin/alerts', adminAlertsRouter);
  app.use('/api/admin/document-types', adminDocumentTypesRouter);
  app.use('/api/admin', adminMiscRouter);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Error handler (log + nicer Multer errors)
  app.use((err, _req, res, _next) => {
    // Always log server-side for debugging (docker logs)
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', err);

    // Multer errors are usually client errors (bad form-data fields)
    if (err && err.name === 'MulterError') {
      return res.status(400).json({ message: err.message || 'Invalid multipart form data' });
    }

    const status = err.status || 500;
    const msg = err.message || 'Server error';
    return res.status(status).json({ message: msg });
  });

  const server = http.createServer(app);
  initSocket(server);

  // Background alerts: notify admins when bordereaux are blocked in DONNE_AU_COURSIER.
  startBordereauAlertScheduler();

  server.listen(PORT, () => {
    console.log(`scan-backend listening on ${PORT}`);
  });
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
