"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import "./answer-library.css";
import { AuthGate } from "../../components/auth-gate";

type SavedAnswer = { id: string; question: string; answer: string; category: string; tags: string[] };
const starterAnswers: SavedAnswer[] = [
  { id: "starter-1", question: "Tell us about yourself.", answer: "I am a full-stack engineer who enjoys turning ambiguous product problems into reliable, user-focused software. My strongest work combines TypeScript, React, APIs, and thoughtful iteration with users.", category: "Introduction", tags: ["about-me", "short"] },
  { id: "starter-2", question: "Why do you want to work here?", answer: "I am interested because the role combines meaningful product work with the chance to contribute as a hands-on engineer. The team’s focus aligns with the way I like to build: practical, collaborative, and measurable.", category: "Motivation", tags: ["company", "motivation"] },
];

export default function AnswerLibraryPage() { return <AuthGate><AnswerLibraryWorkspace /></AuthGate>; }

function AnswerLibraryWorkspace() {
  const [answers, setAnswers] = useState<SavedAnswer[]>(starterAnswers);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [category, setCategory] = useState("Motivation");
  const [query, setQuery] = useState("");
  useEffect(() => { const saved = localStorage.getItem("applypilot-answers"); if (saved) { try { setAnswers(JSON.parse(saved) as SavedAnswer[]); } catch { /* Keep starters. */ } } }, []);
  function save() { if (!question.trim() || !answer.trim()) return; const next = [{ id: crypto.randomUUID(), question: question.trim(), answer: answer.trim(), category, tags: [category.toLowerCase().replace(/\s+/g, "-")] }, ...answers]; setAnswers(next); localStorage.setItem("applypilot-answers", JSON.stringify(next)); setQuestion(""); setAnswer(""); }
  const filtered = answers.filter((item) => `${item.question} ${item.answer} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="main answers-page"><div className="topbar"><div><div className="eyebrow">Personal answer memory</div><h1>Answer library</h1><p className="page-subtitle">Save the answers you have reviewed so the AI adapts instead of starting from zero.</p></div><Link href="/dashboard" className="text-link">Overview</Link></div><div className="answer-layout"><section className="card answer-editor"><div className="section-head"><div><h3>Save a reusable answer</h3><p className="card-help">Your final edited answer is more valuable than a generic generated draft.</p></div><span className="step-badge">01</span></div><label>Question<input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What question should this answer handle?" /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Motivation</option><option>Introduction</option><option>Behavioral</option><option>Technical</option><option>Leadership</option><option>Other</option></select></label><label>Answer<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={9} placeholder="Write the answer in your natural voice…" /></label><button className="save-button wide" onClick={save}>Save to answer memory</button></section><section className="answer-list"><div className="answer-list-head"><div><h3>Reusable answers <span>{answers.length}</span></h3></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory…" /></div>{filtered.map((item) => <article className="answer-item" key={item.id}><div className="answer-item-head"><span>{item.category}</span><button onClick={() => navigator.clipboard.writeText(item.answer)}>Copy</button></div><h3>{item.question}</h3><p>{item.answer}</p><div className="tags">{item.tags.map((tag) => <small key={tag}>#{tag}</small>)}</div></article>)}</section></div></main>;
}
