
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, FileText, MessageSquare, PlayCircle, Save, FolderOpen, Plus, Trash2,
  CheckCircle2, AlertCircle, Loader2, FileAudio, BrainCircuit, Database, 
  X, Key, Users, File, FileImage, LayoutGrid, Paperclip, Mic, Gavel, Edit2, Check,
  ChevronDown, ChevronRight, StopCircle, Play, Layers, ArrowUp, ArrowDown, LogOut, ExternalLink
} from 'lucide-react';
import { EvidenceFile, Fact, ProjectState, ChatMessage, ProcessedContent, Person, EvidenceType, Citation, EvidenceCategory, AnalysisReport, SerializedProject, SerializedDatabase } from './types';
import { processFile, analyzeFactsFromEvidence, chatWithEvidence, sanitizeTranscript } from './services/geminiService';
import { exportToWord, saveProjectFile, saveDatabaseFile, loadFromJSON } from './utils/exportService';
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

const App: React.FC = () => {
  // Auth
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem("veritas_api_key") || "");
  const [tempApiKey, setTempApiKey] = useState("");

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

  // Folder UI State
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  
  // Drag & Drop UI State
  const [dragOverCategory, setDragOverCategory] = useState<EvidenceCategory | null>(null);

  // --- HELPERS ---

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
          // Note: Browser usually handles cleanup when tab closes, 
          // or we could timeout revoke, but explicit revoke is hard for new tab.
      } else {
          alert("Ficheiro original não disponível (Pode ser um ficheiro virtual de um projeto importado).");
      }
  };

  // --- ACTIONS ---

  const addFiles = (fileList: FileList | File[], category: EvidenceCategory) => {
      const newFiles: EvidenceFile[] = Array.from(fileList).map((f: File) => {
          // Attempt to extract folder name from webkitRelativePath
          const relativePath = (f as any).webkitRelativePath || "";
          let folderName = "Raiz";
          if (relativePath) {
              const parts = relativePath.split('/');
              if (parts.length > 1) {
                  // Use the immediate parent folder name, or top level folder
                  folderName = parts[parts.length - 2] || parts[0]; 
              }
          }

          return {
            id: Math.random().toString(36).substr(2, 9),
            file: f,
            name: f.name,
            folder: folderName,
            type: getFileType(f),
            category: category,
            size: f.size
          };
      });
      
      setEvidenceFiles(prev => [...prev, ...newFiles]);
      
      // Auto-expand new folders
      const newFolders: Record<string, boolean> = {};
      newFiles.forEach(f => { if(f.folder) newFolders[`${category}-${f.folder}`] = true; });
      setExpandedFolders(prev => ({ ...prev, ...newFolders }));
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
              
              const newFolders: Record<string, boolean> = {};
              restoredFiles.forEach(f => { newFolders[`${f.category}-${f.folder}`] = true; });
              setExpandedFolders(prev => ({...prev, ...newFolders}));

              alert("Base de Dados carregada.");
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
             alert(`Erro ao processar ${file.name}: ${e.message}`);
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
      } catch (e: any) { alert(e.message); } finally { setIsAnalyzing(false); }
  };

  const deleteReport = (reportId: string) => {
      if(confirm("Tem a certeza que quer apagar este relatório?")) {
          setProject(prev => ({ ...prev, savedReports: prev.savedReports.filter(r => r.id !== reportId) }));
          if (selectedReportId === reportId) setSelectedReportId(null);
      }
  };

  const updateReport = (reportId: string, newConclusion: string, newResults: any) => {
      setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === reportId ? { ...r, generalConclusion: newConclusion, results: newResults } : r) }));
      setEditingReportId(null);
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
      } catch(e) { alert("Erro no chat"); } finally { setIsChatting(false); }
  };
  const clearChat = () => { if(confirm("Apagar histórico?")) setProject(prev => ({ ...prev, chatHistory: [] })); };

  // --- RENDERERS ---

  const renderFileCard = (file: EvidenceFile) => {
      const isProcessed = project.processedData.some(pd => pd.fileId === file.id);
      const isProcessing = processingQueue.includes(file.id);
      
      return (
         <div key={file.id} className="bg-slate-950 border border-slate-800 p-2 rounded flex flex-col gap-2 group hover:border-slate-600 transition-all mb-1">
             <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2 overflow-hidden">
                     <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 text-[10px] 
                         ${file.type === 'AUDIO' ? 'bg-blue-900/30 text-blue-400' : 
                           file.type === 'PDF' ? 'bg-red-900/30 text-red-400' : 
                           'bg-slate-800 text-slate-400'}`}>
                         {file.type === 'AUDIO' && <FileAudio size={12} />}
                         {file.type === 'PDF' && <FileText size={12} />}
                         {file.type === 'IMAGE' && <FileImage size={12} />}
                         {file.type === 'TEXT' && <FileText size={12} />}
                     </div>
                     <div className="overflow-hidden">
                         <div className="text-xs font-medium text-slate-300 truncate w-32" title={file.name}>{file.name}</div>
                         <div className="flex items-center gap-2">
                             {file.isVirtual && <span className="text-[8px] bg-slate-800 px-1 rounded text-slate-500">VIRTUAL</span>}
                             <div className={`text-[9px] font-mono uppercase ${isProcessed ? 'text-green-500' : 'text-slate-600'}`}>{isProcessed ? 'PRONTO' : 'PENDENTE'}</div>
                         </div>
                     </div>
                 </div>
                 <button onClick={() => setEvidenceFiles(prev => prev.filter(f => f.id !== file.id))} className="text-slate-600 hover:text-red-500">
                     <Trash2 size={12} />
                 </button>
             </div>
             
             {file.category !== 'OTHER' && (
                 <select 
                    className="bg-slate-900 border border-slate-800 rounded text-[10px] text-slate-400 w-full outline-none py-1"
                    value={file.personId || ""}
                    onChange={(e) => assignPersonToFile(file.id, e.target.value)}
                 >
                     <option value="">-- Associar Pessoa --</option>
                     {project.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                 </select>
             )}

             {isProcessing && <div className="text-[10px] text-blue-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Processando...</div>}
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
             className={`bg-slate-900 p-5 rounded-2xl border transition-all flex flex-col shadow-lg relative
                ${isDragOver ? 'border-primary-500 bg-slate-800/80 scale-[1.02] z-10' : 'border-slate-800'}
             `}
             onDragOver={(e) => handleDragOver(e, category)}
             onDragLeave={handleDragLeave}
             onDrop={(e) => handleDrop(e, category)}
          >
              <div className="mb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
                      {icon} {title}
                  </h3>
                  <p className="text-xs text-slate-400">{description}</p>
              </div>

              <div className="flex gap-2 mb-4">
                  <label className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold cursor-pointer transition-colors border border-slate-700 flex items-center justify-center gap-2">
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
                      <button onClick={() => { setManualCategory('TESTIMONY'); setIsManualImportOpen(true); }} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700">
                          Texto
                      </button>
                  )}
              </div>

              <div className="flex-1 bg-slate-925 rounded-xl border border-slate-800 p-2 overflow-y-auto max-h-[400px] mb-4 space-y-2">
                  {Object.keys(folders).length === 0 && (
                      <div className="flex flex-col items-center justify-center h-40 text-slate-600 gap-2 border-2 border-dashed border-slate-800/50 rounded-lg pointer-events-none">
                          <Upload size={24} />
                          <span className="text-xs text-center">Arraste pastas para aqui<br/>ou clique em Adicionar</span>
                      </div>
                  )}
                  
                  {Object.entries(folders).map(([folderName, folderFiles]) => {
                      const folderKey = `${category}-${folderName}`;
                      const isExpanded = expandedFolders[folderKey];
                      const folderUnprocessed = folderFiles.filter(f => !project.processedData.find(pd => pd.fileId === f.id)).length;
                      
                      return (
                          <div key={folderKey} className="border border-slate-800 rounded-lg bg-slate-900/50 overflow-hidden">
                              <div 
                                className="p-2 flex items-center justify-between hover:bg-slate-800 transition-colors"
                              >
                                  <div onClick={() => toggleFolder(folderKey)} className="flex items-center gap-2 cursor-pointer flex-1">
                                      {isExpanded ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                                      <FolderOpen size={14} className="text-primary-500" />
                                      <span className="text-xs font-bold text-slate-300 truncate max-w-[100px]" title={folderName}>{folderName}</span>
                                      <span className="text-[10px] text-slate-600">({folderFiles.length})</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1">
                                      {folderUnprocessed > 0 && (
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); runProcessing({ type: 'FOLDER', value: folderKey }); }}
                                            title="Processar esta pasta"
                                            className="p-1 hover:bg-green-900/50 text-slate-500 hover:text-green-400 rounded transition-colors"
                                          >
                                              <Play size={10} fill="currentColor" />
                                          </button>
                                      )}
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); deleteFolder(category, folderName); }}
                                          title="Apagar pasta"
                                          className="p-1 hover:bg-red-900/50 text-slate-500 hover:text-red-400 rounded transition-colors"
                                      >
                                          <Trash2 size={10} />
                                      </button>
                                  </div>
                              </div>
                              
                              {isExpanded && (
                                  <div className="p-2 bg-slate-950/50 border-t border-slate-800">
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
                        className="flex-1 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
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
      <div className="h-full flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950">
          <div className="max-w-4xl w-full text-center space-y-8 animate-in fade-in zoom-in duration-500 flex flex-col items-center">
              <div className="w-20 h-20 bg-primary-600 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-primary-900/50 mb-2">
                  <Database size={40} className="text-white" />
              </div>
              <div>
                  <h1 className="text-4xl font-bold text-white mb-2">Veritas V2.2</h1>
                  <p className="text-slate-500">Sistema de Análise Forense Multimodal</p>
              </div>

              {/* Status Counters */}
              <div className="flex gap-12 py-4 border-y border-slate-800/50 w-full justify-center max-w-lg">
                  <div className="flex flex-col items-center">
                      <span className="text-3xl font-bold text-white">{evidenceFiles.length}</span>
                      <span className="text-xs text-slate-500 uppercase tracking-wider">Ficheiros</span>
                  </div>
                  <div className="flex flex-col items-center">
                      <span className="text-3xl font-bold text-white">{project.people.length}</span>
                      <span className="text-xs text-slate-500 uppercase tracking-wider">Pessoas</span>
                  </div>
                  <div className="flex flex-col items-center">
                      <span className="text-3xl font-bold text-white">{project.facts.length}</span>
                      <span className="text-xs text-slate-500 uppercase tracking-wider">Factos</span>
                  </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-8 w-full max-w-2xl">
                  {/* Novo Projeto */}
                  <button 
                    onClick={handleNewProject}
                    className="p-5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-2xl flex items-center gap-4 group transition-all"
                  >
                      <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center group-hover:bg-slate-700 group-hover:text-white transition-colors">
                          <Plus size={20} />
                      </div>
                      <div className="text-left">
                          <h3 className="font-bold text-white text-sm">Novo Projeto</h3>
                          <p className="text-[10px] text-slate-500">Limpar e começar do zero</p>
                      </div>
                  </button>

                  {/* Carregar Projeto */}
                  <label className="p-5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-2xl flex items-center gap-4 group transition-all cursor-pointer">
                      <div className="w-10 h-10 rounded-full bg-green-900/20 text-green-400 flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors">
                          <FileText size={20} />
                      </div>
                      <div className="text-left">
                          <h3 className="font-bold text-white text-sm">Carregar Projeto</h3>
                          <p className="text-[10px] text-slate-500">veritas_projeto.json</p>
                      </div>
                      <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                  </label>

                  {/* Carregar Base de Dados */}
                  <label className="col-span-2 md:col-span-1 p-5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-2xl flex items-center gap-4 group transition-all cursor-pointer">
                      <div className="w-10 h-10 rounded-full bg-blue-900/20 text-blue-400 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <Database size={20} />
                      </div>
                      <div className="text-left">
                          <h3 className="font-bold text-white text-sm">Carregar Base de Dados</h3>
                          <p className="text-[10px] text-slate-500">veritas_base_dados.json</p>
                      </div>
                      <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                  </label>

                  {/* Spacer for grid if needed or keep layout */}
                   <div className="hidden md:block"></div> 

                  {/* START BUTTON */}
                  <button 
                    onClick={() => setCurrentView('setup')}
                    className="col-span-2 p-4 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl font-bold shadow-lg shadow-primary-900/50 transition-all hover:scale-[1.02] flex items-center justify-center gap-2 mt-4"
                  >
                      <span>INICIAR APLICAÇÃO</span>
                      <ChevronRight size={20} />
                  </button>
              </div>
          </div>
      </div>
  );

  // --- MAIN LAYOUT ---

  // Auth Check
  if (!apiKey) {
      return (
          <div className="h-screen flex items-center justify-center bg-slate-950 p-4">
              <div className="bg-slate-900 p-8 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-md">
                  <h1 className="text-2xl font-bold text-white mb-2 text-center">Veritas V2.2</h1>
                  <input type="password" value={tempApiKey} onChange={e => setTempApiKey(e.target.value)} placeholder="Google Gemini API Key" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white mb-4 focus:border-primary-500 outline-none"/>
                  <button onClick={() => { setApiKey(tempApiKey); localStorage.setItem("veritas_api_key", tempApiKey); }} className="w-full py-3 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl transition-all">Entrar</button>
              </div>
          </div>
      );
  }

  if (currentView === 'landing') return renderLanding();

  const totalUnprocessed = evidenceFiles.filter(f => !f.isVirtual && !project.processedData.find(pd => pd.fileId === f.id)).length;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-primary-500/30 overflow-hidden">
        {/* SIDEBAR */}
        <aside className="w-20 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-6 gap-6 z-20 flex-shrink-0">
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
                        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${currentView === item.id ? 'bg-primary-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    >
                        <item.icon size={20} />
                        <span className="text-[9px] font-bold uppercase">{item.label}</span>
                    </button>
                ))}
            </nav>

            <div className="mt-auto flex flex-col gap-2 w-full px-2 border-t border-slate-800 pt-4">
                {/* PROJECT ACTIONS */}
                <div className="flex flex-col gap-1 items-center pb-2 border-b border-slate-800 w-full">
                    <span className="text-[8px] font-bold text-slate-600 uppercase mb-1">PROJETO</span>
                    <label className="p-2 text-slate-500 hover:text-green-400 cursor-pointer flex flex-col items-center gap-1 w-full hover:bg-slate-800 rounded">
                        <ArrowUp size={16} />
                        <span className="text-[8px]">Carregar</span>
                        <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                    </label>
                    <button onClick={() => saveProjectFile(project)} className="p-2 text-slate-500 hover:text-blue-400 flex flex-col items-center gap-1 w-full hover:bg-slate-800 rounded">
                        <ArrowDown size={16} />
                        <span className="text-[8px]">Guardar</span>
                    </button>
                </div>

                {/* DB ACTIONS */}
                <div className="flex flex-col gap-1 items-center pb-2 border-b border-slate-800 w-full">
                    <span className="text-[8px] font-bold text-slate-600 uppercase mb-1">BASE DADOS</span>
                    <label className="p-2 text-slate-500 hover:text-green-400 cursor-pointer flex flex-col items-center gap-1 w-full hover:bg-slate-800 rounded">
                        <ArrowUp size={16} />
                        <span className="text-[8px]">Carregar</span>
                        <input type="file" accept=".json" onChange={handleLoadProject} className="hidden" />
                    </label>
                    <button onClick={() => saveDatabaseFile(project, evidenceFiles)} className="p-2 text-slate-500 hover:text-blue-400 flex flex-col items-center gap-1 w-full hover:bg-slate-800 rounded">
                        <ArrowDown size={16} />
                        <span className="text-[8px]">Guardar</span>
                    </button>
                </div>

                <button onClick={() => { setApiKey(""); localStorage.removeItem("veritas_api_key"); }} className="p-2 text-slate-500 hover:text-red-400 flex flex-col items-center gap-1 mt-2 w-full hover:bg-slate-800 rounded">
                    <LogOut size={16} />
                    <span className="text-[8px]">Sair</span>
                </button>
            </div>
        </aside>

        {/* CONTENT */}
        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
            <header className="h-16 border-b border-slate-800 bg-slate-950/50 backdrop-blur flex items-center px-8 justify-between flex-shrink-0 z-10">
                <h1 className="text-lg font-bold text-white">
                    {currentView === 'setup' && 'Gestão de Evidências e Factos'}
                    {currentView === 'people' && 'Gestão de Pessoas e Testemunhas'}
                    {currentView === 'analysis' && 'Relatórios de Análise Forense'}
                    {currentView === 'chat' && 'Assistente IA'}
                </h1>
                <div className="flex items-center gap-4">
                     {currentView === 'setup' && totalUnprocessed > 0 && (
                         <>
                             {processingQueue.length > 0 ? (
                                <button onClick={stopProcessing} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-400 text-xs font-bold rounded-lg border border-red-800/50">
                                    <StopCircle size={14} className="animate-pulse" /> A Processar {processingQueue.length}... Parar
                                </button>
                             ) : (
                                <button onClick={() => runProcessing({ type: 'ALL' })} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-900/20">
                                    <BrainCircuit size={14} /> Processar Tudo ({totalUnprocessed})
                                </button>
                             )}
                         </>
                     )}
                    <div className="flex gap-4 text-xs font-mono text-slate-500 border-l border-slate-800 pl-4">
                        <span>Ficheiros: {evidenceFiles.length}</span>
                        <span>Relatórios: {project.savedReports.length}</span>
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 bg-slate-950 relative scroll-smooth">
                {currentView === 'setup' && (
                    <div className="max-w-7xl mx-auto pb-20 space-y-8">
                        {/* Removida altura fixa para evitar sobreposição */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {renderUploadSection("Depoimentos", 'TESTIMONY', <Mic className="text-blue-500" />, "Áudios e Transcrições.")}
                            {renderUploadSection("Autos de Inquirição", 'INQUIRY', <Gavel className="text-red-500" />, "PDFs dos Autos.")}
                            {renderUploadSection("Outros Documentos", 'OTHER', <Paperclip className="text-yellow-500" />, "Anexos e Fotos.")}
                        </div>
                        
                        {/* Margem superior grande para garantir separação visual */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-8 mt-12 border-t border-slate-800">
                            {/* FACTS */}
                            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                                <h3 className="font-bold text-white mb-4 flex items-center gap-2"><CheckCircle2 className="text-primary-500" /> Factos a Provar</h3>
                                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                    {project.facts.map((fact, idx) => (
                                        <div key={fact.id} className="flex gap-2 group">
                                            <span className="text-xs font-mono text-slate-500 mt-3">#{idx+1}</span>
                                            <textarea 
                                              value={fact.text}
                                              onChange={(e) => setProject(p => ({ ...p, facts: p.facts.map(f => f.id === fact.id ? { ...f, text: e.target.value } : f) }))}
                                              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-300 focus:border-primary-500 outline-none resize-none h-20"
                                              placeholder="Insira o facto..."
                                            />
                                            <button onClick={() => setProject(p => ({ ...p, facts: p.facts.filter(f => f.id !== fact.id) }))} className="self-center p-2 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={16} /></button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setProject(p => ({ ...p, facts: [...p.facts, { id: Math.random().toString(36), text: "" }] }))} className="mt-4 text-xs text-primary-400 font-bold uppercase hover:text-primary-300 flex items-center gap-1">
                                    <Plus size={14} /> Adicionar Facto
                                </button>
                            </div>

                            {/* ACTION */}
                            <div className="flex flex-col justify-center items-center p-8 border-2 border-dashed border-slate-800 rounded-2xl">
                                <PlayCircle size={48} className="text-primary-600 mb-4" />
                                <h3 className="text-xl font-bold text-white mb-2">Análise Cruzada V2.2</h3>
                                <p className="text-sm text-slate-500 text-center mb-6 max-w-xs">
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

                {/* Other views remain same as V2.1 */}
                {currentView === 'people' && (
                    <div className="max-w-4xl mx-auto space-y-8 pb-20">
                        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800">
                            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <Users className="text-primary-500" /> Gestão de Pessoas / Testemunhas
                            </h2>
                            <div className="flex gap-6">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Importar Lista (um nome por linha)</label>
                                    <textarea 
                                       value={newPersonList}
                                       onChange={(e) => setNewPersonList(e.target.value)}
                                       className="w-full h-40 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 outline-none focus:border-primary-500"
                                       placeholder="João Silva&#10;Maria Santos&#10;Dr. António..."
                                    />
                                    <button onClick={addPeopleFromList} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold shadow hover:bg-primary-500">Adicionar à Lista</button>
                                </div>
                                <div className="w-1/2 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex flex-col">
                                    <div className="p-3 bg-slate-900 border-b border-slate-800 text-xs font-bold text-slate-400 uppercase">Pessoas Registadas ({project.people.length})</div>
                                    <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[300px]">
                                        {project.people.map(p => (
                                            <div key={p.id} className="flex justify-between items-center p-2 hover:bg-slate-900 rounded group">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">{p.name.charAt(0)}</div>
                                                    <span className="text-sm text-slate-300">{p.name}</span>
                                                </div>
                                                <button onClick={() => removePerson(p.id)} className="text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* Chat and Analysis View reuse from V2.1 logic */}
                {currentView === 'chat' && (
                  <div className="max-w-3xl mx-auto h-[calc(100vh-140px)] flex flex-col bg-slate-900 rounded-2xl border border-slate-800">
                      <div className="h-12 border-b border-slate-800 flex items-center justify-end px-4">
                          <button onClick={clearChat} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1"><Trash2 size={12}/> Limpar Conversa</button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-6 space-y-4">
                          {project.chatHistory.map(msg => (
                              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                                      {msg.text.split('\n').map((line, i) => {
                                          const match = line.match(/\[(.*?)@(.*?)\]/);
                                          if (match) {
                                              const fileName = match[1].trim();
                                              const ev = evidenceFiles.find(f => f.name.includes(fileName) || fileName.includes(f.name));
                                              return (
                                                  <div key={i} className="flex items-center gap-2 my-1">
                                                      <button onClick={() => { if(ev) { setActiveEvidenceId(ev.id); setSeekSeconds(0); } }} className="text-primary-300 hover:underline font-mono text-xs bg-black/20 px-2 py-1 rounded">
                                                          {line}
                                                      </button>
                                                      {ev && !ev.isVirtual && (
                                                          <button onClick={() => handleOpenOriginal(ev.id)} title="Abrir Original" className="p-1 bg-slate-950/50 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors">
                                                              <ExternalLink size={12} />
                                                          </button>
                                                      )}
                                                  </div>
                                              );
                                          }
                                          return <p key={i}>{line}</p>;
                                      })}
                                  </div>
                              </div>
                          ))}
                          {isChatting && <div className="text-xs text-slate-500 text-center animate-pulse">A pensar...</div>}
                      </div>
                      <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-2">
                          <input className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-slate-300 outline-none focus:border-primary-500" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} placeholder="Pergunte sobre os autos, áudios ou documentos..." />
                          <button onClick={handleChat} className="p-3 bg-primary-600 hover:bg-primary-500 rounded-xl text-white"><MessageSquare size={20} /></button>
                      </div>
                  </div>
                )}
                {currentView === 'analysis' && (
                  <div className="max-w-7xl mx-auto h-[calc(100vh-140px)] flex gap-6">
                      <div className="w-64 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shrink-0">
                          <div className="p-4 border-b border-slate-800 font-bold text-slate-400 text-xs uppercase">Relatórios Guardados</div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                              {project.savedReports.map(rep => (
                                  <div key={rep.id} onClick={() => setSelectedReportId(rep.id)} className={`p-3 rounded-lg cursor-pointer border transition-all ${selectedReportId === rep.id ? 'bg-primary-900/30 border-primary-600/50' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}>
                                      <div className="text-sm font-bold text-slate-200 truncate">{rep.name}</div>
                                      <div className="text-[10px] text-slate-500">{new Date(rep.generatedAt).toLocaleString()}</div>
                                  </div>
                              ))}
                          </div>
                      </div>
                      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col relative">
                           {/* Analysis Detail View (Same logic as V2.1) */}
                           {project.savedReports.find(r => r.id === selectedReportId) ? (
                                (() => {
                                    const activeReport = project.savedReports.find(r => r.id === selectedReportId)!;
                                    return (
                                        <>
                                            <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900">
                                                 <h2 className="text-xl font-bold text-white">{activeReport.name}</h2>
                                                 <div className="flex gap-2">
                                                     {editingReportId !== activeReport.id ? (
                                                         <>
                                                            <button onClick={() => setEditingReportId(activeReport.id)} className="p-2 text-slate-400 hover:text-white"><Edit2 size={18}/></button>
                                                            <button onClick={() => exportToWord(activeReport, activeReport.name)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs text-white">Exportar Word</button>
                                                            <button onClick={() => deleteReport(activeReport.id)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={18}/></button>
                                                         </>
                                                     ) : (
                                                         <button onClick={() => updateReport(activeReport.id, activeReport.generalConclusion, activeReport.results)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs text-white flex items-center gap-1"><Check size={14}/> Guardar Edição</button>
                                                     )}
                                                 </div>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-8 space-y-8">
                                                 <div className="bg-slate-950 p-6 rounded-xl border border-slate-800">
                                                     <h3 className="text-primary-400 font-bold mb-2 uppercase text-xs">Conclusão Geral</h3>
                                                     {editingReportId === activeReport.id ? (
                                                         <textarea className="w-full h-32 bg-slate-900 border border-slate-700 rounded p-2 text-slate-300 text-sm" value={activeReport.generalConclusion} onChange={(e) => { const updated = { ...activeReport, generalConclusion: e.target.value }; setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === updated.id ? updated : r) })); }} />
                                                     ) : (
                                                         <p className="text-slate-300 leading-relaxed text-sm">{activeReport.generalConclusion}</p>
                                                     )}
                                                 </div>
                                                 <div className="space-y-6">
                                                      {activeReport.results.map((res, idx) => (
                                                          <div key={idx} className="border border-slate-800 rounded-xl overflow-hidden">
                                                              <div className="bg-slate-800/50 p-4 flex justify-between items-center">
                                                                  <h4 className="font-bold text-slate-200 text-sm">{res.factText}</h4>
                                                                  {editingReportId === activeReport.id ? (
                                                                      <select value={res.status} onChange={(e) => { const newResults = [...activeReport.results]; newResults[idx] = { ...res, status: e.target.value as any }; setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === activeReport.id ? { ...r, results: newResults } : r) })); }} className="bg-slate-900 text-xs text-white border border-slate-700 rounded p-1">
                                                                          <option value="Confirmado">Confirmado</option><option value="Desmentido">Desmentido</option><option value="Inconclusivo/Contraditório">Inconclusivo</option><option value="Não Mencionado">Não Mencionado</option>
                                                                      </select>
                                                                  ) : (
                                                                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${res.status === 'Confirmado' ? 'bg-green-900/40 text-green-400' : res.status === 'Desmentido' ? 'bg-red-900/40 text-red-400' : 'bg-slate-700 text-slate-400'}`}>{res.status}</span>
                                                                  )}
                                                              </div>
                                                              <div className="p-6 bg-slate-900">
                                                                  {editingReportId === activeReport.id ? (
                                                                      <textarea className="w-full h-24 bg-slate-950 border border-slate-700 rounded p-2 text-slate-300 text-sm mb-4" value={res.summary} onChange={(e) => { const newResults = [...activeReport.results]; newResults[idx] = { ...res, summary: e.target.value }; setProject(prev => ({ ...prev, savedReports: prev.savedReports.map(r => r.id === activeReport.id ? { ...r, results: newResults } : r) })); }} />
                                                                  ) : (
                                                                      <p className="text-slate-400 text-sm mb-4 border-l-2 border-slate-700 pl-4">{res.summary}</p>
                                                                  )}
                                                                  <div className="space-y-2">
                                                                      {res.citations.map((cit, i) => (
                                                                          <div key={i} className="bg-slate-950 p-3 rounded-lg border border-slate-800 hover:border-primary-500/50 group transition-all relative">
                                                                              <div className="flex items-center justify-between mb-1">
                                                                                   <div 
                                                                                        onClick={() => { setActiveEvidenceId(cit.fileId); setSeekSeconds(cit.seconds); }} 
                                                                                        className="flex items-center gap-2 cursor-pointer"
                                                                                    >
                                                                                        <PlayCircle size={14} className="text-primary-500" />
                                                                                        <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-900 px-1 rounded hover:text-white transition-colors">{cit.fileName}</span>
                                                                                        <span className="text-[10px] text-slate-600 font-mono">@{cit.timestamp}</span>
                                                                                   </div>
                                                                                   
                                                                                   {(() => {
                                                                                        const evFile = evidenceFiles.find(f => f.id === cit.fileId);
                                                                                        if (evFile && !evFile.isVirtual) {
                                                                                            return (
                                                                                                <button onClick={() => handleOpenOriginal(cit.fileId)} className="text-slate-500 hover:text-white p-1" title="Abrir documento original">
                                                                                                    <ExternalLink size={12} />
                                                                                                </button>
                                                                                            );
                                                                                        }
                                                                                        return null;
                                                                                   })()}
                                                                              </div>
                                                                              <p onClick={() => { setActiveEvidenceId(cit.fileId); setSeekSeconds(cit.seconds); }} className="text-sm text-slate-300 italic cursor-pointer">"{cit.text}"</p>
                                                                          </div>
                                                                      ))}
                                                                  </div>
                                                              </div>
                                                          </div>
                                                      ))}
                                                 </div>
                                            </div>
                                        </>
                                    );
                                })()
                           ) : (
                               <div className="flex items-center justify-center h-full text-slate-500">Selecione um relatório.</div>
                           )}
                      </div>
                  </div>
                )}
            </div>
        </main>

        {/* MANUAL IMPORT MODAL */}
        {isManualImportOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                <div className="bg-slate-900 p-6 rounded-2xl w-full max-w-2xl border border-slate-800">
                    <h3 className="text-xl font-bold text-white mb-4">Importar Texto Manualmente</h3>
                    <input className="w-full bg-slate-950 border border-slate-800 p-3 rounded-lg text-white mb-4" placeholder="Nome do Documento / Depoimento" value={manualName} onChange={e => setManualName(e.target.value)} />
                    <textarea className="w-full h-64 bg-slate-950 border border-slate-800 p-3 rounded-lg text-slate-300 mb-4 font-mono text-sm" placeholder="Cole o texto aqui..." value={manualText} onChange={e => setManualText(e.target.value)} />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setIsManualImportOpen(false)} className="px-4 py-2 text-slate-400">Cancelar</button>
                        <button onClick={handleManualImport} className="px-4 py-2 bg-primary-600 text-white rounded-lg">Importar</button>
                    </div>
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
