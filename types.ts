

export interface AudioFile {
  id: string;
  file: File | null; // Nullable for manually imported transcripts
  name: string;
  duration?: number;
  isVirtual?: boolean; // New flag for text-only entries
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
  audioFileId: string;
  audioFileName: string;
  timestamp: string; // Format "MM:SS"
  seconds: number; // For seeking
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
  id: string; // Unique ID for the report version
  name: string; // User-friendly name
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

export interface Transcription {
  audioFileId: string;
  audioFileName: string;
  fullText: string;
  segments: {
    timestamp: string;
    seconds: number;
    text: string;
  }[];
  processedAt: number;
}

export interface ProjectState {
  facts: Fact[];
  transcriptions: Transcription[];
  analysis: AnalysisReport | null; // Currently viewed analysis
  analysisHistory: AnalysisReport[]; // History of all analyses
  chatHistory: ChatMessage[];
  lastModified: number;
}

// 1. PROJECT FILE (Lightweight: Facts, Analysis, Chat)
export interface SerializedProject {
  type: 'project';
  facts: Fact[];
  analysis: AnalysisReport | null;
  analysisHistory: AnalysisReport[];
  chatHistory: ChatMessage[];
  createdAt: number;
}

// 2. DATABASE FILE (Heavyweight: Transcriptions only)
export interface SerializedDatabase {
  type: 'database';
  transcriptions: Transcription[];
  audioFileNames: string[]; // To help map back to physical files
  exportedAt: number;
}