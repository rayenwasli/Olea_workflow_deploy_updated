const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');
const { RoleName, BordereauStatus, UndoRequestStatus, ChatMessageType } = require('../utils/constants');

const Role = sequelize.define('roles', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.ENUM(...Object.values(RoleName)), allowNull: false, unique: true },
}, { timestamps: false });

const User = sequelize.define('users', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  timestamps: false,
});

const UserRole = sequelize.define('user_roles', {
  user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, primaryKey: true },
  role_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, primaryKey: true },
}, { timestamps: false });

const Client = sequelize.define('clients', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(180), allowNull: false, unique: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, { timestamps: false });

const Assureur = sequelize.define('assureurs', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(180), allowNull: false, unique: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, { timestamps: false });

const ClientResponsable = sequelize.define('client_responsables', {
  client_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, primaryKey: true },
  user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, primaryKey: true },
}, { timestamps: false });

const DocumentTypeCatalog = sequelize.define('document_type_catalog', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  timestamps: false,
});

const UserRoleAllowedDocumentType = sequelize.define('user_role_allowed_document_types', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  role_name: { type: DataTypes.ENUM(RoleName.RESPONSABLE_CLIENT, RoleName.RESPONSABLE_CLIENT_PROD), allowNull: false },
  type_document: { type: DataTypes.STRING(255), allowNull: false },
}, {
  timestamps: false,
  indexes: [
    { name: 'uniq_user_role_allowed_document_type', unique: true, fields: ['user_id', 'role_name', 'type_document'] },
    { name: 'idx_user_role_allowed_role', fields: ['role_name'] },
  ],
});

const RoleAllowedDocumentType = sequelize.define('role_allowed_document_types', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  role_name: { type: DataTypes.ENUM(RoleName.RESPONSABLE_CLIENT, RoleName.RESPONSABLE_CLIENT_PROD), allowNull: false },
  type_document: { type: DataTypes.STRING(255), allowNull: false },
}, {
  timestamps: false,
  indexes: [
    { name: 'uniq_role_allowed_document_type', unique: true, fields: ['role_name', 'type_document'] },
    { name: 'idx_role_allowed_role', fields: ['role_name'] },
  ],
});

const Bordereau = sequelize.define('bordereaux', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  reference: { type: DataTypes.STRING(255), allowNull: false },
  // Stable reference used as the base for scanner renaming and for restarts (return to client)
  base_reference: { type: DataTypes.STRING(255), allowNull: true },
  client_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  client_name: { type: DataTypes.STRING(255), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  parent_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  document_type: { type: DataTypes.STRING(255), allowNull: true },
  current_status: { type: DataTypes.ENUM(...Object.values(BordereauStatus)), allowNull: false, defaultValue: BordereauStatus.CREE },
  priority: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  priority_rank: { type: DataTypes.INTEGER, allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, { timestamps: false });

// Used to generate unique references like: YYYY_CLIENT_001 (incrementing per client per year)
// We store a (client_key, year) -> next_number counter and lock it in transactions.
const BordereauRefSequence = sequelize.define('bordereau_ref_sequences', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  client_key: { type: DataTypes.STRING(255), allowNull: false },
  year: { type: DataTypes.INTEGER, allowNull: false },
  next_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  timestamps: false,
  indexes: [
    { name: 'uniq_bord_ref_seq_key_year', unique: true, fields: ['client_key', 'year'] },
  ],
});

const BordereauStatusHistory = sequelize.define('bordereau_status_history', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  bordereau_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  from_status: { type: DataTypes.ENUM(...Object.values(BordereauStatus)), allowNull: true },
  to_status: { type: DataTypes.ENUM(...Object.values(BordereauStatus)), allowNull: false },
  changed_by_user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  changed_by_role: { type: DataTypes.ENUM(...Object.values(RoleName)), allowNull: false },
  changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  comment: { type: DataTypes.STRING(1000), allowNull: true },
  attachment_url: { type: DataTypes.STRING(512), allowNull: true },
}, { timestamps: false });

