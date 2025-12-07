
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, FileText, MessageSquare, PlayCircle, Save, FolderOpen, Plus, Trash2,
  CheckCircle2, AlertCircle, Loader2, FileAudio, BrainCircuit, Database, 
  X, Key, Users, File, FileImage, LayoutGrid, Paperclip, Mic, Gavel, Edit2, Check,
  ChevronDown, ChevronRight, StopCircle, Play, Layers, ArrowUp, ArrowDown, LogOut, ExternalLink, AlertTriangle, Sun, Moon, Pencil, ChevronUp, UserPlus, Download, ZapOff
} from 'lucide-react';
import { EvidenceFile, Fact, ProjectState, ChatMessage, ProcessedContent, Person, EvidenceType, Citation, EvidenceCategory, AnalysisReport, SerializedProject, SerializedDatabase } from './types';
import { processFile, analyzeFactsFromEvidence, chatWithEvidence, sanitizeTranscript, parseSecondsSafe } from './services/geminiService';
import { exportToWord, saveProjectFile, saveDatabaseFile, loadFromJSON, exportChatToZip } from './utils/exportService';
import EvidenceViewer from './components/EvidenceViewer';

// --- INITIAL STATE ---
const initialProjectState: ProjectState = {
  people: [],
  facts: [],
  processedData: [], 
  savedReports: [],
  chatHistory: [],
  lastModified: Date.now(),
};

type View = 'landing' | 'setup' | 'people' | 'analysis' | 'chat';

