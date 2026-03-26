export type RoleName =
  | 'ADMIN'
  | 'RESPONSABLE_CLIENT'
  | 'RESPONSABLE_CLIENT_PROD'
  | 'COURSIER'
  | 'BUREAU_ORDRE'
  | 'COORDINATEUR'
  | 'VERIFICATEUR'
  | 'SCANNER';

export type Authority = `ROLE_${RoleName}`;

export type Page<T> = {
  items: T[];
  page: number;
  size: number;
  total: number;
  pages: number;
};

export type BordereauStatus =
  | 'CREE'
  | 'RECUPERE_BO'
  | 'DEPOSE_SCAN'
  | 'SCANNE'
  | 'VERIFIE'
  | 'A_RENVOYER_AU_CLIENT'
  | 'RENVOYE_AU_CLIENT'
  | 'RECU_DU_CLIENT'
  | 'PRET_A_ENVOYER'
  | 'RECU_DU_RESPONSABLE'
  | 'DONNE_AU_COURSIER'
  | 'FINALISE'
  | 'VALIDE';

export type ClientDto = { id: number; name: string };

export type AssureurDto = { id: number; name: string; enabled?: boolean };

export type DepositDocumentType = { typeDocument: string; nombre: number };

export type DepositInfoDto = {
  assureur: string;
  depotReference: string;
  responsable: string;
  createdAt?: string;
  documentTypes?: DepositDocumentType[];
  matricule?: string | null;
  nomPrenomPrestataire?: string | null;
  natureDemande?: string | null;
  documentsEnvoyes?: string | null;
  dateAdhesionEffet?: string | null;
  dateReceptionClient?: string | null;
  dateEnvoiAssureurDecharge?: string | null;
  execution?: string | null;
  dateExecution?: string | null;
  remarque?: string | null;
  // legacy fields sometimes present
  typeDocument?: string;
  nombre?: number;
};

export type BordereauDto = {
  id: number;
  reference: string;
  parentId: number | null;
  parentReference?: string | null;
  documentType?: string | null;
  childrenCount?: number;
  children?: BordereauDto[];
  clientId: number | null;
  clientName: string | null;
  description: string | null;
  currentStatus: BordereauStatus;
  // Only present for parent groups (bordereaux with sub-bordereaux).
  // Breakdown of sub-bordereaux statuses so the UI can display a multi-status mother.
  childrenStatusCounts?: { status: BordereauStatus; count: number }[];
  priority: boolean;
  priorityRank: number | null;
  createdAt: string;
  updatedAt: string | null;
  finalDechargeUrl?: string | null;
  finalDechargeAt?: string | null;
  bonRemiseUrl?: string | null;
  bonRemiseAt?: string | null;
  depositInfo?: DepositInfoDto | null;
  isResponsableClientProdFlow: boolean;
};

export type BordereauHistoryDto = {
  id: number;
  fromStatus: BordereauStatus | null;
  toStatus: BordereauStatus;
  changedByEmail: string;
  changedByName: string;
  changedByRole: RoleName;
  changedAt: string;
  comment?: string | null;
  attachmentUrl?: string | null;
};

export type LoginResponse = {
  accessToken: string;
  tokenType: string; // "Bearer"
  expiresIn: number;
  roles: Authority[];
};

export type UserDto = { id: number; email: string; enabled: boolean; roles: RoleName[] };

export type RoleDocumentTypeAssignment = string[];

export type AdminDocumentTypeConfigDto = {
  managedRoles: RoleName[];
  documentTypes: { id: number; name: string; enabled: boolean }[];
  assignments: Partial<Record<RoleName, RoleDocumentTypeAssignment>>;
};

export type ResponsableDto = { id: number; email: string };

export type ClientAssignment = {
  id: number;
  name: string;
  responsables: ResponsableDto[];
};

export type UndoRequestDto = {
  id: number;
  bordereauId: number;
  bordereauReference: string;
  targetHistoryId: number;
  requestedByEmail: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason?: string | null;
  requestedAt?: string;
  decidedAt?: string | null;
  decidedByEmail?: string | null;
};

export type DashboardOverview = {
  generatedAt: string;
  kpis: {
    totalBordereaux: number;
    backlog: number;
    inProgressToday: number;
    inProgressWeek: number;
    priorityCount: number;
    avgCycleHours: number | null;
  };
  statusCounts: { status: string; count: number }[];
  funnel: { status: string; count: number }[];
  createdSeries: { bucket: string; count: number }[];
  finalizedSeries: { bucket: string; count: number }[];
  avgTimePerStatus: { status: string; avgHours: number; samples: number }[];
  bottleneck: { status: string; avgHours: number; samples: number };
  agingBuckets: { bucket: string; total: number; byStatus: Record<string, number> }[];
  roleActivitySeries: { bucket: string; countsByRole: Record<string, number> }[];
};

export type RoleDashboardWaitingItem = {
  bordereauId: number;
  reference: string;
  clientName: string | null;
  status: BordereauStatus;
  statusSince: string | null;
  ageDays: number;
  documentType: string;
  nombre: number;
};

export type RoleDashboard = {
  generatedAt: string;
  role: RoleName;
  scope: {
    from: string;
    to: string;
    bucket: 'DAY' | 'WEEK';
    asOf: string;
    clientId: number | null;
    priority: boolean | null;
  };
  pendingStatuses: BordereauStatus[];
  backlogByStatus: {
    status: BordereauStatus;
    count: number;
    documents: number;
    avgWaitDays: number;
    maxWaitDays: number;
  }[];
  agingDaily: { ageDays: number; count: number; documents: number }[];
  waitingItems: RoleDashboardWaitingItem[];
  throughputSeries: { bucket: string; count: number }[];
  kpis: {
    backlogBordereaux: number;
    backlogDocuments: number;
    avgWaitDays: number;
    maxWaitDays: number;
    processedInRange: number;
  };


export type NumericStats = {
  generatedAt: string;
  scope: {
    from: string;
    to: string;
    bucket: 'DAY' | 'WEEK';
    asOf: string;
    clientId: number | null;
    priority: boolean | null;
  };
  kpis: {
    totalBordereaux: number;
    backlog: number;
    inProgressToday: number;
    inProgressWeek: number;
    priorityCount: number;
    avgCycleHours: number | null;
  };
  bottleneck: { status: string; avgHours: number; samples: number };
  byStatus: { status: string; count: number; avgHours: number; samples: number }[];
  byRole: {
    role: RoleName;
    backlogBordereaux: number;
    backlogDocuments: number;
    avgWaitDays: number;
    maxWaitDays: number;
    processedInRange: number;
  }[];
};

export type ChatSidebarUserDto = {
  id: number;
  email: string;
  roles?: string[];
  unreadCount: number;
  lastMessage: ChatMessage | null;
  online: boolean;
  lastSeenAt?: number | null;
};

export type ChatUser = { id: number; email: string; roles: Authority[] };

export type ChatMessage = {
  id: number;
  senderId: number;
  recipientId: number;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE';
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
  sentAt: string;
  deliveredAt?: string | null;
  seenAt?: string | null;
  clientMessageId?: string | null;
};

export type BordereauChatMessage = {
  id: number;
  bordereauId: number;
  senderId: number;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE';
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
  sentAt: string;
  pinnedAt?: string | null;
  pinnedByUserId?: number | null;
  mentions?: number[];
  clientMessageId?: string | null;
};

export type UploadResponse = {
  url: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  durationMs?: number;
};
