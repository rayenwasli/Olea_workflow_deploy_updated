const RoleName = Object.freeze({
  ADMIN: 'ADMIN',
  RESPONSABLE_CLIENT: 'RESPONSABLE_CLIENT',
  RESPONSABLE_CLIENT_PROD: 'RESPONSABLE_CLIENT_PROD',
  COURSIER: 'COURSIER',
  BUREAU_ORDRE: 'BUREAU_ORDRE',
  COORDINATEUR: 'COORDINATEUR',
  VERIFICATEUR: 'VERIFICATEUR',
  SCANNER: 'SCANNER',
});

const BordereauStatus = Object.freeze({
  CREE: 'CREE',
  RECUPERE_BO: 'RECUPERE_BO',
  DEPOSE_SCAN: 'DEPOSE_SCAN',
  SCANNE: 'SCANNE',
  VERIFIE: 'VERIFIE',
  // Responsable client signale des modifications: BO/coursier renvoie au client
  A_RENVOYER_AU_CLIENT: 'A_RENVOYER_AU_CLIENT',
  // Bordereau renvoyé au client (en attente de retour)
  RENVOYE_AU_CLIENT: 'RENVOYE_AU_CLIENT',
  // Bureau d'ordre marque la réception du retour du client (notification au responsable)
  RECU_DU_CLIENT: 'RECU_DU_CLIENT',
  PRET_A_ENVOYER: 'PRET_A_ENVOYER',
  // Bureau d'ordre confirme la réception des documents depuis le responsable client
  RECU_DU_RESPONSABLE: 'RECU_DU_RESPONSABLE',
  DONNE_AU_COURSIER: 'DONNE_AU_COURSIER',
  FINALISE: 'FINALISE',
  VALIDE: 'VALIDE',
});

const UndoRequestStatus = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

const ChatMessageType = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  FILE: 'FILE',
  VOICE: 'VOICE',
});

module.exports = { RoleName, BordereauStatus, UndoRequestStatus, ChatMessageType };
