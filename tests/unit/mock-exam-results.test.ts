/**
 * Mock exam results review (Phase 3, Task 5): pure result aggregation and
 * answer-label helpers. The DOM card itself is covered by the Playwright flow.
 */
import { describe, expect, it } from 'vitest';
import {
  answerLetters,
  buildReviewAnswer,
  copyMockExamConfig,
  formatTimeSpent,
  getReviewTopicStats,
  optionLetter,
  type MockExamConfig,
} from '../../src/views/MockExamView';
import type { Question, TopicCode } from '../../src/shared/types';

function makeQuestion(id: string, topicCode: TopicCode, correctAnswer = [1]): Question {
  return {
    id,
    topicCode,
    stem: `Stem ${id}`,
    options: ['A', 'B', 'C', 'D', 'E'].map(text => ({ id: `${id}-${text}`, text, isCorrect: correctAnswer.includes(['A', 'B', 'C', 'D', 'E'].indexOf(text)) })),
    correctAnswer,
    explanation: `Explanation ${id}`,
    difficulty: 2,
    tags: [],
    flags: { bookmarked: false, needsReview: false, disputed: false },
    metadata: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1, author: 'user' },
    statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0, total: 0, mastered: 0, learning: 0, new: 0 },
  };
}

const answer = (isCorrect: boolean) => ({ userAnswer: [isCorrect ? 1 : 3], isCorrect, timeMs: 1000, flagged: false, markedReview: false });

describe('mock exam result time', () => {
  it('formats elapsed time as MM:SS and clamps invalid values', () => {
    expect(formatTimeSpent(0)).toBe('00:00');
    expect(formatTimeSpent(65_137)).toBe('01:05');
    expect(formatTimeSpent(90 * 60_000)).toBe('90:00');
    expect(formatTimeSpent(-1_000)).toBe('00:00');
    expect(formatTimeSpent(Number.NaN)).toBe('00:00');
  });
});

describe('mock exam per-topic results', () => {
  it('counts only attempted questions and derives percent from correct/attempted', () => {
    const questions = [
      makeQuestion('q1', 'UM-01'),
      makeQuestion('q2', 'UM-01'),
      makeQuestion('q3', 'KH-01'),
      makeQuestion('q4', 'KH-01'),
    ];
    const answers = new Map([
      ['q1', answer(true)],
      ['q2', answer(false)],
      ['q3', answer(true)],
    ]);

    expect(getReviewTopicStats(questions, answers)).toEqual({
      'UM-01': { attempted: 2, correct: 1, scorePercent: 50 },
      'KH-01': { attempted: 1, correct: 1, scorePercent: 100 },
    });
  });

  it('keeps topics with no answers visible at 0%', () => {
    const stats = getReviewTopicStats([makeQuestion('q1', 'UM-02')], new Map());
    expect(stats['UM-02']).toEqual({ attempted: 0, correct: 0, scorePercent: 0 });
  });
});

describe('mock exam retake configuration', () => {
  it('snapshots the finished exam config without sharing nested state', () => {
    const config: MockExamConfig = {
      durationMinutes: 90,
      questionCount: 100,
      topicCodes: ['UM-01', 'KH-01'],
      topicWeights: { 'UM-01': 1, 'KH-01': 1.5 },
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
    };

    const snapshot = copyMockExamConfig(config);
    expect(snapshot).toEqual(config);

    snapshot.topicCodes.pop();
    snapshot.topicWeights['UM-01'] = 9;
    snapshot.difficultyMix[1] = 100;
    expect(config.topicCodes).toHaveLength(2);
    expect(config.topicWeights['UM-01']).toBe(1);
    expect(config.difficultyMix[1]).toBe(30);
  });
});

describe('mock exam review answer labels', () => {
  it('maps option indices to letters and joins multi-select answers', () => {
    expect(optionLetter(0)).toBe('A');
    expect(optionLetter(4)).toBe('E');
    expect(optionLetter(-1)).toBe('?');
    expect(optionLetter(26)).toBe('?');
    expect(answerLetters([0, 2])).toBe('A, C');
    expect(answerLetters([])).toBe('—');
    expect(answerLetters(undefined)).toBe('—');
  });

  it('describes answered and unanswered questions for the review card', () => {
    const question = makeQuestion('q1', 'UM-01', [1]);
    expect(buildReviewAnswer(question, answer(false))).toMatchObject({
      userAnswerLetters: 'D',
      correctAnswerLetters: 'B',
      isCorrect: false,
      answered: true,
      timeMs: 1000,
    });
    expect(buildReviewAnswer(question, undefined)).toMatchObject({
      userAnswerLetters: '—',
      correctAnswerLetters: 'B',
      isCorrect: false,
      answered: false,
    });
  });
});
