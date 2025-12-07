
import React, { useEffect, useRef, useState } from 'react';
import { EvidenceFile, ProcessedContent } from '../types';
import { Play, Pause, X, Rewind, FastForward, FileText, User, ExternalLink } from 'lucide-react';

interface EvidenceViewerProps {
  file: EvidenceFile | null;
  processedData: ProcessedContent | undefined;
  initialSeekSeconds: number | null;
  personName?: string;
  onClose: () => void;
}

const EvidenceViewer: React.FC<EvidenceViewerProps> = ({ 
  file, 
  processedData, 
  initialSeekSeconds, 
  personName,
  onClose 
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);
  
  // URL temporário para o ficheiro original
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  // --- FILE URL MANAGEMENT ---
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

  // --- AUDIO LOGIC ---
  
  const handleLoadedMetadata = () => {
      const audio = audioRef.current;
      if (!audio) return;

      setDuration(audio.duration);

      // Perform initial seek and play if requested
      if (initialSeekSeconds !== null && isAudio) {
          audio.currentTime = Math.max(0, initialSeekSeconds);
          
          // Use a small timeout to ensure browser allows play action and state is stable
          setTimeout(() => {
              if (audio) {
                  const playPromise = audio.play();
                  if (playPromise !== undefined) {
                      playPromise
                        .then(() => setIsPlaying(true))
                        .catch(err => {
                            console.warn("Auto-play prevented (browser policy) or interrupted:", err);
                            setIsPlaying(false);
                        });
                  }
              }
          }, 100);
      }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      if(!Number.isNaN(audioRef.current.duration)) {
          setDuration(audioRef.current.duration);
      }

      // Find active segment
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
          audioRef.current.play()
              .then(() => setIsPlaying(true))
              .catch(console.error);
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
      if (audioRef.current) {
          audioRef.current.currentTime += amount;
      }
  };

  const formatTime = (time: number) => {
      if (Number.isNaN(time)) return "00:00";
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  if (!file) return null;

  const isAudio = file.type === 'AUDIO';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
       {/* 80% Screen Modal */}
       <div className="bg-slate-900 w-[90%] h-[85%] max-w-6xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700 animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header */}
          <div className="h-16 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
             <div className="flex items-center gap-4">
                 <div className={`p-2 rounded-lg ${isAudio ? 'bg-primary-900/30 text-primary-400' : 'bg-orange-900/30 text-orange-400'}`}>
                     {isAudio ? <Play size={20} /> : <FileText size={20} />}
                 </div>
                 <div>
                     <h2 className="text-lg font-bold text-white truncate max-w-md">{file.name}</h2>
                     {personName && (
                         <div className="flex items-center gap-1.5 text-xs text-slate-400">
                             <User size={12} /> {personName}
                         </div>
                     )}
                 </div>
             </div>
             
             <div className="flex items-center gap-2">
                 {fileUrl && (
                     <a 
                         href={fileUrl}
                         target="_blank"
                         rel="noreferrer"
                         className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors group border border-transparent hover:border-slate-700"
                         title="Abrir ficheiro original num novo separador"
                     >
                         <ExternalLink size={18} />
                         <span className="hidden sm:inline text-xs font-bold group-hover:underline">Abrir Original</span>
                     </a>
                 )}
                 <div className="w-px h-6 bg-slate-800 mx-2"></div>
                 <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                     <X size={24} />
                 </button>
             </div>
          </div>

          {/* Body */}
          <div className="flex-1 flex overflow-hidden">
             
             {/* Left Panel: Media / Visuals */}
             <div className="w-1/3 bg-slate-925 border-r border-slate-800 flex flex-col p-6 items-center justify-center relative">
                 {isAudio ? (
                     <div className="w-full space-y-8">
                         {/* Visualization Placeholder */}
                         <div className="aspect-video bg-slate-900 rounded-2xl border border-slate-800 shadow-inner flex items-center justify-center relative overflow-hidden group">
                             <div className="absolute inset-0 bg-gradient-to-br from-primary-900/10 to-transparent"></div>
                             {isPlaying && (
                                 <div className="flex gap-1 items-end h-12">
                                     {[...Array(8)].map((_, i) => (
                                         <div key={i} className="w-2 bg-primary-500 animate-pulse" style={{ height: `${Math.random() * 100}%`, animationDuration: `${0.5 + Math.random()}s` }}></div>
                                     ))}
                                 </div>
                             )}
                             {!isPlaying && <Play size={48} className="text-slate-700" />}
                         </div>

                         {/* Controls */}
                         <div className="space-y-4">
                             <div className="flex justify-between text-xs font-mono text-slate-400">
                                 <span>{formatTime(currentTime)}</span>
                                 <span>{formatTime(duration)}</span>
                             </div>
                             <input 
                                type="range" 
                                min="0" 
                                max={duration || 100} 
                                value={currentTime}
                                onChange={(e) => {
                                    if(audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value);
                                }}
                                className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full"
                             />
                             
                             <div className="flex items-center justify-center gap-6">
                                 <button onClick={() => skip(-10)} className="text-slate-400 hover:text-white p-2"><Rewind size={20} /></button>
                                 <button 
                                    onClick={togglePlay}
                                    className="w-14 h-14 bg-primary-600 hover:bg-primary-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-primary-900/30 transition-transform active:scale-95"
                                 >
                                     {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                                 </button>
                                 <button onClick={() => skip(10)} className="text-slate-400 hover:text-white p-2"><FastForward size={20} /></button>
                             </div>
                         </div>
                     </div>
                 ) : (
                     <div className="text-center space-y-4 w-full h-full flex flex-col items-center justify-center">
                         {/* Link que cobre o ícone para abrir original */}
                         {fileUrl ? (
                             <a 
                                href={fileUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="group cursor-pointer flex flex-col items-center justify-center w-full h-64 hover:bg-slate-900 rounded-2xl transition-colors"
                             >
                                 <div className="w-24 h-24 bg-slate-800 group-hover:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto transition-colors shadow-lg border border-slate-700 group-hover:border-primary-500/50">
                                     <FileText size={40} className="text-slate-500 group-hover:text-primary-400" />
                                 </div>
                                 <p className="text-sm text-slate-400 mt-4 font-bold group-hover:text-primary-400 flex items-center gap-2">
                                     Visualização de Documento <ExternalLink size={12}/>
                                 </p>
                                 <p className="text-xs text-slate-600 mt-2">Clique para abrir original</p>
                             </a>
                         ) : (
                             <div className="flex flex-col items-center justify-center">
                                 <div className="w-24 h-24 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-50">
                                     <FileText size={40} className="text-slate-500" />
                                 </div>
                                 <p className="text-sm text-slate-400 font-bold">Documento Virtual</p>
                                 <p className="text-xs text-slate-600 mt-1">Ficheiro original não disponível.</p>
                             </div>
                         )}

                         <div className="text-xs text-slate-600 bg-slate-900 p-3 rounded border border-slate-800 text-left space-y-2 mt-auto w-full">
                             <p>Este painel mostra a <strong>versão digitalizada/extraída</strong> pela IA.</p>
                         </div>
                     </div>
                 )}
             </div>

             {/* Right Panel: Transcript / Text */}
             <div className="flex-1 bg-slate-900 flex flex-col relative">
                 <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-slate-900 to-transparent z-10 pointer-events-none"></div>
                 
                 <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-8 space-y-4 scroll-smooth">
                     {processedData ? (
                         processedData.segments.map((seg, idx) => (
                             <div 
                                id={`seg-${idx}`}
                                key={idx} 
                                onClick={() => isAudio && jumpToSegment(seg.seconds)}
                                className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer group
                                    ${activeSegmentIndex === idx && isAudio 
                                        ? 'bg-primary-900/20 border-primary-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)] scale-[1.01]' 
                                        : 'bg-transparent border-transparent hover:bg-slate-800/50 hover:border-slate-700'}
                                `}
                             >
                                 <div className="flex gap-4">
                                     <span className={`text-xs font-mono font-bold mt-1 min-w-[3rem] ${activeSegmentIndex === idx ? 'text-primary-400' : 'text-slate-600'}`}>
                                         {seg.timestamp}
                                     </span>
                                     <p className={`text-base leading-relaxed whitespace-pre-wrap ${activeSegmentIndex === idx ? 'text-white' : 'text-slate-300'}`}>
                                         {seg.text}
                                     </p>
                                 </div>
                             </div>
                         ))
                     ) : (
                         <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                             <p>A carregar transcrição...</p>
                         </div>
                     )}
                 </div>

                 <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-900 to-transparent z-10 pointer-events-none"></div>
             </div>
          </div>
       </div>

       {/* Hidden Audio Element with Metadata Handler */}
       {fileUrl && isAudio && (
           <audio 
               ref={audioRef}
               src={fileUrl}
               onLoadedMetadata={handleLoadedMetadata}
               onTimeUpdate={handleTimeUpdate}
               onEnded={() => setIsPlaying(false)}
               className="hidden"
           />
       )}
    </div>
  );
};

export default EvidenceViewer;
