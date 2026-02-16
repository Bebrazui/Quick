import { useState, useRef, useEffect } from 'react';
import { Pause, Play } from 'lucide-react';
import { DirectMessage } from '../lib/nostr';
import { downloadChunkedTransfer } from '../lib/chunkStore';

interface AudioPlayerProps {
  message: DirectMessage;
  isMe: boolean;
}

export default function AudioPlayer({ message, isMe }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const getAudioUrl = async () => {
      if (!message.attachment) return;
      setIsLoading(true);
      if (message.attachment.chunked && message.attachment.transferId) {
        try {
          const blob = await downloadChunkedTransfer(
            message.attachment.transferId,
            message.attachment.name,
            message.attachment.mimeType,
            true,
          );
          if (blob) {
            setAudioUrl(URL.createObjectURL(blob));
          }
        } catch (error) {
            console.error("Failed to load chunked audio:", error);
        }
      } else if (message.attachment.data) {
        setAudioUrl(`data:${message.attachment.mimeType};base64,${message.attachment.data}`);
      }
      setIsLoading(false);
    };
    getAudioUrl();
  }, [message.attachment]);

  useEffect(() => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onloadedmetadata = () => setDuration(audio.duration);
      audio.ontimeupdate = () => setProgress(audio.currentTime);
      audio.onplay = () => setIsPlaying(true);
      audio.onpause = () => setIsPlaying(false);
      audio.onended = () => {
        setIsPlaying(false);
        setProgress(0);
      };
    }
    return () => {
      audioRef.current?.pause();
      if (audioUrl && audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const handleTogglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    audioRef.current.currentTime = duration * percentage;
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) time = 0;
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex items-center gap-2 w-64 md:w-80 ${isMe ? 'text-white' : 'text-text'}`}>
      <button onClick={handleTogglePlay} disabled={!audioUrl || isLoading} className={`p-2 rounded-full text-sm disabled:opacity-50 ${isMe ? 'hover:bg-white/20' : 'hover:bg-bg-hover'}`}>
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
      </button>
      <div className="flex-1 flex items-center gap-2">
        <div className="w-full h-8 flex items-center cursor-pointer" onClick={handleSeek}>
          <div className={`w-full h-1.5 rounded-full relative ${isMe ? 'bg-white/20' : 'bg-bg-tertiary'}`}>
            <div
              className={`h-full rounded-full ${isMe ? 'bg-white' : 'bg-accent'}`}
              style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%` }}
            />
            <div
              className={`absolute h-3 w-3 rounded-full -top-1 border ${isMe ? 'bg-white border-white/50' : 'bg-white border-border'}`}
              style={{ left: `calc(${duration > 0 ? (progress / duration) * 100 : 0}% - 6px)` }}
            />
          </div>
        </div>
        <span className={`text-xs w-14 text-right ${isMe ? 'text-white/70' : 'text-text-muted'}`}>
          {formatTime(duration ? duration - progress : 0)}
        </span>
      </div>
    </div>
  );
}