// GROUPED CITATION COMPONENT (Audio Bar Style)
const CitationGroup: React.FC<{ 
    fileName: string;
    contentLines: string[];
    evidenceFiles: EvidenceFile[]; 
    onSeek: (fileId: string, seconds: number) => void; 
    onOpenOriginal: (fileId: string) => void;
    renderInline: (text: string) => React.ReactNode;
}> = ({ fileName, contentLines, evidenceFiles, onSeek, onOpenOriginal, renderInline }) => {
    
    // Find Evidence
    const evidence = evidenceFiles.find(f => f.name.toLowerCase().includes(fileName.toLowerCase()) || fileName.toLowerCase().includes(f.name.toLowerCase()));
    
    // Extract all timestamps found in this group for the "Footer Bar"
    const allTimestamps: { label: string, seconds: number }[] = [];
    contentLines.forEach(line => {
        // Look for [00:00] or [00:00:00] or [File @ 00:00] patterns
        const regex = /\[(?:.*?@\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\]/g; 
        let match;
        while ((match = regex.exec(line)) !== null) {
            allTimestamps.push({ label: match[1], seconds: parseSecondsSafe(match[1]) });
        }
        // Also check if line itself is a citation list from AI like [File @ 01:00, 02:00]
        const multiRegex = /\[.*?@\s*(.*?)\]/;
        const multiMatch = line.match(multiRegex);
        if (multiMatch) {
            const times = multiMatch[1].split(',').map(t => t.trim());
            times.forEach(t => {
                if (t.match(/^\d{1,2}:\d{2}/)) {
                     allTimestamps.push({ label: t, seconds: parseSecondsSafe(t) });
                }
            });
        }
    });

    // Deduplicate timestamps
    const uniqueTimestamps = allTimestamps.filter((v, i, a) => a.findIndex(t => t.label === v.label) === i).sort((a,b) => a.seconds - b.seconds);

    return (
        <div className="my-3 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm transition-all group">
            {/* Header */}
            <div className="px-3 py-2 bg-blue-50 dark:bg-primary-900/20 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FileAudio size={14} className="text-primary-600 dark:text-primary-400" />
                    <span className="text-xs font-bold text-primary-700 dark:text-primary-300 uppercase truncate max-w-[200px]" title={fileName}>{fileName}</span>
                </div>
                 {evidence && !evidence.isVirtual && (
                     <button 
                        onClick={(e) => { e.stopPropagation(); onOpenOriginal(evidence.id); }}
                        className="flex items-center gap-1 px-2 py-0.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded text-[10px] text-gray-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                     >
                         <ExternalLink size={10} /> Abrir Original
                     </button>
                 )}
            </div>

            {/* Content Body */}
            <div className="p-4 text-sm text-gray-700 dark:text-slate-300 leading-relaxed space-y-2">
                {contentLines.map((line, i) => (
                    <div key={i}>{renderInline(line)}</div>
                ))}
            </div>

            {/* Footer Buttons (Audio Bar) */}
            {evidence && uniqueTimestamps.length > 0 && evidence.type === 'AUDIO' && (
                <div className="px-3 py-2 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] font-bold text-gray-400 dark:text-slate-600 uppercase mr-2">Ouvir em:</span>
                    {uniqueTimestamps.map((ts, idx) => (
                         <button 
                            key={idx}
                            onClick={(e) => { e.stopPropagation(); onSeek(evidence.id, ts.seconds); }}
                            className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-primary-900/30 text-blue-700 dark:text-primary-300 rounded-md text-[10px] font-mono hover:bg-blue-200 dark:hover:bg-primary-900/50 transition-colors border border-blue-200 dark:border-primary-800/50"
                        >
                            <Play size={8} fill="currentColor"/> {ts.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const App: React.FC = () => {
  // Auth
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem("veritas_api_key") || "");
  const [tempApiKey, setTempApiKey] = useState("");

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  // App State
  const [currentView, setCurrentView] = useState<View>('landing');
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]); 
  const [project, setProject] = useState<ProjectState>(initialProjectState);
  
  // Processing Control
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const abortProcessingRef = useRef<boolean>(false);
  
  // Viewer State (Popup)
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [seekSeconds, setSeekSeconds] = useState<number | null>(null);

  // Manual Import
  const [isManualImportOpen, setIsManualImportOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState<EvidenceCategory>('TESTIMONY');

  // People Management State
  const [newPersonList, setNewPersonList] = useState("");

  // Report Editing
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  
  // Report Renaming State
  const [isRenamingReport, setIsRenamingReport] = useState(false);
  const [tempReportName, setTempReportName] = useState("");

  // Folder UI State
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  
  // Drag & Drop UI State
  const [dragOverCategory, setDragOverCategory] = useState<EvidenceCategory | null>(null);

  // Export Modal State
  const [exportModal, setExportModal] = useState<{ isOpen: boolean, messageId?: string }>({ isOpen: false });

  // Quota Error Modal State
  const [showQuotaModal, setShowQuotaModal] = useState(false);

  // --- EFFECT: THEME ---
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  // Reset renaming state when changing report
  useEffect(() => {
      setIsRenamingReport(false);
      setTempReportName("");
  }, [selectedReportId]);

  // --- HELPERS ---

  const isQuotaError = (error: any): boolean => {
      const msg = error?.message?.toLowerCase() || "";
      return msg.includes('429') || msg.includes('quota') || msg.includes('resource exhausted') || msg.includes('too many requests');
  };

  const getFileType = (file: File): EvidenceType => {
      if (file.type.startsWith('audio/')) return 'AUDIO';
      if (file.type === 'application/pdf') return 'PDF';
      if (file.type.startsWith('image/')) return 'IMAGE';
      if (file.type.startsWith('text/')) return 'TEXT';
      return 'OTHER';
  };

  const peopleMap = React.useMemo(() => {
      const map: Record<string, string> = {};
      evidenceFiles.forEach(f => {
          if (f.personId) {
              const p = project.people.find(person => person.id === f.personId);
              if (p) map[f.id] = p.name;
          }
      });
      return map;
  }, [evidenceFiles, project.people]);

  const toggleFolder = (folderKey: string) => {
      setExpandedFolders(prev => ({ ...prev, [folderKey]: !prev[folderKey] }));
  };
  
  const handleOpenOriginal = (fileId: string) => {
      const file = evidenceFiles.find(f => f.id === fileId);
      if (file && file.file) {
          const url = URL.createObjectURL(file.file);
          window.open(url, '_blank');
      } else {
          alert("Ficheiro original não disponível (Este é um ficheiro virtual de um projeto importado). Por favor, arraste novamente o ficheiro original na aba Dados para reativar esta funcionalidade.");
      }
  };

  // --- RENDER HELPERS (CHAT) ---
  
  const renderTextWithInlineCitations = (text: string) => {
      // Handles [00:00, file.mp3] OR [file.mp3 @ 00:00] OR [file.mp3 @ 00:00, 01:00]
      const parts = text.split(/(\[.*?\])/g);
      
      return (
        <span>
            {parts.map((part, i) => {
                // Check if part is a citation tag
                const matchNameTime = part.match(/^\[(.*?)\s*@\s*(.*?)\]$/); 
                const matchTimeName = part.match(/^\[(\d{1,2}:\d{2}.*?)\s*,\s*(.*?)\]$/);

                if (matchNameTime || matchTimeName) {
                    const fileRef = matchNameTime ? matchNameTime[1] : matchTimeName![2];
                    const timePart = matchNameTime ? matchNameTime[2] : matchTimeName![1];
                    
                    // Split multiple times: "01:00, 02:00"
                    const times = timePart.split(',').map(t => t.trim());
                    const file = evidenceFiles.find(f => f.name.toLowerCase().includes(fileRef.toLowerCase()) || fileRef.toLowerCase().includes(f.name.toLowerCase()));
                    
                    if (file && !file.isVirtual && file.type === 'AUDIO') {
                        return (
                            <span key={i} className="inline-flex flex-wrap items-center gap-1 align-middle mx-1">
                                {times.map((t, idx) => {
                                    const seconds = parseSecondsSafe(t);
                                    if(Number.isNaN(seconds) || !t.match(/\d/)) return null; // Skip non-time
                                    return (
                                        <button 
                                            key={idx}
                                            onClick={(e) => { e.stopPropagation(); setActiveEvidenceId(file.id); setSeekSeconds(seconds); }}
                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 dark:bg-primary-900/40 text-blue-700 dark:text-primary-300 rounded text-[10px] font-mono hover:bg-blue-200 dark:hover:bg-primary-900/60 transition-colors border border-blue-200 dark:border-primary-800 shadow-sm cursor-pointer select-none"
                                            title={`Ouvir ${file.name} em ${t}`}
                                        >
                                            <Play size={8} fill="currentColor"/> {t}
                                        </button>
                                    );
                                })}
                            </span>
                        );
                    }
                }
                return <span key={i}>{part}</span>;
            })}
        </span>
      );
  };

  const renderMessageContent = (msgText: string) => {
      const lines = msgText.split('\n');
      const renderedElements: React.ReactNode[] = [];
      
      let currentGroup: { fileName: string, lines: string[] } | null = null;
      
      // Heuristic to detect if a line belongs to a file group
      const hasFileRef = (line: string) => {
          const match = line.match(/\[(.*?)\s*@/);
          return match ? match[1].trim() : null;
      };

      lines.forEach((line, i) => {
          const fileNameRef = hasFileRef(line);
          
          if (fileNameRef) {
              if (currentGroup && currentGroup.fileName.toLowerCase() === fileNameRef.toLowerCase()) {
                  // Continue same group
                  currentGroup.lines.push(line);
              } else {
                  // Flush prev group
                  if (currentGroup) {
                      renderedElements.push(
                          <CitationGroup 
                              key={`group-${i}`}
                              fileName={currentGroup.fileName}
                              contentLines={currentGroup.lines}
                              evidenceFiles={evidenceFiles}
                              onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }}
                              onOpenOriginal={handleOpenOriginal}
                              renderInline={renderTextWithInlineCitations}
                          />
                      );
                  }
                  // Start new
                  currentGroup = { fileName: fileNameRef, lines: [line] };
              }
          } else {
              if (currentGroup) {
                  renderedElements.push(
                      <CitationGroup 
                          key={`group-${i}`}
                          fileName={currentGroup.fileName}
                          contentLines={currentGroup.lines}
                          evidenceFiles={evidenceFiles}
                          onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }}
                          onOpenOriginal={handleOpenOriginal}
                          renderInline={renderTextWithInlineCitations}
                      />
                  );
                  currentGroup = null;
              }
              if (line.trim()) {
                   renderedElements.push(
                       <p key={`text-${i}`} className="mb-2 last:mb-0 leading-relaxed">
                           {renderTextWithInlineCitations(line)}
                       </p>
                   );
              }
          }
      });

      // Flush final
      if (currentGroup) {
          renderedElements.push(
              <CitationGroup 
                  key={`group-last`}
                  fileName={currentGroup.fileName}
                  contentLines={currentGroup.lines}
                  evidenceFiles={evidenceFiles}
                  onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }}
                  onOpenOriginal={handleOpenOriginal}
                  renderInline={renderTextWithInlineCitations}
              />
          );
      }
      
      return renderedElements;
  };

  // --- ACTIONS ---

  const addFiles = (fileList: FileList | File[], category: EvidenceCategory) => {
      setEvidenceFiles(prevFiles => {
          const updatedFiles = [...prevFiles];
          const newFilesToAdd: EvidenceFile[] = [];

          Array.from(fileList).forEach((f: File) => {
              // Extract folder logic
              const relativePath = (f as any).webkitRelativePath || "";
              let folderName = "Raiz";
              if (relativePath) {
                  const parts = relativePath.split('/');
                  if (parts.length > 1) {
                      folderName = parts[parts.length - 2] || parts[0]; 
                  }
              }

              // Check for existing virtual file to rehydrate
              const existingIndex = updatedFiles.findIndex(
                  ev => ev.name === f.name && ev.isVirtual && ev.category === category
              );

              if (existingIndex !== -1) {
                  // REHYDRATE: Link physical file to existing metadata
                  updatedFiles[existingIndex] = {
                      ...updatedFiles[existingIndex],
                      file: f,
                      isVirtual: false, 
                      size: f.size
                  };
              } else {
                  // CREATE NEW
                  newFilesToAdd.push({
                      id: Math.random().toString(36).substr(2, 9),
                      file: f,
                      name: f.name,
                      folder: folderName,
                      type: getFileType(f),
                      category: category,
                      size: f.size
                  });
              }
          });

          return [...updatedFiles, ...newFilesToAdd];
      });

      // NOTA: Pastas fechadas por defeito, por isso não atualizamos expandedFolders aqui.
  };

  // 1. Categorized File Upload with Folder Detection
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, category: EvidenceCategory) => {
    if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files, category);
    }
  };

  // Drag and Drop Handlers
  const handleDragOver = (e: React.DragEvent, category: EvidenceCategory) => {
      e.preventDefault();
      setDragOverCategory(category);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverCategory(null);
  };

  const handleDrop = (e: React.DragEvent, category: EvidenceCategory) => {
      e.preventDefault();
      setDragOverCategory(null);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          addFiles(e.dataTransfer.files, category);
      }
  };

  const deleteFolder = (category: EvidenceCategory, folderName: string) => {
      if(confirm(`Tem a certeza que quer apagar a pasta "${folderName}" e todos os ficheiros nela contidos?`)) {
          setEvidenceFiles(prev => prev.filter(f => !(f.category === category && f.folder === folderName)));
      }
  };

  // 2. Load Project / Database
  const handleLoadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
          const result = await loadFromJSON(file);
          if (result.type === 'project') {
              const data = result.data as SerializedProject;
              setProject({
                  ...initialProjectState,
                  people: data.people || [],
                  facts: data.facts || [],
                  savedReports: data.savedReports || [],
                  chatHistory: data.chatHistory || [],
              });
              alert("Projeto carregado com sucesso.");
          } else if (result.type === 'database') {
              const data = result.data as SerializedDatabase;
              setProject(prev => ({ ...prev, processedData: data.processedData || [] }));
              
              // Restore evidence files as Virtual Files
              const restoredFiles: EvidenceFile[] = data.fileManifest.map(m => ({
                  id: m.id,
                  name: m.name,
                  type: m.type as EvidenceType,
                  category: m.category as EvidenceCategory,
                  folder: m.folder || "Importado",
                  file: null,
                  isVirtual: true
              }));
              
              // Merge with existing, avoiding duplicates
              setEvidenceFiles(prev => {
                  const existingIds = new Set(prev.map(f => f.id));
                  const newFiles = restoredFiles.filter(f => !existingIds.has(f.id));
                  return [...prev, ...newFiles];
              });
              
              // Default to closed folders - do not auto expand
              alert("Base de Dados carregada. \n\nIMPORTANTE: Arraste os ficheiros originais (Áudios/PDFs) para as respetivas áreas de upload para reativar a reprodução e visualização.");
          } else {
              alert("Ficheiro desconhecido.");
          }
      } catch (err: any) {
          alert(err.message);
      }
      e.target.value = '';
  };

  const handleNewProject = () => {
      if(evidenceFiles.length > 0 && !confirm("Tem a certeza? Isto limpará todos os dados carregados.")) return;
      setProject(initialProjectState);
      setEvidenceFiles([]);
      setProcessingQueue([]);
  };

  // 3. Processing Logic with Stop
  const runProcessing = async (scope: { type: 'ALL' | 'CATEGORY' | 'FOLDER', value?: string }) => {
     if (!apiKey) return alert("Chave API em falta.");
     
     // Filter Logic
     const unprocessed = evidenceFiles.filter(f => {
         // Basic Check: Not processed, not virtual
         if (f.isVirtual || project.processedData.find(pd => pd.fileId === f.id)) return false;

         // Scope Check
         if (scope.type === 'ALL') return true;
         if (scope.type === 'CATEGORY') return f.category === scope.value;
         if (scope.type === 'FOLDER' && scope.value) {
             // value format expected: "CATEGORY-FOLDERNAME"
             const [cat, ...rest] = scope.value.split('-');
             const folderName = rest.join('-');
             return f.category === cat && f.folder === folderName;
         }
         return false;
     });

     if (unprocessed.length === 0) return alert("Não há ficheiros novos para processar neste âmbito.");

     abortProcessingRef.current = false;

     for (const file of unprocessed) {
         if (abortProcessingRef.current) {
             setProcessingQueue([]);
             break;
         }

         setProcessingQueue(prev => [...prev, file.id]);
         try {
             const result = await processFile(apiKey, file);
             setProject(prev => ({
                 ...prev,
                 processedData: [...prev.processedData, result]
             }));
         } catch (e: any) {
             console.error(e);
             if (isQuotaError(e)) {
                 setShowQuotaModal(true);
                 stopProcessing();
                 break; // Stop loop immediately
             } else {
                 alert(`Erro ao processar ${file.name}: ${e.message}`);
             }
         } finally {
             setProcessingQueue(prev => prev.filter(id => id !== file.id));
         }
     }
  };

  const stopProcessing = () => {
      abortProcessingRef.current = true;
  };

  // People & Chat & Manual Import Logic (Same as before)
  const addPeopleFromList = () => {
      const names = newPersonList.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      const newPeople: Person[] = names.map(name => ({
          id: Math.random().toString(36).substr(2, 9),
          name: name,
          role: 'Testemunha'
      }));
      setProject(prev => ({ ...prev, people: [...prev.people, ...newPeople] }));
      setNewPersonList("");
  };

  const handleBatchAddPeople = (peopleData: string[]) => {
      const existingNames = new Set(project.people.map(p => p.name.toLowerCase().trim()));
      const newPeople: Person[] = [];
      let addedCount = 0;
      const fileUpdates: { fileId: string, personId: string }[] = [];

      peopleData.forEach(entry => {
          // Parse format: "Name | File"
          const parts = entry.split('|');
          const name = parts[0].trim();
          const fileNameRef = parts[1] ? parts[1].trim() : "";
          
          let personId = "";
          
          if (name && !existingNames.has(name.toLowerCase())) {
              personId = Math.random().toString(36).substr(2, 9);
              newPeople.push({
                  id: personId,
                  name: name,
                  role: 'Detetado no Chat'
              });
              existingNames.add(name.toLowerCase());
              addedCount++;
          } else {
              // Find existing person ID if we need to link files to existing people too
              const existing = project.people.find(p => p.name.toLowerCase() === name.toLowerCase());
              if(existing) personId = existing.id;
          }

          // AUTO-LINK FILES based on Semantic Match from AI
          if (personId && fileNameRef) {
             const file = evidenceFiles.find(f => f.name.toLowerCase().includes(fileNameRef.toLowerCase()) || fileNameRef.toLowerCase().includes(f.name.toLowerCase()));
             if (file && !file.personId) {
                 fileUpdates.push({ fileId: file.id, personId });
             }
          }
      });

      if (addedCount > 0) {
          setProject(prev => ({ ...prev, people: [...prev.people, ...newPeople] }));
      }
      
      if (fileUpdates.length > 0) {
          setEvidenceFiles(prev => prev.map(f => {
              const update = fileUpdates.find(u => u.fileId === f.id);
              return update ? { ...f, personId: update.personId } : f;
          }));
      }

      if (addedCount > 0 || fileUpdates.length > 0) {
          alert(`${addedCount} pessoas adicionadas e ${fileUpdates.length} ficheiros associados automaticamente.`);
      } else {
          alert("Nenhuma pessoa nova ou associação encontrada.");
      }
  };

  const removePerson = (id: string) => {
      setProject(prev => ({ ...prev, people: prev.people.filter(p => p.id !== id) }));
      setEvidenceFiles(prev => prev.map(f => f.personId === id ? { ...f, personId: undefined } : f));
  };

  const assignPersonToFile = (fileId: string, personId: string) => {
      setEvidenceFiles(prev => prev.map(f => f.id === fileId ? { ...f, personId: personId || undefined } : f));
  };

  const handleManualImport = () => {
      if (!manualName || !manualText) return;
      const id = Math.random().toString(36).substr(2, 9);
      const newFile: EvidenceFile = {
          id, file: null, name: manualName, type: 'TEXT', category: manualCategory, isVirtual: true, folder: 'Manual'
      };
      setEvidenceFiles(prev => [...prev, newFile]);
      const segments = sanitizeTranscript(manualText);
      const processed: ProcessedContent = {
          fileId: id, fileName: manualName, fullText: segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n'), segments: segments, processedAt: Date.now()
      };
      setProject(prev => ({ ...prev, processedData: [...prev.processedData, processed] }));
      setIsManualImportOpen(false); setManualName(""); setManualText("");
  };

  const runAnalysis = async () => {
      if (!apiKey) return alert("Chave API necessária.");
      setIsAnalyzing(true);
      try {
          const report = await analyzeFactsFromEvidence(apiKey, project.processedData, project.facts, peopleMap, evidenceFiles);
          setProject(prev => ({ ...prev, savedReports: [report, ...prev.savedReports] }));
          setSelectedReportId(report.id);
          setCurrentView('analysis');
      } catch (e: any) { 
          if (isQuotaError(e)) {
              setShowQuotaModal(true);
          } else {
              alert(e.message); 
          }
      } finally { setIsAnalyzing(false); }
  };

  const deleteReport = (reportId: string) => {
      if(confirm("Tem a certeza que quer apagar este relatório?")) {
          setProject(prev => ({ ...prev, savedReports: prev.savedReports.filter(r => r.id !== reportId) }));
          if (selectedReportId === reportId) setSelectedReportId(null);
      }
  };
  
  const handleRenameReport = () => {
      if (!selectedReportId || !tempReportName.trim()) return;
      setProject(prev => ({
          ...prev,
          savedReports: prev.savedReports.map(r => 
              r.id === selectedReportId ? { ...r, name: tempReportName.trim() } : r
          )
      }));
      setIsRenamingReport(false);
  };

  const updateReport = (reportId: string, newConclusion: string, newResults: any) => {
      setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === reportId ? { ...r, generalConclusion: newConclusion, results: newResults } : r) }));
      setEditingReportId(null);
  };

  // Chat Export Logic
  const handleExportChat = async (type: 'SINGLE' | 'FULL') => {
      if (exportModal.messageId && type === 'SINGLE') {
          await exportChatToZip(project.chatHistory, evidenceFiles, exportModal.messageId);
      } else {
          await exportChatToZip(project.chatHistory, evidenceFiles);
      }
      setExportModal({ isOpen: false });
  };

  // Chat
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const handleChat = async () => {
      if (!chatInput.trim() || !apiKey) return;
      const msg: ChatMessage = { id: Date.now().toString(), role: 'user', text: chatInput, timestamp: Date.now() };
      setProject(prev => ({ ...prev, chatHistory: [...prev.chatHistory, msg] }));
      setChatInput(""); setIsChatting(true);
      try {
          const resp = await chatWithEvidence(apiKey, project.processedData, [...project.chatHistory, msg], msg.text, peopleMap, evidenceFiles);
          const aiMsg: ChatMessage = { id: (Date.now()+1).toString(), role: 'model', text: resp, timestamp: Date.now() };
          setProject(prev => ({ ...prev, chatHistory: [...prev.chatHistory, aiMsg] }));
      } catch(e) { 
          if (isQuotaError(e)) setShowQuotaModal(true);
          else alert("Erro no chat"); 
      } finally { setIsChatting(false); }
  };
  const clearChat = () => { if(confirm("Apagar histórico?")) setProject(prev => ({ ...prev, chatHistory: [] })); };

  // --- RENDERERS ---

  const renderFileCard = (file: EvidenceFile) => {
      const isProcessed = project.processedData.some(pd => pd.fileId === file.id);
      const isProcessing = processingQueue.includes(file.id);
      
      return (
         <div key={file.id} className={`bg-white dark:bg-slate-900 border p-2 rounded flex flex-col gap-2 group transition-all mb-1 ${file.isVirtual ? 'border-orange-200 dark:border-orange-900/50' : 'border-gray-200 dark:border-slate-800 hover:border-gray-400 dark:hover:border-slate-600'}`}>
             <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2 overflow-hidden">
                     <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 text-[10px] 
                         ${file.type === 'AUDIO' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 
                           file.type === 'PDF' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 
                           'bg-gray-200 text-gray-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                         {file.type === 'AUDIO' && <FileAudio size={12} />}
                         {file.type === 'PDF' && <FileText size={12} />}
                         {file.type === 'IMAGE' && <FileImage size={12} />}
                         {file.type === 'TEXT' && <FileText size={12} />}
                     </div>
                     <div className="overflow-hidden">
                         <div className={`text-xs font-medium truncate w-32 ${file.isVirtual ? 'text-orange-500' : 'text-gray-700 dark:text-slate-300'}`} title={file.name}>{file.name}</div>
                         <div className="flex items-center gap-2">
                             {file.isVirtual ? (
                                 <span className="text-[9px] text-orange-500 font-bold flex items-center gap-1">
                                     <AlertTriangle size={8} /> FICHEIRO EM FALTA
                                 </span>
                             ) : (
                                 <div className={`text-[9px] font-mono uppercase ${isProcessed ? 'text-green-600 dark:text-green-500' : 'text-gray-500 dark:text-slate-600'}`}>{isProcessed ? 'PRONTO' : 'PENDENTE'}</div>
                             )}
                         </div>
                     </div>
                 </div>
                 <button onClick={() => setEvidenceFiles(prev => prev.filter(f => f.id !== file.id))} className="text-gray-400 dark:text-slate-600 hover:text-red-500">
                     <Trash2 size={12} />
                 </button>
             </div>
             
             {file.category !== 'OTHER' && (
                 <select 
                    className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded text-[10px] text-gray-600 dark:text-slate-400 w-full outline-none py-1"
                    value={file.personId || ""}
                    onChange={(e) => assignPersonToFile(file.id, e.target.value)}
                 >
                     <option value="">-- Associar Pessoa --</option>
                     {project.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                 </select>
             )}

             {isProcessing && <div className="text-[10px] text-blue-500 dark:text-blue-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Processando...</div>}
         </div>
      );
  };

  const renderUploadSection = (title: string, category: EvidenceCategory, icon: React.ReactNode, description: string) => {
      const files = evidenceFiles.filter(f => f.category === category);
      const unprocessedCount = files.filter(f => !project.processedData.find(pd => pd.fileId === f.id)).length;
      const isDragOver = dragOverCategory === category;
      
      // Group by folder
      const folders: Record<string, EvidenceFile[]> = {};
      files.forEach(f => {
          const key = f.folder || 'Geral';
          if (!folders[key]) folders[key] = [];
          folders[key].push(f);
      });

      return (
          <div 
             className={`bg-white dark:bg-slate-900 p-5 rounded-2xl border transition-all flex flex-col shadow-sm relative
                ${isDragOver ? 'border-primary-500 bg-blue-50 dark:bg-slate-800/80 scale-[1.02] z-10' : 'border-gray-200 dark:border-slate-800'}
             `}
             onDragOver={(e) => handleDragOver(e, category)}
             onDragLeave={handleDragLeave}
             onDrop={(e) => handleDrop(e, category)}
          >
              <div className="mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-1">
                      {icon} {title}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{description}</p>
              </div>

              <div className="flex gap-2 mb-4">
                  <label className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg text-xs font-bold cursor-pointer transition-colors border border-gray-200 dark:border-slate-700 flex items-center justify-center gap-2">
                      <FolderOpen size={14} /> Adicionar Pastas
                      <input 
                         type="file" 
                         multiple 
                         // @ts-ignore
                         webkitdirectory="" directory=""
                         onChange={(e) => handleFileUpload(e, category)} 
                         className="hidden" 
                      />
                  </label>
                  {category === 'TESTIMONY' && (
                      <button onClick={() => { setManualCategory('TESTIMONY'); setIsManualImportOpen(true); }} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg text-xs font-bold border border-gray-200 dark:border-slate-700">
                          Texto
                      </button>
                  )}
              </div>

              <div className="flex-1 bg-gray-50 dark:bg-slate-925 rounded-xl border border-gray-200 dark:border-slate-800 p-2 overflow-y-auto max-h-[400px] mb-4 space-y-2">
                  {Object.keys(folders).length === 0 && (
                      <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-slate-600 gap-2 border-2 border-dashed border-gray-200 dark:border-slate-800/50 rounded-lg pointer-events-none">
                          <Upload size={24} />
                          <span className="text-xs text-center">Arraste pastas para aqui<br/>para adicionar ou reparar</span>
                      </div>
                  )}
                  
                  {Object.entries(folders).map(([folderName, folderFiles]) => {
                      const folderKey = `${category}-${folderName}`;
                      const isExpanded = expandedFolders[folderKey];
                      const folderUnprocessed = folderFiles.filter(f => !project.processedData.find(pd => pd.fileId === f.id)).length;
                      
                      return (
                          <div key={folderKey} className="border border-gray-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900/50 overflow-hidden">
                              <div 
                                className="p-2 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                  <div onClick={() => toggleFolder(folderKey)} className="flex items-center gap-2 cursor-pointer flex-1">
                                      {isExpanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                                      <FolderOpen size={14} className="text-primary-500" />
                                      <span className="text-xs font-bold text-gray-700 dark:text-slate-300 truncate max-w-[100px]" title={folderName}>{folderName}</span>
                                      <span className="text-[10px] text-gray-500 dark:text-slate-600">({folderFiles.length})</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1">
                                      {folderUnprocessed > 0 && (
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); runProcessing({ type: 'FOLDER', value: folderKey }); }}
                                            title="Processar esta pasta"
                                            className="p-1 hover:bg-green-100 dark:hover:bg-green-900/50 text-gray-500 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 rounded transition-colors"
                                          >
                                              <Play size={10} fill="currentColor" />
                                          </button>
                                      )}
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); deleteFolder(category, folderName); }}
                                          title="Apagar pasta"
                                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 text-gray-500 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                                      >
                                          <Trash2 size={10} />
                                      </button>
                                  </div>
                              </div>
                              
                              {isExpanded && (
                                  <div className="p-2 bg-gray-50 dark:bg-slate-950/50 border-t border-gray-200 dark:border-slate-800">
                                      {folderFiles.map(renderFileCard)}
                                  </div>
                              )}
                          </div>
                      );
                  })}
              </div>

              {files.length > 0 && (
                 <div className="flex gap-2 mt-auto">
                     <button 
                        onClick={() => runProcessing({ type: 'CATEGORY', value: category })}
                        disabled={unprocessedCount === 0 || processingQueue.length > 0}
                        className="flex-1 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-gray-300 dark:disabled:bg-slate-800 disabled:text-gray-500 dark:disabled:text-slate-600 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                     >
                         {processingQueue.length > 0 ? <Loader2 size={12} className="animate-spin"/> : <Layers size={12} />}
                         Processar ({unprocessedCount})
                     </button>
                 </div>
              )}
          </div>
      );
  };

  const renderLanding = () => (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-100 via-gray-50 to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950 transition-colors duration-300">
          <div className="max-w-4xl w-full text-center space-y-8 animate-in fade-in zoom-in duration-500 flex flex-col items-center">
              <div className="w-20 h-20 bg-primary-600 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-primary-900/20 dark:shadow-primary-900/50 mb-2">
                  <Database size={40} className="text-white" />
              </div>
              <div>
                  <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Veritas V2.2</h1>
                  <p className="text-gray-500 dark:text-slate-500">Sistema de Análise Forense Multimodal</p>
              </div>

              {/* Status Counters */}
              <div className="flex gap-12 py-4 border-y border-gray-200 dark:border-slate-800/50 w-full justify-center max-w-lg">
                  <div className="flex flex-col items-center">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">{evidenceFiles.length}</span>
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase tracking-wider">Ficheiros</span>
                  </div>
                  <div className="flex flex-col items-center">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">{project.people.length}</span>
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase tracking-wider">Pessoas</span>
                  </div>
                  <div className="flex flex-col items-center">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">{project.facts.length}</span>
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase tracking-wider">Factos</span>
                  </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-8 w-full max-w-2xl">
                  {/* Carregar Projeto */}
                  <label className="p-5 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 rounded-2xl flex items-center gap-4 group transition-all cursor-pointer shadow-sm">
                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400 flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors">
                          <FileText size={20} />
                      </div>
                      <div className="text-left">
                          <h3 className="font-bold text-gray-900 dark:text-white text-sm">Carregar Projeto</h3>
                          <p className="text-[10px] text-gray-500 dark:text-slate-500">veritas_projeto.json</p>
                      </div>
                      <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                  </label>

                  {/* Carregar Base de Dados */}
                  <label className="p-5 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 rounded-2xl flex items-center gap-4 group transition-all cursor-pointer shadow-sm">
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <Database size={20} />
                      </div>
                      <div className="text-left">
                          <h3 className="font-bold text-gray-900 dark:text-white text-sm">Carregar Base de Dados</h3>
                          <p className="text-[10px] text-gray-500 dark:text-slate-500">veritas_base_dados.json</p>
                      </div>
                      <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                  </label>

                  {/* START BUTTON */}
                  <button 
                    onClick={() => setCurrentView('setup')}
                    className="col-span-2 p-4 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl font-bold shadow-lg shadow-primary-900/40 transition-all hover:scale-[1.02] flex items-center justify-center gap-2 mt-4"
                  >
                      <span>INICIAR APLICAÇÃO</span>
                      <ChevronRight size={20} />
                  </button>
              </div>
              
              <div className="absolute bottom-6 left-6">
                 <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-3 bg-white dark:bg-slate-900 rounded-full shadow-lg text-gray-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 border border-gray-200 dark:border-slate-800">
                    {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                 </button>
              </div>

              <p className="text-[10px] text-gray-400 dark:text-slate-600 max-w-md">
                 Nota: Para iniciar um novo projeto do zero, basta clicar em Iniciar Aplicação sem carregar ficheiros. O botão "Novo Projeto" encontra-se dentro da aplicação.
              </p>
          </div>
      </div>
  );

  // --- MAIN LAYOUT ---

  // Auth Check
  if (!apiKey) {
      return (
          <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 p-4 transition-colors duration-300">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-md animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex justify-center mb-6">
                      <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center text-primary-600 dark:text-primary-400">
                          <Key size={32} />
                      </div>
                  </div>
                  
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">Bem-vindo ao Veritas V2.2</h1>
                  <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-6">
                      Para utilizar a Inteligência Artificial, necessita de uma Chave API do Google Gemini.
                  </p>

                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-gray-500 dark:text-slate-500 uppercase ml-1 mb-1 block">Google Gemini API Key</label>
                          <input 
                            type="password" 
                            value={tempApiKey} 
                            onChange={e => setTempApiKey(e.target.value)} 
                            placeholder="Cole a sua chave aqui (Ex: AIzaSy...)" 
                            className="w-full p-3 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl text-gray-900 dark:text-white focus:border-primary-500 outline-none transition-all focus:ring-2 focus:ring-primary-500/20"
                          />
                      </div>

                      <button 
                        onClick={() => { 
                            if(!tempApiKey.trim()) return alert("Por favor insira uma chave válida.");
                            setApiKey(tempApiKey); 
                            localStorage.setItem("veritas_api_key", tempApiKey); 
                        }} 
                        className="w-full py-3 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-primary-900/20 active:scale-95"
                      >
                          Entrar na Aplicação
                      </button>
                  </div>

                  <div className="mt-6 pt-6 border-t border-gray-100 dark:border-slate-800 text-center">
                      <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">Não tem uma chave API?</p>
                      <a 
                        href="https://aistudio.google.com/app/apikey" 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-bold text-primary-600 dark:text-primary-400 hover:underline"
                      >
                          Criar chave no Google AI Studio <ExternalLink size={12} />
                      </a>
                  </div>
              </div>
          </div>
      );
  }

  if (currentView === 'landing') return renderLanding();

  const totalUnprocessed = evidenceFiles.filter(f => !f.isVirtual && !project.processedData.find(pd => pd.fileId === f.id)).length;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-200 font-sans selection:bg-primary-500/30 overflow-hidden transition-colors duration-300">
        {/* SIDEBAR */}
        <aside className="w-20 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col items-center py-6 gap-6 z-20 flex-shrink-0 shadow-sm dark:shadow-none">
            <div onClick={() => setCurrentView('landing')} className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center font-bold text-white shadow-lg cursor-pointer">V2</div>
            
            <nav className="flex flex-col gap-4 w-full px-2">
                {[
                    { id: 'setup', icon: LayoutGrid, label: 'Dados' },
                    { id: 'people', icon: Users, label: 'Pessoas' },
                    { id: 'analysis', icon: FileText, label: 'Relatório' },
                    { id: 'chat', icon: MessageSquare, label: 'Chat' },
                ].map(item => (
                    <button 
                        key={item.id} 
                        onClick={() => setCurrentView(item.id as View)}
                        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${currentView === item.id ? 'bg-primary-600 text-white shadow-lg' : 'text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-300'}`}
                    >
                        <item.icon size={20} />
                        <span className="text-[9px] font-bold uppercase">{item.label}</span>
                    </button>
                ))}
            </nav>

            <div className="mt-auto flex flex-col gap-2 w-full px-2 border-t border-gray-200 dark:border-slate-800 pt-4">
                 <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 text-gray-400 dark:text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 flex flex-col items-center gap-1 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded mb-2">
                    {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                </button>

                {/* PROJECT ACTIONS */}
                <div className="flex flex-col gap-1 items-center pb-2 border-b border-gray-200 dark:border-slate-800 w-full">
                    <span className="text-[8px] font-bold text-gray-400 dark:text-slate-600 uppercase mb-1">PROJETO</span>
                    <label className="p-2 text-gray-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 cursor-pointer flex flex-col items-center gap-1 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                        <ArrowUp size={16} />
                        <span className="text-[8px]">Carregar</span>
                        <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                    </label>
                    <button onClick={() => saveProjectFile(project)} className="p-2 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 flex flex-col items-center gap-1 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                        <ArrowDown size={16} />
                        <span className="text-[8px]">Guardar</span>
                    </button>
                </div>

                {/* DB ACTIONS */}
                <div className="flex flex-col gap-1 items-center pb-2 border-b border-gray-200 dark:border-slate-800 w-full">
                    <span className="text-[8px] font-bold text-gray-400 dark:text-slate-600 uppercase mb-1">BASE DADOS</span>
                    <label className="p-2 text-gray-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 cursor-pointer flex flex-col items-center gap-1 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                        <ArrowUp size={16} />
                        <span className="text-[8px]">Carregar</span>
                        <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                    </label>
                    <button onClick={() => saveDatabaseFile(project, evidenceFiles)} className="p-2 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 flex flex-col items-center gap-1 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                        <ArrowDown size={16} />
                        <span className="text-[8px]">Guardar</span>
                    </button>
                </div>

                <div className="border-t border-gray-200 dark:border-slate-800 pt-2 w-full flex flex-col items-center">
                    <button onClick={handleNewProject} className="p-2 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-white flex flex-col items-center gap-1 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                        <Plus size={16} />
                        <span className="text-[8px]">Novo</span>
                    </button>
                </div>

                <button onClick={() => { setApiKey(""); localStorage.removeItem("veritas_api_key"); }} className="p-2 text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 flex flex-col items-center gap-1 mt-2 w-full hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                    <LogOut size={16} />
                    <span className="text-[8px]">Sair</span>
                </button>
            </div>
        </aside>

        {/* CONTENT */}
        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
            <header className="h-16 border-b border-gray-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/50 backdrop-blur flex items-center px-8 justify-between flex-shrink-0 z-10 transition-colors">
                <h1 className="text-lg font-bold text-gray-800 dark:text-white">
                    {currentView === 'setup' && 'Gestão de Evidências e Factos'}
                    {currentView === 'people' && 'Gestão de Pessoas e Testemunhas'}
                    {currentView === 'analysis' && 'Relatórios de Análise Forense'}
                    {currentView === 'chat' && 'Assistente IA'}
                </h1>
                <div className="flex items-center gap-4">
                     {currentView === 'setup' && totalUnprocessed > 0 && (
                         <>
                             {processingQueue.length > 0 ? (
                                <button onClick={stopProcessing} className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-900 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-800/50">
                                    <StopCircle size={14} className="animate-pulse" /> A Processar {processingQueue.length}... Parar
                                </button>
                             ) : (
                                <button onClick={() => runProcessing({ type: 'ALL' })} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-900/20">
                                    <BrainCircuit size={14} /> Processar Tudo ({totalUnprocessed})
                                </button>
                             )}
                         </>
                     )}
                    <div className="flex gap-4 text-xs font-mono text-gray-500 dark:text-slate-500 border-l border-gray-200 dark:border-slate-800 pl-4 border-r pr-4">
                        <span>Ficheiros: {evidenceFiles.length}</span>
                        <span>Relatórios: {project.savedReports.length}</span>
                    </div>

                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className="p-2 text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                        title={isDarkMode ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
                    >
                        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 bg-gray-50 dark:bg-slate-950 relative scroll-smooth transition-colors">
                {currentView === 'setup' && (
                    <div className="max-w-7xl mx-auto pb-20 space-y-8">
                        {/* Removida altura fixa para evitar sobreposição */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {renderUploadSection("Depoimentos", 'TESTIMONY', <Mic className="text-blue-500" />, "Áudios e Transcrições.")}
                            {renderUploadSection("Autos de Inquirição", 'INQUIRY', <Gavel className="text-red-500" />, "PDFs dos Autos.")}
                            {renderUploadSection("Outros Documentos", 'OTHER', <Paperclip className="text-yellow-500" />, "Anexos e Fotos.")}
                        </div>
                        
                        {/* Margem superior grande para garantir separação visual */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-8 mt-12 border-t border-gray-200 dark:border-slate-800">
                            {/* FACTS */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm dark:shadow-none">
                                <h3 className="font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2"><CheckCircle2 className="text-primary-500" /> Factos a Provar</h3>
                                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                    {project.facts.map((fact, idx) => (
                                        <div key={fact.id} className="flex gap-2 group">
                                            <span className="text-xs font-mono text-gray-400 dark:text-slate-500 mt-3">#{idx+1}</span>
                                            <textarea 
                                              value={fact.text}
                                              onChange={(e) => setProject(p => ({ ...p, facts: p.facts.map(f => f.id === fact.id ? { ...f, text: e.target.value } : f) }))}
                                              className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg p-3 text-sm text-gray-800 dark:text-slate-300 focus:border-primary-500 outline-none resize-none h-20"
                                              placeholder="Insira o facto..."
                                            />
                                            <button onClick={() => setProject(p => ({ ...p, facts: p.facts.filter(f => f.id !== fact.id) }))} className="self-center p-2 text-gray-400 dark:text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={16} /></button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setProject(p => ({ ...p, facts: [...p.facts, { id: Math.random().toString(36), text: "" }] }))} className="mt-4 text-xs text-primary-600 dark:text-primary-400 font-bold uppercase hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1">
                                    <Plus size={14} /> Adicionar Facto
                                </button>
                            </div>

                            {/* ACTION */}
                            <div className="flex flex-col justify-center items-center p-8 border-2 border-dashed border-gray-300 dark:border-slate-800 rounded-2xl">
                                <PlayCircle size={48} className="text-primary-600 mb-4" />
                                <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Análise Cruzada V2.2</h3>
                                <p className="text-sm text-gray-500 dark:text-slate-500 text-center mb-6 max-w-xs">
                                    O sistema irá cruzar Depoimentos, Autos e Documentos respeitando as categorias.
                                </p>
                                <button 
                                  onClick={runAnalysis}
                                  disabled={isAnalyzing}
                                  className="px-8 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-full font-bold shadow-lg shadow-primary-900/40 transition-transform active:scale-95 disabled:opacity-50"
                                >
                                    {isAnalyzing ? <Loader2 className="animate-spin" /> : "Gerar Novo Relatório"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* PEOPLE */}
                {currentView === 'people' && (
                    <div className="max-w-4xl mx-auto space-y-8 pb-20">
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                                <Users className="text-primary-500" /> Gestão de Pessoas / Testemunhas
                            </h2>
                            <div className="flex gap-6">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-gray-500 dark:text-slate-500 uppercase mb-2 block">Importar Lista (um nome por linha)</label>
                                    <textarea 
                                       value={newPersonList}
                                       onChange={(e) => setNewPersonList(e.target.value)}
                                       className="w-full h-40 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl p-4 text-sm text-gray-800 dark:text-slate-300 outline-none focus:border-primary-500"
                                       placeholder="João Silva&#10;Maria Santos&#10;Dr. António..."
                                    />
                                    <button onClick={addPeopleFromList} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold shadow hover:bg-primary-500">Adicionar à Lista</button>
                                </div>
                                <div className="w-1/2 bg-gray-50 dark:bg-slate-950 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
                                    <div className="p-3 bg-gray-100 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Pessoas Registadas ({project.people.length})</div>
                                    <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[300px]">
                                        {project.people.map(p => (
                                            <div key={p.id} className="flex justify-between items-center p-2 hover:bg-gray-100 dark:hover:bg-slate-900 rounded group">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-slate-400">{p.name.charAt(0)}</div>
                                                    <span className="text-sm text-gray-700 dark:text-slate-300">{p.name}</span>
                                                </div>
                                                <button onClick={() => removePerson(p.id)} className="text-gray-400 dark:text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* CHAT */}
                {currentView === 'chat' && (
                  <div className="max-w-3xl mx-auto h-[calc(100vh-140px)] flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                      <div className="h-12 border-b border-gray-200 dark:border-slate-800 flex items-center justify-end px-4">
                          <button onClick={clearChat} className="text-xs text-gray-500 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1"><Trash2 size={12}/> Limpar Conversa</button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-6 space-y-4">
                          {project.chatHistory.map(msg => {
                              // DETECT HIDDEN TAG FOR PEOPLE
                              const peopleMatch = msg.text.match(/\[\[DETECTED_PEOPLE:(.*?)\]\]/);
                              let cleanText = msg.text;
                              let detectedPeopleData: string[] = [];

                              if (peopleMatch) {
                                  cleanText = msg.text.replace(/\[\[DETECTED_PEOPLE:.*?\]\]/, '').trim();
                                  // This will now contain strings like "Name | File"
                                  detectedPeopleData = peopleMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
                              }

                              return (
                                  <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                      <div className={`relative max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed group ${msg.role === 'user' ? 'bg-primary-600 text-white pr-10' : 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-300 border border-gray-200 dark:border-slate-700 pr-10'}`}>
                                          
                                          {renderMessageContent(cleanText)}

                                          {/* EXPORT BUTTON FOR THIS MESSAGE */}
                                          {msg.role === 'model' && (
                                              <button 
                                                onClick={() => setExportModal({ isOpen: true, messageId: msg.id })}
                                                className="absolute right-2 top-2 p-1.5 bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-full hover:bg-primary-500 hover:text-white transition-colors"
                                                title="Exportar esta resposta"
                                              >
                                                  <Download size={14} />
                                              </button>
                                          )}
                                      </div>
                                      
                                      {/* PEOPLE ADDITION CARD */}
                                      {detectedPeopleData.length > 0 && (
                                          <div className="mt-2 ml-2 bg-white dark:bg-slate-900 border border-green-200 dark:border-green-900/50 p-3 rounded-xl shadow-lg animate-in fade-in slide-in-from-top-2 max-w-sm">
                                              <div className="flex items-center gap-2 mb-2">
                                                  <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">
                                                      <UserPlus size={16} />
                                                  </div>
                                                  <div>
                                                      <div className="text-xs font-bold text-gray-900 dark:text-white">Pessoas Identificadas</div>
                                                      <div className="text-[10px] text-gray-500 dark:text-slate-400">{detectedPeopleData.length} nomes encontrados</div>
                                                  </div>
                                              </div>
                                              <div className="text-xs text-gray-600 dark:text-slate-300 mb-3 line-clamp-2 italic">
                                                  {detectedPeopleData.map(d => d.split('|')[0].trim()).join(", ")}
                                              </div>
                                              <button 
                                                  onClick={() => handleBatchAddPeople(detectedPeopleData)}
                                                  className="w-full py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors"
                                              >
                                                  Adicionar à Lista de Pessoas
                                              </button>
                                          </div>
                                      )}
                                  </div>
                              );
                          })}
                          {isChatting && <div className="text-xs text-gray-500 dark:text-slate-500 text-center animate-pulse">A pensar...</div>}
                      </div>
                      <div className="p-4 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 flex gap-2">
                          <input className="flex-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-3 text-gray-800 dark:text-slate-300 outline-none focus:border-primary-500" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} placeholder="Pergunte sobre os autos, áudios ou documentos..." />
                          <button onClick={handleChat} className="p-3 bg-primary-600 hover:bg-primary-500 rounded-xl text-white"><MessageSquare size={20} /></button>
                      </div>
                  </div>
                )}
                
                {/* ANALYSIS */}
                {currentView === 'analysis' && (
                  <div className="max-w-7xl mx-auto h-[calc(100vh-140px)] flex gap-6">
                      <div className="w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl flex flex-col overflow-hidden shrink-0 shadow-sm">
                          <div className="p-4 border-b border-gray-200 dark:border-slate-800 font-bold text-gray-400 dark:text-slate-400 text-xs uppercase">Relatórios Guardados</div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                              {project.savedReports.map(rep => (
                                  <div key={rep.id} onClick={() => setSelectedReportId(rep.id)} className={`p-3 rounded-lg cursor-pointer border transition-all ${selectedReportId === rep.id ? 'bg-blue-50 dark:bg-primary-900/30 border-primary-500/50' : 'bg-white dark:bg-slate-950 border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                                      <div className="text-sm font-bold text-gray-800 dark:text-slate-200 truncate">{rep.name}</div>
                                      <div className="text-[10px] text-gray-500 dark:text-slate-500">{new Date(rep.generatedAt).toLocaleString()}</div>
                                  </div>
                              ))}
                          </div>
                      </div>
                      <div className="flex-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col relative shadow-sm">
                           {/* Analysis Detail View */}
                           {project.savedReports.find(r => r.id === selectedReportId) ? (
                                (() => {
                                    const activeReport = project.savedReports.find(r => r.id === selectedReportId)!;
                                    return (
                                        <>
                                            <div className="h-16 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-6 bg-white dark:bg-slate-900">
                                                 {isRenamingReport ? (
                                                    <div className="flex items-center gap-2 flex-1 mr-4">
                                                        <input 
                                                            className="flex-1 bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded px-3 py-1 text-sm font-bold text-gray-900 dark:text-white focus:border-primary-500 outline-none"
                                                            value={tempReportName}
                                                            onChange={(e) => setTempReportName(e.target.value)}
                                                            placeholder="Nome do relatório..."
                                                            autoFocus
                                                        />
                                                        <button onClick={handleRenameReport} className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50"><Check size={16} /></button>
                                                        <button onClick={() => setIsRenamingReport(false)} className="p-1.5 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 rounded hover:bg-gray-200 dark:hover:bg-slate-700"><X size={16} /></button>
                                                    </div>
                                                 ) : (
                                                    <div className="flex items-center gap-3">
                                                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">{activeReport.name}</h2>
                                                        <button 
                                                            onClick={() => { setTempReportName(activeReport.name); setIsRenamingReport(true); }}
                                                            className="text-gray-400 hover:text-primary-500 dark:text-slate-500 dark:hover:text-primary-400 transition-colors"
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                    </div>
                                                 )}
                                                 
                                                 <div className="flex gap-2">
                                                     {editingReportId !== activeReport.id ? (
                                                         <>
                                                            <button onClick={() => setEditingReportId(activeReport.id)} className="p-2 text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"><Edit2 size={18}/></button>
                                                            <button onClick={() => exportToWord(activeReport, activeReport.name)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded text-xs text-gray-700 dark:text-white">Exportar Word</button>
                                                            <button onClick={() => deleteReport(activeReport.id)} className="p-2 text-gray-400 dark:text-slate-400 hover:text-red-500"><Trash2 size={18}/></button>
                                                         </>
                                                     ) : (
                                                         <button onClick={() => updateReport(activeReport.id, activeReport.generalConclusion, activeReport.results)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs text-white flex items-center gap-1"><Check size={14}/> Guardar Edição</button>
                                                     )}
                                                 </div>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-gray-50 dark:bg-slate-950">
                                                 <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                                                     <h3 className="text-primary-600 dark:text-primary-400 font-bold mb-2 uppercase text-xs">Conclusão Geral</h3>
                                                     {editingReportId === activeReport.id ? (
                                                         <textarea className="w-full h-32 bg-gray-50 dark:bg-slate-950 border border-gray-300 dark:border-slate-700 rounded p-2 text-gray-800 dark:text-slate-300 text-sm" value={activeReport.generalConclusion} onChange={(e) => { const updated = { ...activeReport, generalConclusion: e.target.value }; setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === updated.id ? updated : r) })); }} />
                                                     ) : (
                                                         <p className="text-gray-700 dark:text-slate-300 leading-relaxed text-sm">{activeReport.generalConclusion}</p>
                                                     )}
                                                 </div>
                                                 <div className="space-y-6">
                                                      {activeReport.results.map((res, idx) => (
                                                          <div key={idx} className="border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                                                              <div className="bg-gray-50 dark:bg-slate-800/50 p-4 flex justify-between items-center border-b border-gray-100 dark:border-slate-800">
                                                                  <h4 className="font-bold text-gray-800 dark:text-slate-200 text-sm">{res.factText}</h4>
                                                                  {editingReportId === activeReport.id ? (
                                                                      <select value={res.status} onChange={(e) => { const newResults = [...activeReport.results]; newResults[idx] = { ...res, status: e.target.value as any }; setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === activeReport.id ? { ...r, results: newResults } : r) })); }} className="bg-white dark:bg-slate-900 text-xs text-gray-900 dark:text-white border border-gray-300 dark:border-slate-700 rounded p-1">
                                                                          <option value="Confirmado">Confirmado</option><option value="Desmentido">Desmentido</option><option value="Inconclusivo/Contraditório">Inconclusivo</option><option value="Não Mencionado">Não Mencionado</option>
                                                                      </select>
                                                                  ) : (
                                                                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${res.status === 'Confirmado' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : res.status === 'Desmentido' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>{res.status}</span>
                                                                  )}
                                                              </div>
                                                              <div className="p-6">
                                                                  {editingReportId === activeReport.id ? (
                                                                      <textarea className="w-full h-24 bg-gray-50 dark:bg-slate-950 border border-gray-300 dark:border-slate-700 rounded p-2 text-gray-800 dark:text-slate-300 text-sm mb-4" value={res.summary} onChange={(e) => { const newResults = [...activeReport.results]; newResults[idx] = { ...res, summary: e.target.value }; setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === activeReport.id ? { ...r, results: newResults } : r) })); }} />
                                                                  ) : (
                                                                      <p className="text-gray-600 dark:text-slate-400 text-sm mb-6 border-l-2 border-gray-300 dark:border-slate-700 pl-4">{res.summary}</p>
                                                                  )}
                                                                  
                                                                  {res.citations.length > 0 && (
                                                                    <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-slate-800/50">
                                                                        <h5 className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500 mb-2">Citações e Fontes:</h5>
                                                                        {(() => {
                                                                            // GROUP CITATIONS BY FILE FOR REPORT
                                                                            const groupedByFile: Record<string, Citation[]> = {};
                                                                            res.citations.forEach(c => {
                                                                                if(!groupedByFile[c.fileId]) groupedByFile[c.fileId] = [];
                                                                                groupedByFile[c.fileId].push(c);
                                                                            });

                                                                            return Object.entries(groupedByFile).map(([fileId, cits]) => {
                                                                                 const fileName = cits[0].fileName;
                                                                                 const contentLines = cits.map(c => `* "${c.text}" [${c.timestamp}]`);
                                                                                 
                                                                                 return (
                                                                                    <CitationGroup 
                                                                                        key={fileId}
                                                                                        fileName={fileName}
                                                                                        contentLines={contentLines}
                                                                                        evidenceFiles={evidenceFiles}
                                                                                        onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }}
                                                                                        onOpenOriginal={handleOpenOriginal}
                                                                                        renderInline={renderTextWithInlineCitations}
                                                                                    />
                                                                                 );
                                                                            });
                                                                        })()}
                                                                    </div>
                                                                  )}
                                                              </div>
                                                          </div>
                                                      ))}
                                                 </div>
                                            </div>
                                        </>
                                    );
                                })()
                           ) : (
                               <div className="flex items-center justify-center h-full text-gray-400 dark:text-slate-500">Selecione um relatório.</div>
                           )}
                      </div>
                  </div>
                )}
            </div>
        </main>

        {/* MANUAL IMPORT MODAL */}
        {isManualImportOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl w-full max-w-2xl border border-gray-200 dark:border-slate-800 shadow-2xl">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Importar Texto Manualmente</h3>
                    <input className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 p-3 rounded-lg text-gray-900 dark:text-white mb-4" placeholder="Nome do Documento / Depoimento" value={manualName} onChange={e => setManualName(e.target.value)} />
                    <textarea className="w-full h-64 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 p-3 rounded-lg text-gray-800 dark:text-slate-300 mb-4 font-mono text-sm" placeholder="Cole o texto aqui..." value={manualText} onChange={e => setManualText(e.target.value)} />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setIsManualImportOpen(false)} className="px-4 py-2 text-gray-500 dark:text-slate-400">Cancelar</button>
                        <button onClick={handleManualImport} className="px-4 py-2 bg-primary-600 text-white rounded-lg">Importar</button>
                    </div>
                </div>
            </div>
        )}

        {/* EXPORT MODAL */}
        {exportModal.isOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl w-full max-w-sm border border-gray-200 dark:border-slate-800 shadow-2xl text-center space-y-4">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Exportar Conversa</h3>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                        O sistema irá gerar um ficheiro ZIP contendo um documento Word com a conversa e uma pasta com todos os ficheiros (Áudios/PDFs) mencionados.
                    </p>
                    
                    <div className="grid grid-cols-1 gap-3 pt-2">
                        {exportModal.messageId && (
                             <button 
                                onClick={() => handleExportChat('SINGLE')}
                                className="px-4 py-3 bg-blue-50 hover:bg-blue-100 dark:bg-primary-900/20 dark:hover:bg-primary-900/30 text-blue-700 dark:text-blue-300 rounded-xl text-sm font-bold border border-blue-200 dark:border-primary-800 transition-colors"
                             >
                                Exportar Apenas Esta Resposta
                             </button>
                        )}
                        <button 
                             onClick={() => handleExportChat('FULL')}
                             className="px-4 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-xl text-sm font-bold border border-gray-200 dark:border-slate-700 transition-colors"
                        >
                            Exportar Toda a Conversa
                        </button>
                    </div>

                    <button 
                        onClick={() => setExportModal({ isOpen: false })}
                        className="text-xs text-gray-400 dark:text-slate-500 hover:underline mt-4"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        )}

        {/* QUOTA ERROR MODAL */}
        {showQuotaModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-300">
                <div className="bg-white dark:bg-slate-900 w-full max-w-md p-8 rounded-3xl shadow-2xl border border-red-100 dark:border-red-900/30 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-400 to-orange-400"></div>
                    
                    <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500 dark:text-red-400 ring-8 ring-red-50/50 dark:ring-red-900/10">
                        <ZapOff size={32} />
                    </div>

                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Pausa para Café ☕</h2>
                    <p className="text-gray-600 dark:text-slate-300 mb-8 leading-relaxed text-sm">
                        Atingiu o limite de velocidade da versão gratuita do Google Gemini (Quota Exceeded).
                        <br/><br/>
                        Por favor, <strong>aguarde cerca de 1 a 2 minutos</strong> antes de tentar novamente.
                    </p>

                    <button 
                        onClick={() => setShowQuotaModal(false)}
                        className="w-full py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold rounded-xl hover:scale-[1.02] transition-transform shadow-lg"
                    >
                        Entendido, vou aguardar
                    </button>
                </div>
            </div>
        )}

        {/* EVIDENCE VIEWER POPUP */}
        {activeEvidenceId && (
            <EvidenceViewer 
                file={evidenceFiles.find(f => f.id === activeEvidenceId) || null}
                processedData={project.processedData.find(pd => pd.fileId === activeEvidenceId)}
                initialSeekSeconds={seekSeconds}
                personName={peopleMap[activeEvidenceId] || "Desconhecido"}
                onClose={() => { setActiveEvidenceId(null); setSeekSeconds(null); }}
            />
        )}
    </div>
  );
};

export default App;
