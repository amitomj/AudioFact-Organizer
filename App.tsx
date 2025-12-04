import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  MessageSquare, 
  PlayCircle, 
  Save, 
  FolderOpen, 
  Plus, 
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  FileAudio,
  BrainCircuit,
  Database,
  Download,
  FileJson,
  XCircle,
  History,
  ChevronRight,
  Edit2,
  Check,
  X,
  Eraser,
  Key,
  ExternalLink
} from 'lucide-react';
import { AudioFile, Fact, ProjectState, SerializedProject, SerializedDatabase, ChatMessage, Citation, Transcription, AnalysisReport } from './types';
import { transcribeAudio, analyzeFactsFromTranscripts, chatWithTranscripts } from './services/geminiService';
import { exportToWord, saveProjectFile, saveDatabaseFile } from './utils/exportService';
import AudioPlayer from './components/AudioPlayer';

// Initial State
const initialProjectState: ProjectState = {
  facts: [],
  transcriptions: [],
  analysis: null,
  analysisHistory: [],
  chatHistory: [],
  lastModified: Date.now(),
};

type View = 'setup' | 'analysis' | 'chat';

const App: React.FC = () => {
  // --- Auth State ---
  const [apiKey, setApiKey] = useState<string>("");
  const [tempApiKey, setTempApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);

  // Application State
  const [currentView, setCurrentView] = useState<View>('setup');
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [project, setProject] = useState<ProjectState>(initialProjectState);
  
  // Processing States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]); // Array of AudioFile IDs currently processing
  
  // Audio Player State
  const [activeAudioFile, setActiveAudioFile] = useState<AudioFile | null>(null);
  const [seekTimestamp, setSeekTimestamp] = useState<number | null>(null);

  // Missing files restoration state
  const [missingFiles, setMissingFiles] = useState<string[]>([]);
  const [isRestoring, setIsRestoring] = useState(false);

  // History Editing State
  const [editingAnalysisId, setEditingAnalysisId] = useState<string | null>(null);
  const [tempAnalysisName, setTempAnalysisName] = useState("");

  // --- Auth Logic ---
  useEffect(() => {
    const savedKey = localStorage.getItem("veritas_api_key");
    if (savedKey) {
        setApiKey(savedKey);
    }
  }, []);

  const handleLogin = () => {
      if (!tempApiKey.trim()) return alert("Por favor insira uma chave de API válida.");
      
      setApiKey(tempApiKey.trim());
      if (rememberKey) {
          localStorage.setItem("veritas_api_key", tempApiKey.trim());
      } else {
          localStorage.removeItem("veritas_api_key");
      }
  };

  const handleLogout = () => {
      setApiKey("");
      setTempApiKey("");
      localStorage.removeItem("veritas_api_key");
  };

  // --- File & Fact Management ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileList = Array.from(files);
      const newFiles: AudioFile[] = fileList.map((f: File) => ({
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        name: f.name
      }));
      setAudioFiles(prev => [...prev, ...newFiles]);
      
      // If we are restoring, check if these files match the missing ones
      if (isRestoring) {
        setMissingFiles(prev => prev.filter(name => !newFiles.find(nf => nf.name === name)));
      }
    }
  };

  const removeAudioFile = (id: string) => {
    setAudioFiles(prev => prev.filter(f => f.id !== id));
    // Also remove transcription if it exists for this file
    setProject(prev => ({
      ...prev,
      transcriptions: prev.transcriptions.filter(t => t.audioFileId !== id)
    }));
  };

  const addFact = () => {
    const newFact: Fact = { id: Math.random().toString(36).substr(2, 9), text: '' };
    setProject(prev => ({ ...prev, facts: [...prev.facts, newFact] }));
  };

  const updateFact = (id: string, text: string) => {
    setProject(prev => ({
      ...prev,
      facts: prev.facts.map(f => f.id === id ? { ...f, text } : f)
    }));
  };

  const removeFact = (id: string) => {
    setProject(prev => ({ ...prev, facts: prev.facts.filter(f => f.id !== id) }));
  };

  // --- Core Logic: Transcription & Analysis ---

  const processAudioFiles = async () => {
    if (!apiKey) return alert("Erro: Chave de API em falta.");

    const unprocessedFiles = audioFiles.filter(f => 
      !project.transcriptions.find(t => t.audioFileId === f.id || t.audioFileName === f.name)
    );
    
    if (unprocessedFiles.length === 0) {
      alert("Todos os ficheiros já foram processados.");
      return;
    }

    for (const file of unprocessedFiles) {
      setProcessingQueue(prev => [...prev, file.id]);
      try {
        const transcription = await transcribeAudio(apiKey, file);
        setProject(prev => ({
          ...prev,
          transcriptions: [...prev.transcriptions, transcription]
        }));
      } catch (error) {
        console.error(error);
        alert(`Erro ao processar ${file.name}. Verifique se o áudio é válido.`);
      } finally {
        setProcessingQueue(prev => prev.filter(id => id !== file.id));
      }
    }
  };

  const runAnalysis = async () => {
    if (!apiKey) return alert("Erro: Chave de API em falta.");
    if (project.transcriptions.length === 0) return alert("Processe os áudios primeiro para criar a base de dados.");
    if (project.facts.length === 0) return alert("Adicione pelo menos um facto.");
    if (project.facts.some(f => !f.text.trim())) return alert("Preencha todos os factos.");

    setIsAnalyzing(true);
    try {
      const report = await analyzeFactsFromTranscripts(apiKey, project.transcriptions, project.facts);
      
      setProject(prev => {
        const newHistory = [report, ...(prev.analysisHistory || [])];
        return {
           ...prev,
           analysis: report,
           analysisHistory: newHistory
        };
      });
      
      setCurrentView('analysis');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- History Management ---

  const switchAnalysisVersion = (reportId: string) => {
      const selected = project.analysisHistory.find(r => r.id === reportId);
      if (selected) {
          setProject(prev => ({ ...prev, analysis: selected }));
      }
  };

  const deleteAnalysis = (e: React.MouseEvent, reportId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("Tem a certeza que deseja eliminar esta análise do histórico?")) {
        setProject(prev => {
            const newHistory = prev.analysisHistory.filter(r => r.id !== reportId);
            let newActive = prev.analysis;
            if (prev.analysis && prev.analysis.id === reportId) {
                newActive = newHistory.length > 0 ? newHistory[0] : null;
            }
            return {
                ...prev,
                analysisHistory: newHistory,
                analysis: newActive
            };
        });
    }
  };

  const startRenaming = (e: React.MouseEvent, report: AnalysisReport) => {
      e.stopPropagation();
      setEditingAnalysisId(report.id);
      setTempAnalysisName(report.name || `Versão ${report.id}`);
  };

  const saveRenaming = (e: React.MouseEvent, reportId: string) => {
      e.stopPropagation();
      if (!tempAnalysisName.trim()) return;

      setProject(prev => {
          const newHistory = prev.analysisHistory.map(r => 
              r.id === reportId ? { ...r, name: tempAnalysisName } : r
          );
          const newActive = prev.analysis && prev.analysis.id === reportId 
              ? { ...prev.analysis, name: tempAnalysisName } 
              : prev.analysis;

          return {
              ...prev,
              analysisHistory: newHistory,
              analysis: newActive
          };
      });
      setEditingAnalysisId(null);
  };

  const cancelRenaming = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingAnalysisId(null);
  };

  // --- Import / Export Logic ---

  const loadDatabaseData = (data: SerializedDatabase | any) => {
    const newTranscripts = data.transcriptions || [];
    setProject(prev => {
       const existingNames = new Set(prev.transcriptions.map(t => t.audioFileName));
       const uniqueNewTranscripts = newTranscripts.filter((t: Transcription) => !existingNames.has(t.audioFileName));
       return {
         ...prev,
         transcriptions: [...prev.transcriptions, ...uniqueNewTranscripts]
       };
    });

    const allFileNames = new Set([...missingFiles, ...(data.audioFileNames || [])]);
    const currentlyLoadedNames = new Set(audioFiles.map(f => f.name));
    const needed = Array.from(allFileNames).filter(name => !currentlyLoadedNames.has(name));
    
    setMissingFiles(needed);
    if (needed.length > 0) setIsRestoring(true);

    return `Base de Dados carregada! ${newTranscripts.length} depoimentos disponíveis.`;
  };

  const loadProjectData = (data: SerializedProject | any) => {
    const loadedAnalysis = data.analysis || null;
    let loadedHistory = data.analysisHistory || [];
    if (loadedAnalysis && loadedHistory.length === 0) {
        loadedHistory = [loadedAnalysis];
    }

    setProject(prev => ({
      ...prev,
      facts: data.facts || [],
      analysis: loadedAnalysis,
      analysisHistory: loadedHistory,
      chatHistory: data.chatHistory || [],
      lastModified: Date.now()
    }));
    return "Projeto carregado com sucesso!";
  };

  const handleSmartUpload = (e: React.ChangeEvent<HTMLInputElement>, origin: 'database_btn' | 'project_btn') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        let message = "";

        if (json.type === 'project') {
           message = loadProjectData(json);
           if (origin === 'database_btn') message += "\n(Nota: Ficheiro de Projeto detetado.)";
        } 
        else if (json.type === 'database') {
           message = loadDatabaseData(json);
           if (origin === 'project_btn') message += "\n(Nota: Ficheiro de Base de Dados detetado.)";
        }
        else {
           let loadedSomething = false;
           if (Array.isArray(json.transcriptions)) { loadDatabaseData(json); loadedSomething = true; }
           if (Array.isArray(json.facts)) { loadProjectData(json); loadedSomething = true; }
           if (!loadedSomething) throw new Error("Ficheiro inválido.");
           message = "Ficheiro legado carregado.";
        }
        alert(message);
      } catch (err: any) {
        console.error(err);
        alert(err.message || "Erro ao ler ficheiro.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const playCitation = (citation: Citation) => {
    setSeekTimestamp(null); // Reset trigger
    let file = audioFiles.find(f => f.id === citation.audioFileId);
    if (!file) {
        file = audioFiles.find(f => f.name.toLowerCase() === citation.audioFileName.toLowerCase());
    }
    
    if (file) {
      setActiveAudioFile(file);
      setTimeout(() => {
          setSeekTimestamp(citation.seconds);
      }, 50);
    } else {
      alert(`Ficheiro de áudio "${citation.audioFileName}" não encontrado. Por favor carregue-o novamente.`);
    }
  };

  // --- Chat Logic ---
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    if (!apiKey) return alert("Chave de API em falta.");
    if (project.transcriptions.length === 0) {
      alert("Carregue dados ou processe áudios primeiro.");
      return;
    }

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: chatInput,
      timestamp: Date.now()
    };

    setProject(prev => ({ ...prev, chatHistory: [...prev.chatHistory, newMessage] }));
    setChatInput('');
    setIsChatting(true);

    try {
      const responseText = await chatWithTranscripts(apiKey, project.transcriptions, [...project.chatHistory, newMessage], newMessage.text);
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      setProject(prev => ({ ...prev, chatHistory: [...prev.chatHistory, aiMessage] }));
    } catch (error) {
      alert("Erro no chat.");
    } finally {
      setIsChatting(false);
    }
  };

  const clearChatHistory = () => {
    if (project.chatHistory.length === 0) return;
    if (confirm("Apagar todo o histórico de conversação?")) {
      setProject(prev => ({ ...prev, chatHistory: [] }));
    }
  };

  const deleteChatMessage = (id: string) => {
    setProject(prev => ({ 
      ...prev, 
      chatHistory: prev.chatHistory.filter(msg => msg.id !== id) 
    }));
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [project.chatHistory, currentView]);

  // --- Message Content Renderer ---
  const renderMessageContent = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    
    return lines.map((line, index) => {
        // Regex handles loose formatting: [File @ 00:00]
        const match = line.match(/\[?([^\[\]\n]+?)\s*@\s*(\d{1,2}:\d{2})\]?/);
        
        if (match) {
            const rawFileName = match[1];
            const fileName = rawFileName.replace(/^[\[\s]+|[\]\s]+$/g, '').trim();
            const timestamp = match[2].trim();
            
            let content = "Texto não disponível."; 
            
            const parts = timestamp.split(':');
            const seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);

            // --- SOURCE OF TRUTH + 8 SENTENCES EXPANSION ---
            const transcript = project.transcriptions.find(t => 
                t.audioFileName.toLowerCase().replace(/\.(mp3|wav|m4a)$/, '').trim() === 
                fileName.toLowerCase().replace(/\.(mp3|wav|m4a)$/, '').trim()
            );
            
            if (transcript) {
                // Find closest segment
                const closestSegment = transcript.segments.reduce((prev, curr) => {
                     const diffCurr = Math.abs(curr.seconds - seconds);
                     const diffPrev = Math.abs(prev.seconds - seconds);
                     // Allow 10s variance
                     if (diffCurr < 10) return curr;
                     return diffCurr < diffPrev ? curr : prev;
                }, transcript.segments[0]);

                if (closestSegment) {
                    let expandedText = closestSegment.text || "";
                    // Count sentences using basic punctuation check
                    let sentenceCount = (expandedText.match(/[.!?]+/g) || []).length;
                    const startIndex = transcript.segments.indexOf(closestSegment);
                    let nextIdx = startIndex + 1;
                    
                    while (sentenceCount < 8 && nextIdx < transcript.segments.length) {
                         const nextSeg = transcript.segments[nextIdx];
                         if (nextSeg && nextSeg.text) {
                            expandedText += " " + nextSeg.text;
                            sentenceCount = (expandedText.match(/[.!?]+/g) || []).length;
                         }
                         nextIdx++;
                    }
                    
                    // CLEAN LOOPS ON DISPLAY
                    const loopRegex = /\b(\w+)(?:[\s,.]+\1\b){3,}/gi;
                    expandedText = expandedText.replace(loopRegex, '$1');
                    const phraseLoopRegex = /(.{5,50}?)(?:[\s,.]+\1){3,}/gi;
                    expandedText = expandedText.replace(phraseLoopRegex, '$1');

                    // FORMAT DIALOGUE (Visual Only)
                    expandedText = expandedText.replace(/([.!?])\s+([-–—])\s*/g, "$1\n$2 ");
                    expandedText = expandedText.replace(/([.!?])\s+([A-ZÀ-Ú][a-zçáéíóúâêôãõ]+:)/g, "$1\n$2");

                    content = expandedText;
                }
            } else {
                content = `Transcrição de "${fileName}" não encontrada na Base de Dados.`;
            }

            return (
                <div key={index} className="mt-3 mb-3 pl-4 border-l-2 border-slate-700/50">
                     <div className="flex gap-3 group items-start">
                        <button 
                            onClick={() => {
                               playCitation({
                                   audioFileId: 'unknown',
                                   audioFileName: fileName,
                                   timestamp: timestamp,
                                   seconds: seconds,
                                   text: content
                               });
                            }}
                            className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-primary-400 hover:bg-primary-600 hover:text-white transition-all shadow-sm"
                            title="Reproduzir trecho"
                        >
                            <PlayCircle size={14} fill="currentColor" className="opacity-80" />
                        </button>
                        <div className="text-sm">
                            <div className="text-slate-300 italic mb-1 whitespace-pre-wrap leading-relaxed">
                                "{content}"
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-primary-300 bg-primary-900/30 px-2 py-0.5 rounded border border-primary-900/50">
                                {fileName}
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">@ {timestamp}</span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (!line.trim()) return <br key={index} />;
        return <p key={index} className="mb-1 last:mb-0">{line}</p>;
    });
  };

  // --- Render Functions ---

  const renderApiKeyModal = () => (
      <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 max-w-md w-full">
              <div className="flex flex-col items-center mb-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center font-bold text-2xl shadow-lg shadow-primary-900/20 text-white mb-4">V</div>
                  <h1 className="text-2xl font-bold text-white">Veritas Audio Analyst</h1>
                  <p className="text-slate-400 text-sm mt-1">Insira a sua chave de API para começar</p>
              </div>

              <div className="space-y-4">
                  <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Google Gemini API Key</label>
                      <div className="relative">
                          <input 
                              type="password"
                              value={tempApiKey}
                              onChange={(e) => setTempApiKey(e.target.value)}
                              placeholder="Cole a sua chave aqui..."
                              className="w-full p-3 pl-10 bg-slate-950 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                          />
                          <Key size={16} className="absolute left-3 top-3.5 text-slate-600" />
                      </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer group">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${rememberKey ? 'bg-primary-600 border-primary-600' : 'border-slate-600 bg-transparent'}`}>
                          {rememberKey && <Check size={12} className="text-white" />}
                      </div>
                      <input type="checkbox" className="hidden" checked={rememberKey} onChange={(e) => setRememberKey(e.target.checked)} />
                      <span className="text-sm text-slate-400 group-hover:text-slate-300">Lembrar neste navegador</span>
                  </label>

                  <button 
                      onClick={handleLogin}
                      className="w-full py-3 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl shadow-lg shadow-primary-900/20 transition-all transform active:scale-95"
                  >
                      Entrar
                  </button>

                  <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
                      <div className="relative flex justify-center"><span className="bg-slate-900 px-2 text-xs text-slate-600">ou</span></div>
                  </div>

                  <a 
                      href="https://aistudio.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-xl text-slate-300 text-sm font-medium transition-colors"
                  >
                      <ExternalLink size={16} /> Obter chave gratuita (Google AI Studio)
                  </a>
              </div>
          </div>
      </div>
  );

  const renderSetup = () => {
    const unprocCount = audioFiles.filter(f => 
        !project.transcriptions.find(t => t.audioFileId === f.id || t.audioFileName === f.name)
    ).length;
    const isProcessing = processingQueue.length > 0;

    return (
      <div className="space-y-8 max-w-5xl mx-auto pb-20">
        <div className="bg-slate-900 p-6 rounded-2xl shadow-lg border border-slate-800">
          <h2 className="text-2xl font-bold text-white mb-2">Configuração do Projeto</h2>
          <p className="text-slate-400">
            Carregue áudios, processe transcrições e defina os factos a analisar.
          </p>
          {isRestoring && missingFiles.length > 0 && (
            <div className="mt-4 p-4 bg-orange-950/40 border border-orange-900 rounded-lg">
              <h3 className="font-bold text-orange-400 flex items-center gap-2">
                <AlertCircle size={18} /> Ficheiros em Falta
              </h3>
              <p className="text-sm text-orange-300/80 mt-1">
                Carregue os ficheiros originais para permitir a reprodução de áudio:
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                 {missingFiles.map(f => (
                     <span key={f} className="px-2 py-1 bg-orange-900/50 text-orange-200 text-xs rounded border border-orange-800 font-mono">
                        {f}
                     </span>
                 ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <FileAudio className="text-primary-500" /> Depoimentos
              </h3>
              <div className="flex gap-2">
                <span className="text-xs text-slate-400 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
                   BD: <span className="text-primary-400">{project.transcriptions.length}</span>
                </span>
                <span className="text-xs text-slate-400 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
                   Ficheiros: <span className="text-primary-400">{audioFiles.length}</span>
                </span>
              </div>
            </div>
            
            <div className="group relative border-2 border-dashed border-slate-700 bg-slate-900/50 rounded-2xl p-8 text-center hover:bg-slate-800 hover:border-primary-500/50 transition-all duration-300">
              <input 
                type="file" 
                multiple 
                accept="audio/*"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex flex-col items-center justify-center space-y-3">
                 <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="text-primary-500" size={24} />
                 </div>
                 <p className="text-slate-300 font-medium">Clique ou arraste áudios aqui</p>
              </div>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {audioFiles.map(file => {
                const isProcessed = project.transcriptions.some(t => t.audioFileId === file.id || t.audioFileName === file.name);
                const isProcessingThis = processingQueue.includes(file.id);

                return (
                  <div key={file.id} className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:border-slate-700 transition-colors group">
                    <div className="flex items-center gap-4 overflow-hidden">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isProcessed ? 'bg-green-900/20 text-green-500' : 'bg-slate-800 text-slate-500'}`}>
                        {isProcessingThis ? <Loader2 className="animate-spin" size={20} /> : isProcessed ? <CheckCircle2 size={20} /> : <FileAudio size={20} />}
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-sm font-medium text-slate-200 truncate">{file.name}</span>
                        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
                          {isProcessed ? 'Processado' : 'Não Processado'}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => removeAudioFile(file.id)} className="text-slate-600 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 size={18} />
                    </button>
                  </div>
                );
              })}
              {audioFiles.length === 0 && (
                  <div className="p-4 text-center text-sm text-slate-600 italic">Nenhum áudio carregado.</div>
              )}
            </div>

            <div className="pt-2">
              <button 
                onClick={processAudioFiles}
                disabled={isProcessing || unprocCount === 0}
                className={`w-full py-4 rounded-xl font-bold text-sm tracking-wide uppercase transition-all shadow-lg flex items-center justify-center gap-2
                  ${unprocCount > 0 
                    ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/20' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'}
                `}
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <BrainCircuit size={18} />}
                {isProcessing 
                  ? `A Processar (${processingQueue.length} fila)...` 
                  : unprocCount > 0 ? `Transcrever ${unprocCount} Novos` : 'Base de Dados Atualizada'
                }
              </button>
            </div>
          </div>

          <div className="space-y-4">
             <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <CheckCircle2 className="text-primary-500" /> Factos a Verificar
              </h3>
              <button onClick={addFact} className="text-sm text-primary-400 font-medium hover:text-primary-300 flex items-center gap-1 px-3 py-1 bg-primary-500/10 rounded-full border border-primary-500/20">
                <Plus size={14} /> Novo Facto
              </button>
            </div>

            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
              {project.facts.map((fact, index) => (
                <div key={fact.id} className="relative group">
                  <span className="absolute -left-3 top-3 text-[10px] font-bold text-slate-600 bg-slate-950 px-1">#{index + 1}</span>
                  <textarea
                    value={fact.text}
                    onChange={(e) => updateFact(fact.id, e.target.value)}
                    placeholder="Descreva o facto a ser verificado..."
                    className="w-full p-4 pl-6 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none resize-none h-24 text-sm leading-relaxed transition-all hover:bg-slate-800"
                  />
                  <button onClick={() => removeFact(fact.id)} className="absolute top-2 right-2 text-slate-500 hover:text-red-400 p-2 bg-slate-900/50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="flex justify-center pt-8 border-t border-slate-800/50 mt-8">
          <button 
            onClick={runAnalysis}
            disabled={isAnalyzing || isProcessing || project.transcriptions.length === 0}
            className="group relative bg-primary-600 text-white px-10 py-4 rounded-full font-bold shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] hover:bg-primary-500 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed flex items-center gap-3 transition-all transform hover:scale-105"
          >
            {isAnalyzing ? <Loader2 className="animate-spin" /> : <PlayCircle className="fill-current" />} 
            {isAnalyzing ? 'A Analisar Inteligência...' : 'Executar Análise Forense'}
          </button>
        </div>
      </div>
    );
  };

  const renderAnalysis = () => {
    const activeAnalysis = project.analysis || (project.analysisHistory.length > 0 ? project.analysisHistory[0] : null);

    if (!activeAnalysis) return <div className="text-center p-10 text-slate-500 mt-20 text-lg">Sem relatório disponível. Execute uma análise.</div>;

    return (
      <div className="flex gap-6 max-w-7xl mx-auto pb-32">
        <div className="w-64 flex-shrink-0 space-y-4">
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <History size={14} /> Histórico de Análises
            </h3>
            <div className="space-y-2">
                {project.analysisHistory.map((report, idx) => {
                    const isSelected = report.id === activeAnalysis.id;
                    const isEditing = editingAnalysisId === report.id;
                    const date = new Date(report.generatedAt);
                    
                    return (
                        <div
                            key={report.id}
                            className={`group relative w-full text-left p-3 rounded-xl border transition-all overflow-hidden cursor-pointer ${isSelected ? 'bg-slate-800 border-primary-500/50 text-white shadow-lg' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                            onClick={() => !isEditing && switchAnalysisVersion(report.id)}
                        >
                            {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-500"></div>}
                            
                            {isEditing ? (
                                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input 
                                        type="text" 
                                        value={tempAnalysisName}
                                        onChange={(e) => setTempAnalysisName(e.target.value)}
                                        className="w-full bg-slate-950 text-xs p-1 rounded border border-slate-700 text-white outline-none focus:border-primary-500"
                                        autoFocus
                                    />
                                    <button onClick={(e) => saveRenaming(e, report.id)} className="text-green-500 hover:text-green-400 p-1"><Check size={14} /></button>
                                    <button onClick={cancelRenaming} className="text-red-500 hover:text-red-400 p-1"><X size={14} /></button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex justify-between items-start pr-6">
                                        <div className="text-xs font-bold mb-1 truncate" title={report.name || `Versão #${idx}`}>
                                            {report.name || `Versão #${project.analysisHistory.length - idx}`}
                                        </div>
                                    </div>
                                    <div className="text-[10px] opacity-70">{date.toLocaleDateString()} {date.toLocaleTimeString()}</div>
                                    
                                    <div className="absolute right-1 top-2 z-10 opacity-0 group-hover:opacity-100 flex flex-col gap-1 transition-opacity z-10">
                                        <button 
                                            onClick={(e) => startRenaming(e, report)} 
                                            className="p-1 text-slate-500 hover:text-primary-400 hover:bg-slate-950 rounded z-20"
                                        >
                                            <Edit2 size={12} />
                                        </button>
                                        <button 
                                            onClick={(e) => deleteAnalysis(e, report.id)} 
                                            className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-950 rounded z-20"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>

        <div className="flex-1 space-y-8">
            <div className="flex items-center justify-between bg-slate-900/80 backdrop-blur p-4 rounded-2xl shadow-xl border border-slate-800 sticky top-0 z-10">
                <div>
                    <h2 className="text-xl font-bold text-slate-100">{activeAnalysis.name || "Relatório da Análise"}</h2>
                    <div className="text-xs text-slate-500 mt-1">Gerado a: {new Date(activeAnalysis.generatedAt).toLocaleString()}</div>
                </div>
                <button onClick={() => exportToWord(activeAnalysis, activeAnalysis.name)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 border border-slate-700 transition-colors">
                <FileText size={16} /> Exportar Word
                </button>
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 text-white p-8 rounded-2xl shadow-lg relative overflow-hidden">
            <h3 className="font-bold text-lg mb-4 text-primary-400">Conclusão Geral</h3>
            <p className="text-slate-300 leading-relaxed relative z-10">{activeAnalysis.generalConclusion}</p>
            </div>

            <div className="space-y-6">
            {activeAnalysis.results.map((result) => (
                <div key={result.factId} className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 overflow-hidden">
                <div className="p-6 border-b border-slate-800 flex justify-between items-start gap-4">
                    <div className="flex gap-4">
                        <span className="text-slate-600 font-mono text-sm mt-1">ID:{result.factId.substring(0,4)}</span>
                        <h4 className="font-semibold text-slate-200 text-lg leading-snug">{result.factText}</h4>
                    </div>
                    <span className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap uppercase tracking-wide border
                    ${result.status === 'Confirmado' ? 'bg-green-950/30 text-green-400 border-green-900/50' : ''}
                    ${result.status === 'Desmentido' ? 'bg-red-950/30 text-red-400 border-red-900/50' : ''}
                    ${result.status.includes('Inconclusivo') ? 'bg-amber-950/30 text-amber-400 border-amber-900/50' : ''}
                    ${result.status === 'Não Mencionado' ? 'bg-slate-800 text-slate-400 border-slate-700' : ''}`}>
                    {result.status}
                    </span>
                </div>
                
                <div className="p-6">
                    <p className="text-slate-400 text-sm mb-6 leading-relaxed border-l-2 border-slate-700 pl-4">{result.summary}</p>
                    {result.citations.length > 0 && (
                    <div className="bg-slate-950/50 rounded-xl p-4 space-y-3 border border-slate-800/50">
                        <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Evidências Detetadas</h5>
                        {result.citations.map((cit, idx) => (
                        <div key={idx} className="flex gap-3 group items-start">
                            <button 
                            onClick={() => playCitation(cit)}
                            className="mt-1 flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-primary-400 hover:bg-primary-600 hover:text-white transition-all shadow-sm"
                            title="Reproduzir trecho"
                            >
                                <PlayCircle size={14} fill="currentColor" className="opacity-80" />
                            </button>
                            <div className="text-sm">
                                <div className="text-slate-300 italic mb-1 whitespace-pre-wrap leading-relaxed">
                                    "{cit.text}"
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-primary-300 bg-primary-900/30 px-2 py-0.5 rounded border border-primary-900/50">
                                    {cit.audioFileName}
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-mono">@ {cit.timestamp}</span>
                                </div>
                            </div>
                        </div>
                        ))}
                    </div>
                    )}
                </div>
                </div>
            ))}
            </div>
        </div>
      </div>
    );
  };

  const renderChat = () => (
    <div className="max-w-3xl mx-auto h-[calc(100vh-140px)] flex flex-col bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden">
      <div className="p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
        <div>
            <h3 className="font-bold text-slate-100 flex items-center gap-2"><MessageSquare className="text-primary-500" /> Assistente Forense</h3>
            <p className="text-xs text-slate-500 mt-1">Interaja diretamente com a base de dados.</p>
        </div>
        {project.chatHistory.length > 0 && (
            <button onClick={clearChatHistory} className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors" title="Apagar histórico">
                <Trash2 size={16} />
            </button>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-950/30">
        {project.chatHistory.length === 0 ? (
            <div className="text-center text-slate-600 mt-20"><p>Comece uma conversa com a IA sobre os seus áudios.</p></div>
        ) : (
            project.chatHistory.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group relative`}>
                    {msg.role === 'user' && (
                        <button onClick={() => deleteChatMessage(msg.id)} className="mr-2 self-center p-1 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={14} />
                        </button>
                    )}
                    <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-br-none' : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-bl-none'}`}>
                        {msg.role === 'model' ? renderMessageContent(msg.text) : msg.text}
                    </div>
                    {msg.role === 'model' && (
                        <button onClick={() => deleteChatMessage(msg.id)} className="ml-2 self-center p-1 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={14} />
                        </button>
                    )}
                </div>
            ))
        )}
        {isChatting && (
           <div className="flex justify-start">
             <div className="bg-slate-800 border border-slate-700 p-4 rounded-2xl rounded-bl-none shadow-sm flex gap-3 items-center">
                <Loader2 size={16} className="animate-spin text-primary-500" />
                <span className="text-xs text-slate-400">A processar informação...</span>
             </div>
           </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <div className="flex gap-3">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
            placeholder="Faça uma pergunta sobre os factos..."
            disabled={isChatting}
            className="flex-1 p-3 px-4 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm transition-all"
          />
          <button onClick={sendChatMessage} disabled={isChatting || !chatInput.trim()} className="p-3 bg-primary-600 text-white rounded-xl hover:bg-primary-500 disabled:opacity-50 disabled:bg-slate-800 shadow-lg transition-all">
            <MessageSquare size={20} />
          </button>
        </div>
      </div>
    </div>
  );

  if (!apiKey) {
      return renderApiKeyModal();
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-primary-500/30">
      <aside className="w-28 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 z-20 overflow-y-auto">
        <div className="h-20 flex flex-col items-center justify-center border-b border-slate-800/50 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center font-bold text-lg shadow-lg shadow-primary-900/20 text-white">V</div>
            <span className="text-[10px] font-bold mt-2 tracking-widest text-slate-400 uppercase">Veritas</span>
        </div>
        <nav className="flex-1 px-2 space-y-4 py-4">
          <div className="space-y-2">
            <button onClick={() => setCurrentView('setup')} className={`w-full flex flex-col items-center justify-center p-3 rounded-xl gap-1.5 transition-all duration-200 text-center ${currentView === 'setup' ? 'bg-slate-800 text-white shadow-md border border-slate-700' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>
                <Database size={22} />
                <span className="text-[10px] font-medium leading-tight">Base Dados</span>
            </button>
            <button onClick={() => setCurrentView('analysis')} className={`w-full flex flex-col items-center justify-center p-3 rounded-xl gap-1.5 transition-all duration-200 text-center ${currentView === 'analysis' ? 'bg-slate-800 text-white shadow-md border border-slate-700' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>
                <FileText size={22} />
                <span className="text-[10px] font-medium leading-tight">Relatório</span>
            </button>
            <button onClick={() => setCurrentView('chat')} className={`w-full flex flex-col items-center justify-center p-3 rounded-xl gap-1.5 transition-all duration-200 text-center ${currentView === 'chat' ? 'bg-slate-800 text-white shadow-md border border-slate-700' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>
                <MessageSquare size={22} />
                <span className="text-[10px] font-medium leading-tight">Chat IA</span>
            </button>
          </div>
          <div className="border-t border-slate-800 pt-4 space-y-2">
            <p className="text-[9px] text-center text-slate-600 uppercase font-bold mb-1">Dados</p>
            <button onClick={() => saveDatabaseFile(project, audioFiles)} className="w-full flex flex-col items-center justify-center p-2 rounded-lg gap-1 text-slate-500 hover:text-primary-400 hover:bg-slate-800/50 transition-colors" title="Guardar Base de Dados">
                  <Save size={18} />
                  <span className="text-[9px] font-bold">Guardar</span>
            </button>
            <div className="relative group w-full">
                  <input type="file" accept=".json" onChange={(e) => handleSmartUpload(e, 'database_btn')} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" />
                  <button className="w-full flex flex-col items-center justify-center p-2 rounded-lg gap-1 text-slate-500 group-hover:text-primary-400 group-hover:bg-slate-800/50 transition-colors" title="Carregar Base de Dados">
                      <Upload size={18} />
                      <span className="text-[9px] font-bold">Carregar</span>
                  </button>
            </div>
          </div>
           <div className="border-t border-slate-800 pt-4 space-y-2">
             <p className="text-[9px] text-center text-slate-600 uppercase font-bold mb-1">Projeto</p>
             <button onClick={() => saveProjectFile(project)} className="w-full flex flex-col items-center justify-center p-2 rounded-lg gap-1 text-slate-500 hover:text-primary-400 hover:bg-slate-800/50 transition-colors" title="Guardar Projeto">
                  <Save size={18} />
                  <span className="text-[9px] font-bold">Guardar</span>
            </button>
            <div className="relative group w-full">
                  <input type="file" accept=".json" onChange={(e) => handleSmartUpload(e, 'project_btn')} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" />
                  <button className="w-full flex flex-col items-center justify-center p-2 rounded-lg gap-1 text-slate-500 group-hover:text-primary-400 group-hover:bg-slate-800/50 transition-colors" title="Carregar Projeto">
                      <Upload size={18} />
                      <span className="text-[9px] font-bold">Carregar</span>
                  </button>
            </div>
          </div>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto relative bg-slate-950">
        <header className="h-20 flex items-center justify-between px-8 sticky top-0 z-20 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/50">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                  {currentView === 'setup' && 'Configuração e Dados'}
                  {currentView === 'analysis' && 'Análise de Factos'}
                  {currentView === 'chat' && 'Assistente Inteligente'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">Veritas Audio Analyst v1.0</p>
            </div>
            <div className="flex items-center gap-4">
               {isAnalyzing && (
                 <div className="flex items-center gap-2 px-3 py-1 bg-primary-900/20 rounded-full border border-primary-900/50">
                    <Loader2 size={12} className="animate-spin text-primary-500" />
                    <span className="text-xs text-primary-400 font-bold uppercase tracking-wider">A Analisar</span>
                 </div>
               )}
               {processingQueue.length > 0 && (
                 <div className="flex items-center gap-2 px-3 py-1 bg-blue-900/20 rounded-full border border-blue-900/50">
                    <Loader2 size={12} className="animate-spin text-blue-500" />
                    <span className="text-xs text-blue-400 font-bold uppercase tracking-wider">Fila: {processingQueue.length}</span>
                 </div>
               )}
               <div className="flex items-center gap-3">
                   <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" title="API Ligada"></span>
                   <button onClick={handleLogout} className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800/50 rounded-lg transition-colors" title="Sair / Alterar Chave">
                       <Key size={18} />
                   </button>
               </div>
            </div>
        </header>
        <div className="p-8">
            {currentView === 'setup' && renderSetup()}
            {currentView === 'analysis' && renderAnalysis()}
            {currentView === 'chat' && renderChat()}
        </div>
      </main>
      <AudioPlayer activeFile={activeAudioFile} seekTo={seekTimestamp} onClose={() => setActiveAudioFile(null)} />
    </div>
  );
};

export default App;