const BordereauDepositInfo = sequelize.define('bordereau_deposit_info', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  bordereau_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, unique: true },
  assureur: { type: DataTypes.STRING(255), allowNull: false },
  type_document: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
  depot_reference: { type: DataTypes.STRING(255), allowNull: false },
  nombre: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  responsable: { type: DataTypes.STRING(255), allowNull: false },
  matricule: { type: DataTypes.STRING(255), allowNull: true },
  nom_prenom_prestataire: { type: DataTypes.STRING(255), allowNull: true },
  nature_demande: { type: DataTypes.STRING(255), allowNull: true },
  documents_envoyes: { type: DataTypes.STRING(1000), allowNull: true },
  date_adhesion_effet: { type: DataTypes.DATE, allowNull: true },
  date_reception_client: { type: DataTypes.DATE, allowNull: true },
  date_envoi_assureur_decharge: { type: DataTypes.DATE, allowNull: true },
  execution: { type: DataTypes.STRING(20), allowNull: true },
  date_execution: { type: DataTypes.DATE, allowNull: true },
  remarque: { type: DataTypes.STRING(1000), allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { timestamps: false });

const BordereauDepositDocumentType = sequelize.define('bordereau_deposit_document_type', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  deposit_info_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  type_document: { type: DataTypes.STRING(255), allowNull: false },
  nombre: { type: DataTypes.INTEGER, allowNull: false },
}, { timestamps: false });

const UndoRequest = sequelize.define('undo_request', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  bordereau_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  target_history_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  requested_by_user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  reason: { type: DataTypes.STRING(800), allowNull: true },
  status: { type: DataTypes.ENUM(...Object.values(UndoRequestStatus)), allowNull: false, defaultValue: UndoRequestStatus.PENDING },
  requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  decided_by_admin_user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  decided_at: { type: DataTypes.DATE, allowNull: true },
}, { timestamps: false });

const ChatMessage = sequelize.define('chat_messages', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  conversation_key: { type: DataTypes.STRING(64), allowNull: false },
  sender_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  recipient_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  content: { type: DataTypes.STRING(2000), allowNull: false, defaultValue: '' },
  type: { type: DataTypes.ENUM(...Object.values(ChatMessageType)), allowNull: false, defaultValue: ChatMessageType.TEXT },
  media_url: { type: DataTypes.STRING(512), allowNull: true },
  mime_type: { type: DataTypes.STRING(128), allowNull: true },
  file_name: { type: DataTypes.STRING(255), allowNull: true },
  file_size: { type: DataTypes.BIGINT, allowNull: true },
  duration_ms: { type: DataTypes.BIGINT, allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  delivered_at: { type: DataTypes.DATE, allowNull: true },
  seen_at: { type: DataTypes.DATE, allowNull: true },
}, {
  timestamps: false,
  indexes: [
    { name: 'idx_chat_conv_time', fields: ['conversation_key', 'sent_at'] },
    { name: 'idx_chat_sender', fields: ['sender_id'] },
    { name: 'idx_chat_recipient', fields: ['recipient_id'] },
    { name: 'idx_chat_recipient_seen', fields: ['recipient_id', 'seen_at'] },
  ],
});



// Bordereau threads (one chat thread per bordereau)
const BordereauChatMessage = sequelize.define('bordereau_chat_messages', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  bordereau_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  sender_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  content: { type: DataTypes.STRING(2000), allowNull: false, defaultValue: '' },
  type: { type: DataTypes.ENUM(...Object.values(ChatMessageType)), allowNull: false, defaultValue: ChatMessageType.TEXT },
  media_url: { type: DataTypes.STRING(512), allowNull: true },
  mime_type: { type: DataTypes.STRING(128), allowNull: true },
  file_name: { type: DataTypes.STRING(255), allowNull: true },
  file_size: { type: DataTypes.BIGINT, allowNull: true },
  duration_ms: { type: DataTypes.BIGINT, allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  pinned_at: { type: DataTypes.DATE, allowNull: true },
  pinned_by_user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  // JSON string: { mentionUserIds: number[] }
  mentions_json: { type: DataTypes.TEXT, allowNull: true },
}, {
  timestamps: false,
  indexes: [
    { name: 'idx_bord_chat_time', fields: ['bordereau_id', 'sent_at'] },
    { name: 'idx_bord_chat_sender', fields: ['sender_id'] },
    { name: 'idx_bord_chat_pinned', fields: ['bordereau_id', 'pinned_at'] },
  ],
});
// Persistent notifications (for navbar center + cross-device history)
const Notification = sequelize.define('notifications', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  // stable identifier to avoid duplicates across socket + API reloads
  event_key: { type: DataTypes.STRING(160), allowNull: false },
  kind: { type: DataTypes.ENUM('CHAT', 'BORDEREAU', 'SYSTEM'), allowNull: false, defaultValue: 'SYSTEM' },
  title: { type: DataTypes.STRING(255), allowNull: false },
  message: { type: DataTypes.STRING(1000), allowNull: true },
  href: { type: DataTypes.STRING(512), allowNull: true },
  read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  timestamps: false,
  indexes: [
    { name: 'idx_notif_user_time', fields: ['user_id', 'created_at'] },
    { name: 'uniq_notif_user_key', unique: true, fields: ['user_id', 'event_key'] },
  ],
});

