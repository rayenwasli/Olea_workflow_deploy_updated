const { RoleName, BordereauStatus } = require('./constants');

function roleToAuthority(roleName) {
  return 'ROLE_' + roleName;
}

function authoritiesFromRoleNames(roleNames) {
  return (roleNames || []).map(roleToAuthority);
}

function isBlank(s) {
  return s == null || String(s).trim().length === 0;
}

function hasResponsableClientLikeRole(roleNames) {
  const roles = Array.isArray(roleNames) ? roleNames : [];
  return roles.includes(RoleName.RESPONSABLE_CLIENT) || roles.includes(RoleName.RESPONSABLE_CLIENT_PROD);
}

/**
 * Create a safe reference token from free text.
 * - removes accents
 * - uppercases
 * - replaces non-alphanumerics with '_' (and collapses repeats)
 */
function refToken(input, { maxLen = 40 } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  // Remove accents/diacritics
  const noAccents = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const upper = noAccents.toUpperCase();

  // Replace non [A-Z0-9] with underscores
  const cleaned = upper
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!cleaned) return '';
  return cleaned.slice(0, maxLen);
}

/**
 * Queue ordering:
 *  1) priority=true first
 *  2) priorityRank (nulls last)
 *  3) priorityRank asc
 *  4) updatedAt desc
 */
function queueOrder() {
  const { literal } = require('sequelize');
  return [
    ['priority', 'DESC'],
    [literal('CASE WHEN priority_rank IS NULL THEN 1 ELSE 0 END'), 'ASC'],
    ['priority_rank', 'ASC'],
    ['updated_at', 'DESC'],
  ];
}

const WORKFLOW = [
  BordereauStatus.CREE,
  BordereauStatus.RECUPERE_BO,
  BordereauStatus.DEPOSE_SCAN,
  BordereauStatus.SCANNE,
  BordereauStatus.VERIFIE,
  BordereauStatus.A_RENVOYER_AU_CLIENT,
  BordereauStatus.RENVOYE_AU_CLIENT,
  BordereauStatus.RECU_DU_CLIENT,
  BordereauStatus.PRET_A_ENVOYER,
  BordereauStatus.RECU_DU_RESPONSABLE,
  BordereauStatus.DONNE_AU_COURSIER,
  BordereauStatus.FINALISE,
  BordereauStatus.VALIDE,
];

module.exports = { roleToAuthority, authoritiesFromRoleNames, isBlank, hasResponsableClientLikeRole, refToken, queueOrder, WORKFLOW };
