"use client";

import { useCallback, useRef, useState } from "react";

type Status = "idle" | "recording" | "transcribing";

/**
 * Records microphone audio with MediaRecorder and sends it to the server for
 * transcription. All recognition happens server-side so no vendor key reaches
 * the browser, and the provider can be swapped without touching this component.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Type your answer instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        setStatus("transcribing");
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const body = new FormData();
        body.append("audio", blob, "recording.webm");
        try {
          const response = await fetch("/api/transcribe", { method: "POST", body });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Transcription failed");
          onText(payload.text as string);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Transcription failed.");
        } finally {
          setStatus("idle");
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus("recording");
    } catch {
      setError("Microphone permission was denied. Type your answer instead.");
    }
  }, [onText]);

  const toggle = useCallback(() => { if (status === "recording") stop(); else if (status === "idle") void start(); }, [start, status, stop]);

  return { status, error, toggle };
}

export function VoiceButton({ onText, label = "Dictate" }: { onText: (text: string) => void; label?: string }) {
  const { status, error, toggle } = useVoiceInput(onText);
  const text = status === "recording" ? "Stop recording" : status === "transcribing" ? "Transcribing…" : label;
  return <div className="voice-input">
    <button type="button" className={`voice-button ${status}`} onClick={toggle} disabled={status === "transcribing"}>
      <span className="voice-dot" />{text}
    </button>
    {error && <small className="voice-error">{error}</small>}
  </div>;
}
