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

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  roles: string[]; // ["ROLE_ADMIN", ...]
}

export interface ClientDto {
  id: number;
  name: string;
}

export interface DepositDocumentType {
  typeDocument: string;
  nombre: number;
}

export interface Bordereau {
  id: number;
  reference: string;
  clientId?: number | null;
  clientName?: string | null;
  description?: string | null;
  currentStatus: BordereauStatus;
  priority: boolean;
  priorityRank?: number | null;
  createdAt: string;
  updatedAt: string;

  finalDechargeUrl?: string | null;
  finalDechargeAt?: string | null;
  bonRemiseUrl?: string | null;
  bonRemiseAt?: string | null;

  depositInfo?: {
    assureur: string;
    depotReference: string;
    documentTypes: DepositDocumentType[];
    responsable: string;
    createdAt: string;
    typeDocument?: string;
    nombre?: number;
  } | null;
}

export interface BordereauHistory {
  id: number;
  fromStatus?: BordereauStatus | null;
  toStatus: BordereauStatus;
  changedByEmail: string;
  changedByName: string;
  changedByRole: string;
  changedAt: string;
  comment?: string | null;
  attachmentUrl?: string | null;
}

export interface CreateBordereauRequest {
  reference: string;
  clientId?: number | null;
  clientName?: string | null;
  description?: string | null;
}

export interface PrioritizeRequest {
  priority: boolean;
  priorityRank?: number | null;
}

export interface TransitionData {
  toStatus: BordereauStatus;
  comment?: string | null;
  assureur?: string | null;
  depotReference?: string | null;
  documentTypes?: DepositDocumentType[] | null;
  typeDocument?: string | null;
  nombre?: number | null;
  responsable?: string | null;
}

export interface WorkloadBucket {
  role: string;
  status?: BordereauStatus | null;
  count: number;
}

export interface WorkloadResponse {
  total: number;
  buckets: WorkloadBucket[];
}

export interface User {
  id: number;
  email: string;
  enabled: boolean;
  roles: string[]; // RoleName values, e.g. ["ADMIN"]
}

export interface UndoRequestDto {
  id: number;
  bordereauId: number;
  bordereauReference: string;
  targetHistoryId: number;
  requestedByEmail: string;
  status: string;
  reason?: string | null;
  requestedAt: string;
  decidedByEmail?: string | null;
  decidedAt?: string | null;
}

export interface DashboardOverview {
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
}

export interface ChatUser {
  id: number;
  email: string;
  roles: string[];
}

export type ChatMessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE';

export interface ChatMessage {
  id: number;
  senderId: number;
  recipientId: number;
  content: string;
  type: ChatMessageType;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
  sentAt: string;
  clientMessageId?: string | null;
}
