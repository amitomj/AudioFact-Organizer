
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, FileText, MessageSquare, PlayCircle, Save, FolderOpen, Plus, Trash2,
  CheckCircle2, AlertCircle, Loader2, FileAudio, BrainCircuit, Database, 
  X, Key, Users, File, FileImage, LayoutGrid, Paperclip, Mic, Gavel, Edit2, Check,
  ChevronDown, ChevronRight, StopCircle, Play, Layers, ArrowUp, ArrowDown, LogOut, ExternalLink, AlertTriangle, Sun, Moon, Pencil, ChevronUp, UserPlus, Download, ZapOff, Library, Headphones, Music, HelpCircle, User, Filter, Search as SearchIcon, BookOpen
} from 'lucide-react';
import { EvidenceFile, Fact, ProjectState, ChatMessage, ProcessedContent, Person, EvidenceType, Citation, EvidenceCategory, AnalysisReport, SerializedProject, SerializedDatabase, FactStatus } from './types';
import { processFile, analyzeFactsFromEvidence, chatWithEvidence, sanitizeTranscript, parseSecondsSafe } from './services/geminiService';
import { exportToWord, saveProjectFile, saveDatabaseFile, loadFromJSON, exportChatToZip, exportTranscriptsToWord } from './utils/exportService';
import { generateDocumentation } from './utils/documentationGenerator';
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

type View = 'landing' | 'setup' | 'people' | 'analysis' | 'chat' | 'library';

