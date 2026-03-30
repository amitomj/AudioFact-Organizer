
import React, { useEffect, useRef, useState } from 'react';
import { EvidenceFile, ProcessedContent } from '../types';
import { Play, Pause, X, Rewind, FastForward, FileText, User, ExternalLink, Search, ChevronUp, ChevronDown, Edit3, Save } from 'lucide-react';

interface EvidenceViewerProps {
  file: EvidenceFile | null;
  processedData: ProcessedContent | undefined;
  initialSeekSeconds: number | null;
  personName?: string;
  onClose: () => void;
  onRenameSpeaker: (fileId: string, oldName: string, newName: string) => void;
}

const EvidenceViewer: React.FC<EvidenceViewerProps> = ({ 
  file, 
  processedData, 
  initialSeekSeconds, 
  personName,
  onClose,
  onRenameSpeaker
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);
  
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  // Speaker Renaming State
  const [showSpeakerTools, setShowSpeakerTools] = useState(false);
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");

  useEffect(() => {
    if (file && file.file) {
      const url = URL.createObjectURL(file.file);
      setFileUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setFileUrl(null);
  }, [file]);

  // Detect Speakers on Load and when processedData changes
  useEffect(() => {
      if (processedData) {
          const speakers = new Set<string>();
          processedData.segments.forEach(seg => {
              let name = "";
              
              // Pattern 1: Bold Format (**Speaker**)
              const boldMatch = seg.text.match(/^\*\*(.*?)\*\*/);
              if (boldMatch) {
                  name = boldMatch[1].replace(':', '').trim();
              } 
              // Pattern 2: Legacy/Simple Format (Speaker:) - Must be at start of string
              else {
                  const simpleMatch = seg.text.match(/^([A-Za-zÀ-ÖØ-öø-ÿ0-9\s]+):/);
                  if (simpleMatch) {
                      name = simpleMatch[1].trim();
                  }
              }

              // Validate name
              if (name && name.length > 0 && name.length < 40 && !name.includes('\n')) {
                  speakers.add(name);
              }
          });
          
          const speakerList = Array.from(speakers).sort();
          setDetectedSpeakers(speakerList);
      }
  }, [processedData]);

  // Search Logic
  useEffect(() => {
      if (!searchQuery.trim() || !processedData) {
          setSearchResults([]);
          return;
      }
      const results = processedData.segments
          .map((seg, idx) => seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ? idx : -1)
          .filter(idx => idx !== -1);
      
      setSearchResults(results);
      setCurrentResultIndex(0);
      
      if (results.length > 0) {
          scrollToSegment(results[0]);
      }
  }, [searchQuery, processedData]);

  const handleNextResult = () => {
      if (searchResults.length === 0) return;
      const nextIndex = (currentResultIndex + 1) % searchResults.length;
      setCurrentResultIndex(nextIndex);
      const segIndex = searchResults[nextIndex];
      scrollToSegment(segIndex);
      if (processedData && isAudio) jumpToSegment(processedData.segments[segIndex].seconds);
  };

  const handlePrevResult = () => {
      if (searchResults.length === 0) return;
      const prevIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
      setCurrentResultIndex(prevIndex);
      const segIndex = searchResults[prevIndex];
      scrollToSegment(segIndex);
      if (processedData && isAudio) jumpToSegment(processedData.segments[segIndex].seconds);
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget;
      setDuration(audio.duration);

      if (initialSeekSeconds !== null && !isNaN(initialSeekSeconds)) {
          audio.currentTime = Math.max(0, initialSeekSeconds);
          audio.play().then(() => setIsPlaying(true)).catch(console.log);
      }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      if(!Number.isNaN(audioRef.current.duration)) {
          setDuration(audioRef.current.duration);
      }

      if (processedData?.segments) {
        const idx = processedData.segments.findIndex((seg, i) => {
           const nextSeg = processedData.segments[i + 1];
           return time >= seg.seconds && (nextSeg ? time < nextSeg.seconds : true);
        });
        
        if (idx !== -1 && idx !== activeSegmentIndex) {
            setActiveSegmentIndex(idx);
            scrollToSegment(idx);
        }
      }
    }
  };

  const scrollToSegment = (index: number) => {
      const el = document.getElementById(`seg-${index}`);
      if (el && scrollContainerRef.current) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
  };

  const jumpToSegment = (seconds: number) => {
      if (audioRef.current) {
          audioRef.current.currentTime = seconds;
          audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
      }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
      } else {
          audioRef.current.play().catch(console.error);
          setIsPlaying(true);
      }
    }
  };

  const skip = (amount: number) => {
      if (audioRef.current) audioRef.current.currentTime += amount;
  };

  const formatTime = (time: number) => {
      if (Number.isNaN(time)) return "00:00";
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  const renderHighlightedText = (text: string) => {
      if (!searchQuery.trim()) return text;
      const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
      return parts.map((part, i) => 
          part.toLowerCase() === searchQuery.toLowerCase() 
            ? <span key={i} className="bg-yellow-300 dark:bg-yellow-600/50 text-black dark:text-white rounded px-0.5">{part}</span> 
            : part
      );
  };
  
  const submitRename = (oldName: string) => {
      const trimmedNew = newSpeakerName.trim();
      if(file && trimmedNew && trimmedNew !== oldName) {
          onRenameSpeaker(file.id, oldName, trimmedNew);
          setEditingSpeaker(null);
          setNewSpeakerName("");
          // State will sync via processedData prop and its useEffect
      }
  };

  if (!file) return null;
  const isAudio = file.type === 'AUDIO';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
       <div className="bg-white dark:bg-slate-900 w-[90%] h-[85%] max-w-6xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200">
          
          <div className="h-16 bg-gray-50 dark:bg-slate-950 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
             <div className="flex items-center gap-4">
                 <div className={`p-2 rounded-lg ${isAudio ? 'bg-blue-100 text-blue-600 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                     {isAudio ? <Play size={20} /> : <FileText size={20} />}
                 </div>
                 <div>
                     <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate max-w-md">{file.name}</h2>
                     {personName && (
                         <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                             <User size={12} /> {personName}
                         </div>
                     )}
                 </div>
             </div>
             
             <div className="flex items-center gap-2">
                 {fileUrl && (
                     <a href={fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                         <ExternalLink size={18} />
                         <span className="hidden sm:inline text-xs font-bold">Abrir Original</span>
                     </a>
                 )}
                 <div className="w-px h-6 bg-gray-200 dark:bg-slate-800 mx-2"></div>
                 <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                     <X size={24} />
                 </button>
             </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
             <div className="w-1/3 bg-gray-50 dark:bg-slate-925 border-r border-gray-200 dark:border-slate-800 flex flex-col p-6 items-center justify-center relative">
                 {isAudio ? (
                     <div className="w-full space-y-8">
                         <div className="aspect-video bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-inner flex items-center justify-center relative overflow-hidden group">
                             <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 dark:from-primary-900/10 to-transparent"></div>
                             {isPlaying && (
                                 <div className="flex gap-1 items-end h-12">
                                     {[...Array(8)].map((_, i) => (
                                         <div key={i} className="w-2 bg-blue-500 dark:bg-primary-500 animate-pulse" style={{ height: `${Math.random() * 100}%`, animationDuration: `${0.5 + Math.random()}s` }}></div>
                                     ))}
                                 </div>
                             )}
                             {!isPlaying && <Play size={48} className="text-gray-300 dark:text-slate-700" />}
                         </div>

                         <div className="space-y-4">
                             <div className="flex justify-between text-xs font-mono text-gray-500 dark:text-slate-400">
                                 <span>{formatTime(currentTime)}</span>
                                 <span>{formatTime(duration)}</span>
                             </div>
                             <input type="range" min="0" max={duration || 100} value={currentTime} onChange={(e) => { if(audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} className="w-full h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-600 dark:[&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full" />
                             
                             <div className="flex items-center justify-center gap-6">
                                 <button onClick={() => skip(-10)} className="text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white p-2"><Rewind size={20} /></button>
                                 <button onClick={togglePlay} className="w-14 h-14 bg-blue-600 dark:bg-primary-600 hover:bg-blue-500 dark:hover:bg-primary-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-blue-500/30 dark:shadow-primary-900/30 transition-transform active:scale-95">
                                     {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                                 </button>
                                 <button onClick={() => skip(10)} className="text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white p-2"><FastForward size={20} /></button>
                             </div>
                         </div>
                     </div>
                 ) : (
                     <div className="text-center space-y-4 w-full h-full flex flex-col items-center justify-center">
                         {fileUrl ? (
                             <a href={fileUrl} target="_blank" rel="noreferrer" className="group cursor-pointer flex flex-col items-center justify-center w-full h-64 hover:bg-gray-100 dark:hover:bg-slate-900 rounded-2xl transition-colors">
                                 <div className="w-24 h-24 bg-white dark:bg-slate-800 group-hover:bg-gray-50 dark:group-hover:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto transition-colors shadow-lg border border-gray-200 dark:border-slate-700 group-hover:border-blue-400 dark:group-hover:border-primary-500/50">
                                     <FileText size={40} className="text-gray-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-primary-400" />
                                 </div>
                                 <p className="text-sm text-gray-500 dark:text-slate-400 mt-4 font-bold group-hover:text-blue-600 dark:group-hover:text-primary-400 flex items-center gap-2">Visualização de Documento <ExternalLink size={12}/></p>
                             </a>
                         ) : (
                             <div className="flex flex-col items-center justify-center">
                                 <div className="w-24 h-24 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-50 border border-gray-100 dark:border-none">
                                     <FileText size={40} className="text-gray-300 dark:text-slate-500" />
                                 </div>
                                 <p className="text-sm text-gray-500 dark:text-slate-400 font-bold">Documento Virtual</p>
                             </div>
                         )}
                     </div>
                 )}
                 
                 <div className="mt-6 w-full bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col">
                     <button onClick={() => setShowSpeakerTools(!showSpeakerTools)} className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 bg-gray-50 dark:bg-slate-900">
                         <span>Interlocutores Detectados ({detectedSpeakers.length})</span>
                         {showSpeakerTools ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                     </button>
                     
                     {showSpeakerTools && (
                         <div className="p-3 bg-white dark:bg-slate-950 max-h-48 overflow-y-auto space-y-2 border-t border-gray-100 dark:border-slate-800">
                             {detectedSpeakers.length === 0 ? (
                                 <div className="text-center text-[10px] text-gray-400 dark:text-slate-600 py-2">Nenhum interlocutor detectado.</div>
                             ) : (
                                 detectedSpeakers.map(speaker => (
                                     <div key={speaker} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 p-2 rounded border border-gray-100 dark:border-slate-800">
                                         {editingSpeaker === speaker ? (
                                             <div className="flex items-center gap-2 flex-1">
                                                 <input className="flex-1 text-xs p-1.5 bg-white dark:bg-slate-800 border border-blue-300 dark:border-primary-600 rounded text-gray-900 dark:text-white outline-none" value={newSpeakerName} onChange={e => setNewSpeakerName(e.target.value)} autoFocus onKeyDown={(e) => { if(e.key === 'Enter') submitRename(speaker); if(e.key === 'Escape') setEditingSpeaker(null); }} />
                                                 <button onClick={() => submitRename(speaker)} className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded"><Save size={14}/></button>
                                                 <button onClick={() => setEditingSpeaker(null)} className="p-1.5 bg-gray-200 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded"><X size={14}/></button>
                                             </div>
                                         ) : (
                                             <>
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-[10px] text-orange-600 dark:text-orange-400 font-bold shrink-0">{speaker.charAt(0).toUpperCase()}</div>
                                                    <span className="text-xs text-gray-700 dark:text-slate-300 font-bold truncate">{speaker}</span>
                                                </div>
                                                <button onClick={() => { setEditingSpeaker(speaker); setNewSpeakerName(speaker); }} className="text-gray-400 hover:text-blue-600 dark:hover:text-primary-400 p-1"><Edit3 size={14} /></button>
                                             </>
                                         )}
                                     </div>
                                 ))
                             )}
                         </div>
                     )}
                 </div>
             </div>

             <div className="flex-1 bg-white dark:bg-slate-900 flex flex-col relative">
                 <div className="h-12 border-b border-gray-100 dark:border-slate-800 flex items-center px-4 gap-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur z-20">
                     <Search size={16} className="text-gray-400" />
                     <input className="flex-1 bg-transparent border-none outline-none text-sm text-gray-700 dark:text-slate-300 placeholder-gray-400" placeholder="Pesquisar na transcrição..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                     {searchResults.length > 0 && (
                         <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded">
                             <span>{currentResultIndex + 1} / {searchResults.length}</span>
                             <button onClick={handlePrevResult} className="hover:text-primary-500"><ChevronUp size={14}/></button>
                             <button onClick={handleNextResult} className="hover:text-primary-500"><ChevronDown size={14}/></button>
                         </div>
                     )}
                 </div>

                 <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-8 space-y-4 scroll-smooth">
                     {processedData ? (
                         processedData.segments.map((seg, idx) => (
                             <div id={`seg-${idx}`} key={idx} onClick={() => isAudio && jumpToSegment(seg.seconds)} className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer group ${activeSegmentIndex === idx && isAudio ? 'bg-blue-50 dark:bg-primary-900/20 border-blue-200 dark:border-primary-500/50' : 'bg-transparent border-transparent hover:bg-gray-50 dark:hover:bg-slate-800/50'} ${searchResults.includes(idx) ? 'ring-2 ring-yellow-400/50' : ''}`}>
                                 <div className="flex gap-4">
                                     <span className={`text-xs font-mono font-bold mt-1 min-w-[3rem] ${activeSegmentIndex === idx ? 'text-blue-600 dark:text-primary-400' : 'text-gray-400 dark:text-slate-600'}`}>{seg.timestamp}</span>
                                     <p className={`text-base leading-relaxed whitespace-pre-wrap ${activeSegmentIndex === idx ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-600 dark:text-slate-300'}`}>{renderHighlightedText(seg.text)}</p>
                                 </div>
                             </div>
                         ))
                     ) : (
                         <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4">
                             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                             <p>A carregar transcrição...</p>
                         </div>
                     )}
                 </div>
             </div>
          </div>
       </div>

       {fileUrl && isAudio && (
           <audio ref={audioRef} src={fileUrl} onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
       )}
    </div>
  );
};

export default EvidenceViewer;
