import React, { useEffect, useRef, useState } from 'react';
import { EvidenceFile } from '../types';
import { Play, Pause, Volume2, X } from 'lucide-react';

interface AudioPlayerProps {
  activeFile: EvidenceFile | null;
  seekTo: number | null; // Seconds to seek to
  onClose: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ activeFile, seekTo, onClose }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Handle new file loading
  useEffect(() => {
    if (activeFile && activeFile.file && audioRef.current) {
      const url = URL.createObjectURL(activeFile.file);
      audioRef.current.src = url;
      
      // Note: We do NOT play immediately here. 
      // We wait for onLoadedMetadata to handle seeking and initial play
      // to avoid "currentTime" errors before metadata exists.

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [activeFile]);

  // Handle Seek Request when file is already loaded
  useEffect(() => {
    if (audioRef.current && seekTo !== null && activeFile && !isNaN(seekTo)) {
        // If metadata is already loaded (duration > 0), we can seek immediately
        if (audioRef.current.readyState >= 1) { // HAVE_METADATA
            audioRef.current.currentTime = Math.max(0, seekTo);
            if (!isPlaying) {
                audioRef.current.play().catch(console.error);
                setIsPlaying(true);
            }
        }
        // If metadata isn't loaded yet, the onLoadedMetadata handler will catch this
        // because seekTo is in props.
    }
  }, [seekTo]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
        // 1. Seek if requested
        if (seekTo !== null && Number.isFinite(seekTo)) {
            audioRef.current.currentTime = Math.max(0, seekTo);
        }
        
        // 2. Auto-play
        audioRef.current.play()
            .then(() => setIsPlaying(true))
            .catch(err => console.error("Auto-play blocked:", err));
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
      const pct = (audioRef.current.currentTime / audioRef.current.duration) * 100;
      setProgress(pct || 0);
    }
  };

  if (!activeFile) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.4)] p-4 z-50">
      <div className="max-w-4xl mx-auto flex items-center gap-6">
        
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={20} />
        </button>

        <div className="flex-1">
            <h4 className="text-sm font-semibold text-slate-200 truncate">{activeFile.name}</h4>
            <div className="w-full bg-slate-800 h-1.5 mt-2 rounded-full overflow-hidden">
                <div 
                    className="bg-primary-500 h-full transition-all duration-200 shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                    style={{ width: `${progress}%` }} 
                />
            </div>
        </div>

        <div className="flex items-center gap-4">
            <button 
                onClick={togglePlay}
                className="w-12 h-12 flex items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-500 hover:scale-105 transition-all shadow-lg"
            >
                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
            </button>
            <div className="flex items-center gap-2 text-slate-500">
                <Volume2 size={18} />
            </div>
        </div>

        <audio 
            ref={audioRef} 
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate} 
            onEnded={() => setIsPlaying(false)}
        />
      </div>
    </div>
  );
};

export default AudioPlayer;