// GROUPED CITATION COMPONENT
const CitationGroup: React.FC<{ 
    fileName: string;
    contentLines: string[];
    evidenceFiles: EvidenceFile[]; 
    onSeek: (fileId: string, seconds: number) => void; 
    onOpenOriginal: (fileId: string, page?: number) => void;
    renderInline: (text: string) => React.ReactNode;
}> = ({ fileName, contentLines, evidenceFiles, onSeek, onOpenOriginal, renderInline }) => {
    const evidence = evidenceFiles.find(f => f.name.toLowerCase().includes(fileName.toLowerCase()) || fileName.toLowerCase().includes(f.name.toLowerCase()));
    const allRefs: { label: string, value: number }[] = [];
    
    contentLines.forEach(line => {
        // Regex for [Time] or [Pág X]
        const regex = /\[(?:.*?@\s*)?(\d{1,2}:\d{2}(?::\d{2})?|P[áa]g\.?\s*\d+)(?:\])?/g; 
        let match;
        while ((match = regex.exec(line)) !== null) {
            const val = match[1];
            if (val.toLowerCase().includes('pág')) {
                const pageNum = parseInt(val.match(/\d+/)?.[0] || "1");
                allRefs.push({ label: val, value: pageNum });
            } else {
                allRefs.push({ label: val, value: parseSecondsSafe(val) });
            }
        }
    });
    const uniqueRefs = allRefs.filter((v, i, a) => a.findIndex(t => t.label === v.label) === i).sort((a,b) => a.value - b.value);

    const isAudio = evidence?.type === 'AUDIO';

    return (
        <div className="my-3 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm transition-all group text-left">
            <div className="px-3 py-2 bg-blue-50 dark:bg-primary-900/20 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {isAudio ? <FileAudio size={14} className="text-primary-600 dark:text-primary-400" /> : <FileText size={14} className="text-orange-600 dark:text-orange-400" />}
                    <span className="text-xs font-bold text-gray-700 dark:text-primary-300 uppercase truncate max-w-[200px]" title={fileName}>{fileName}</span>
                </div>
                 {evidence && !evidence.isVirtual && (
                     <button onClick={(e) => { e.stopPropagation(); onOpenOriginal(evidence.id); }} className="flex items-center gap-1 px-2 py-0.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded text-[10px] text-gray-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                         <ExternalLink size={10} /> Abrir Original
                     </button>
                 )}
            </div>
            <div className="p-4 text-sm text-gray-700 dark:text-slate-300 leading-relaxed space-y-2">
                {contentLines.map((line, i) => (<div key={i}>{renderInline(line)}</div>))}
            </div>
            {evidence && uniqueRefs.length > 0 && (
                <div className="px-3 py-2 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] font-bold text-gray-400 dark:text-slate-600 uppercase mr-2">Ver na fonte:</span>
                    {uniqueRefs.map((ref, idx) => (
                         <button 
                            key={idx} 
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                if (isAudio) onSeek(evidence.id, ref.value);
                                else onOpenOriginal(evidence.id, ref.value);
                            }} 
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-colors border shadow-sm
                                ${isAudio 
                                    ? 'bg-blue-100 dark:bg-primary-900/30 text-blue-700 dark:text-primary-300 border-blue-200 dark:border-primary-800/50 hover:bg-blue-200' 
                                    : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800/50 hover:bg-orange-200'}`}
                         >
                            {isAudio ? <Play size={8} fill="currentColor"/> : <BookOpen size={8}/>} {ref.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const App: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [currentView, setCurrentView] = useState<View>('landing');
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]); 
  const [project, setProject] = useState<ProjectState>(initialProjectState);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const abortProcessingRef = useRef<boolean>(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [seekSeconds, setSeekSeconds] = useState<number | null>(null);
  const [isManualImportOpen, setIsManualImportOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualName, setManualName] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [dragOverCategory, setDragOverCategory] = useState<EvidenceCategory | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");

  const projectInputRef = useRef<HTMLInputElement>(null);
  const databaseInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  useEffect(() => {
    if (currentView === 'chat') {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [project.chatHistory, currentView]);

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

  const toggleFolder = (folderKey: string) => setExpandedFolders(prev => ({ ...prev, [folderKey]: !prev[folderKey] }));
  
  const handleOpenOriginal = (fileId: string, pageOrSeconds?: number) => {
      const file = evidenceFiles.find(f => f.id === fileId);
      if (file && file.file) {
          let url = URL.createObjectURL(file.file);
          // PDF page parameter: #page=X
          if (file.type === 'PDF' && pageOrSeconds) {
              url += `#page=${pageOrSeconds}`;
          }
          window.open(url, '_blank');
      } else {
          alert("Ficheiro original não disponível (Virtual). Por favor, use o botão 'Adicionar Pastas' no separador DADOS para re-importar os ficheiros originais.");
      }
  };

  const renderTextWithInlineCitations = (text: string) => {
      const parts = text.split(/(\[.*?\])/g);
      return (
        <span>
            {parts.map((part, i) => {
                const matchNameRef = part.match(/^\[(.*?)\s*@\s*(.*?)\]$/); 
                if (matchNameRef) {
                    const fileRef = matchNameRef[1];
                    const refPart = matchNameRef[2];
                    const file = evidenceFiles.find(f => f.name.toLowerCase().includes(fileRef.toLowerCase()) || fileRef.toLowerCase().includes(f.name.toLowerCase()));
                    
                    if (file) {
                        const isAudio = file.type === 'AUDIO';
                        return (
                            <button 
                                key={i} 
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    if (isAudio) {
                                        setActiveEvidenceId(file.id); 
                                        setSeekSeconds(parseSecondsSafe(refPart));
                                    } else {
                                        const page = parseInt(refPart.match(/\d+/)?.[0] || "1");
                                        handleOpenOriginal(file.id, page);
                                    }
                                }} 
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors border shadow-sm mx-1
                                    ${isAudio 
                                        ? 'bg-blue-100 dark:bg-primary-900/40 text-blue-700 dark:text-primary-300 border-blue-200 dark:border-primary-800 hover:bg-blue-200' 
                                        : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 hover:bg-orange-200'}`}
                            >
                                {isAudio ? <Play size={8} fill="currentColor"/> : <BookOpen size={8}/>} {refPart}
                            </button>
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
      lines.forEach((line, i) => {
          const match = line.match(/\[(.*?)\s*@/);
          const fileNameRef = match ? match[1].trim() : null;
          if (fileNameRef) {
              if (currentGroup && currentGroup.fileName.toLowerCase() === fileNameRef.toLowerCase()) currentGroup.lines.push(line);
              else {
                  if (currentGroup) renderedElements.push(<CitationGroup key={`group-${i}`} fileName={currentGroup.fileName} contentLines={currentGroup.lines} evidenceFiles={evidenceFiles} onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }} onOpenOriginal={handleOpenOriginal} renderInline={renderTextWithInlineCitations}/>);
                  currentGroup = { fileName: fileNameRef, lines: [line] };
              }
          } else {
              if (currentGroup) {
                  renderedElements.push(<CitationGroup key={`group-${i}`} fileName={currentGroup.fileName} contentLines={currentGroup.lines} evidenceFiles={evidenceFiles} onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }} onOpenOriginal={handleOpenOriginal} renderInline={renderTextWithInlineCitations}/>);
                  currentGroup = null;
              }
              if (line.trim()) renderedElements.push(<p key={`text-${i}`} className="mb-2 last:mb-0 leading-relaxed text-left">{renderTextWithInlineCitations(line)}</p>);
          }
      });
      if (currentGroup) renderedElements.push(<CitationGroup key={`group-last`} fileName={currentGroup.fileName} contentLines={currentGroup.lines} evidenceFiles={evidenceFiles} onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }} onOpenOriginal={handleOpenOriginal} renderInline={renderTextWithInlineCitations}/>);
      return renderedElements;
  };

  const addFiles = (fileList: FileList | File[], category: EvidenceCategory) => {
      const MAX_SIZE = 90 * 1024 * 1024;
      setEvidenceFiles(prevFiles => {
          const updatedFiles = [...prevFiles];
          const newFilesToAdd: EvidenceFile[] = [];
          Array.from(fileList).forEach((f: File) => {
              if (f.size > MAX_SIZE) return;
              const relativePath = (f as any).webkitRelativePath || "";
              let folderName = relativePath ? (relativePath.split('/').slice(-2, -1)[0] || "Raiz") : "Raiz";
              
              // REHYDRATION LOGIC: Check if this file name already exists as a virtual file
              const existingIndex = updatedFiles.findIndex(ev => ev.name === f.name && ev.category === category);
              if (existingIndex !== -1) {
                  updatedFiles[existingIndex] = { ...updatedFiles[existingIndex], file: f, isVirtual: false, size: f.size };
              } else {
                  newFilesToAdd.push({ id: Math.random().toString(36).substr(2, 9), file: f, name: f.name, folder: folderName, type: getFileType(f), category: category, size: f.size });
              }
          });
          return [...updatedFiles, ...newFilesToAdd];
      });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, category: EvidenceCategory) => { if (e.target.files && e.target.files.length > 0) addFiles(e.target.files, category); };
  const handleDragOver = (e: React.DragEvent, category: EvidenceCategory) => { e.preventDefault(); setDragOverCategory(category); };
  const handleDrop = (e: React.DragEvent, category: EvidenceCategory) => { e.preventDefault(); setDragOverCategory(null); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files, category); };
  
  const handleLoadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
          const result = await loadFromJSON(file);
          if (result.type === 'project') setProject({ ...initialProjectState, people: result.data.people || [], facts: result.data.facts || [], savedReports: result.data.savedReports || [], chatHistory: result.data.chatHistory || [] });
          else if (result.type === 'database') {
              setProject(prev => ({ ...prev, processedData: result.data.processedData || [] }));
              const restored = result.data.fileManifest.map(m => ({ id: m.id, name: m.name, type: m.type as EvidenceType, category: m.category as EvidenceCategory, folder: m.folder || "Importado", file: null, isVirtual: true }));
              setEvidenceFiles(prev => { 
                const existingNames = new Set(prev.map(f => f.name));
                return [...prev, ...restored.filter(f => !existingNames.has(f.name))]; 
              });
          }
          alert("Ficheiro carregado. Se os ícones de arquivo estiverem laranja, re-importe os ficheiros originais no separador Dados.");
      } catch (err: any) { alert(err.message); }
      e.target.value = '';
  };

  const runProcessing = async (scope: { type: 'ALL' | 'CATEGORY' | 'FOLDER' | 'FILE', value?: string }) => {
     const unprocessed = evidenceFiles.filter(f => {
         if (f.isVirtual || project.processedData.find(pd => pd.fileId === f.id)) return false;
         if (f.file && f.file.size > 90 * 1024 * 1024) return false;
         if (scope.type === 'ALL') return true;
         if (scope.type === 'CATEGORY') return f.category === scope.value;
         if (scope.type === 'FOLDER' && scope.value) { const [cat, ...rest] = scope.value.split('-'); return f.category === cat && f.folder === rest.join('-'); }
         if (scope.type === 'FILE') return f.id === scope.value;
         return false;
     });
     if (unprocessed.length === 0) return;
     abortProcessingRef.current = false;
     for (const file of unprocessed) {
         if (abortProcessingRef.current) { setProcessingQueue([]); break; }
         setProcessingQueue(prev => [...prev, file.id]);
         try {
             const result = await processFile(file);
             setProject(prev => ({ ...prev, processedData: [...prev.processedData, result] }));
         } catch (e: any) {
             if (isQuotaError(e)) { setShowQuotaModal(true); stopProcessing(); break; }
             else alert(`Erro em ${file.name}: ${e.message}`);
         } finally { setProcessingQueue(prev => prev.filter(id => id !== file.id)); }
     }
  };

  const stopProcessing = () => abortProcessingRef.current = true;

  const runAnalysis = async () => {
      setIsAnalyzing(true);
      try {
          const report = await analyzeFactsFromEvidence(project.processedData, project.facts, peopleMap, evidenceFiles);
          setProject(prev => ({ ...prev, savedReports: [report, ...prev.savedReports] }));
          setSelectedReportId(report.id);
          setCurrentView('analysis');
      } catch (e: any) { if (isQuotaError(e)) setShowQuotaModal(true); else alert(e.message); }
      finally { setIsAnalyzing(false); }
  };

  const handleChat = async () => {
      if (!chatInput.trim()) return;
      const msg: ChatMessage = { id: Date.now().toString(), role: 'user', text: chatInput, timestamp: Date.now() };
      setProject(p => ({ ...p, chatHistory: [...p.chatHistory, msg] }));
      setChatInput(""); setIsChatting(true);
      try {
          const resp = await chatWithEvidence(project.processedData, [...project.chatHistory, msg], msg.text, peopleMap, evidenceFiles);
          setProject(p => ({ ...p, chatHistory: [...p.chatHistory, { id: (Date.now()+1).toString(), role: 'model', text: resp, timestamp: Date.now() }] }));
      } catch(e: any) { if (isQuotaError(e)) setShowQuotaModal(true); else alert(`Erro: ${e.message}`); }
      finally { setIsChatting(false); }
  };

  const handleRenameSpeaker = (fileId: string, oldName: string, newName: string) => {
    setProject(prev => ({
      ...prev,
      processedData: prev.processedData.map(pd => {
        if (pd.fileId === fileId) {
          const updatedSegments = pd.segments.map(seg => {
            // Robust replacement handling both Markdown bold and simple colon format
            const boldOld = `**${oldName}**`;
            const colonOld = `${oldName}:`;
            
            let updatedText = seg.text;
            if (updatedText.includes(boldOld)) {
                updatedText = updatedText.split(boldOld).join(`**${newName}**`);
            } else if (updatedText.includes(colonOld)) {
                updatedText = updatedText.split(colonOld).join(`${newName}:`);
            } else if (updatedText.startsWith(oldName)) {
                // Fallback for cases where it's just the name at the start
                updatedText = updatedText.replace(oldName, newName);
            }
            return { ...seg, text: updatedText };
          });
          
          return { 
            ...pd, 
            segments: updatedSegments, 
            fullText: updatedSegments.map(s => `[${s.timestamp}] ${s.text}`).join('\n') 
          };
        }
        return pd;
      })
    }));
  };

  const renderFileCard = (file: EvidenceFile) => {
      const isProcessed = project.processedData.some(pd => pd.fileId === file.id);
      const isProcessing = processingQueue.includes(file.id);
      const isTooLarge = file.file && file.file.size > 90 * 1024 * 1024;
      return (
         <div key={file.id} className={`bg-white dark:bg-slate-900 border p-2 rounded flex flex-col gap-2 transition-all mb-1 ${isTooLarge ? 'border-red-500 bg-red-50/10' : file.isVirtual ? 'border-orange-200' : 'border-gray-200 dark:border-slate-800'}`}>
             <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2 overflow-hidden">
                     <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 text-[10px] ${file.type === 'AUDIO' ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}`}>
                         {file.type === 'AUDIO' ? <FileAudio size={12}/> : <FileText size={12}/>}
                     </div>
                     <div className="overflow-hidden">
                         <div className="text-xs font-medium truncate w-32 dark:text-slate-300" title={file.name}>{file.name}</div>
                         <div className="flex items-center gap-2">
                             {isTooLarge ? <span className="text-[9px] text-red-600 font-bold uppercase">MUITO GRANDE</span> 
                             : file.isVirtual ? <span className="text-[9px] text-orange-500 font-bold uppercase">EM FALTA</span> 
                             : <div className={`text-[9px] font-mono uppercase ${isProcessed ? 'text-green-600' : 'text-gray-500'}`}>{isProcessed ? 'PRONTO' : 'PENDENTE'}</div>}
                         </div>
                     </div>
                 </div>
                 <div className="flex items-center gap-2">
                     {!isProcessed && !isProcessing && !file.isVirtual && !isTooLarge && (<button onClick={(e) => { e.stopPropagation(); runProcessing({ type: 'FILE', value: file.id }); }} className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"><Play size={10} fill="currentColor" /></button>)}
                     <button onClick={() => setEvidenceFiles(prev => prev.filter(f => f.id !== file.id))} className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                 </div>
             </div>
         </div>
      );
  };

  const renderUploadSection = (title: string, category: EvidenceCategory, icon: React.ReactNode, description: string) => {
      const files = evidenceFiles.filter(f => f.category === category);
      const unprocessed = files.filter(f => !project.processedData.find(pd => pd.fileId === f.id) && !(f.file && f.file.size > 90 * 1024 * 1024)).length;
      const folders: Record<string, EvidenceFile[]> = {};
      files.forEach(f => { const k = f.folder || 'Raiz'; if(!folders[k]) folders[k] = []; folders[k].push(f); });
      return (
          <div className={`bg-white dark:bg-slate-900/50 p-6 rounded-2xl border flex flex-col shadow-sm relative ${dragOverCategory === category ? 'border-primary-500 bg-blue-50' : 'border-gray-200 dark:border-slate-800'}`} onDragOver={(e) => handleDragOver(e, category)} onDrop={(e) => handleDrop(e, category)}>
              <div className="mb-4 text-left"><h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-1">{icon} {title}</h3><p className="text-xs text-gray-500 dark:text-slate-400">{description}</p></div>
              <div className="flex gap-2 mb-4">
                <label className="flex-1 px-3 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg text-xs font-bold cursor-pointer flex items-center justify-center gap-2 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700">
                  <FolderOpen size={14}/> Adicionar Pastas
                  {/* Fix: Using spread to bypass TypeScript restriction on non-standard directory attributes */}
                  <input type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} onChange={(e) => handleFileUpload(e, category)} className="hidden"/>
                </label>
              </div>
              <div className="flex-1 bg-gray-50 dark:bg-slate-925 rounded-xl border border-gray-200 dark:border-slate-800 p-2 overflow-y-auto max-h-[350px] space-y-2 mb-4">
                  {Object.entries(folders).map(([name, fArr]) => {
                      const folderKey = `${category}-${name}`;
                      const isExpanded = expandedFolders[folderKey];
                      const folderUnprocessed = fArr.filter(f => !project.processedData.find(pd => pd.fileId === f.id) && !(f.file && f.file.size > 90 * 1024 * 1024)).length;
                      return (
                          <div key={folderKey} className="border border-gray-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900/50 overflow-hidden">
                              <div className="p-2 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => toggleFolder(folderKey)}>
                                <div className="flex items-center gap-2">{isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<FolderOpen size={14} className="text-primary-500"/><span className="text-xs font-bold truncate max-w-[100px] text-gray-700 dark:text-slate-300">{name}</span><span className="text-[10px] text-gray-500 dark:text-slate-500">({fArr.length})</span></div>
                                <div className="flex items-center gap-2">
                                   {folderUnprocessed > 0 && (<button onClick={(e) => { e.stopPropagation(); runProcessing({ type: 'FOLDER', value: folderKey }); }} className="p-1 text-gray-400 hover:text-green-500"><Play size={12} fill="currentColor"/></button>)}
                                   <button onClick={(e) => { e.stopPropagation(); if(confirm(`Apagar pasta ${name}?`)) setEvidenceFiles(prev => prev.filter(f => !(f.category === category && f.folder === name))); }} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12}/></button>
                                </div>
                              </div>
                              {isExpanded && <div className="p-2 bg-gray-50 dark:bg-slate-950/50 border-t border-gray-200 dark:border-slate-800">{fArr.map(renderFileCard)}</div>}
                          </div>
                      );
                  })}
              </div>
              {files.length > 0 && (
                 <button onClick={() => runProcessing({ type: 'CATEGORY', value: category })} disabled={unprocessed === 0 || processingQueue.length > 0} className="w-full py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-bold disabled:bg-gray-300 dark:disabled:bg-slate-800 disabled:text-gray-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary-900/20">
                   {processingQueue.length > 0 ? <Loader2 size={14} className="animate-spin"/> : <Layers size={14}/>} Processar ({unprocessed})
                 </button>
              )}
          </div>
      );
  };

  const currentReport = project.savedReports.find(r => r.id === selectedReportId) || project.savedReports[0];

  if (currentView === 'landing') return (
    <div className="h-full flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-100 via-gray-50 to-white dark:from-slate-900 dark:via-slate-950 transition-colors">
        <div className="max-w-4xl w-full text-center space-y-8 animate-in fade-in zoom-in duration-500 flex flex-col items-center">
            <div className="w-20 h-20 bg-primary-600 rounded-3xl flex items-center justify-center shadow-2xl mb-2"><Database size={40} className="text-white"/></div>
            <div><h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Veritas V2.2</h1><p className="text-gray-500 dark:text-slate-400">Sistema de Análise Forense Multimodal</p></div>
            <div className="flex gap-12 py-4 border-y border-gray-200 dark:border-slate-800 w-full justify-center max-w-lg">
                <div className="flex flex-col items-center"><span className="text-3xl font-bold dark:text-white">{evidenceFiles.length}</span><span className="text-xs uppercase text-gray-500">Ficheiros</span></div>
                <div className="flex flex-col items-center"><span className="text-3xl font-bold dark:text-white">{project.people.length}</span><span className="text-xs uppercase text-gray-500">Pessoas</span></div>
                <div className="flex flex-col items-center"><span className="text-3xl font-bold dark:text-white">{project.facts.length}</span><span className="text-xs uppercase text-gray-500">Factos</span></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-8 w-full max-w-2xl">
                <button onClick={() => projectInputRef.current?.click()} className="p-5 bg-white dark:bg-slate-900 hover:bg-gray-50 border border-gray-200 dark:border-slate-800 rounded-2xl flex items-center gap-4 cursor-pointer shadow-sm group transition-all text-left">
                  <FileText size={20} className="text-green-600"/><div className="text-left"><h3 className="font-bold text-sm dark:text-white">Carregar Projeto</h3><p className="text-[10px] text-gray-500">veritas_projeto.json</p></div>
                </button>
                <button onClick={() => databaseInputRef.current?.click()} className="p-5 bg-white dark:bg-slate-900 hover:bg-gray-50 border border-gray-200 dark:border-slate-800 rounded-2xl flex items-center gap-4 cursor-pointer shadow-sm group transition-all text-left">
                  <Database size={20} className="text-blue-600"/><div className="text-left"><h3 className="font-bold text-sm dark:text-white">Carregar Base de Dados</h3><p className="text-[10px] text-gray-500">veritas_base_dados.json</p></div>
                </button>
                <button onClick={() => setCurrentView('setup')} className="col-span-2 p-4 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 mt-4 hover:scale-[1.02] transition-all uppercase tracking-wider">Iniciar Aplicação <ChevronRight size={20}/></button>
            </div>
        </div>
        <input type="file" ref={projectInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
        <input type="file" ref={databaseInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-200 overflow-hidden transition-colors">
        {/* SIDEBAR */}
        <aside className="w-24 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col items-center py-6 z-20 shrink-0 shadow-sm custom-scrollbar overflow-y-auto">
            <div onClick={() => setCurrentView('landing')} className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center font-bold text-white cursor-pointer shadow-lg mb-8 shrink-0">V2</div>
            <nav className="flex flex-col gap-6 w-full px-2 items-center">
                {[{id:'setup',icon:LayoutGrid, label:'DADOS'},{id:'people',icon:Users, label:'PESSOAS'},{id:'library',icon:Library, label:'BIBLIOTECA'},{id:'analysis',icon:FileText, label:'RELATÓRIO'},{id:'chat',icon:MessageSquare, label:'CHAT'}].map(item => (
                    <button key={item.id} onClick={() => setCurrentView(item.id as View)} className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all ${currentView === item.id ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
                      <item.icon size={22}/>
                      <span className="text-[9px] font-bold uppercase tracking-tight">{item.label}</span>
                    </button>
                ))}
            </nav>
            <div className="w-10 h-px bg-gray-200 dark:bg-slate-800 my-6"></div>
            <div className="flex flex-col gap-5 w-full items-center">
                <button onClick={() => setIsDarkMode(!isDarkMode)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-primary-600 transition-colors">{isDarkMode ? <Sun size={18}/> : <Moon size={18}/>}</button>
                <button onClick={generateDocumentation} className="flex flex-col items-center gap-1 text-gray-400 hover:text-purple-600 transition-colors"><HelpCircle size={18}/><span className="text-[8px] font-bold uppercase">Manual</span></button>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1">Projeto</span>
                  <button onClick={() => projectInputRef.current?.click()} className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors"><ArrowUp size={18}/><span className="text-[8px] font-bold uppercase">Carregar</span></button>
                  <button onClick={() => saveProjectFile(project)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors"><ArrowDown size={18}/><span className="text-[8px] font-bold uppercase">Guardar</span></button>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1">Base Dados</span>
                  <button onClick={() => databaseInputRef.current?.click()} className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors"><ArrowUp size={18}/><span className="text-[8px] font-bold uppercase">Carregar</span></button>
                  <button onClick={() => saveDatabaseFile(project, evidenceFiles)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors"><ArrowDown size={18}/><span className="text-[8px] font-bold uppercase">Guardar</span></button>
                </div>
                <div className="w-10 h-px bg-gray-200 dark:bg-slate-800 my-4"></div>
                <button onClick={() => { if(confirm("Limpar tudo?")) { setProject(initialProjectState); setEvidenceFiles([]); } }} className="flex flex-col items-center gap-1 text-gray-400 hover:text-emerald-500 transition-colors"><Plus size={20}/><span className="text-[8px] font-bold uppercase">Novo</span></button>
                <button onClick={() => window.location.reload()} className="flex flex-col items-center gap-1 text-gray-400 hover:text-red-600 mt-2 transition-colors"><LogOut size={18}/><span className="text-[8px] font-bold uppercase">Sair</span></button>
            </div>
            <input type="file" ref={projectInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
            <input type="file" ref={databaseInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden relative">
            <header className="h-16 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 backdrop-blur flex items-center px-8 justify-between shrink-0 z-10 text-left">
                <h1 className="text-lg font-bold text-gray-800 dark:text-white uppercase tracking-tight">
                    {currentView === 'setup' && 'Gestão de Evidências e Factos'}
                    {currentView === 'people' && 'Gestão de Pessoas'}
                    {currentView === 'analysis' && 'Relatórios Forenses'}
                    {currentView === 'chat' && 'Assistente IA'}
                    {currentView === 'library' && 'Biblioteca de Áudio'}
                </h1>
                <div className="flex gap-4 text-[10px] font-mono text-gray-500 uppercase">
                    <span>Ficheiros: {evidenceFiles.length}</span>
                    <span>Relatórios: {project.savedReports.length}</span>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 bg-gray-50 dark:bg-slate-950">
                {currentView === 'setup' && (
                    <div className="max-w-7xl mx-auto space-y-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {renderUploadSection("Depoimentos", 'TESTIMONY', <Mic className="text-blue-500"/>, "Áudios e Transcrições.")}
                            {renderUploadSection("Autos de Inquirição", 'INQUIRY', <Gavel className="text-red-500"/>, "PDFs dos Autos.")}
                            {renderUploadSection("Outros Documentos", 'OTHER', <Paperclip className="text-yellow-500"/>, "Anexos e Fotos.")}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-8 border-t border-gray-200 dark:border-slate-800">
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm text-left">
                                <h3 className="font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2"><CheckCircle2 className="text-primary-500"/> Factos a Provar</h3>
                                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                    {project.facts.map((fact, idx) => (
                                        <div key={fact.id} className="flex gap-4 group">
                                            <span className="text-[10px] font-mono text-gray-400 mt-4">#{idx+1}</span>
                                            <textarea value={fact.text} onChange={(e) => setProject(p => ({ ...p, facts: p.facts.map(f => f.id === fact.id ? { ...f, text: e.target.value } : f) }))} className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl p-4 text-sm focus:border-primary-500 outline-none resize-none h-24 shadow-inner dark:text-slate-300" placeholder="Insira o facto..."/>
                                            <button onClick={() => setProject(p => ({ ...p, facts: p.facts.filter(f => f.id !== fact.id) }))} className="self-center p-2 text-gray-300 hover:text-red-500"><Trash2 size={18}/></button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setProject(p => ({ ...p, facts: [...p.facts, { id: Math.random().toString(36), text: "" }] }))} className="mt-6 text-xs text-primary-600 font-bold uppercase hover:text-primary-700 flex items-center gap-2"><Plus size={16}/> Adicionar Facto</button>
                            </div>
                            <div className="flex flex-col justify-center items-center p-12 border-2 border-dashed border-gray-300 dark:border-slate-800 rounded-3xl bg-white/50 dark:bg-slate-900/20 text-center">
                                <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center text-primary-600 mb-6 shadow-xl"><PlayCircle size={32}/></div>
                                <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-3">Análise Cruzada V2.2</h3>
                                <p className="text-sm text-gray-500 text-center mb-8 max-w-sm">O sistema irá cruzar Depoimentos, Autos e Documentos respeitando as categorias. (Limite 90MB por ficheiro)</p>
                                <button onClick={runAnalysis} disabled={isAnalyzing} className="px-10 py-4 bg-primary-600 hover:bg-primary-500 text-white rounded-full font-bold shadow-2xl transition-all disabled:opacity-50 flex items-center gap-3">
                                    {isAnalyzing ? <Loader2 className="animate-spin"/> : "Gerar Novo Relatório"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {currentView === 'people' && (
                    <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm text-left">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900 dark:text-white"><Users className="text-primary-500"/> Intervenientes</h3>
                            <div className="space-y-4 mb-8">
                                {project.people.map(person => (
                                    <div key={person.id} className="flex gap-4 items-center bg-gray-50 dark:bg-slate-950 p-4 rounded-xl border border-gray-200 dark:border-slate-800 group">
                                        <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600"><User size={20}/></div>
                                        <div className="flex-1 grid grid-cols-2 gap-4">
                                            <input value={person.name} onChange={e => setProject(p => ({ ...p, people: p.people.map(ps => ps.id === person.id ? { ...ps, name: e.target.value } : ps) }))} className="bg-transparent font-bold text-sm outline-none border-b border-transparent focus:border-primary-500" placeholder="Nome Completo"/>
                                            <input value={person.role || ""} onChange={e => setProject(p => ({ ...p, people: p.people.map(ps => ps.id === person.id ? { ...ps, role: e.target.value } : ps) }))} className="bg-transparent text-sm outline-none border-b border-transparent focus:border-primary-500" placeholder="Cargo/Papel (Ex: Testemunha)"/>
                                        </div>
                                        <button onClick={() => setProject(p => ({ ...p, people: p.people.filter(ps => ps.id !== person.id) }))} className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={18}/></button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => setProject(p => ({ ...p, people: [...p.people, { id: Math.random().toString(36), name: "", role: "" }] }))} className="flex items-center gap-2 text-sm font-bold text-primary-600 uppercase tracking-wider"><Plus size={16}/> Adicionar Pessoa</button>
                        </div>
                    </div>
                )}

                {currentView === 'library' && (
                    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
                        <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-4 rounded-2xl border border-gray-200 dark:border-slate-800 gap-4">
                            <div className="relative flex-1 max-w-md">
                                <SearchIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                                <input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl py-2 pl-10 pr-4 outline-none focus:border-primary-500 text-sm" placeholder="Pesquisar áudios..."/>
                            </div>
                            {project.processedData.length > 0 && (
                                <button 
                                    onClick={() => exportTranscriptsToWord(project.processedData, "Consolidado_Veritas")}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg transition-all shrink-0"
                                >
                                    <Download size={14}/> Exportar Tudo (.doc)
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {evidenceFiles.filter(f => f.type === 'AUDIO' && f.name.toLowerCase().includes(librarySearch.toLowerCase())).map(file => {
                                const processed = project.processedData.find(pd => pd.fileId === file.id);
                                return (
                                    <div key={file.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all group cursor-pointer text-left" onClick={() => setActiveEvidenceId(file.id)}>
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="w-12 h-12 bg-blue-50 dark:bg-primary-900/20 rounded-xl flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform"><FileAudio size={24}/></div>
                                            {processed && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); exportTranscriptsToWord([processed], `Transcrição_${file.name}`); }}
                                                    className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-primary-400 transition-colors bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm"
                                                    title="Exportar transcrição para Word"
                                                >
                                                    <FileText size={16}/>
                                                </button>
                                            )}
                                        </div>
                                        <h3 className="font-bold text-gray-800 dark:text-white truncate" title={file.name}>{file.name}</h3>
                                        <div className="mt-4 flex items-center justify-between">
                                            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">{processed ? 'Processado' : 'Pendente'}</span>
                                            <button className="p-2 bg-primary-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all"><Play size={16} fill="currentColor"/></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {currentView === 'analysis' && (
                    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8 h-full animate-in fade-in duration-500 text-left">
                        <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col shadow-sm">
                            <div className="p-4 bg-gray-50 dark:bg-slate-950 font-bold text-xs uppercase text-gray-500 border-b dark:border-slate-800">Relatórios Salvos</div>
                            <div className="flex-1 overflow-y-auto">
                                {project.savedReports.map(report => (
                                    <div key={report.id} onClick={() => setSelectedReportId(report.id)} className={`p-4 border-b dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 transition-all ${selectedReportId === report.id ? 'bg-primary-50 dark:bg-primary-900/10 border-l-4 border-l-primary-500' : ''}`}>
                                        <div className="font-bold text-sm text-gray-900 dark:text-white truncate">{report.name}</div>
                                        <div className="text-[10px] text-gray-400 mt-1">{new Date(report.generatedAt).toLocaleString()}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="lg:col-span-3 h-full overflow-y-auto custom-scrollbar">
                            {currentReport ? (
                                <div className="bg-white dark:bg-slate-900 p-10 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm space-y-8">
                                    <div className="flex justify-between items-start border-b border-gray-100 dark:border-slate-800 pb-6">
                                        <div>
                                            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-2">{currentReport.name}</h2>
                                            <p className="text-xs text-gray-500 uppercase tracking-widest">Gerado em {new Date(currentReport.generatedAt).toLocaleString()}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => exportToWord(currentReport, currentReport.name)} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-500 shadow-lg transition-all"><Download size={14}/> Word</button>
                                        </div>
                                    </div>
                                    <section>
                                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-800 dark:text-white"><BrainCircuit className="text-primary-500"/> Parecer Geral</h3>
                                        <div className="p-6 bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-100 dark:border-slate-800 text-sm leading-relaxed text-gray-700 dark:text-slate-300 italic">"{currentReport.generalConclusion}"</div>
                                    </section>
                                    <section className="space-y-6">
                                        <h3 className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-white"><CheckCircle2 className="text-green-500"/> Verificação de Factos</h3>
                                        {currentReport.results.map((res, i) => (
                                            <div key={i} className="p-6 bg-white dark:bg-slate-925 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow text-left">
                                                <div className="flex justify-between items-start mb-4">
                                                    <h4 className="font-bold text-sm text-gray-900 dark:text-white flex-1 mr-4">#{i+1}: {res.factText}</h4>
                                                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${res.status === FactStatus.CONFIRMED ? 'bg-green-100 text-green-700' : res.status === FactStatus.DENIED ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{res.status}</span>
                                                </div>
                                                <p className="text-sm text-gray-600 dark:text-slate-400 mb-6 leading-relaxed">{res.summary}</p>
                                                {res.citations && res.citations.length > 0 && (
                                                    <div className="space-y-2 border-t border-gray-50 dark:border-slate-800 pt-4">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Evidências Diretas:</span>
                                                        <div className="flex flex-wrap gap-2">
                                                            {res.citations.map((cit, ci) => {
                                                                const file = evidenceFiles.find(f => f.id === cit.fileId);
                                                                const isAudio = file?.type === 'AUDIO';
                                                                return (
                                                                    <button 
                                                                        key={ci} 
                                                                        onClick={() => { 
                                                                            if (isAudio) {
                                                                                setActiveEvidenceId(cit.fileId); 
                                                                                setSeekSeconds(cit.seconds); 
                                                                            } else {
                                                                                handleOpenOriginal(cit.fileId, cit.seconds);
                                                                            }
                                                                        }} 
                                                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors border shadow-sm
                                                                            ${isAudio 
                                                                                ? 'bg-blue-50 dark:bg-primary-900/20 text-blue-600 dark:text-primary-400 border-blue-100 dark:border-primary-800 hover:bg-blue-100' 
                                                                                : 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-800 hover:bg-orange-100'}`}
                                                                    >
                                                                        {isAudio ? <Play size={10} fill="currentColor"/> : <BookOpen size={10}/>}
                                                                        {cit.fileName} @ {cit.timestamp}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </section>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4"><Database size={48} className="opacity-20"/><p>Selecione um relatório para visualizar ou gere um novo no separador Dados.</p></div>
                            )}
                        </div>
                    </div>
                )}

                {currentView === 'chat' && (
                    <div className="h-full flex flex-col animate-in fade-in duration-500">
                        <div className="flex-1 overflow-y-auto space-y-6 pb-12 custom-scrollbar px-12">
                            {project.chatHistory.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
                                    <MessageSquare size={64}/>
                                    <div><h3 className="font-bold">Assistente Forense Veritas</h3><p className="text-sm">Faça perguntas sobre os depoimentos e provas.</p></div>
                                </div>
                            )}
                            {project.chatHistory.map(msg => (
                                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                                    <div className={`max-w-[85%] rounded-3xl p-5 shadow-sm text-sm ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-800 rounded-tl-none'}`}>
                                        <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest opacity-60">
                                            {msg.role === 'user' ? <User size={12}/> : <BrainCircuit size={12}/>}
                                            {msg.role === 'user' ? 'Utilizador' : 'Veritas AI'}
                                        </div>
                                        {renderMessageContent(msg.text)}
                                        <div className="mt-2 text-[8px] opacity-40 text-right">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                                    </div>
                                </div>
                            ))}
                            {isChatting && (
                                <div className="flex justify-start"><div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-gray-200 dark:border-slate-800 flex items-center gap-2"><Loader2 size={16} className="animate-spin text-primary-500"/><span className="text-xs text-gray-500 italic">Analisando provas...</span></div></div>
                            )}
                            <div ref={chatEndRef}/>
                        </div>
                        <div className="h-24 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 flex items-center px-8 gap-4 relative">
                            <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-t from-gray-50 dark:from-slate-950 to-transparent pointer-events-none"></div>
                            <div className="flex-1 bg-gray-100 dark:bg-slate-950 rounded-2xl border border-gray-200 dark:border-slate-800 flex items-center px-4 gap-2 focus-within:border-primary-500 transition-colors">
                                <Paperclip size={18} className="text-gray-400 cursor-pointer hover:text-primary-500"/>
                                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} className="flex-1 bg-transparent py-4 text-sm outline-none text-gray-800 dark:text-slate-200" placeholder="Pergunte algo sobre o caso..."/>
                                <button onClick={handleChat} disabled={isChatting || !chatInput.trim()} className="p-2 bg-primary-600 text-white rounded-xl hover:bg-primary-500 disabled:opacity-30 transition-all"><ArrowUp size={20}/></button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>

        {activeEvidenceId && (
            <EvidenceViewer 
                file={evidenceFiles.find(f => f.id === activeEvidenceId) || null}
                processedData={project.processedData.find(pd => pd.fileId === activeEvidenceId)}
                initialSeekSeconds={seekSeconds}
                onClose={() => { setActiveEvidenceId(null); setSeekSeconds(null); }}
                onRenameSpeaker={handleRenameSpeaker}
            />
        )}
        
        {isManualImportOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl w-full max-w-2xl border border-gray-200 dark:border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Importar Texto Manualmente</h3>
                    <input className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 p-3 rounded-lg text-gray-900 dark:text-white mb-4 outline-none focus:border-primary-500" placeholder="Nome do Documento / Depoimento" value={manualName} onChange={e => setManualName(e.target.value)} />
                    <textarea className="w-full h-64 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg p-3 text-sm text-gray-800 dark:text-slate-300 outline-none focus:border-primary-500 resize-none" placeholder="Cole o texto aqui..." value={manualText} onChange={e => setManualText(e.target.value)}/>
                    <div className="flex justify-end gap-2 mt-4">
                        <button onClick={() => setIsManualImportOpen(false)} className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 text-sm font-bold uppercase tracking-wide">Cancelar</button>
                        <button onClick={() => {
                          if (!manualName || !manualText) return;
                          const id = Math.random().toString(36).substr(2, 9);
                          const newFile: EvidenceFile = { id, file: null, name: manualName, type: 'TEXT', category: 'TESTIMONY', isVirtual: true, folder: 'Manual' };
                          setEvidenceFiles(prev => [...prev, newFile]);
                          const segments = sanitizeTranscript(manualText);
                          const processed: ProcessedContent = { fileId: id, fileName: manualName, fullText: segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n'), segments: segments, processedAt: Date.now() };
                          setProject(prev => ({ ...prev, processedData: [...prev.processedData, processed] }));
                          setIsManualImportOpen(false); setManualName(""); setManualText("");
                        }} className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-bold shadow-lg uppercase tracking-wide">Importar</button>
                    </div>
                </div>
            </div>
        )}

        {showQuotaModal && (
            <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                 <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl max-sm text-center shadow-2xl border border-gray-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
                     <AlertTriangle size={48} className="mx-auto mb-4 text-amber-500"/>
                     <h3 className="text-xl font-bold mb-2 dark:text-white">Limite de Quota Atingido</h3>
                     <p className="text-sm text-gray-500 dark:text-slate-400 mb-6 leading-relaxed">Aguarde <strong>1 minuto</strong> antes de continuar o processamento.</p>
                     <button onClick={() => setShowQuotaModal(false)} className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold shadow-lg uppercase tracking-wider">Entendido</button>
                 </div>
            </div>
        )}
    </div>
  );
};

export default App;
