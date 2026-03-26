import { useCallback, useRef } from "react";

interface UseCompletionSoundParams {
  soundSrc: string;
}

export function useCompletionSound({ soundSrc }: UseCompletionSoundParams) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playCompletionSound = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      const audio = new Audio(soundSrc);
      audioRef.current = audio;
      audio.volume = 0.5;
      audio.play().catch((error) => {
        console.warn("sound playback failed:", error);
      });
    } catch (error) {
      console.warn("sound playback error:", error);
    }
  }, [soundSrc]);

  return { playCompletionSound };
}
