import type { AnswerMemoryItem } from "@applypilot/shared";
import { getExtensionSupabase, getExtensionUser } from "./supabase";

const MEMORY_KEY = "answerMemory";
const MAX_MEMORY_ITEMS = 200;

function terms(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(/\s+/).filter((word) => word.length > 2));
}

function similarity(left: string, right: string) {
  const a = terms(left);
  const b = terms(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

export async function getLocalMemory(): Promise<AnswerMemoryItem[]> {
  const result = await chrome.storage.local.get(MEMORY_KEY);
  return Array.isArray(result[MEMORY_KEY]) ? result[MEMORY_KEY] as AnswerMemoryItem[] : [];
}

export async function findLocalMemory(question: string): Promise<AnswerMemoryItem | null> {
  const items = await getLocalMemory();
  const match = items.map((item) => ({ item, score: similarity(question, item.question) })).sort((a, b) => b.score - a.score)[0];
  return match && match.score >= 0.55 ? match.item : null;
}

export async function saveAnswerMemory(input: Omit<AnswerMemoryItem, "id" | "updatedAt">) {
  const item: AnswerMemoryItem = { ...input, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
  const existing = await getLocalMemory();
  const next = [item, ...existing.filter((old) => old.question.toLowerCase() !== item.question.toLowerCase())].slice(0, MAX_MEMORY_ITEMS);
  await chrome.storage.local.set({ [MEMORY_KEY]: next });

  const supabase = getExtensionSupabase();
  const user = await getExtensionUser();
  if (supabase && user) {
    await supabase.from("answer_library").upsert({ user_id: user.id, question: item.question, answer: item.answer, category: item.intent ?? "unknown", tags: [item.source, "extension"] });
  }
  return item;
}
