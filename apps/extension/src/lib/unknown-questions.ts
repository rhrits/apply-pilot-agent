import type { PageSummary } from "@applypilot/shared";
import { getExtensionSupabase, getExtensionUser } from "./supabase";

const KEY = "unknownQuestions";

export interface UnknownQuestion {
  id: string;
  question: string;
  page: PageSummary;
  createdAt: string;
}

export async function saveUnknownQuestion(question: string, page: PageSummary) {
  const result = await chrome.storage.local.get(KEY);
  const existing = Array.isArray(result[KEY]) ? result[KEY] as UnknownQuestion[] : [];
  const normalized = question.trim().toLowerCase();
  if (!normalized) return null;
  const item: UnknownQuestion = { id: crypto.randomUUID(), question: question.trim(), page, createdAt: new Date().toISOString() };
  const next = [item, ...existing.filter((entry) => entry.question.trim().toLowerCase() !== normalized)].slice(0, 200);
  await chrome.storage.local.set({ [KEY]: next });

  const supabase = getExtensionSupabase();
  const user = await getExtensionUser();
  if (supabase && user) {
    await supabase.from("answer_library").upsert({ user_id: user.id, question: item.question, answer: "", category: "unknown-question", tags: ["needs-answer", page.hostname] });
  }
  return item;
}
