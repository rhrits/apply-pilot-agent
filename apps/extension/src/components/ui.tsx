import { useCallback, useEffect, useRef, useState } from "react";

/** Small inline icon set. Inline SVG keeps the panel dependency-free and themable. */

const base = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function CopyIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>;
}

export function MicIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /></svg>;
}

export function StopIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>;
}

export function InsertIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
}

export function SaveIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></svg>;
}

export function SyncIcon({ size = 14 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>;
}

export function ExternalIcon({ size = 12 }: { size?: number }) {
  return <svg {...base} width={size} height={size} aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>;
}

/** Copy-to-clipboard button that confirms inline. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button
    className={`icon-button ${copied ? "ok" : ""}`}
    title={label}
    aria-label={label}
    onClick={async () => {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    }}
  >{copied ? <CheckIcon /> : <CopyIcon />}</button>;
}

type DictationStatus = "idle" | "recording" | "transcribing";

/**
 * Microphone capture with a live interim transcript.
 *
 * Interim text comes from the browser's own SpeechRecognition when available, purely
 * so the user sees words appear while speaking. The authoritative transcript always
 * comes from the server (Voxtral), which is more accurate and works in every browser.
 */
export function useDictation(onFinalText: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const stopInterim = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* recognition may already be closed */ }
    recognitionRef.current = null;
  }, []);

  const startInterim = useCallback(() => {
    const Recognition = (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Recognition) return;
    try {
      const recognition = new Recognition() as unknown as {
        continuous: boolean; interimResults: boolean; lang: string;
        onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        start: () => void; stop: () => void;
      };
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        let text = "";
        for (let index = 0; index < event.results.length; index += 1) text += event.results[index][0].transcript;
        setInterim(text.trim());
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch { /* interim preview is best-effort */ }
  }, []);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    stopInterim();
  }, [stopInterim]);

  const start = useCallback(async () => {
    setError(""); setInterim("");
    if (!navigator.mediaDevices?.getUserMedia) { setError("This browser cannot record audio."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        setStatus("transcribing");
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not read the recording."));
            reader.readAsDataURL(blob);
          });
          const result = await chrome.runtime.sendMessage({ type: "TRANSCRIBE_AUDIO", dataUrl, mimeType: blob.type });
          if (result?.error) throw new Error(result.error);
          if (result?.text) onFinalText(result.text as string);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Transcription failed.");
        } finally {
          setStatus("idle"); setInterim("");
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus("recording");
      startInterim();
    } catch { setError("Microphone permission was denied."); }
  }, [onFinalText, startInterim]);

  useEffect(() => () => stop(), [stop]);

  return { status, interim, error, toggle: () => (status === "recording" ? stop() : status === "idle" ? void start() : undefined) };
}

/** Mic button plus the live interim transcript shown beneath an input. */
export function DictationControl({ onText }: { onText: (text: string) => void }) {
  const { status, interim, error, toggle } = useDictation(onText);
  return <div className="dictation">
    <button className={`mic-button ${status}`} onClick={toggle} disabled={status === "transcribing"} title="Dictate" aria-label="Dictate">
      {status === "recording" ? <StopIcon /> : <MicIcon />}
      <span>{status === "recording" ? "Stop" : status === "transcribing" ? "Transcribing…" : "Dictate"}</span>
      {status === "recording" && <i className="pulse" />}
    </button>
    {status === "recording" && <p className="interim">{interim || "Listening…"}</p>}
    {error && <p className="dictation-error">{error}</p>}
  </div>;
}