// Associations
User.belongsToMany(Role, { through: UserRole, foreignKey: 'user_id', otherKey: 'role_id' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'role_id', otherKey: 'user_id' });

DocumentTypeCatalog.hasMany(UserRoleAllowedDocumentType, { foreignKey: 'type_document', sourceKey: 'name', as: 'userAssignments' });
UserRoleAllowedDocumentType.belongsTo(DocumentTypeCatalog, { foreignKey: 'type_document', targetKey: 'name', as: 'documentTypeCatalog' });
DocumentTypeCatalog.hasMany(RoleAllowedDocumentType, { foreignKey: 'type_document', sourceKey: 'name', as: 'roleAssignments' });
RoleAllowedDocumentType.belongsTo(DocumentTypeCatalog, { foreignKey: 'type_document', targetKey: 'name', as: 'documentTypeCatalog' });

User.hasMany(UserRoleAllowedDocumentType, { foreignKey: 'user_id', as: 'roleAllowedDocumentTypes' });
UserRoleAllowedDocumentType.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

Client.belongsToMany(User, { through: ClientResponsable, as: 'responsables', foreignKey: 'client_id', otherKey: 'user_id' });
User.belongsToMany(Client, { through: ClientResponsable, as: 'assigned_clients', foreignKey: 'user_id', otherKey: 'client_id' });

Bordereau.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Client.hasMany(Bordereau, { foreignKey: 'client_id', as: 'bordereaux' });

Bordereau.belongsTo(Bordereau, { foreignKey: 'parent_id', as: 'parent' });
Bordereau.hasMany(Bordereau, { foreignKey: 'parent_id', as: 'children' });


BordereauStatusHistory.belongsTo(Bordereau, { foreignKey: 'bordereau_id', as: 'bordereau' });
BordereauStatusHistory.belongsTo(User, { foreignKey: 'changed_by_user_id', as: 'changedBy' });
Bordereau.hasMany(BordereauStatusHistory, { foreignKey: 'bordereau_id', as: 'history' });

BordereauDepositInfo.belongsTo(Bordereau, { foreignKey: 'bordereau_id', as: 'bordereau' });
Bordereau.hasOne(BordereauDepositInfo, { foreignKey: 'bordereau_id', as: 'depositInfo' });
BordereauDepositDocumentType.belongsTo(BordereauDepositInfo, { foreignKey: 'deposit_info_id', as: 'depositInfo' });
BordereauDepositInfo.hasMany(BordereauDepositDocumentType, { foreignKey: 'deposit_info_id', as: 'documentTypes' });

UndoRequest.belongsTo(Bordereau, { foreignKey: 'bordereau_id', as: 'bordereau' });
UndoRequest.belongsTo(BordereauStatusHistory, { foreignKey: 'target_history_id', as: 'targetHistory' });
UndoRequest.belongsTo(User, { foreignKey: 'requested_by_user_id', as: 'requestedBy' });
UndoRequest.belongsTo(User, { foreignKey: 'decided_by_admin_user_id', as: 'decidedBy' });

Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });

// Bordereau chat associations
BordereauChatMessage.belongsTo(Bordereau, { foreignKey: 'bordereau_id', as: 'bordereau' });
Bordereau.hasMany(BordereauChatMessage, { foreignKey: 'bordereau_id', as: 'chatMessages' });
BordereauChatMessage.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });
BordereauChatMessage.belongsTo(User, { foreignKey: 'pinned_by_user_id', as: 'pinnedBy' });

module.exports = {
  sequelize,
  Role, User, UserRole,
  Client, ClientResponsable,
  Assureur,

  Bordereau, BordereauStatusHistory,
  BordereauRefSequence,
  BordereauDepositInfo, BordereauDepositDocumentType,
  UndoRequest,
  ChatMessage,
  BordereauChatMessage,
  Notification,
  DocumentTypeCatalog,
  UserRoleAllowedDocumentType,
  RoleAllowedDocumentType,
};
