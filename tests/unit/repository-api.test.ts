/**
 * Repository API contract tests for the remaining Task 1 CRUD methods.
 * Dexie is mocked with in-memory stores so these run in the node-only vitest
 * environment (DOM flows are covered by Playwright).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Flashcard, Session } from '../../src/shared/types';

const { sessionStore, cardStore } = vi.hoisted(() => ({
  sessionStore: new Map<string, Session>(),
  cardStore: new Map<string, Flashcard>(),
}));

vi.mock('../../src/db/schema', () => ({
  db: {
    sessions: {
      async toArray(): Promise<Session[]> {
        return Array.from(sessionStore.values()).map(s => structuredClone(s));
      },
    },
    flashcards: {
      where(index: string) {
        return {
          equals(value: unknown) {
            return {
              async toArray(): Promise<Flashcard[]> {
                return Array.from(cardStore.values())
                  .filter(c => (c as unknown as Record<string, unknown>)[index] === value)
                  .map(c => structuredClone(c));
              },
            };
          },
        };
      },
    },
  },
}));

import { sessionsRepo } from '../../src/db/repositories/sessions';
import { flashcardsRepo } from '../../src/db/repositories/flashcards';

function makeSession(id: string, completedAt?: string): Session {
  return {
    id,
    mode: 'practice',
    startedAt: '2024-01-01T00:00:00.000Z',
    ...(completedAt ? { completedAt } : {}),
    config: {},
    topicCodes: [],
  };
}

function makeCard(id: string, questionId: string): Flashcard {
  return {
    id,
    questionId,
    front: `Front ${id}`,
    back: `Back ${id}`,
    type: 'qa',
    dueDate: '2024-01-01',
    interval: 0,
    easeFactor: 2.5,
    reps: 0,
    lapses: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  sessionStore.clear();
  cardStore.clear();
});

describe('sessionsRepo.getCompleted', () => {
  it('returns only sessions with a completion timestamp, newest first', async () => {
    sessionStore.set('older', makeSession('older', '2024-01-02T00:00:00.000Z'));
    sessionStore.set('open', makeSession('open'));
    sessionStore.set('newer', makeSession('newer', '2024-01-05T00:00:00.000Z'));

    const result = await sessionsRepo.getCompleted();
    expect(result.map(s => s.id)).toEqual(['newer', 'older']);
  });
});

describe('flashcardsRepo.getByQuestionId', () => {
  it('returns only cards linked to the requested question', async () => {
    cardStore.set('a', makeCard('a', 'q-1'));
    cardStore.set('b', makeCard('b', 'q-2'));
    cardStore.set('c', makeCard('c', 'q-1'));

    expect((await flashcardsRepo.getByQuestionId('q-1')).map(c => c.id).sort()).toEqual(['a', 'c']);
    expect(await flashcardsRepo.getByQuestionId('missing')).toEqual([]);
  });
});
