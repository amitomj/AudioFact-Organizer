
export type EvidenceType = 'AUDIO' | 'PDF' | 'IMAGE' | 'TEXT' | 'OTHER';
export type EvidenceCategory = 'TESTIMONY' | 'INQUIRY' | 'OTHER';

export interface Person {
  id: string;
  name: string;
  role?: string; // e.g., "Testemunha", "Autor", "Réu"
}

export interface EvidenceFile {
  id: string;
  file: File | null; // Nullable for manually imported text or restored sessions
  name: string;
  folder?: string; // Folder name for grouping
  type: EvidenceType;
  category: EvidenceCategory;
  personId?: string; // Link to a person
  size?: number;
  isVirtual?: boolean;
}

export interface Fact {
  id: string;
  text: string;
}

export enum FactStatus {
  CONFIRMED = 'Confirmado',
  DENIED = 'Desmentido',
  INCONCLUSIVE = 'Inconclusivo/Contraditório',
  NOT_MENTIONED = 'Não Mencionado',
}

export interface Citation {
  fileId: string;
  fileName: string;
  timestamp: string; // Format "MM:SS" for audio, or "Pág X" for PDF if applicable
  seconds: number; // For seeking (0 for non-time-based docs)
  text: string;
}

export interface FactAnalysis {
  factId: string;
  factText: string;
  status: FactStatus;
  summary: string;
  citations: Citation[];
}

export interface AnalysisReport {
  id: string; 
  name: string;
  generatedAt: string;
  results: FactAnalysis[];
  generalConclusion: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface ProcessedContent {
  fileId: string;
  fileName: string;
  fullText: string;
  // Segments are crucial for Audio Karaoke, but also useful for Page mapping in PDFs
  segments: {
    timestamp: string; // "MM:SS" or "Page 1"
    seconds: number;   // Seconds for audio, Page Number for PDF (can use negative or specific logic)
    text: string;
  }[];
  processedAt: number;
}

export interface ProjectState {
  people: Person[];
  facts: Fact[];
  processedData: ProcessedContent[]; 
  savedReports: AnalysisReport[]; // Lista de relatórios guardados
  chatHistory: ChatMessage[];
  lastModified: number;
}

// SERIALIZATION TYPES

export interface SerializedProject {
  type: 'project_v2';
  people: Person[];
  facts: Fact[];
  savedReports: AnalysisReport[];
  chatHistory: ChatMessage[];
  createdAt: number;
}

export interface SerializedDatabase {
  type: 'database_v2';
  processedData: ProcessedContent[];
  fileManifest: { id: string; name: string; type: EvidenceType; category: EvidenceCategory; folder?: string }[];
  exportedAt: number;
}